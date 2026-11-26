import { constants } from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn() }));
const database = vi.hoisted(() => ({
  isolate: vi.fn(),
  pool: { options: { connectionString: "postgresql://fixture.invalid:1/postgres" } },
}));
vi.mock("node:fs/promises", () => io);
vi.mock("@workspace/db", () => ({
  assertDevelopmentDatabaseIsolation: database.isolate,
  pool: database.pool,
}));

import {
  createGpt02ReaderCustodyRuntime,
  CustodyFileError,
  GPT02_CUSTODY_FILES,
  inspectProtectedGpt02ReaderMount,
  readProtectedGpt02CustodyDocument,
} from "../gpt02ReaderCustodyVerifiedAdapter.js";
import {
  GPT02_DBA_CUSTODY_TARGET,
  GPT02_WORKER_ATTESTATION_TARGET,
  gpt02CustodyCredentialBinding,
} from "../gpt02ReaderCustodyAttestation.js";

const now = Date.UTC(2026, 10, 24, 12);
const serviceId = "8ad7fba1-d2e3-4f51-8a13-68d1eaf71d50";
const receiptId = "1eaf4224-b999-4e13-80e2-3fc648525982";
const principal = "openclaw-vps-main";
const tokenBinding = gpt02CustodyCredentialBinding("a".repeat(64));

function key() {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.publicKey.export({ type: "spki", format: "der" });
  return { ...pair, publicDer: der.toString("base64"), fingerprint: createHash("sha256").update(der).digest("hex") };
}
function fixture() {
  // Generated in memory only, never used against a live issuer or database.
  const workerKey = key();
  const dbaKey = key();
  const workerReceipt = {
    ...GPT02_WORKER_ATTESTATION_TARGET,
    credentialId: serviceId,
    credentialBinding: tokenBinding,
    issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
    notBefore: now - 1000,
    expiresAt: now + 60_000,
  };
  const worker = {
    receipt: workerReceipt,
    signature: sign(null, Buffer.from(JSON.stringify(workerReceipt)), workerKey.privateKey).toString("base64url"),
  };
  const dbaReceipt = {
    ...GPT02_DBA_CUSTODY_TARGET,
    credentialId: serviceId,
    credentialBinding: tokenBinding,
    workerAttestationSha256: createHash("sha256").update(JSON.stringify(workerReceipt)).digest("hex"),
    receiptId,
    notBefore: now,
    expiresAt: now + 30_000,
  };
  const dba = {
    receipt: dbaReceipt,
    signature: sign(null, Buffer.from(JSON.stringify(dbaReceipt)), dbaKey.privateKey).toString("base64url"),
  };
  const env: NodeJS.ProcessEnv = {
    APP_ENV: "development",
    NODE_ENV: "test",
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64: workerKey.publicDer,
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256: workerKey.fingerprint,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64: dbaKey.publicDer,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256: dbaKey.fingerprint,
  };
  const documents: Record<"worker" | "dba", unknown> = { worker, dba };
  const readDocument = vi.fn(async (kind: "worker" | "dba") => documents[kind]);
  const inspectReaderMount = vi.fn(async () => undefined);
  const verifyDatabaseIsolation = vi.fn();
  let clock = now;
  const runtime = createGpt02ReaderCustodyRuntime({
    environment: () => env,
    now: () => clock,
    readDocument,
    inspectReaderMount,
    verifyDatabaseIsolation,
  });
  return {
    runtime, env, worker, workerKey, dba, documents, readDocument, inspectReaderMount, verifyDatabaseIsolation,
    setTime: (value: number) => { clock = value; },
  };
}

