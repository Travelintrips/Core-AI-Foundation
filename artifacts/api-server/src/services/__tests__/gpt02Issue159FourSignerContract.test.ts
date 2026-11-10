import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync, sign, verify,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  GPT02_ISSUE159_SIGNER_DOMAINS,
  GPT02_ISSUE159_SIGNER_ROLES,
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
  canonicalGpt02Issue159IssuerEvidence,
  gpt02Issue159SigningBytes,
  inspectGpt02Issue159PublicRoots,
} from "../gpt02Issue159FourSignerContract.js";

const approval = {
  v: 2,
  environment: "DEV",
  audience: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
  taskId: 137,
  commandId: "11111111-1111-4111-8111-111111111111",
  attemptId: "22222222-2222-4222-8222-222222222222",
  nonce: "A".repeat(44),
  operatorNamespace: "ai-task-hub.public.users",
  superAdminId: "fixture-super-admin",
  companyId: "default",
  issuedAt: 1000,
  expiresAt: 2000,
};

const operatorLink = {
  v: 1,
  environment: "DEV",
  audience: "GPT02_DUAL_ACCOUNT_COMMAND_LINK",
  linkId: "33333333-3333-4333-8333-333333333333",
  companyId: "default",
  hubTaskId: 137,
  hubExecutionId: "44444444-4444-4444-8444-444444444444",
  coreTaskId: "55555555-5555-4555-8555-555555555555",
  coreCommandId: approval.commandId,
  attemptId: approval.attemptId,
  attemptNumber: 1,
  assigneeId: 5,
  accountableOwnerId: "fixture-owner",
  hubOperatorNamespace: "ai-task-hub.public.users",
  hubOperatorId: approval.superAdminId,
  hubRole: "super_admin",
  hubActive: true,
  coreOperatorNamespace: "ai-core.ai_platform.internal_users",
  coreOperatorUserId: 77,
  coreRole: "admin",
  coreActive: true,
  corePasswordChanged: true,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  approvalDigest: "a".repeat(64),
  nonce: approval.nonce,
  issuedAt: 1100,
  expiresAt: 1900,
};

const issuer = {
  v: 1,
  environment: "DEV",
  audience: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
  companyId: "default",
  hubTaskId: 137,
  hubExecutionId: operatorLink.hubExecutionId,
  coreTaskId: operatorLink.coreTaskId,
  commandId: approval.commandId,
  attemptId: approval.attemptId,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  receiptId: "66666666-6666-4666-8666-666666666666",
  linkId: operatorLink.linkId,
  fenceId: "77777777-7777-4777-8777-777777777777",
  approvalDigest: "a".repeat(64),
  nonceDigest: "b".repeat(64),
  issuerRole: "dev_gpt02_issuer_evidence",
  leaseEpoch: 1,
  issuedAt: 1200,
  expiresAt: 1800,
};

const publicPem = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) =>
  key.export({ format: "pem", type: "spki" }).toString();

describe("GPT02 Issue159 four-signer nonmounted contract", () => {
  it("pins the exact four verifier domains and canonical field order", () => {
    expect(GPT02_ISSUE159_SIGNER_ROLES)
      .toEqual(["approval", "hub", "core", "issuer"]);
    expect(GPT02_ISSUE159_SIGNER_DOMAINS).toEqual({
      approval: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
      hub: "GPT02_OPERATOR_LINK_V1:hub",
      core: "GPT02_OPERATOR_LINK_V1:core",
      issuer: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
    });

    expect(canonicalGpt02Issue159Approval(approval))
      .toBe(JSON.stringify(approval));
    expect(canonicalGpt02Issue159OperatorLink(operatorLink))
      .toBe(JSON.stringify(operatorLink));
    expect(canonicalGpt02Issue159IssuerEvidence(issuer))
      .toBe(JSON.stringify(issuer));
  });

  it("separates Hub, Core and issuer signatures cryptographically", () => {
    const approvalKey = generateKeyPairSync("ed25519");
    const hubKey = generateKeyPairSync("ed25519");
    const coreKey = generateKeyPairSync("ed25519");
    const issuerKey = generateKeyPairSync("ed25519");

    const vectors = [
      ["approval", approval, approvalKey],
      ["hub", operatorLink, hubKey],
      ["core", operatorLink, coreKey],
      ["issuer", issuer, issuerKey],
    ] as const;

    const signatures = vectors.map(([role, claims, key]) =>
      sign(null, gpt02Issue159SigningBytes(role, claims), key.privateKey));

    vectors.forEach(([role, claims, key], index) => {
      expect(verify(
        null, gpt02Issue159SigningBytes(role, claims),
        key.publicKey, signatures[index],
      )).toBe(true);
    });

    expect(verify(
      null, gpt02Issue159SigningBytes("core", operatorLink),
      hubKey.publicKey, signatures[1],
    )).toBe(false);
    expect(verify(
      null, gpt02Issue159SigningBytes("hub", operatorLink),
      coreKey.publicKey, signatures[2],
    )).toBe(false);
  });

  it("requires four unique Ed25519 public roots and returns no authority", () => {
    const keys = Array.from({ length: 4 }, () => generateKeyPairSync("ed25519"));
    const result = inspectGpt02Issue159PublicRoots({
      approvalPublicKeyPem: publicPem(keys[0].publicKey),
      hubPublicKeyPem: publicPem(keys[1].publicKey),
      corePublicKeyPem: publicPem(keys[2].publicKey),
      issuerPublicKeyPem: publicPem(keys[3].publicKey),
    });
    expect(new Set(Object.values(result.fingerprints)).size).toBe(4);
    expect(result.environment).toBe("DEV");
    expect(result.algorithm).toBe("Ed25519");
    expect(result.publicRootsVerified).toBe(true);
    expect(result.privateKeyLoaded).toBe(false);
    expect(result.signerMounted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
  });

  it("rejects duplicate roots, non-Ed25519 keys and claim shape drift", () => {
    const keys = Array.from({ length: 4 }, () => generateKeyPairSync("ed25519"));
    const same = publicPem(keys[0].publicKey);
    expect(() => inspectGpt02Issue159PublicRoots({
      approvalPublicKeyPem: same,
      hubPublicKeyPem: same,
      corePublicKeyPem: publicPem(keys[2].publicKey),
      issuerPublicKeyPem: publicPem(keys[3].publicKey),
    })).toThrow("GPT02_ISSUE159_INDEPENDENT_PUBLIC_KEYS_REQUIRED");

    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => inspectGpt02Issue159PublicRoots({
      approvalPublicKeyPem: publicPem(keys[0].publicKey),
      hubPublicKeyPem: publicPem(keys[1].publicKey),
      corePublicKeyPem: publicPem(keys[2].publicKey),
      issuerPublicKeyPem: publicPem(rsa.publicKey),
    })).toThrow("GPT02_ISSUE159_ED25519_PUBLIC_KEY_REQUIRED");

    expect(() => canonicalGpt02Issue159Approval({
      ...approval, injected: true,
    })).toThrow("GPT02_ISSUE159_APPROVAL_FIELDS_INVALID");
  });

  it("production source has no private signing, key-file, DB, HTTP or dispatch surface", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159FourSignerContract.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "generateKeyPair", "sign(",
      "readFile", "node:fs", "process.env", "fetch(",
      "http://", "https://", "@workspace/db", "dispatchPermitted: true",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
