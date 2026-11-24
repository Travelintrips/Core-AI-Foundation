import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from "node:crypto";

const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const GPT02_WORKER_ATTESTATION_TARGET = Object.freeze({
  audience: "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2",
  project: "xssrfshdrtdfupgqwfdw",
  scope: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
  principal: "openclaw-vps-main",
  service: "openclaw-vps-dev-consumer",
} as const);

export const GPT02_DBA_CUSTODY_TARGET = Object.freeze({
  audience: "CST-DEV/GPT02/READER-CUSTODY/DBA-RECEIPT/v2",
  project: "xssrfshdrtdfupgqwfdw",
  scope: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
  principal: "openclaw-vps-main",
  readerRole: "gpt02_owner_ledger_reader_dev",
  runtimeCredentialPath: "/run/credentials/gpt02-owner-ledger-reader/reader.json",
  issuer: "CST_DEV_READER_CREDENTIAL_CUSTODIAN",
} as const);

type IssuerTrust = Readonly<{
  trustedIssuerPublicDerB64: string | undefined;
  trustedIssuerSha256: string | undefined;
}>;

export type VerifiedGpt02CustodyWorker = Readonly<{
  credentialId: string;
  credentialBinding: string;
  /** SHA-256 of the canonical signed receipt bytes, excluding the envelope. */
  digest: string;
  notBefore: number;
  expiresAt: number;
}>;

export type Gpt02WorkerAttestationInput = IssuerTrust & Readonly<{
  document: unknown;
  authenticatedCredentialId: string;
  authenticatedCredentialBinding: string;
  now: number;
}>;

export type Gpt02DbaCustodyReceiptInput = IssuerTrust & Readonly<{
  document: unknown;
  /** Must be the result of the worker verifier for this authenticated request. */
  verifiedWorker: VerifiedGpt02CustodyWorker | null;
  now: number;
}>;

export type Gpt02DbaCustodyReceiptResult = Readonly<{
  verified: boolean;
  receiptId: string | null;
}>;

/** Derive a purpose-specific binding; never return the token or its stored hash. */
export function gpt02CustodyCredentialBinding(tokenHash: string): string {
  if (typeof tokenHash !== "string" || !SHA256.test(tokenHash)) {
    throw new Error("INVALID_TOKEN_HASH_INPUT");
  }
  return createHash("sha256")
    .update("CST-DEV/GPT02/READER-CUSTODY/CREDENTIAL-BINDING/v1\0")
    .update(tokenHash)
    .digest("hex");
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) {
    return null;
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
  }
  return value as Record<string, unknown>;
}

function hasTarget(record: Record<string, unknown>, target: Readonly<Record<string, string>>): boolean {
  return Object.entries(target).every(([key, value]) => record[key] === value);
}

function validWindow(notBefore: unknown, expiresAt: unknown, now: unknown): boolean {
  return typeof notBefore === "number" && Number.isSafeInteger(notBefore) && notBefore >= 0 &&
    typeof expiresAt === "number" && Number.isSafeInteger(expiresAt) &&
    typeof now === "number" && Number.isSafeInteger(now) && now >= 0 &&
    notBefore <= now && now < expiresAt && expiresAt > notBefore &&
    expiresAt - notBefore <= MAX_VALIDITY_MS;
}

function equalDigest(left: unknown, right: unknown): boolean {
  return typeof left === "string" && SHA256.test(left) &&
    typeof right === "string" && SHA256.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function trustedKey(publicDerB64: unknown, fingerprint: unknown): KeyObject | null {
  if (typeof publicDerB64 !== "string" || publicDerB64.length === 0 || publicDerB64.length > 1024 ||
      publicDerB64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicDerB64) ||
      typeof fingerprint !== "string" || !SHA256.test(fingerprint)) return null;
  const der = Buffer.from(publicDerB64, "base64");
  if (der.toString("base64") !== publicDerB64 ||
      !equalDigest(createHash("sha256").update(der).digest("hex"), fingerprint)) return null;
  const key = createPublicKey({ key: der, type: "spki", format: "der" });
  if (key.asymmetricKeyType !== "ed25519") return null;
  // Reject trailing bytes and noncanonical ASN.1 encodings accepted by a parser.
  const canonicalDer = key.export({ type: "spki", format: "der" });
  if (canonicalDer.length !== der.length || !timingSafeEqual(canonicalDer, der)) return null;
  return key;
}

function signatureValid(canonical: object, signature: unknown, key: KeyObject): boolean {
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  const bytes = Buffer.from(signature, "base64url");
  return bytes.length === 64 && bytes.toString("base64url") === signature &&
    verify(null, Buffer.from(JSON.stringify(canonical), "utf8"), key, bytes);
}

