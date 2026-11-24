import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  gpt02CustodyCredentialBinding,
  verifyGpt02CustodyWorkerAttestation,
  verifyGpt02DbaCustodyReceipt,
  type Gpt02WorkerAttestationInput,
  type Gpt02DbaCustodyReceiptInput,
} from "../gpt02ReaderCustodyAttestation.js";

// Synthetic in-memory keys only. No files, database, live identities, or issuer.
const workerKeys = generateKeyPairSync("ed25519");
const dbaKeys = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const wrongAlgorithmKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const now = Date.UTC(2026, 10, 24, 12, 0, 0);
const credentialId = "b994bcd3-8190-4ad8-b275-6950215fd131";
const otherId = "b994bcd3-8190-4ad8-b275-6950215fd132";
const receiptId = "3926085a-67ee-49f9-a0b1-a5ca04d9e3a0";
const tokenHash = "a".repeat(64);
const binding = gpt02CustodyCredentialBinding(tokenHash);

function trust(publicKey: KeyObject) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return {
    trustedIssuerPublicDerB64: der.toString("base64"),
    trustedIssuerSha256: createHash("sha256").update(der).digest("hex"),
  };
}

function packet(receipt: Record<string, unknown>, privateKey = workerKeys.privateKey) {
  return {
    receipt,
    signature: sign(null, Buffer.from(JSON.stringify(receipt), "utf8"), privateKey).toString("base64url"),
  };
}

// Deliberately independent of exported target constants: these are the wire contract.
const workerReceipt = {
  audience: "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2",
  project: "xssrfshdrtdfupgqwfdw",
  scope: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
  principal: "openclaw-vps-main",
  service: "openclaw-vps-dev-consumer",
  credentialId,
  credentialBinding: binding,
  issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
  notBefore: now - 1000,
  expiresAt: now + 60_000,
};

const workerInput: Gpt02WorkerAttestationInput = {
  document: packet(workerReceipt),
  ...trust(workerKeys.publicKey),
  authenticatedCredentialId: credentialId,
  authenticatedCredentialBinding: binding,
  now,
};
const workerDigest = createHash("sha256").update(JSON.stringify(workerReceipt), "utf8").digest("hex");

const dbaReceipt = {
  audience: "CST-DEV/GPT02/READER-CUSTODY/DBA-RECEIPT/v2",
  project: "xssrfshdrtdfupgqwfdw",
  scope: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
  principal: "openclaw-vps-main",
  readerRole: "gpt02_owner_ledger_reader_dev",
  runtimeCredentialPath: "/run/credentials/gpt02-owner-ledger-reader/reader.json",
  issuer: "CST_DEV_READER_CREDENTIAL_CUSTODIAN",
  credentialId,
  credentialBinding: binding,
  workerAttestationSha256: workerDigest,
  receiptId,
  notBefore: now,
  expiresAt: now + 30_000,
};

const dbaInput: Gpt02DbaCustodyReceiptInput = {
  document: packet(dbaReceipt, dbaKeys.privateKey),
  ...trust(dbaKeys.publicKey),
  verifiedWorker: verifyGpt02CustodyWorkerAttestation(workerInput),
  now,
};
const deniedReceipt = { verified: false, receiptId: null };

describe("GPT02 purpose-specific credential binding", () => {
  it("binds the credential generation without exposing its token hash", () => {
    expect(binding).toMatch(/^[a-f0-9]{64}$/);
    expect(binding).not.toBe(tokenHash);
    expect(binding).not.toBe(gpt02CustodyCredentialBinding("b".repeat(64)));
    expect(binding).not.toBe(createHash("sha256").update("CST-DEV/task189/credential/v1\0").update(tokenHash).digest("hex"));
  });

  it.each(["", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65)])("rejects malformed stored hashes (%s)", value => {
    expect(() => gpt02CustodyCredentialBinding(value)).toThrow("INVALID_TOKEN_HASH_INPUT");
  });
});

