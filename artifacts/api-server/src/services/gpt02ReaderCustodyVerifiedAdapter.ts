import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname } from "node:path";
import { assertDevelopmentDatabaseIsolation, pool } from "@workspace/db";
import {
  verifyGpt02CustodyWorkerAttestation,
  verifyGpt02DbaCustodyReceipt,
  GPT02_WORKER_ATTESTATION_TARGET,
  type VerifiedGpt02CustodyWorker,
} from "./gpt02ReaderCustodyAttestation.js";

const PRINCIPAL = "openclaw-vps-main";
const PROJECT = "xssrfshdrtdfupgqwfdw";
export const GPT02_CUSTODY_FILES = Object.freeze({
  worker: "/run/credentials/gpt02-reader-custody/worker-attestation.json",
  dba: "/run/credentials/gpt02-reader-custody/issuer-receipt.json",
  reader: "/run/credentials/gpt02-owner-ledger-reader/reader.json",
});
const MAX_RECEIPT_BYTES = 8_192;
const MAX_READER_BYTES = 4_096;

export type CustodyVerification = Readonly<{ verified: boolean; reason?: string }>;
export type CustodyReceiptVerification = CustodyVerification & Readonly<{ receiptId: string | null }>;
export type CustodyAttestationRequest = Readonly<{
  state: "AWAITING_AUTHORIZED_WORKER_ATTESTOR";
  unsignedRequest: typeof GPT02_WORKER_ATTESTATION_TARGET & { credentialId: string; credentialBinding: string };
  authorizationGranted: false;
  issuerAttestationVerified: false;
  credentialIssuedByBroker: false;
  signingPermitted: false;
  dispatchPermitted: false;
}>;

/** Only non-secret, signed evidence is read. The reader credential is inspected
 * with fstat only; this module never reads or decrypts its contents. */
export class CustodyFileError extends Error {
  constructor(readonly code: "MISSING" | "UNSAFE" | "INVALID") { super(code); }
}

async function assertTrustedParents(path: string): Promise<void> {
  let parent = dirname(path);
  while (true) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
      throw new CustodyFileError("UNSAFE");
    }
    if (parent === "/") return;
    parent = dirname(parent);
  }
}

function assertTrustedFile(stat: Stats, maxBytes: number) {
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o077) !== 0 ||
      stat.nlink !== 1 || stat.size < 1 || stat.size > maxBytes) {
    throw new CustodyFileError("UNSAFE");
  }
}

function fileError(error: unknown): CustodyFileError {
  if (error instanceof CustodyFileError) return error;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return new CustodyFileError(code === "ENOENT" ? "MISSING" : "UNSAFE");
}

/** Fixed receipt paths only. O_NONBLOCK avoids hanging on an unexpected FIFO;
 * O_NOFOLLOW and fstat validate the object actually opened, before bounded IO. */
