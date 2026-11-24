import { describe, expect, it } from "vitest";
import { EXTERNAL_AGENT_RULES, getExternalAgentRule } from "../externalAgentRegistryService.js";
import {
  evaluateGpt02ReaderCustodyCoordination as check,
  GPT02_READER_CUSTODY_SCOPE,
} from "../gpt02OpenClawReaderCustodyPolicy.js";

const trusted = {
  authenticatedPrincipal: "openclaw-vps-main",
  source: "openclaw",
  projectId: "xssrfshdrtdfupgqwfdw",
  environment: "development",
  scope: GPT02_READER_CUSTODY_SCOPE,
  action: "REQUEST_AUTHORIZED_CUSTODIAN_PROVISIONING",
  leaseActive: true,
  verifiedHealthy: true,
  workerAttestationVerified: true,
};

describe("GPT02 OpenClaw credential custody coordination scope", () => {
  it("registers exact bounded capability only on canonical VPS principal", () => {
    const registry = getExternalAgentRule("openclaw-vps-main");
    expect(registry?.capabilities).toContain("gpt02:reader-custody:coordinate:dev");
    expect(registry?.role).toBe("bounded_orchestration_agent");
    for (const [id, rule] of Object.entries(EXTERNAL_AGENT_RULES)) {
      if (id !== "openclaw-vps-main") {
        expect(rule.capabilities).not.toContain("gpt02:reader-custody:coordinate:dev");
      }
      expect(rule.permissions.productionDeploy).toBe(false);
    }
  });

  it.each([
    "REQUEST_AUTHORIZED_CUSTODIAN_PROVISIONING",
    "VERIFY_NON_SECRET_READER_STATUS",
    "VERIFY_SEALED_CUSTODY_RECEIPT",
    "REQUEST_SIGNED_SUPER_ADMIN_E2E_QA",
  ])("permits scoped coordination only with independent attestation: %s", (action) => {
    const decision = check({ ...trusted, action });
    expect(decision.allowed).toBe(true);
    expect(decision.credentialsReadable).toBe(false);
    expect(decision.databaseRoleMutationPermitted).toBe(false);
    expect(decision.signerPermitted).toBe(false);
    expect(decision.dispatchPermitted).toBe(false);
    expect(decision.productionPermitted).toBe(false);
  });

  it.each([
    ["wrong agent", { authenticatedPrincipal: "gcp-openclaw-main" }],
    ["wrong project", { projectId: "nzdweipzckfszczzqtuw" }],
    ["PROD", { environment: "production" }],
    ["relock executor scope", { scope: "GPT02_RELOCK_CST_DEV" }],
    ["lease expired", { leaseActive: false }],
    ["unhealthy", { verifiedHealthy: false }],
    ["unverified identity", { workerAttestationVerified: false }],
    ["spoofed source", { source: "some-other-agent" }],
    ["direct password change", { action: "ALTER_ROLE_PASSWORD" }],
    ["credential read", { action: "READ_CREDENTIAL" }],
    ["dispatch", { action: "DISPATCH_GPT02" }],
    ["signer", { action: "ACTIVATE_SIGNER" }],
    ["Git write", { action: "GIT_PUSH" }],
  ])("denies %s", (_, update) => {
    expect(check({ ...trusted, ...update }).allowed).toBe(false);
  });

  it("does not authorize by clientId or live heartbeat alone", () => {
    expect(check({ ...trusted, workerAttestationVerified: false }).allowed).toBe(false);
  });
});