describe("signed GPT02 worker attestation", () => {
  it("accepts the exact pinned issuer, complete UUID and authenticated credential binding", () => {
    expect(verifyGpt02CustodyWorkerAttestation(workerInput)).toEqual({
      credentialId,
      credentialBinding: binding,
      digest: workerDigest,
      notBefore: now - 1000,
      expiresAt: now + 60_000,
    });
  });

  it("canonicalizes JSON property order without changing signed bytes", () => {
    const document = packet(workerReceipt);
    document.receipt = Object.fromEntries(Object.entries(workerReceipt).reverse());
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, document })?.digest).toBe(workerDigest);
  });

  it.each([
    ["wrong current credential ID", { authenticatedCredentialId: otherId }],
    ["malformed current credential ID", { authenticatedCredentialId: "not-a-uuid" }],
    ["rotated credential", { authenticatedCredentialBinding: gpt02CustodyCredentialBinding("b".repeat(64)) }],
    ["unbound credential", { authenticatedCredentialBinding: "" }],
    ["expired at boundary", { now: workerReceipt.expiresAt }],
    ["not yet valid", { now: workerReceipt.notBefore - 1 }],
    ["invalid server clock", { now: Number.NaN }],
    ["missing issuer key", { trustedIssuerPublicDerB64: undefined }],
    ["missing issuer fingerprint", { trustedIssuerSha256: undefined }],
    ["wrong fingerprint", { trustedIssuerSha256: "0".repeat(64) }],
    ["noncanonical fingerprint", { trustedIssuerSha256: trust(workerKeys.publicKey).trustedIssuerSha256.toUpperCase() }],
    ["different pinned key", trust(otherKeys.publicKey)],
    ["wrong key algorithm", trust(wrongAlgorithmKeys.publicKey)],
    ["noncanonical public key base64", { trustedIssuerPublicDerB64: trust(workerKeys.publicKey).trustedIssuerPublicDerB64 + "\n" }],
    ["invalid public key", { trustedIssuerPublicDerB64: "AAAA" }],
  ] as Array<[string, Partial<Gpt02WorkerAttestationInput>]>) ("rejects %s", (_name, update) => {
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, ...update })).toBeNull();
  });

  // Re-sign altered fields with the trusted test key. These test semantic
  // scope rejection independently of an invalid-signature rejection.
  it.each([
    ["cross-domain audience", { audience: "CST-DEV/task189/second-preparation/signer-window/v1" }],
    ["other project", { project: "nzdweipzckfszczzqtuw" }],
    ["relock scope", { scope: "GPT02_RELOCK_CST_DEV" }],
    ["other principal", { principal: "gcp-openclaw-main" }],
    ["other service", { service: "gcp-ai-workers-primary" }],
    ["self-appointed issuer", { issuer: "OPENCLAW_SELF_SIGNED" }],
    ["other credential", { credentialId: otherId }],
    ["old malformed UUID shape", { credentialId: "b994bcd3-8190-4ad8-b6950215fd131" }],
    ["changed binding", { credentialBinding: "f".repeat(64) }],
    ["excess TTL", { expiresAt: workerReceipt.notBefore + 86_400_001 }],
    ["empty validity", { expiresAt: workerReceipt.notBefore }],
    ["fractional time", { notBefore: now - 0.5 }],
    ["negative time", { notBefore: -1 }],
    ["unsafe time", { expiresAt: Number.MAX_SAFE_INTEGER + 1 }],
    ["unexpected field", { password: "synthetic-forbidden-field" }],
  ] as Array<[string, Record<string, unknown>]>) ("rejects a correctly signed %s", (_name, change) => {
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, document: packet({ ...workerReceipt, ...change }) })).toBeNull();
  });

  it.each([
    ["null", null],
    ["array", []],
    ["missing signature", { receipt: workerReceipt }],
    ["extra envelope field", { ...packet(workerReceipt), claimedAdmin: true }],
    ["padded signature", { ...packet(workerReceipt), signature: packet(workerReceipt).signature + "=" }],
    ["invalid signature", { receipt: workerReceipt, signature: "A".repeat(86) }],
    ["missing receipt field", { ...packet(workerReceipt), receipt: { ...workerReceipt, service: undefined } }],
  ])("rejects malformed envelope: %s", (_name, document) => {
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, document })).toBeNull();
  });

  it("rejects accessor/prototype/symbol properties rather than executing them", () => {
    const accessor = { signature: packet(workerReceipt).signature };
    Object.defineProperty(accessor, "receipt", { enumerable: true, get() { throw new Error("must not read"); } });
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, document: accessor })).toBeNull();
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, document: Object.create(packet(workerReceipt)) })).toBeNull();
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, document: { ...packet(workerReceipt), [Symbol("extra")]: true } })).toBeNull();
  });

  it("rejects noncanonical DER with a matching fingerprint", () => {
    const der = Buffer.concat([workerKeys.publicKey.export({ type: "spki", format: "der" }), Buffer.from([0])]);
    expect(verifyGpt02CustodyWorkerAttestation({
      ...workerInput,
      trustedIssuerPublicDerB64: der.toString("base64"),
      trustedIssuerSha256: createHash("sha256").update(der).digest("hex"),
    })).toBeNull();
  });

  it("accepts inclusive notBefore and the maximum bounded lifetime", () => {
    const receipt = { ...workerReceipt, notBefore: now, expiresAt: now + 86_400_000 };
    expect(verifyGpt02CustodyWorkerAttestation({ ...workerInput, document: packet(receipt) })?.expiresAt).toBe(receipt.expiresAt);
  });
});

