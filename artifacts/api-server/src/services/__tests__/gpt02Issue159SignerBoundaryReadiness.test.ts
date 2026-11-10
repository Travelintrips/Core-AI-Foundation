import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  GPT02_ISSUE159_SIGNER_DOMAINS,
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
} from "../gpt02Issue159FourSignerContract.js";
import {
  GPT02_ISSUE159_CUSTODY_POLICY,
} from "../gpt02Issue159SignerCustodyPolicy.js";
import {
  assessGpt02Issue159SignerBoundaryReadiness,
} from "../gpt02Issue159SignerBoundaryReadiness.js";

const pem = () => generateKeyPairSync("ed25519").publicKey
  .export({ format: "pem", type: "spki" }).toString();

const approvalClaims = {
  v: 2, environment: "DEV",
  audience: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
  taskId: 137,
  commandId: "11111111-1111-4111-8111-111111111111",
  attemptId: "22222222-2222-4222-8222-222222222222",
  nonce: "A".repeat(44),
  operatorNamespace: "ai-task-hub.public.users",
  superAdminId: "google_fixture_super_admin",
  companyId: "default", issuedAt: 1000, expiresAt: 301000,
};
const approvalDigest = createHash("sha256")
  .update(canonicalGpt02Issue159Approval(approvalClaims)).digest("hex");
const nonceDigest = createHash("sha256")
  .update(approvalClaims.nonce).digest("hex");

const linkClaims = {
  v: 1, environment: "DEV", audience: "GPT02_DUAL_ACCOUNT_COMMAND_LINK",
  linkId: "33333333-3333-4333-8333-333333333333",
  companyId: "default", hubTaskId: 137,
  hubExecutionId: "44444444-4444-4444-8444-444444444444",
  coreTaskId: "55555555-5555-4555-8555-555555555555",
  coreCommandId: approvalClaims.commandId,
  attemptId: approvalClaims.attemptId, attemptNumber: 1,
  assigneeId: 5, accountableOwnerId: "fixture-owner",
  hubOperatorNamespace: "ai-task-hub.public.users",
  hubOperatorId: approvalClaims.superAdminId,
  hubRole: "super_admin", hubActive: true,
  coreOperatorNamespace: "ai-core.ai_platform.internal_users",
  coreOperatorUserId: 77, coreRole: "admin",
  coreActive: true, corePasswordChanged: true,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  approvalDigest, nonce: approvalClaims.nonce,
  issuedAt: 1100, expiresAt: 121000,
};
const linkDigest = createHash("sha256")
  .update(canonicalGpt02Issue159OperatorLink(linkClaims)).digest("hex");

const issuerClaims = {
  v: 1, environment: "DEV", audience: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
  companyId: "default", hubTaskId: 137,
  hubExecutionId: linkClaims.hubExecutionId,
  coreTaskId: linkClaims.coreTaskId,
  commandId: approvalClaims.commandId,
  attemptId: approvalClaims.attemptId,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  receiptId: "66666666-6666-4666-8666-666666666666",
  linkId: linkClaims.linkId,
  fenceId: "77777777-7777-4777-8777-777777777777",
  approvalDigest, nonceDigest,
  issuerRole: "dev_gpt02_issuer_evidence", leaseEpoch: 1,
  issuedAt: 3000, expiresAt: 10000,
};

function provenance() {
  return {
    approval: { role: "approval" as const, ...GPT02_ISSUE159_CUSTODY_POLICY.approval,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.approval, publicKeyPem: pem() },
    hub: { role: "hub" as const, ...GPT02_ISSUE159_CUSTODY_POLICY.hub,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.hub, publicKeyPem: pem() },
    core: { role: "core" as const, ...GPT02_ISSUE159_CUSTODY_POLICY.core,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.core, publicKeyPem: pem() },
    issuer: { role: "issuer" as const, ...GPT02_ISSUE159_CUSTODY_POLICY.issuer,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.issuer, publicKeyPem: pem() },
  };
}

