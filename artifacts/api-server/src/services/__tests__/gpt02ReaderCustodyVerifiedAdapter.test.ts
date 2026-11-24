import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn() }));
const database = vi.hoisted(() => ({
  verify: vi.fn(),
  pool: { options: { connectionString: "postgresql://isolated-fixture.invalid:1/postgres" } },
}));
vi.mock("node:fs/promises", () => io);
vi.mock("@workspace/db", () => ({
  assertDevelopmentDatabaseIsolation: database.verify,
  pool: database.pool,
}));

import { createConfiguredGpt02ReaderCustodyAdapter } from "../gpt02ReaderCustodyVerifiedAdapter.js";
import {
  GPT02_DBA_CUSTODY_TARGET,
  GPT02_WORKER_ATTESTATION_TARGET,
  gpt02CustodyCredentialBinding,
} from "../gpt02ReaderCustodyAttestation.js";

const now = Date.UTC(2026, 10, 24, 12);
const serviceId = "8ad7fba1-d2e3-4f51-8a13-68d1eaf71d50";
const receiptId = "1eaf4224-b999-4e13-80e2-3fc648525982";
const binding = gpt02CustodyCredentialBinding("a".repeat(64));
const principal = "openclaw-vps-main";
const paths = {
  worker: "/run/credentials/gpt02-reader-custody/worker-attestation.json",
  dba: "/run/credentials/gpt02-reader-custody/issuer-receipt.json",
  reader: "/run/credentials/gpt02-owner-ledger-reader/reader.json",
};