/**
 * Verifies a separately issued public attestation. This function cannot issue
 * attestations, load private keys, grant DBA rights, or establish secret custody.
 * Fixed field order is the signing wire format; incoming JSON key order is irrelevant.
 */
export function verifyGpt02CustodyWorkerAttestation(
  input: Gpt02WorkerAttestationInput,
): VerifiedGpt02CustodyWorker | null {
  try {
    const envelope = exactRecord(input.document, ["receipt", "signature"]);
    const key = trustedKey(input.trustedIssuerPublicDerB64, input.trustedIssuerSha256);
    if (!envelope || !key) return null;
    const raw = exactRecord(envelope.receipt, [
      ...Object.keys(GPT02_WORKER_ATTESTATION_TARGET),
      "credentialId", "credentialBinding", "issuer", "notBefore", "expiresAt",
    ]);
    if (!raw || !hasTarget(raw, GPT02_WORKER_ATTESTATION_TARGET) ||
        raw.issuer !== "CST_DEV_AGENT_CREDENTIAL_ADMIN" ||
        typeof raw.credentialId !== "string" || !UUID.test(raw.credentialId) ||
        typeof input.authenticatedCredentialId !== "string" || !UUID.test(input.authenticatedCredentialId) ||
        raw.credentialId !== input.authenticatedCredentialId ||
        !equalDigest(raw.credentialBinding, input.authenticatedCredentialBinding) ||
        !validWindow(raw.notBefore, raw.expiresAt, input.now)) return null;

    const canonical = {
      ...GPT02_WORKER_ATTESTATION_TARGET,
      credentialId: raw.credentialId,
      credentialBinding: raw.credentialBinding as string,
      issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
      notBefore: raw.notBefore as number,
      expiresAt: raw.expiresAt as number,
    };
    if (!signatureValid(canonical, envelope.signature, key)) return null;
    return Object.freeze({
      credentialId: canonical.credentialId,
      credentialBinding: canonical.credentialBinding,
      digest: createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex"),
      notBefore: canonical.notBefore,
      expiresAt: canonical.expiresAt,
    });
  } catch { return null; }
}

/** A signed custody receipt is evidence only; it never activates the reader. */
export function verifyGpt02DbaCustodyReceipt(input: Gpt02DbaCustodyReceiptInput): Gpt02DbaCustodyReceiptResult {
  const denied = Object.freeze({ verified: false, receiptId: null });
  try {
    const worker = exactRecord(input.verifiedWorker, [
      "credentialId", "credentialBinding", "digest", "notBefore", "expiresAt",
    ]);
    if (!worker || typeof worker.credentialId !== "string" || !UUID.test(worker.credentialId) ||
        typeof worker.credentialBinding !== "string" || !SHA256.test(worker.credentialBinding) ||
        typeof worker.digest !== "string" || !SHA256.test(worker.digest) ||
        !validWindow(worker.notBefore, worker.expiresAt, input.now)) return denied;
    const envelope = exactRecord(input.document, ["receipt", "signature"]);
    const key = trustedKey(input.trustedIssuerPublicDerB64, input.trustedIssuerSha256);
    if (!envelope || !key) return denied;
    const raw = exactRecord(envelope.receipt, [
      ...Object.keys(GPT02_DBA_CUSTODY_TARGET),
      "credentialId", "credentialBinding", "workerAttestationSha256", "receiptId", "notBefore", "expiresAt",
    ]);
    if (!raw || !hasTarget(raw, GPT02_DBA_CUSTODY_TARGET) ||
        raw.credentialId !== worker.credentialId ||
        !equalDigest(raw.credentialBinding, worker.credentialBinding) ||
        !equalDigest(raw.workerAttestationSha256, worker.digest) ||
        typeof raw.receiptId !== "string" || !UUID.test(raw.receiptId) ||
        !validWindow(raw.notBefore, raw.expiresAt, input.now) ||
        (raw.notBefore as number) < (worker.notBefore as number) ||
        (raw.expiresAt as number) > (worker.expiresAt as number)) return denied;

    const canonical = {
      ...GPT02_DBA_CUSTODY_TARGET,
      credentialId: worker.credentialId,
      credentialBinding: worker.credentialBinding,
      workerAttestationSha256: worker.digest,
      receiptId: raw.receiptId,
      notBefore: raw.notBefore as number,
      expiresAt: raw.expiresAt as number,
    };
    if (!signatureValid(canonical, envelope.signature, key)) return denied;
    return Object.freeze({ verified: true, receiptId: canonical.receiptId });
  } catch { return denied; }
}
