import { Router } from "express";
import { z } from "zod";
import { requireAgentServiceScope } from "../middleware/agentServiceAuth.js";
import { getExternalAgentRegistrySnapshot } from "../services/externalAgentRegistryService.js";
import { createConfiguredGpt02ReaderCustodyAdapter } from "../services/gpt02ReaderCustodyVerifiedAdapter.js";
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

type VerifiedService = { id: string; name: string; scopes: string[] };
export interface CustodyBrokerDeps {
  /** Independent security attestor, not agent supplied. Unconfigured = DENY. */
  verifyWorkerAttestation: (serviceId: string, principal: string) => Promise<boolean>;
  /** Trusted DBA custody handoff state; never return secrets. */
  readDbaCustodyReceipt: () => Promise<{ verified: boolean; receiptId: string | null }>;
  /** Source registry has no privilege to update roles or secrets. */
  readPresence: () => Promise<{ active: boolean; healthy: boolean }>;
}
export function createGpt02ReaderCustodyBroker(deps: CustodyBrokerDeps) {
  const router = Router();
  const authenticate = requireAgentServiceScope("agent:presence");

  async function authorize(res: import("express").Response, action: string) {
    const service = res.locals["aiAgentService"] as VerifiedService | undefined;
    if (!service || service.name !== TOKEN_NAME || !service.id) {
      return { allowed: false, reason: "CUSTODY_WORKER_TOKEN_NOT_BOUND" };
    }
    const [attested, presence] = await Promise.all([
      deps.verifyWorkerAttestation(service.id, PRINCIPAL),
      deps.readPresence(),
    ]);
    const decision = evaluateGpt02ReaderCustodyCoordination({
      authenticatedPrincipal: PRINCIPAL,
      source: "openclaw",
      projectId: PROJECT,
      environment: "development",
      scope: GPT02_READER_CUSTODY_SCOPE,
      action,
      leaseActive: presence.active,
      verifiedHealthy: presence.healthy,
      workerAttestationVerified: attested,
    });
    return {
      allowed: decision.allowed,
      reason: decision.allowed ? "SCOPED_COORDINATION_AUTHORIZED" : "CUSTODY_WORKER_ATTESTATION_REQUIRED",
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
      const receipt = await deps.readDbaCustodyReceipt();
      res.status(200).json({
        state: receipt.verified ? "CUSTODY_RECEIPT_VERIFIED" : "AWAITING_AUTHORIZED_DBA",
        projectId: PROJECT,
        worker: PRINCIPAL,
        secretExposed: false,
        databaseMutationGranted: false,
        receiptId: receipt.verified ? receipt.receiptId : null,
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
      const receipt = await deps.readDbaCustodyReceipt();
      // This broker only coordinates the handoff; it never touches DB roles or secrets.
      res.status(receipt.verified ? 200 : 409).json({
        state: receipt.verified ? "READY_FOR_READER_E2E_VERIFICATION" : "AWAITING_AUTHORIZED_DBA",
        action: parsed.data.action,
        projectId: PROJECT,
        credentialIssuedByBroker: false,
        directPostgresPrivileges: false,
      });
    } catch {
      res.status(503).json({ error: "CUSTODY_BROKER_UNAVAILABLE" });
    }
  });
  return router;
}

/** Production dependency configuration is intentionally deny-by-default until
 * independent DBA custody and authenticated worker attestation are installed. */
export function createLockedGpt02ReaderCustodyBroker() {
  const proofs = createConfiguredGpt02ReaderCustodyAdapter();
  return createGpt02ReaderCustodyBroker({
    verifyWorkerAttestation: proofs.verifyWorkerAttestation,
    readDbaCustodyReceipt: proofs.readDbaCustodyReceipt,
    readPresence: async () => {
      const rows = await getExternalAgentRegistrySnapshot({ skipSchemaEnsure: true });
      const record = rows.find(row => row.clientId === PRINCIPAL);
      return { active: record?.presenceState === "ACTIVE", healthy: record?.reportedHealth === "healthy" };
    },
  });
}
