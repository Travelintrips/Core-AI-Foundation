import { Router } from "express";
import { z } from "zod";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { getExternalAgentRegistrySnapshot } from "../services/externalAgentRegistryService.js";
import { gpt02CustodyCredentialBinding } from "../services/gpt02ReaderCustodyAttestation.js";
import { createConfiguredGpt02ReaderCustodyAdapter, type CustodyVerification, type CustodyReceiptVerification, type CustodyAttestationRequest } from "../services/gpt02ReaderCustodyVerifiedAdapter.js";
import {
  evaluateGpt02ReaderCustodyCoordination,
  GPT02_READER_CUSTODY_SCOPE,
} from "../services/gpt02OpenClawReaderCustodyPolicy.js";

const PRINCIPAL = "openclaw-vps-main";
const TOKEN_NAME = "openclaw-vps-dev-consumer";
const PROJECT = "xssrfshdrtdfupgqwfdw";
const allowedRequest = z.object({
  action: z.enum([
    "REQUEST_AUTHORIZED_CUSTODIAN_PROVISIONING",
    "VERIFY_NON_SECRET_READER_STATUS",
    "VERIFY_SEALED_CUSTODY_RECEIPT",
    "REQUEST_SIGNED_SUPER_ADMIN_E2E_QA",
  ]),
}).strict();

