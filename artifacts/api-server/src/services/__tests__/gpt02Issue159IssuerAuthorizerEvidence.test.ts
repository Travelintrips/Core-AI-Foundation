import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
} from "../gpt02Issue159FourSignerContract.js";
import {
  inspectGpt02Issue159IssuerAuthorizerEvidence,
} from "../gpt02Issue159IssuerAuthorizerEvidence.js";

const approvalClaims = {
  v: 2,
  environment: "DEV",
  audience: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
  taskId: 137,
  commandId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  nonce: "A".repeat(44),
  operatorNamespace: "ai-task-hub.public.users",
  superAdminId: "google_fixture_super_admin",
  companyId: "default",
  issuedAt: 1000,
  expiresAt: 20000,
};
const approvalDigest = createHash("sha256")
  .update(canonicalGpt02Issue159Approval(approvalClaims)).digest("hex");
const nonceDigest = createHash("sha256")
  .update(approvalClaims.nonce).digest("hex");

const operatorLinkClaims = {
  v: 1,
  environment: "DEV",
  audience: "GPT02_DUAL_ACCOUNT_COMMAND_LINK",
  linkId: "66666666-6666-4666-8666-666666666666",
  companyId: "default",
  hubTaskId: 137,
  hubExecutionId: "11111111-1111-4111-8111-111111111111",
  coreTaskId: "22222222-2222-4222-8222-222222222222",
  coreCommandId: approvalClaims.commandId,
  attemptId: approvalClaims.attemptId,
  attemptNumber: 1,
  assigneeId: 5,
  accountableOwnerId: "fixture-owner",
  hubOperatorNamespace: "ai-task-hub.public.users",
  hubOperatorId: approvalClaims.superAdminId,
  hubRole: "super_admin",
  hubActive: true,
  coreOperatorNamespace: "ai-core.ai_platform.internal_users",
  coreOperatorUserId: 77,
  coreRole: "admin",
  coreActive: true,
  corePasswordChanged: true,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  approvalDigest,
  nonce: approvalClaims.nonce,
  issuedAt: 1100,
  expiresAt: 12000,
};
const linkDigest = createHash("sha256")
  .update(canonicalGpt02Issue159OperatorLink(operatorLinkClaims)).digest("hex");

const claims = () => ({
  v: 1,
  environment: "DEV",
  audience: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
  companyId: "default",
  hubTaskId: 137,
  hubExecutionId: operatorLinkClaims.hubExecutionId,
  coreTaskId: operatorLinkClaims.coreTaskId,
  commandId: approvalClaims.commandId,
  attemptId: approvalClaims.attemptId,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  receiptId: "55555555-5555-4555-8555-555555555555",
  linkId: operatorLinkClaims.linkId,
  fenceId: "77777777-7777-4777-8777-777777777777",
  approvalDigest,
  nonceDigest,
  issuerRole: "dev_gpt02_issuer_evidence",
  leaseEpoch: 1,
  issuedAt: 3000,
  expiresAt: 10000,
});

const receipt = () => ({
  receiptId: claims().receiptId,
  commandId: claims().commandId,
  nonce: approvalClaims.nonce,
  digest: approvalDigest,
  consumedAt: 2000,
});

const identityReceipt = () => ({
  receiptId: claims().receiptId,
  commandId: claims().commandId,
  linkId: operatorLinkClaims.linkId,
  operatorUserId: operatorLinkClaims.coreOperatorUserId,
  hubOperatorId: operatorLinkClaims.hubOperatorId,
  linkDigest,
  bindingVerified: false,
  mayDispatchWorker: false,
  mayIssueGrant: false,
  mayCloseJob: false,
  coreLedgerWritten: false,
});

const fence = () => ({
  fenceId: claims().fenceId,
  receiptId: claims().receiptId,
  commandId: claims().commandId,
  linkId: claims().linkId,
  hubExecutionId: claims().hubExecutionId,
  coreTaskId: claims().coreTaskId,
  attemptId: claims().attemptId,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  leaseEpoch: 1,
  leaseStartedAt: 2500,
  leaseExpiresAt: 12000,
  dispatchAllowed: false,
  coreLedgerWritten: false,
});