export async function readProtectedGpt02CustodyDocument(kind: "worker" | "dba"): Promise<unknown> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const path = GPT02_CUSTODY_FILES[kind];
    await assertTrustedParents(path);
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    assertTrustedFile(before, MAX_RECEIPT_BYTES);
    const bytes = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const after = await file.stat();
    assertTrustedFile(after, MAX_RECEIPT_BYTES);
    if (total > MAX_RECEIPT_BYTES || total !== before.size || total !== after.size ||
        before.dev !== after.dev || before.ino !== after.ino ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new CustodyFileError("UNSAFE");
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total))); }
    catch { throw new CustodyFileError("INVALID"); }
  } catch (error) {
    throw fileError(error);
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export async function inspectProtectedGpt02ReaderMount(): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await assertTrustedParents(GPT02_CUSTODY_FILES.reader);
    file = await open(GPT02_CUSTODY_FILES.reader, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    assertTrustedFile(await file.stat(), MAX_READER_BYTES);
    // Intentionally no file.read(), readFile(), JSON parse, or secret hash.
  } catch (error) {
    throw fileError(error);
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export interface Gpt02CustodyRuntimeDeps {
  environment: () => NodeJS.ProcessEnv;
  verifyDatabaseIsolation: () => void;
  readDocument: (kind: "worker" | "dba") => Promise<unknown>;
  inspectReaderMount: () => Promise<void>;
  now: () => number;
}

function verifyRuntimeDatabaseIsolation(): void {
  // Validate the configured pool, not a request field or a claimed project name.
  assertDevelopmentDatabaseIsolation(pool.options.connectionString ?? "", {
    APP_ENV: "development", SUPABASE_URL_DEV: `https://${PROJECT}.supabase.co`,
  });
}

/** Dependency injection is for isolated tests; the mounted factory below uses
 * the fixed filesystem and the real pool. No caller can select paths or keys. */
export function createGpt02ReaderCustodyRuntime(overrides: Partial<Gpt02CustodyRuntimeDeps> = {}) {
  const deps: Gpt02CustodyRuntimeDeps = {
    environment: () => process.env,
    verifyDatabaseIsolation: verifyRuntimeDatabaseIsolation,
    readDocument: readProtectedGpt02CustodyDocument,
    inspectReaderMount: inspectProtectedGpt02ReaderMount,
    now: Date.now,
    ...overrides,
  };

  function context(): NodeJS.ProcessEnv {
    const env = deps.environment();
    if (env.APP_ENV !== "development" || env.NODE_ENV === "production") throw new Error("CUSTODY_DEV_ENVIRONMENT_REQUIRED");
    try { deps.verifyDatabaseIsolation(); }
    catch { throw new Error("CUSTODY_DEV_DATABASE_UNVERIFIED"); }
    return env;
  }

  async function worker(serviceId: string, principal: string, binding?: string): Promise<{
    status: CustodyVerification; proof: VerifiedGpt02CustodyWorker | null; env?: NodeJS.ProcessEnv;
  }> {
    let env: NodeJS.ProcessEnv;
    try { env = context(); }
    catch (error) {
      const reason = error instanceof Error && error.message === "CUSTODY_DEV_ENVIRONMENT_REQUIRED"
        ? error.message : "CUSTODY_DEV_DATABASE_UNVERIFIED";
      return { status: { verified: false, reason }, proof: null };
    }
    if (principal !== PRINCIPAL || !binding) return { status: { verified: false, reason: "CUSTODY_WORKER_TOKEN_NOT_BOUND" }, proof: null };
    if (!env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64 || !env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256) {
      return { status: { verified: false, reason: "CUSTODY_ATTESTOR_NOT_CONFIGURED" }, proof: null };
    }
    let document: unknown;
    try { document = await deps.readDocument("worker"); }
    catch (error) {
      return { status: { verified: false, reason: error instanceof CustodyFileError && error.code === "MISSING"
        ? "CUSTODY_ATTESTATION_NOT_INSTALLED" : "CUSTODY_ATTESTATION_FILE_REJECTED" }, proof: null };
    }
    const proof = verifyGpt02CustodyWorkerAttestation({
      document, trustedIssuerPublicDerB64: env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64,
      trustedIssuerSha256: env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256,
      authenticatedCredentialId: serviceId, authenticatedCredentialBinding: binding, now: deps.now(),
    });
    return { status: { verified: !!proof, ...(proof ? {} : { reason: "CUSTODY_ATTESTATION_REJECTED" }) }, proof, env };
  }

  return {
    verifyRuntimeIsolation(): void { context(); },
    async prepareAttestationRequest(serviceId: string, principal: string, binding?: string): Promise<CustodyAttestationRequest> {
      context();
      if (principal !== PRINCIPAL || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(serviceId) ||
          !binding || !/^[a-f0-9]{64}$/.test(binding)) throw new Error("CUSTODY_WORKER_TOKEN_NOT_BOUND");
      // Bootstrap information for the authorized attestor. This is neither a
      // canonical-identity attestation nor a registration/grant/DBA request.
      return {
        state: "AWAITING_AUTHORIZED_WORKER_ATTESTOR",
        unsignedRequest: { ...GPT02_WORKER_ATTESTATION_TARGET, credentialId: serviceId, credentialBinding: binding },
        authorizationGranted: false, issuerAttestationVerified: false,
        credentialIssuedByBroker: false, signingPermitted: false, dispatchPermitted: false,
      };
    },
    async verifyWorkerAttestation(serviceId: string, principal: string, binding?: string): Promise<CustodyVerification> {
      return (await worker(serviceId, principal, binding)).status;
    },
    async readDbaCustodyReceipt(serviceId: string, principal: string, binding?: string): Promise<CustodyReceiptVerification> {
      // Re-read every request, including after authorization. Removal/expiry or
      // token rotation cannot leave a cached grant behind.
      const current = await worker(serviceId, principal, binding);
      if (!current.proof || !current.env) return { ...current.status, receiptId: null };
      const env = current.env;
      if (!env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64 || !env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256) {
        return { verified: false, receiptId: null, reason: "CUSTODY_DBA_ATTESTOR_NOT_CONFIGURED" };
      }
      if (env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 === env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256) {
        return { verified: false, receiptId: null, reason: "CUSTODY_ISSUER_DOMAINS_NOT_SEPARATE" };
      }
      let document: unknown;
      try { document = await deps.readDocument("dba"); }
      catch (error) {
        return { verified: false, receiptId: null, reason: error instanceof CustodyFileError && error.code === "MISSING"
          ? "CUSTODY_DBA_RECEIPT_NOT_INSTALLED" : "CUSTODY_DBA_RECEIPT_FILE_REJECTED" };
      }
      const receipt = verifyGpt02DbaCustodyReceipt({
        document, trustedIssuerPublicDerB64: env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64,
        trustedIssuerSha256: env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256, verifiedWorker: current.proof, now: deps.now(),
      });
      if (!receipt.verified) return { ...receipt, reason: "CUSTODY_DBA_RECEIPT_REJECTED" };
      try { await deps.inspectReaderMount(); }
      catch (error) {
        return { verified: false, receiptId: null, reason: error instanceof CustodyFileError && error.code === "MISSING"
          ? "CUSTODY_READER_CREDENTIAL_NOT_MOUNTED" : "CUSTODY_READER_CREDENTIAL_FILE_REJECTED" };
      }
      // Filesystem IO may cross the validity boundary. Make the final decision
      // against the current clock after the last asynchronous prerequisite.
      const finalReceipt = verifyGpt02DbaCustodyReceipt({
        document, trustedIssuerPublicDerB64: env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64,
        trustedIssuerSha256: env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256, verifiedWorker: current.proof, now: deps.now(),
      });
      return finalReceipt.verified ? finalReceipt : { ...finalReceipt, reason: "CUSTODY_DBA_RECEIPT_REJECTED" };
    },
  };
}

/** Canonical factory retained from PR #1813; one adapter and no V1 fallback. */
export function createConfiguredGpt02ReaderCustodyAdapter() {
  return createGpt02ReaderCustodyRuntime();
}