describe("GPT02 custody runtime uses real signatures with isolated dependencies", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts valid proof and a separately signed DBA handoff for exactly this credential", async () => {
    const s = fixture();
    expect(await s.runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding)).toEqual({ verified: true });
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({ verified: true, receiptId });
    expect(s.inspectReaderMount).toHaveBeenCalledOnce();
    expect(s.readDocument.mock.calls.map(call => call[0])).toEqual(["worker", "worker", "dba"]);
  });

  it("rejects a receipt that expires while awaiting the final credential-mount inspection", async () => {
    const s = fixture();
    s.inspectReaderMount.mockImplementation(async () => { s.setTime(now + 30_000); });
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_DBA_RECEIPT_REJECTED",
    });
    expect(s.inspectReaderMount).toHaveBeenCalledOnce();
  });

  it.each([
    ["unset APP_ENV", undefined, "test"],
    ["production APP_ENV", "production", "test"],
    ["production NODE_ENV", "development", "production"],
  ])("rejects %s before touching evidence", async (_name, appEnv, nodeEnv) => {
    const s = fixture();
    s.env.APP_ENV = appEnv;
    s.env.NODE_ENV = nodeEnv;
    expect(await s.runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding)).toMatchObject({
      verified: false, reason: "CUSTODY_DEV_ENVIRONMENT_REQUIRED",
    });
    expect(s.readDocument).not.toHaveBeenCalled();
  });

  it("rejects a database isolation failure without leaking the error", async () => {
    const s = fixture();
    s.verifyDatabaseIsolation.mockImplementation(() => { throw new Error("private configuration"); });
    expect(await s.runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding)).toEqual({
      verified: false, reason: "CUSTODY_DEV_DATABASE_UNVERIFIED",
    });
    expect(s.readDocument).not.toHaveBeenCalled();
  });

  it("uses the real configured pool for the default database check", async () => {
    const s = fixture();
    const runtime = createGpt02ReaderCustodyRuntime({
      environment: () => s.env, now: () => now,
      readDocument: s.readDocument, inspectReaderMount: s.inspectReaderMount,
    });
    await runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding);
    expect(database.isolate).toHaveBeenCalledWith(database.pool.options.connectionString, {
      APP_ENV: "development", SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
    });
  });

  it.each([
    ["key", "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64"],
    ["fingerprint", "GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256"],
  ])("rejects missing attestor %s with a concrete readiness reason", async (_name, field) => {
    const s = fixture();
    delete s.env[field];
    expect(await s.runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding)).toEqual({
      verified: false, reason: "CUSTODY_ATTESTOR_NOT_CONFIGURED",
    });
    expect(s.readDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong principal", "openclaw-pc-worker", tokenBinding],
    ["missing binding", principal, undefined],
  ])("rejects %s", async (_name, worker, binding) => {
    const s = fixture();
    expect(await s.runtime.verifyWorkerAttestation(serviceId, worker, binding)).toMatchObject({
      verified: false, reason: "CUSTODY_WORKER_TOKEN_NOT_BOUND",
    });
  });

  it("invalidates the proof after token rotation even with the same credential row ID", async () => {
    const s = fixture();
    const rotated = gpt02CustodyCredentialBinding("b".repeat(64));
    expect(await s.runtime.verifyWorkerAttestation(serviceId, principal, rotated)).toMatchObject({
      verified: false, reason: "CUSTODY_ATTESTATION_REJECTED",
    });
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, rotated)).toMatchObject({
      verified: false, receiptId: null,
    });
    expect(s.inspectReaderMount).not.toHaveBeenCalled();
  });

  it("revokes file-backed authorization immediately when the signed worker file is removed", async () => {
    const s = fixture();
    expect((await s.runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding)).verified).toBe(true);
    s.readDocument.mockRejectedValue(new CustodyFileError("MISSING"));
    expect(await s.runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding)).toEqual({
      verified: false, reason: "CUSTODY_ATTESTATION_NOT_INSTALLED",
    });
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_ATTESTATION_NOT_INSTALLED",
    });
    expect(s.inspectReaderMount).not.toHaveBeenCalled();
  });

  it("never reuses a removed DBA receipt after an earlier success", async () => {
    const s = fixture();
    expect((await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).verified).toBe(true);
    s.readDocument.mockImplementation(async kind => {
      if (kind === "dba") throw new CustodyFileError("MISSING");
      return s.worker;
    });
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_DBA_RECEIPT_NOT_INSTALLED",
    });
    expect(s.inspectReaderMount).toHaveBeenCalledTimes(1);
  });

  it("denies absent DBA trust even after real worker verification", async () => {
    const s = fixture();
    delete s.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256;
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_DBA_ATTESTOR_NOT_CONFIGURED",
    });
    expect(s.inspectReaderMount).not.toHaveBeenCalled();
  });

  it("does not treat the same issuer key as two independent custody domains", async () => {
    const s = fixture();
    s.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 = s.env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256;
    s.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64 = s.env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64;
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_ISSUER_DOMAINS_NOT_SEPARATE",
    });
  });

  it("rejects a stale DBA handoff when the worker attestation is replaced", async () => {
    const s = fixture();
    const receipt = { ...s.worker.receipt, notBefore: now - 500 };
    s.documents.worker = {
      receipt,
      signature: sign(null, Buffer.from(JSON.stringify(receipt)), s.workerKey.privateKey).toString("base64url"),
    };
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({
      verified: false, receiptId: null, reason: "CUSTODY_DBA_RECEIPT_REJECTED",
    });
    expect(s.inspectReaderMount).not.toHaveBeenCalled();
  });

  it.each([
    ["MISSING", "CUSTODY_READER_CREDENTIAL_NOT_MOUNTED"],
    ["UNSAFE", "CUSTODY_READER_CREDENTIAL_FILE_REJECTED"],
  ] as const)("never reports ready with a %s runtime credential", async (code, reason) => {
    const s = fixture();
    s.inspectReaderMount.mockRejectedValue(new CustodyFileError(code));
    expect(await s.runtime.readDbaCustodyReceipt(serviceId, principal, tokenBinding)).toEqual({
      verified: false, receiptId: null, reason,
    });
  });

  it("sanitizes arbitrary IO errors", async () => {
    const s = fixture();
    s.readDocument.mockRejectedValue(new Error("password=do-not-disclose"));
    const result = await s.runtime.verifyWorkerAttestation(serviceId, principal, tokenBinding);
    expect(result).toEqual({ verified: false, reason: "CUSTODY_ATTESTATION_FILE_REJECTED" });
    expect(JSON.stringify(result)).not.toContain("do-not-disclose");
  });
});

