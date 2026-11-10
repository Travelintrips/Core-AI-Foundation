import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  canonicalGpt02Issue159Approval,
} from "../gpt02Issue159FourSignerContract.js";
import {
  inspectGpt02Issue159ApprovalAuthorizerEvidence,
} from "../gpt02Issue159ApprovalAuthorizerEvidence.js";

const claims = {
  v: 2,
  environment: "DEV",
  audience: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
  taskId: 137,
  commandId: "11111111-1111-4111-8111-111111111111",
  attemptId: "22222222-2222-4222-8222-222222222222",
  nonce: "A".repeat(44),
  operatorNamespace: "ai-task-hub.public.users",
  superAdminId: "google_fixture_super_admin",
  companyId: "default",
  issuedAt: 1000,
  expiresAt: 301000,
};

const digest = () => createHash("sha256")
  .update(canonicalGpt02Issue159Approval(claims))
  .digest("hex");

const decision = () => ({
  decisionId: "33333333-3333-4333-8333-333333333333",
  claimsSha256: digest(),
  actorId: claims.superAdminId,
  authMethod: "supabase_aal2" as const,
  roleAtDecision: "super_admin" as const,
  decision: "APPROVE" as const,
  recordedAt: 2000,
});

describe("GPT02 Issue159 approval signer authorizer evidence", () => {
  it("matches exact AAL2 Super Admin persisted binding but never permits signing", () => {
    const result = inspectGpt02Issue159ApprovalAuthorizerEvidence({
      claims,
      decision: decision(),
      observedAt: 2500,
    });
    expect(result.approvalBindingMatched).toBe(true);
    expect(result.aal2SuperAdminMatched).toBe(true);
    expect(result.claimsSha256).toBe(digest());
    expect(result.persistedTrustedReadProven).toBe(false);
    expect(result.privateKeyLoaded).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("rejects static approval token, non-AAL2 or non-Super-Admin provenance", () => {
    for (const patch of [
      { actorId: "dev_approval_token" },
      { authMethod: "static_dev_token" },
      { roleAtDecision: "admin" },
      { decision: "REJECT" },
    ]) {
      expect(() => inspectGpt02Issue159ApprovalAuthorizerEvidence({
        claims,
        decision: { ...decision(), ...patch },
        observedAt: 2500,
      })).toThrow("GPT02_ISSUE159_AAL2_SUPER_ADMIN_APPROVAL_REQUIRED");
    }
  });

  it("rejects wrong claim digest, actor or decision timing", () => {
    for (const patch of [
      { claimsSha256: "b".repeat(64) },
      { actorId: "another-super-admin" },
      { recordedAt: 999 },
      { recordedAt: 301001 },
    ]) {
      expect(() => inspectGpt02Issue159ApprovalAuthorizerEvidence({
        claims,
        decision: { ...decision(), ...patch },
        observedAt: 301001,
      })).toThrow("GPT02_ISSUE159_APPROVAL_BINDING_MISMATCH");
    }
  });

  it("rejects stale observation and injected decision fields", () => {
    expect(() => inspectGpt02Issue159ApprovalAuthorizerEvidence({
      claims,
      decision: decision(),
      observedAt: 400_001,
    })).toThrow("GPT02_ISSUE159_APPROVAL_BINDING_MISMATCH");

    expect(() => inspectGpt02Issue159ApprovalAuthorizerEvidence({
      claims,
      decision: { ...decision(), authorized: true },
      observedAt: 2500,
    })).toThrow("GPT02_ISSUE159_APPROVAL_DECISION_SHAPE_INVALID");
  });

  it("source has no signing, private-key, filesystem, env, DB or network surface", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159ApprovalAuthorizerEvidence.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "sign(", "process.env", "readFile",
      "node:fs", "@workspace/db", "fetch(", "http://", "https://",
      "signingPermitted: true", "dispatchPermitted: true",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