function fixture() {
  return {
    provenance: provenance(),
    approval: {
      claims: approvalClaims,
      decision: {
        decisionId: "88888888-8888-4888-8888-888888888888",
        claimsSha256: approvalDigest,
        actorId: approvalClaims.superAdminId,
        authMethod: "supabase_aal2",
        roleAtDecision: "super_admin",
        decision: "APPROVE",
        recordedAt: 2000,
      },
      observedAt: 2500,
    },
    hub: {
      claims: linkClaims,
      evidence: {
        namespace: "ai-task-hub.public.users",
        operatorId: linkClaims.hubOperatorId,
        operatorRole: "super_admin",
        active: true,
        hubTaskId: linkClaims.hubTaskId,
        hubExecutionId: linkClaims.hubExecutionId,
        commandCandidateId: linkClaims.coreCommandId,
        attemptId: linkClaims.attemptId,
        linkId: linkClaims.linkId,
        assignmentAuditAction: "gpt02_pic_assigned",
        assignmentAuditEntityId: String(linkClaims.hubTaskId),
        assignmentActorId: linkClaims.hubOperatorId,
        assignmentActorRole: "super_admin",
        assignmentActorActive: true,
        approvalDigest: linkClaims.approvalDigest,
        claimsSha256: linkDigest,
        observedAt: 2500,
      },
      observedAt: 2500,
    },
    core: {
      claims: linkClaims,
      evidence: {
        namespace: "ai-core.ai_platform.internal_users",
        operatorUserId: linkClaims.coreOperatorUserId,
        operatorRole: linkClaims.coreRole,
        active: true,
        passwordChanged: true,
        coreTaskId: linkClaims.coreTaskId,
        coreCommandId: linkClaims.coreCommandId,
        attemptId: linkClaims.attemptId,
        taskStatus: "PENDING",
        runCount: 0,
        commandCount: 0,
        workerId: linkClaims.workerId,
        linkId: linkClaims.linkId,
        claimsSha256: linkDigest,
        observedAt: 2500,
      },
      observedAt: 2500,
    },
    issuer: {
      claims: issuerClaims,
      approvalClaims,
      operatorLinkClaims: linkClaims,
      nonceReceipt: {
        receiptId: issuerClaims.receiptId,
        commandId: issuerClaims.commandId,
        nonce: approvalClaims.nonce,
        digest: approvalDigest,
        consumedAt: 2000,
      },
      identityReceipt: {
        receiptId: issuerClaims.receiptId,
        commandId: issuerClaims.commandId,
        linkId: linkClaims.linkId,
        operatorUserId: linkClaims.coreOperatorUserId,
        hubOperatorId: linkClaims.hubOperatorId,
        linkDigest,
        bindingVerified: false,
        mayDispatchWorker: false,
        mayIssueGrant: false,
        mayCloseJob: false,
        coreLedgerWritten: false,
      },
      fence: {
        fenceId: issuerClaims.fenceId,
        receiptId: issuerClaims.receiptId,
        commandId: issuerClaims.commandId,
        linkId: issuerClaims.linkId,
        hubExecutionId: issuerClaims.hubExecutionId,
        coreTaskId: issuerClaims.coreTaskId,
        attemptId: issuerClaims.attemptId,
        workerId: issuerClaims.workerId,
        leaseEpoch: 1,
        leaseStartedAt: 2500,
        leaseExpiresAt: 12000,
        dispatchAllowed: false,
        coreLedgerWritten: false,
      },
      observedAt: 5000,
    },
  };
}

describe("GPT02 Issue159 signer boundary aggregate readiness", () => {
  it("proves all source contracts while remaining operationally NO_GO", () => {
    const result = assessGpt02Issue159SignerBoundaryReadiness(fixture());
    expect(result.sourceContractsVerified).toBe(true);
    expect(result.fourPublicRootsUnique).toBe(true);
    expect(result.approvalAuthorizerContractVerified).toBe(true);
    expect(result.hubAuthorizerContractVerified).toBe(true);
    expect(result.coreAuthorizerContractVerified).toBe(true);
    expect(result.issuerAuthorizerContractVerified).toBe(true);
    expect(result.blockers).toEqual([
      "TRUSTED_PERSISTED_READ_ADAPTER_NOT_IMPLEMENTED",
      "REAL_PRIVATE_KEY_CUSTODY_NOT_ATTESTED",
      "SIGNER_RUNTIME_NOT_MOUNTED",
      "OPERATIONAL_PUBLIC_TRUST_NOT_INSTALLED",
    ]);
    expect(result.operationalSigningReady).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("propagates approval, operator and issuer evidence failures", () => {
    {
      const x = fixture();
      x.approval.decision.actorId = "dev_approval_token";
      expect(() => assessGpt02Issue159SignerBoundaryReadiness(x))
        .toThrow("GPT02_ISSUE159_AAL2_SUPER_ADMIN_APPROVAL_REQUIRED");
    }
    {
      const x = fixture();
      x.hub.evidence.operatorRole = "admin";
      expect(() => assessGpt02Issue159SignerBoundaryReadiness(x))
        .toThrow("GPT02_ISSUE159_HUB_IDENTITY_BINDING_MISMATCH");
    }
    {
      const x = fixture();
      x.core.evidence.passwordChanged = false;
      expect(() => assessGpt02Issue159SignerBoundaryReadiness(x))
        .toThrow("GPT02_ISSUE159_CORE_IDENTITY_BINDING_MISMATCH");
    }
    {
      const x = fixture();
      x.issuer.fence.dispatchAllowed = true;
      expect(() => assessGpt02Issue159SignerBoundaryReadiness(x))
        .toThrow("GPT02_ISSUE159_FENCE_BINDING_MISMATCH");
    }
  });

  it("rejects duplicate public roots before any operational readiness claim", () => {
    const x = fixture();
    x.provenance.hub.publicKeyPem = x.provenance.approval.publicKeyPem;
    expect(() => assessGpt02Issue159SignerBoundaryReadiness(x))
      .toThrow("GPT02_ISSUE159_INDEPENDENT_PUBLIC_KEYS_REQUIRED");
  });

  it("source contains no signer key loading, signing, DB, filesystem or network path", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159SignerBoundaryReadiness.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "sign(", "process.env", "readFile",
      "node:fs", "@workspace/db", "fetch(", "http://", "https://",
      "operationalSigningReady: true", "signingPermitted: true",
      "dispatchPermitted: true",
    ]) expect(source).not.toContain(forbidden);
  });
});