function directory(overrides: Record<string, unknown> = {}) {
  return { uid: 0, mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false, ...overrides };
}
function stat(size: number, overrides: Record<string, unknown> = {}) {
  return {
    uid: 0, mode: 0o100600, nlink: 1, size, dev: 1, ino: 2, mtimeMs: 30, ctimeMs: 40,
    isFile: () => true, ...overrides,
  };
}
function fileFixture(value: string | Buffer, overrides: Record<string, unknown> = {}) {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  let position = 0;
  const file = {
    stat: vi.fn().mockResolvedValue(stat(bytes.length, overrides)),
    read: vi.fn(async (target: Buffer, offset: number, length: number) => {
      const count = Math.min(length, bytes.length - position, 17);
      bytes.copy(target, offset, position, position + count);
      position += count;
      return { bytesRead: count, buffer: target };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  io.lstat.mockResolvedValue(directory());
  io.open.mockResolvedValue(file);
  return file;
}

describe("fixed custody file IO validates the actual descriptor", () => {
  beforeEach(() => { vi.clearAllMocks(); io.open.mockReset(); io.lstat.mockReset(); });

  it("reads a bounded non-secret JSON receipt with no-follow and nonblocking open", async () => {
    const payload = { receipt: { note: "non-secret" }, signature: "fixture" };
    const file = fileFixture(JSON.stringify(payload));
    expect(await readProtectedGpt02CustodyDocument("worker")).toEqual(payload);
    expect(io.open).toHaveBeenCalledWith(
      GPT02_CUSTODY_FILES.worker, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    expect(io.lstat.mock.calls.map(call => call[0])).toEqual(["/run/credentials/gpt02-reader-custody", "/run/credentials", "/run", "/"]);
    expect(file.read.mock.calls.every(call => call[2] <= 8193)).toBe(true);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["symlink parent", { isSymbolicLink: () => true }],
    ["non-directory parent", { isDirectory: () => false }],
    ["untrusted parent owner", { uid: 1001 }],
    ["writable parent", { mode: 0o40777 }],
  ])("rejects %s before opening any file", async (_name, bad) => {
    const file = fileFixture("{}");
    io.lstat.mockResolvedValueOnce(directory(bad));
    await expect(readProtectedGpt02CustodyDocument("worker")).rejects.toMatchObject({ code: "UNSAFE" });
    expect(io.open).not.toHaveBeenCalled();
    expect(file.read).not.toHaveBeenCalled();
  });

  it("rejects a final-component symlink and sanitizes the OS error", async () => {
    fileFixture("{}");
    io.open.mockRejectedValue(Object.assign(new Error("sensitive path"), { code: "ELOOP" }));
    await expect(readProtectedGpt02CustodyDocument("worker")).rejects.toMatchObject({ message: "UNSAFE", code: "UNSAFE" });
    expect(io.open.mock.calls[0][1] & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
  });

  it.each([
    ["wrong owner", { uid: 1001 }],
    ["group-readable", { mode: 0o100640 }],
    ["world-writable", { mode: 0o100602 }],
    ["directory or special file", { isFile: () => false }],
    ["hardlinked file", { nlink: 2 }],
    ["oversized", { size: 8193 }],
    ["empty", { size: 0 }],
  ])("rejects %s before reading and closes the descriptor", async (_name, bad) => {
    const file = fileFixture("{}", bad);
    await expect(readProtectedGpt02CustodyDocument("dba")).rejects.toMatchObject({ code: "UNSAFE" });
    expect(file.read).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["mtime changed", { mtimeMs: 31 }],
    ["ctime changed", { ctimeMs: 41 }],
    ["inode changed", { ino: 3 }],
    ["device changed", { dev: 2 }],
    ["size changed", { size: 3 }],
    ["permission changed", { mode: 0o100644 }],
  ])("rejects %s during the read", async (_name, changed) => {
    const file = fileFixture("{}");
    file.stat.mockResolvedValueOnce(stat(2)).mockResolvedValueOnce(stat(2, changed));
    await expect(readProtectedGpt02CustodyDocument("worker")).rejects.toMatchObject({ code: "UNSAFE" });
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("bounds a file that grows after the initial fstat", async () => {
    const file = fileFixture(Buffer.alloc(9000, 0x20));
    file.stat.mockResolvedValue(stat(2));
    await expect(readProtectedGpt02CustodyDocument("worker")).rejects.toMatchObject({ code: "UNSAFE" });
    const requested = file.read.mock.calls.reduce((n, call) => n + Math.min(call[2], 17), 0);
    expect(requested).toBeLessThanOrEqual(8193);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["malformed JSON", Buffer.from("{")],
    ["invalid UTF-8", Buffer.from([0x7b, 0xff, 0x7d])],
  ])("rejects %s and closes", async (_name, bytes) => {
    const file = fileFixture(bytes);
    await expect(readProtectedGpt02CustodyDocument("worker")).rejects.toMatchObject({ code: "INVALID" });
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("reports missing evidence without leaking path or raw OS messages", async () => {
    fileFixture("{}");
    io.open.mockRejectedValue(Object.assign(new Error("private pathname"), { code: "ENOENT" }));
    await expect(readProtectedGpt02CustodyDocument("worker")).rejects.toMatchObject({ message: "MISSING", code: "MISSING" });
  });

  it("closes a descriptor after a read failure", async () => {
    const file = fileFixture("{}");
    file.read.mockRejectedValue(new Error("raw failed IO"));
    await expect(readProtectedGpt02CustodyDocument("worker")).rejects.toMatchObject({ code: "UNSAFE" });
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("inspects reader credential metadata without reading any secret bytes", async () => {
    const file = fileFixture("this content must never be read");
    await expect(inspectProtectedGpt02ReaderMount()).resolves.toBeUndefined();
    expect(io.open.mock.calls[0][0]).toBe(GPT02_CUSTODY_FILES.reader);
    expect(file.read).not.toHaveBeenCalled();
    expect(file.stat).toHaveBeenCalledOnce();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it("rejects an oversized credential mount without reading its contents", async () => {
    const file = fileFixture("ignored", { size: 4097 });
    await expect(inspectProtectedGpt02ReaderMount()).rejects.toMatchObject({ code: "UNSAFE" });
    expect(file.read).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });
});