function pair() {
  const result = generateKeyPairSync("ed25519");
  const der = result.publicKey.export({ type: "spki", format: "der" });
  return {
    ...result,
    der: der.toString("base64"),
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
}

function fixture() {
  const workerKey = pair();
  const dbaKey = pair();
  const workerReceipt = {
    ...GPT02_WORKER_ATTESTATION_TARGET,
    credentialId: serviceId,
    credentialBinding: binding,
    issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
    notBefore: now - 1000,
    expiresAt: now + 60_000,
  };
  const dbaReceipt = {
    ...GPT02_DBA_CUSTODY_TARGET,
    credentialId: serviceId,
    credentialBinding: binding,
    workerAttestationSha256: createHash("sha256").update(JSON.stringify(workerReceipt)).digest("hex"),
    receiptId,
    notBefore: now,
    expiresAt: now + 30_000,
  };
  const documents: Record<string, unknown> = {
    [paths.worker]: {
      receipt: workerReceipt,
      signature: sign(null, Buffer.from(JSON.stringify(workerReceipt)), workerKey.privateKey).toString("base64url"),
    },
    [paths.dba]: {
      receipt: dbaReceipt,
      signature: sign(null, Buffer.from(JSON.stringify(dbaReceipt)), dbaKey.privateKey).toString("base64url"),
    },
  };
  // Exactly the previous V1 wire format, genuinely signed with the same trusted
  // keys. These proofs lack credential-generation and worker-to-DBA bindings.
  const oldWorker = {
    kind: "GPT02_DEV_WORKER_ATTESTATION_V1",
    serviceId,
    principal,
    scope: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
    projectId: "xssrfshdrtdfupgqwfdw",
    issuedAt: now - 1000,
    expiresAt: now + 60_000,
  };
  const oldDba = {
    kind: "GPT02_DEV_OWNER_READER_ISSUER_RECEIPT_V1",
    receiptId,
    role: "gpt02_owner_ledger_reader_dev",
    projectId: "xssrfshdrtdfupgqwfdw",
    issuedAt: now - 1000,
    expiresAt: now + 60_000,
  };
  const legacyWorker = {
    ...oldWorker,
    signature: sign(null, Buffer.from(JSON.stringify(oldWorker)), workerKey.privateKey).toString("base64"),
  };
  const legacyDba = {
    ...oldDba,
    signature: sign(null, Buffer.from(JSON.stringify(oldDba)), dbaKey.privateKey).toString("base64"),
  };
  const env = {
    APP_ENV: "development",
    NODE_ENV: "test",
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64: workerKey.der,
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256: workerKey.fingerprint,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64: dbaKey.der,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256: dbaKey.fingerprint,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.spyOn(Date, "now").mockReturnValue(now);
  io.lstat.mockResolvedValue({
    uid: 0, mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false,
  });
  const readerContentsRead = vi.fn(() => { throw new Error("Reader secret must not be read"); });
  io.open.mockImplementation(async (path: string) => {
    const isReader = path === paths.reader;
    if (!isReader && !Object.hasOwn(documents, path)) {
      throw Object.assign(new Error("absent fixture"), { code: "ENOENT" });
    }
    const bytes = isReader ? Buffer.from("opaque-unread-fixture") : Buffer.from(JSON.stringify(documents[path]));
    let position = 0;
    return {
      stat: async () => ({
        uid: 0, mode: 0o100600, nlink: 1, size: bytes.length,
        dev: 1, ino: 2, mtimeMs: 3, ctimeMs: 4, isFile: () => true,
      }),
      read: isReader ? readerContentsRead : async (target: Buffer, offset: number, length: number) => {
        const count = Math.min(length, bytes.length - position);
        bytes.copy(target, offset, position, position + count);
        position += count;
        return { bytesRead: count, buffer: target };
      },
      close: async () => undefined,
    };
  });
  return { documents, legacyWorker, legacyDba, readerContentsRead };
}

describe("configured custody adapter preserves deployed inputs without accepting unbound V1 proofs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.verify.mockReset();
    io.lstat.mockReset();
    io.open.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the established public-key variables and fixed mounts with the new fingerprint pins", async () => {
    const s = fixture();
    const adapter = createConfiguredGpt02ReaderCustodyAdapter();
    expect(await adapter.verifyWorkerAttestation(serviceId, principal, binding)).toEqual({ verified: true });
    expect(await adapter.readDbaCustodyReceipt(serviceId, principal, binding)).toEqual({ verified: true, receiptId });
    expect(database.verify).toHaveBeenCalledWith(database.pool.options.connectionString, {
      APP_ENV: "development",
      SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
    });
    expect(io.open.mock.calls.map(call => call[0])).toEqual([paths.worker, paths.worker, paths.dba, paths.reader]);
    expect(s.readerContentsRead).not.toHaveBeenCalled();
  });

  it("rejects genuinely signed legacy V1 worker and DBA files with no compatibility fallback", async () => {
    const s = fixture();
    s.documents[paths.worker] = s.legacyWorker;
    s.documents[paths.dba] = s.legacyDba;
    const adapter = createConfiguredGpt02ReaderCustodyAdapter();
    expect(await adapter.verifyWorkerAttestation(serviceId, principal, binding)).toEqual({
      verified: false, reason: "CUSTODY_ATTESTATION_REJECTED",
    });
    expect(await adapter.readDbaCustodyReceipt(serviceId, principal, binding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_ATTESTATION_REJECTED",
    });
    expect(io.open.mock.calls.some(call => call[0] === paths.dba || call[0] === paths.reader)).toBe(false);
  });

  it("rejects a legacy unbound DBA receipt even after authentic V2 worker verification", async () => {
    const s = fixture();
    s.documents[paths.dba] = s.legacyDba;
    const adapter = createConfiguredGpt02ReaderCustodyAdapter();
    expect(await adapter.verifyWorkerAttestation(serviceId, principal, binding)).toEqual({ verified: true });
    expect(await adapter.readDbaCustodyReceipt(serviceId, principal, binding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_DBA_RECEIPT_REJECTED",
    });
    expect(io.open.mock.calls.some(call => call[0] === paths.reader)).toBe(false);
  });

  it("does not treat a legacy public-key setting alone as a verified fingerprint pin", async () => {
    fixture();
    vi.stubEnv("GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256", undefined);
    const adapter = createConfiguredGpt02ReaderCustodyAdapter();
    expect(await adapter.verifyWorkerAttestation(serviceId, principal, binding)).toEqual({
      verified: false, reason: "CUSTODY_ATTESTOR_NOT_CONFIGURED",
    });
    expect(io.open).not.toHaveBeenCalled();
  });
});