type VerifiedService = { id: string; name: string; scopes: string[]; credentialBinding?: string };
export interface CustodyBrokerDeps {
  /** The mounted adapter verifies the actual pool before authentication can query it. */
  verifyRuntimeIsolation?: () => void;
  /** Non-authorizing binding packet for the real issuer; not an attestation. */
  prepareAttestationRequest?: (serviceId: string, principal: string, binding?: string) => Promise<CustodyAttestationRequest>;
  /** Independent security attestor, not agent supplied. Unconfigured = DENY. */
  verifyWorkerAttestation: (serviceId: string, principal: string, binding?: string) => Promise<boolean | CustodyVerification>;
  /** Trusted DBA custody handoff state; never return secrets. */
  readDbaCustodyReceipt: (serviceId: string, principal: string, binding?: string) => Promise<CustodyReceiptVerification>;
  /** Source registry has no privilege to update roles or secrets. */
  readPresence: () => Promise<{ active: boolean; healthy: boolean }>;
}
export function createGpt02ReaderCustodyBroker(deps: CustodyBrokerDeps) {
  const router = Router();
  const authenticate = requireAgentServiceScope("agent:presence", gpt02CustodyCredentialBinding);

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try { deps.verifyRuntimeIsolation?.(); }
    catch { res.status(503).json({ error: "CUSTODY_DEV_RUNTIME_UNAVAILABLE" }); return; }
    next();
  });

  router.get("/attestation-request", authenticate, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const service = res.locals["aiAgentService"] as VerifiedService | undefined;
    if (!service || service.name !== TOKEN_NAME || !service.id || !service.credentialBinding) {
      res.status(403).json({ error: "CUSTODY_WORKER_TOKEN_NOT_BOUND" }); return;
    }
    try {
      if (!deps.prepareAttestationRequest) throw new Error("UNCONFIGURED");
      const packet = await deps.prepareAttestationRequest(service.id, PRINCIPAL, service.credentialBinding);
      res.status(200).json(packet);
    } catch {
      res.status(503).json({ error: "CUSTODY_ATTESTATION_REQUEST_UNAVAILABLE" });
    }
  });

  async function authorize(res: import("express").Response, action: string) {
    const service = res.locals["aiAgentService"] as VerifiedService | undefined;
    if (!service || service.name !== TOKEN_NAME || !service.id || !service.credentialBinding) {
      return { allowed: false, reason: "CUSTODY_WORKER_TOKEN_NOT_BOUND" };
    }
    const attested = await deps.verifyWorkerAttestation(service.id, PRINCIPAL, service.credentialBinding);
    if (!(typeof attested === "boolean" ? attested : attested.verified)) {
      return { allowed: false, reason: typeof attested === "boolean"
        ? "CUSTODY_WORKER_ATTESTATION_REQUIRED" : attested.reason ?? "CUSTODY_WORKER_ATTESTATION_REQUIRED" };
    }
    const presence = await deps.readPresence();
    const decision = evaluateGpt02ReaderCustodyCoordination({
      authenticatedPrincipal: PRINCIPAL,
      source: "openclaw",
      projectId: PROJECT,
      environment: "development",
      scope: GPT02_READER_CUSTODY_SCOPE,
      action,
      leaseActive: presence.active,
      verifiedHealthy: presence.healthy,
      workerAttestationVerified: typeof attested === "boolean" ? attested : attested.verified,
    });
    return {
      allowed: decision.allowed,
      reason: decision.allowed ? "SCOPED_COORDINATION_AUTHORIZED"
        : !presence.active || !presence.healthy ? "CUSTODY_WORKER_PRESENCE_REQUIRED"
        : "CUSTODY_WORKER_ATTESTATION_REQUIRED",
      service,
    };
  }
  router.get("/status", authenticate, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const authorization = await authorize(res, "VERIFY_NON_SECRET_READER_STATUS");
      if (!authorization.allowed) {
        res.status(403).json({ error: authorization.reason, state: "LOCKED", projectId: PROJECT });
        return;
      }
      const service = authorization.service!;
      const receipt = await deps.readDbaCustodyReceipt(service.id, PRINCIPAL, service.credentialBinding);
      res.status(200).json({
        state: receipt.verified ? "CUSTODY_RECEIPT_VERIFIED" : "AWAITING_AUTHORIZED_DBA",
        projectId: PROJECT,
        worker: PRINCIPAL,
        secretExposed: false,
        databaseMutationGranted: false,
        receiptId: receipt.verified ? receipt.receiptId : null,
        ...(!receipt.verified && { reason: receipt.reason ?? "CUSTODY_DBA_RECEIPT_REQUIRED" }),
        readerE2eVerified: false,
        signingPermitted: false,
        dispatchPermitted: false,
      });
    } catch {
      res.status(503).json({ error: "CUSTODY_BROKER_UNAVAILABLE" });
    }
  });
  router.post("/request", authenticate, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = allowedRequest.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: "INVALID_CUSTODY_REQUEST" }); return; }
    try {
      const authorization = await authorize(res, parsed.data.action);
      if (!authorization.allowed) { res.status(403).json({ error: authorization.reason }); return; }
      const service = authorization.service!;
      const receipt = await deps.readDbaCustodyReceipt(service.id, PRINCIPAL, service.credentialBinding);
      // This broker only coordinates the handoff; it never touches DB roles or secrets.
      res.status(receipt.verified ? 200 : 409).json({
        state: receipt.verified ? "READY_FOR_READER_E2E_VERIFICATION" : "AWAITING_AUTHORIZED_DBA",
        action: parsed.data.action,
        projectId: PROJECT,
        credentialIssuedByBroker: false,
        directPostgresPrivileges: false,
        requestRecorded: false,
        handoffDispatched: false,
        readerE2eVerified: false,
        ...(!receipt.verified && { reason: receipt.reason ?? "CUSTODY_DBA_RECEIPT_REQUIRED" }),
      });
    } catch {
      res.status(503).json({ error: "CUSTODY_BROKER_UNAVAILABLE" });
    }
  });
  return router;
}

/** Mounted runtime adapter remains deny-by-default until the authorized issuer
 * trust and signed evidence are installed. It never issues credentials. */
export function createLockedGpt02ReaderCustodyBroker() {
  return createGpt02ReaderCustodyBroker({
    ...createConfiguredGpt02ReaderCustodyAdapter(),
    readPresence: async () => {
      const rows = await getExternalAgentRegistrySnapshot({ skipSchemaEnsure: true });
      const record = rows.find(row => row.clientId === PRINCIPAL);
      return { active: record?.presenceState === "ACTIVE", healthy: record?.reportedHealth === "healthy" };
    },
  });
}