describe("independent GPT02 DBA custody receipt", () => {
  it("accepts only the exact worker attestation, reader target and pinned DBA signature", () => {
    expect(verifyGpt02DbaCustodyReceipt(dbaInput)).toEqual({ verified: true, receiptId });
    expect(Object.keys(verifyGpt02DbaCustodyReceipt(dbaInput)).sort()).toEqual(["receiptId", "verified"]);
  });

  it("supports JSON key reordering while preserving canonical signature verification", () => {
    const document = packet(dbaReceipt, dbaKeys.privateKey);
    document.receipt = Object.fromEntries(Object.entries(dbaReceipt).reverse());
    expect(verifyGpt02DbaCustodyReceipt({ ...dbaInput, document })).toEqual({ verified: true, receiptId });
  });

  it.each([
    ["worker audience", { audience: workerReceipt.audience }],
    ["wrong project", { project: "nzdweipzckfszczzqtuw" }],
    ["relock scope", { scope: "GPT02_RELOCK_CST_DEV" }],
    ["wrong principal", { principal: "openclaw-pc-worker" }],
    ["other reader role", { readerRole: "gpt02_issuer_evidence_reader" }],
    ["other credential path", { runtimeCredentialPath: "/etc/credstore.encrypted/task190-owner-ledger-reader-dsn" }],
    ["worker attestor as issuer", { issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN" }],
    ["other credential ID", { credentialId: otherId }],
    ["rotated credential binding", { credentialBinding: gpt02CustodyCredentialBinding("b".repeat(64)) }],
    ["different worker attestation", { workerAttestationSha256: "f".repeat(64) }],
    ["malformed receipt UUID", { receiptId: "receipt-safe-1" }],
    ["notBefore outside worker interval", { notBefore: workerReceipt.notBefore - 1 }],
    ["expiresAt outside worker interval", { expiresAt: workerReceipt.expiresAt + 1 }],
    ["future receipt", { notBefore: now + 1 }],
    ["expired receipt", { expiresAt: now }],
    ["unexpected claim", { readerActivated: true }],
  ] as Array<[string, Record<string, unknown>]>) ("rejects correctly signed %s", (_name, change) => {
    expect(verifyGpt02DbaCustodyReceipt({ ...dbaInput, document: packet({ ...dbaReceipt, ...change }, dbaKeys.privateKey) })).toEqual(deniedReceipt);
  });

  it.each([
    ["no verified worker", { verifiedWorker: null }],
    ["no DBA document", { document: null }],
    ["wrong DBA key", trust(otherKeys.publicKey)],
    ["unconfigured DBA fingerprint", { trustedIssuerSha256: undefined }],
    ["wrong DBA fingerprint", { trustedIssuerSha256: "0".repeat(64) }],
    ["wrong DBA key algorithm", trust(wrongAlgorithmKeys.publicKey)],
    ["expired at boundary", { now: dbaReceipt.expiresAt }],
    ["worker expired", { now: workerReceipt.expiresAt }],
    ["invalid server time", { now: Number.POSITIVE_INFINITY }],
    ["unexpected envelope field", { document: { ...packet(dbaReceipt, dbaKeys.privateKey), approved: true } }],
    ["worker signature used for DBA", { document: packet(dbaReceipt, workerKeys.privateKey) }],
  ] as Array<[string, Partial<Gpt02DbaCustodyReceiptInput>]>) ("denies %s", (_name, update) => {
    expect(verifyGpt02DbaCustodyReceipt({ ...dbaInput, ...update })).toEqual(deniedReceipt);
  });

  it("invalidates prior custody after worker attestation renewal even for the same token", () => {
    const renewed = verifyGpt02CustodyWorkerAttestation({
      ...workerInput, document: packet({ ...workerReceipt, notBefore: now, expiresAt: now + 60_000 }),
    });
    expect(renewed).not.toBeNull();
    expect(verifyGpt02DbaCustodyReceipt({ ...dbaInput, verifiedWorker: renewed })).toEqual(deniedReceipt);
  });

  it("permits a receipt window exactly bounded by the verified worker", () => {
    const document = packet({ ...dbaReceipt, notBefore: workerReceipt.notBefore, expiresAt: workerReceipt.expiresAt }, dbaKeys.privateKey);
    expect(verifyGpt02DbaCustodyReceipt({ ...dbaInput, document })).toEqual({ verified: true, receiptId });
  });
});
