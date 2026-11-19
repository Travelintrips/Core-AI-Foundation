import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  canonicalGpt02Issue159OperatorLink,
} from "../gpt02Issue159FourSignerContract.js";
import {
  inspectGpt02Issue159OperatorAuthorizerEvidence,
} from "../gpt02Issue159OperatorAuthorizerEvidence.js";

const claims = {
  v: 1,
  environment: "DEV",
  audience: "GPT02_DUAL_ACCOUNT_COMMAND_LINK",
  linkId: "33333333-3333-4333-8333-333333333333",
  companyId: "default",
  hubTaskId: 137,
  hubExecutionId: "44444444-4444-4444-8444-444444444444",
  coreTaskId: "55555555-5555-4555-8555-555555555555",
  coreCommandId: "11111111-1111-4111-8111-111111111111",
  attemptId: "22222222-2222-4222-8222-222222222222",
  attemptNumber: 1,
  assigneeId: 5,
  accountableOwnerId: "fixture-owner",
  hubOperatorNamespace: "ai-task-hub.public.users",
  hubOperatorId: "google_fixture_super_admin",
  hubRole: "super_admin",
  hubActive: true,
  coreOperatorNamespace: "ai-core.ai_platform.internal_users",
  coreOperatorUserId: 77,
  coreRole: "admin",
  coreActive: true,
  corePasswordChanged: true,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  approvalDigest: "a".repeat(64),
  nonce: "A".repeat(44),
  issuedAt: 1000,
  expiresAt: 121000,
};

const digest = createHash("sha256")
  .update(canonicalGpt02Issue159OperatorLink(claims))
  .digest("hex");

const hubEvidence = () => ({
  namespace: "ai-task-hub.public.users",
  operatorId: claims.hubOperatorId,
  operatorRole: "super_admin",
  active: true,
  hubTaskId: claims.hubTaskId,
  hubExecutionId: claims.hubExecutionId,
  commandCandidateId: claims.coreCommandId,
  attemptId: claims.attemptId,
  linkId: claims.linkId,
  assignmentAuditAction: "gpt02_pic_assigned",
  assignmentAuditEntityId: String(claims.hubTaskId),
  assignmentActorId: claims.hubOperatorId,
  assignmentActorRole: "super_admin",
  assignmentActorActive: true,
  approvalDigest: claims.approvalDigest,
  claimsSha256: digest,
  observedAt: 2000,
});

const coreEvidence = () => ({
  namespace: "ai-core.ai_platform.internal_users",
  operatorUserId: claims.coreOperatorUserId,
  operatorRole: claims.coreRole,
  active: true,
  passwordChanged: true,
  coreTaskId: claims.coreTaskId,
  coreCommandId: claims.coreCommandId,
  attemptId: claims.attemptId,
  taskStatus: "PENDING",
  runCount: 0,
  commandCount: 0,
  workerId: claims.workerId,
  linkId: claims.linkId,
  claimsSha256: digest,
  observedAt: 2000,
});

describe("GPT02 Issue159 operator signer authorizer evidence", () => {
  it("matches exact Hub Super Admin identity but never permits signing", () => {
    const result = inspectGpt02Issue159OperatorAuthorizerEvidence({
      role: "hub", claims, evidence: hubEvidence(), observedAt: 2000,
    });
    expect(result.role).toBe("hub");
    expect(result.operatorBindingMatched).toBe(true);
    expect(result.persistedTrustedReadProven).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("matches exact Core operator identity but never permits signing", () => {
    const result = inspectGpt02Issue159OperatorAuthorizerEvidence({
      role: "core", claims, evidence: coreEvidence(), observedAt: 2000,
    });
    expect(result.role).toBe("core");
    expect(result.operatorBindingMatched).toBe(true);
    expect(result.signingPermitted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
  });

  it("rejects Hub identity, role, digest or approval binding drift", () => {
    for (const patch of [
      { operatorId: "other-user" },
      { operatorRole: "admin" },
      { active: false },
      { claimsSha256: "b".repeat(64) },
      { approvalDigest: "c".repeat(64) },
      { assignmentAuditAction: "other_action" },
      { assignmentAuditEntityId: "999" },
      { assignmentActorId: "other-user" },
      { assignmentActorRole: "admin" },
      { assignmentActorActive: false },
      { observedAt: 2001 },
    ]) {
      expect(() => inspectGpt02Issue159OperatorAuthorizerEvidence({
        role: "hub", claims, evidence: { ...hubEvidence(), ...patch }, observedAt: 2000,
      })).toThrow("GPT02_ISSUE159_HUB_IDENTITY_BINDING_MISMATCH");
    }
  });

  it("rejects Core identity, role, password-state or task binding drift", () => {
    for (const patch of [
      { operatorUserId: 78 },
      { operatorRole: "viewer" },
      { active: false },
      { passwordChanged: false },
      { coreTaskId: "66666666-6666-4666-8666-666666666666" },
      { taskStatus: "RUNNING" },
      { runCount: 1 },
      { commandCount: 1 },
      { workerId: "other-worker" },
      { observedAt: 2001 },
      { claimsSha256: "b".repeat(64) },
    ]) {
      expect(() => inspectGpt02Issue159OperatorAuthorizerEvidence({
        role: "core", claims, evidence: { ...coreEvidence(), ...patch }, observedAt: 2000,
      })).toThrow("GPT02_ISSUE159_CORE_IDENTITY_BINDING_MISMATCH");
    }
  });

  it("rejects stale/early observation and injected authority fields", () => {
    for (const observedAt of [999, 121001]) {
      expect(() => inspectGpt02Issue159OperatorAuthorizerEvidence({
        role: "hub", claims, evidence: hubEvidence(), observedAt,
      })).toThrow("GPT02_ISSUE159_OPERATOR_EVIDENCE_EXPIRED");
    }
    expect(() => inspectGpt02Issue159OperatorAuthorizerEvidence({
      role: "hub",
      claims,
      evidence: { ...hubEvidence(), authorized: true },
      observedAt: 2000,
    })).toThrow("GPT02_ISSUE159_HUB_EVIDENCE_SHAPE_INVALID");
  });

  it("source has no signing, private-key, filesystem, env, DB or network surface", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159OperatorAuthorizerEvidence.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "sign(", "process.env", "readFile",
      "node:fs", "@workspace/db", "fetch(", "http://", "https://",
      "signingPermitted: true", "dispatchPermitted: true",
    ]) expect(source).not.toContain(forbidden);
  });
});