const input = () => ({
  claims: claims(),
  approvalClaims,
  operatorLinkClaims,
  nonceReceipt: receipt(),
  identityReceipt: identityReceipt(),
  fence: fence(),
  observedAt: 5000,
});

describe("GPT02 Issue159 issuer signer authorizer evidence", () => {
  it("matches full approval/link/nonce/identity/fence lineage but never permits signing", () => {
    const result = inspectGpt02Issue159IssuerAuthorizerEvidence(input());
    expect(result.issuerEvidenceBindingMatched).toBe(true);
    expect(result.approvalDigestMatched).toBe(true);
    expect(result.operatorLinkDigestMatched).toBe(true);
    expect(result.nonceReceiptMatched).toBe(true);
    expect(result.identityReceiptMatched).toBe(true);
    expect(result.nonDispatchFenceMatched).toBe(true);
    expect(result.persistedTrustedReadProven).toBe(false);
    expect(result.privateKeyLoaded).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.commandCreated).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("rejects canonical approval or operator-link lineage drift", () => {
    {
      const x = input();
      x.approvalClaims = { ...approvalClaims, nonce: "B".repeat(44) };
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_APPROVAL_LINK_BINDING_MISMATCH");
    }
    {
      const x = input();
      x.operatorLinkClaims = {
        ...operatorLinkClaims, approvalDigest: "c".repeat(64),
      };
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_APPROVAL_LINK_BINDING_MISMATCH");
    }
  });

  it("rejects raw nonce receipt identity or digest drift", () => {
    for (const patch of [
      { receiptId: "88888888-8888-4888-8888-888888888888" },
      { commandId: "99999999-9999-4999-8999-999999999999" },
      { nonce: "B".repeat(44) },
      { digest: "c".repeat(64) },
      { consumedAt: 999 },
    ]) {
      const x = input();
      x.nonceReceipt = { ...receipt(), ...patch };
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_NONCE_RECEIPT_BINDING_MISMATCH");
    }
  });

  it("rejects identity receipt drift or authority booleans", () => {
    for (const patch of [
      { operatorUserId: 78 },
      { hubOperatorId: "other-admin" },
      { linkDigest: "c".repeat(64) },
      { bindingVerified: true },
      { mayDispatchWorker: true },
      { mayIssueGrant: true },
      { mayCloseJob: true },
      { coreLedgerWritten: true },
    ]) {
      const x = input();
      x.identityReceipt = { ...identityReceipt(), ...patch };
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_IDENTITY_RECEIPT_BINDING_MISMATCH");
    }
  });

  it("rejects dispatch-enabled, ledger-written or wrong fence lineage", () => {
    for (const patch of [
      { dispatchAllowed: true },
      { coreLedgerWritten: true },
      { leaseEpoch: 2 },
      { linkId: "88888888-8888-4888-8888-888888888888" },
      { workerId: "other-worker" },
      { leaseExpiresAt: 5000 },
    ]) {
      const x = input();
      x.fence = { ...fence(), ...patch };
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_FENCE_BINDING_MISMATCH");
    }
  });

  it("rejects stale evidence, invalid claim lifetime and injected authority fields", () => {
    {
      const x = input();
      x.observedAt = 10001;
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_ISSUER_EVIDENCE_EXPIRED_OR_UNBOUND");
    }
    {
      const x = input();
      x.claims = { ...claims(), expiresAt: 20001 };
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_ISSUER_CLAIMS_INVALID");
    }
    {
      const x = input();
      x.identityReceipt = { ...identityReceipt(), authorized: true };
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence(x))
        .toThrow("GPT02_ISSUE159_ISSUER_AUTHORIZER_INPUT_INVALID");
    }
  });

  it("source has no signing, private-key, filesystem, env, DB or network surface", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159IssuerAuthorizerEvidence.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "sign(", "process.env", "readFile",
      "node:fs", "@workspace/db", "fetch(", "http://", "https://",
      "signingPermitted: true", "dispatchPermitted: true",
    ]) expect(source).not.toContain(forbidden);
  });
});
