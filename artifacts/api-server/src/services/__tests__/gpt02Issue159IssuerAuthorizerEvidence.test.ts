import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  inspectGpt02Issue159IssuerAuthorizerEvidence,
} from "../gpt02Issue159IssuerAuthorizerEvidence.js";

const claims = () => ({
  v: 1,
  environment: "DEV",
  audience: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
  companyId: "default",
  hubTaskId: 137,
  hubExecutionId: "11111111-1111-4111-8111-111111111111",
  coreTaskId: "22222222-2222-4222-8222-222222222222",
  commandId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  workerId: "openclaw-dell-chatgpt-wake-dev",
  receiptId: "55555555-5555-4555-8555-555555555555",
  linkId: "66666666-6666-4666-8666-666666666666",
  fenceId: "77777777-7777-4777-8777-777777777777",
  approvalDigest: "a".repeat(64),
  nonceDigest: "b".repeat(64),
  issuerRole: "dev_gpt02_issuer_evidence",
  leaseEpoch: 1,
  issuedAt: 3000,
  expiresAt: 10000,
});

const receipt = () => ({
  receiptId: claims().receiptId,
  commandId: claims().commandId,
  approvalDigest: claims().approvalDigest,
  nonceDigest: claims().nonceDigest,
  consumedAt: 2000,
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

describe("GPT02 Issue159 issuer signer authorizer evidence", () => {
  it("matches exact nonce/fence/lease evidence but never permits signing or dispatch", () => {
    const result = inspectGpt02Issue159IssuerAuthorizerEvidence({
      claims: claims(),
      nonceReceipt: receipt(),
      fence: fence(),
      observedAt: 5000,
    });
    expect(result.issuerEvidenceBindingMatched).toBe(true);
    expect(result.nonceReceiptMatched).toBe(true);
    expect(result.nonDispatchFenceMatched).toBe(true);
    expect(result.persistedTrustedReadProven).toBe(false);
    expect(result.privateKeyLoaded).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.commandCreated).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("rejects mismatched nonce receipt identity or digests", () => {
    for (const patch of [
      { receiptId: "88888888-8888-4888-8888-888888888888" },
      { commandId: "99999999-9999-4999-8999-999999999999" },
      { approvalDigest: "c".repeat(64) },
      { nonceDigest: "d".repeat(64) },
    ]) {
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence({
        claims: claims(),
        nonceReceipt: { ...receipt(), ...patch },
        fence: fence(),
        observedAt: 5000,
      })).toThrow("GPT02_ISSUE159_NONCE_RECEIPT_BINDING_MISMATCH");
    }
  });

  it("rejects dispatch-enabled, ledger-written or wrong fence lineage", () => {
    for (const patch of [
      { dispatchAllowed: true },
      { coreLedgerWritten: true },
      { leaseEpoch: 2 },
      { linkId: "88888888-8888-4888-8888-888888888888" },
      { workerId: "other-worker" },
    ]) {
      expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence({
        claims: claims(),
        nonceReceipt: receipt(),
        fence: { ...fence(), ...patch },
        observedAt: 5000,
      })).toThrow("GPT02_ISSUE159_FENCE_BINDING_MISMATCH");
    }
  });

  it("rejects stale evidence, invalid claim lifetime and injected authority fields", () => {
    expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence({
      claims: claims(),
      nonceReceipt: receipt(),
      fence: fence(),
      observedAt: 10001,
    })).toThrow("GPT02_ISSUE159_ISSUER_EVIDENCE_EXPIRED_OR_UNBOUND");

    expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence({
      claims: { ...claims(), expiresAt: 20001 },
      nonceReceipt: receipt(),
      fence: fence(),
      observedAt: 5000,
    })).toThrow("GPT02_ISSUE159_ISSUER_CLAIMS_INVALID");

    expect(() => inspectGpt02Issue159IssuerAuthorizerEvidence({
      claims: claims(),
      nonceReceipt: receipt(),
      fence: { ...fence(), authorized: true },
      observedAt: 5000,
    })).toThrow("GPT02_ISSUE159_ISSUER_AUTHORIZER_INPUT_INVALID");
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
