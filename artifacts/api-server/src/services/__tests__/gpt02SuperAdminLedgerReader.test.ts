import { constants, type Stats } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lstat: vi.fn(), open: vi.fn(), readFile: vi.fn(), lstatSync: vi.fn(), readFileSync: vi.fn(),
  createPool: vi.fn(), digest: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ lstat: mocks.lstat, open: mocks.open, readFile: mocks.readFile }));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  lstatSync: mocks.lstatSync, readFileSync: mocks.readFileSync,
}));
vi.mock("@workspace/db", () => ({ PostgresPool: mocks.createPool }));
vi.mock("../gpt02RelockOwnerApprovalService.js", () => ({ digestGpt02RelockManifest: mocks.digest }));

import { readGpt02SuperAdminLedgerReceipt } from "../gpt02SuperAdminLedgerReader.js";

const CHALLENGE = "9c4f21e1-48af-4f7f-9830-931b84e3e846";
const CREDENTIAL = "/run/credentials/gpt02-owner-ledger-reader/reader.json";
const ROOT_CA = "/etc/gpt02-dev/supabase-root-ca-2021.crt";
const DENIED = "GPT02_LEDGER_SEPARATE_READER_CUSTODY_UNAVAILABLE";
const CA = "-----BEGIN CERTIFICATE-----\nSYNTHETIC_TEST_ONLY\n-----END CERTIFICATE-----";
const ACTOR = {
  id: "google_103728868378401731050", role: "super_admin", companyId: "default",
  email: "admcst001@gmail.com", authSource: "supabase_google_identity",
  authSupabaseId: "11111111-2222-4333-8444-555555555555", authVerifiedAt: Date.now(),
};
const CONFIG = {
  database: "postgres", host: "db.xssrfshdrtdfupgqwfdw.supabase.co",
  password: "synthetic-test-only-not-real-credential", port: 5432,
  projectId: "xssrfshdrtdfupgqwfdw", sslMode: "verify-full", user: "gpt02_owner_ledger_reader_dev",
};
const IDENTITY = {
  actor: CONFIG.user, effective: CONFIG.user, database_name: "postgres",
  transaction_read_only: "on", default_read_only: "on",
};
const DECISION = {
  challenge_id: CHALLENGE, status: "CONSUMED", decision: "APPROVED",
  manifest_sha256: "a".repeat(64), manifest_json: { scope: "GPT02_RELOCK_CST_DEV" },
  decided_at: new Date("2026-11-24T07:25:16.637Z"),
  consumed_at: new Date("2026-11-24T07:25:16.637Z"),
  expires_at: new Date("2026-11-24T07:27:11.791Z"),
  approval_method: "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION",
};

function fileStat(size: number, mode: number): Stats {
  return {
    uid: 0, gid: 0, mode, nlink: 1, size, dev: 1, ino: mode, mtimeMs: 100, ctimeMs: 100,
    isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
  } as Stats;
}

function installFixture(nextIdentity = IDENTITY, nextDecision: typeof DECISION | null = DECISION) {
  const files = new Map([
    [CREDENTIAL, { data: Buffer.from(JSON.stringify(CONFIG)), stat: fileStat(Buffer.byteLength(JSON.stringify(CONFIG)), 0o100600) }],
    [ROOT_CA, { data: Buffer.from(CA), stat: fileStat(Buffer.byteLength(CA), 0o100644) }],
  ]);
  const handles: Array<{
    path: string; stat: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>;
  }> = [];
  const parents = new Map<string, Partial<Stats>>();
  mocks.lstat.mockImplementation(async (path: string) => ({
    uid: 0, gid: 0, mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false,
    ...parents.get(path),
  }));
  mocks.open.mockImplementation(async (path: string) => {
    const entry = files.get(path);
    if (!entry) throw Object.assign(new Error("SYNTHETIC_PRIVATE_PATH_NOT_FOUND"), { code: "ENOENT" });
    let position = 0;
    const handle = {
      path,
      stat: vi.fn().mockImplementation(async () => ({ ...entry.stat })),
      read: vi.fn(async (target: Buffer, offset: number, length: number, _position: number | null) => {
        const bytesRead = Math.min(length, entry.data.length - position);
        entry.data.copy(target, offset, position, position + bytesRead);
        position += bytesRead;
        return { bytesRead, buffer: target };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    handles.push(handle);
    return handle;
  });
  mocks.digest.mockReturnValue("a".repeat(64));
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.includes("session_user::text")) return { rowCount: 1, rows: [nextIdentity] };
      if (sql.includes("FROM gpt02_owner_approval.")) return {
        rowCount: nextDecision ? 1 : 0, rows: nextDecision ? [nextDecision] : [],
      };
      throw new Error("Unexpected SQL");
    }),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn().mockResolvedValue(undefined) };
  mocks.createPool.mockImplementation(function () { return pool; });
  function replaceContent(path: string, data: Buffer) {
    const entry = files.get(path)!;
    entry.data = data;
    entry.stat.size = data.length;
  }
  return { client, pool, files, handles, parents, replaceContent };
}

async function expectCustodyDenied(promise: Promise<unknown>) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ message: DENIED });
  expect(error).not.toHaveProperty("cause");
}

describe("GPT02 separated Super Admin ledger custody", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("GPT02_OWNER_LEDGER_READER_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["GPT02_OWNER_LEDGER_READER_ENABLED", "false"],
    ["APP_ENV", "production"], ["NODE_ENV", "production"],
  ])("refuses %s=%s before opening files or a database connection", async (name, value) => {
    vi.stubEnv(name, value);
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(mocks.lstat).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.createPool).not.toHaveBeenCalled();
  });

  it.each([
    ["missing actor", undefined], ["null actor", null], ["missing email", { ...ACTOR, email: undefined }],
    ["numeric email", { ...ACTOR, email: 123 }], ["missing owner identity", { ...ACTOR, authSupabaseId: undefined }],
    ["invalid owner identity", { ...ACTOR, authSupabaseId: "not-a-uuid" }],
    ["wrong owner", { ...ACTOR, email: "different-owner@example.invalid" }],
    ["non-admin actor", { ...ACTOR, role: "viewer" }],
  ])("sanitizes %s without touching credentials", async (_name, actor) => {
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(
      CHALLENGE, actor as unknown as Parameters<typeof readGpt02SuperAdminLedgerReceipt>[1],
    ));
    expect(mocks.lstat).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.createPool).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, "not-a-uuid"])("sanitizes invalid challenge %j before input IO", async (challenge) => {
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(challenge as unknown as string, ACTOR));
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.createPool).not.toHaveBeenCalled();
  });

  it.each([CREDENTIAL, ROOT_CA])("sanitizes a missing protected file %s and opens no connection", async (path) => {
    const { files, handles } = installFixture();
    files.delete(path);
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(mocks.createPool).not.toHaveBeenCalled();
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("does not follow a credential replaced with a symlink between directory checks and open", async () => {
    installFixture();
    mocks.open.mockImplementation(async (path: string, flags: number) => {
      expect(path).toBe(CREDENTIAL);
      expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      throw Object.assign(new Error("SYNTHETIC_PRIVATE_SYMLINK_TARGET"), { code: "ELOOP" });
    });
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.createPool).not.toHaveBeenCalled();
  });

  it.each([
    ["credential owner", CREDENTIAL, { uid: 1000 }],
    ["credential group", CREDENTIAL, { gid: 999 }],
    ["readable credential", CREDENTIAL, { mode: 0o100640 }],
    ["credential hard link", CREDENTIAL, { nlink: 2 }],
    ["CA owner", ROOT_CA, { uid: 1000 }], ["CA group", ROOT_CA, { gid: 999 }],
    ["group-writable CA", ROOT_CA, { mode: 0o100664 }],
    ["world-writable CA", ROOT_CA, { mode: 0o100646 }],
    ["CA hard link", ROOT_CA, { nlink: 2 }],
  ] as const)("rejects unsafe %s with its deployed file policy", async (_name, path, stat) => {
    const { files, handles } = installFixture();
    Object.assign(files.get(path)!.stat, stat);
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(mocks.createPool).not.toHaveBeenCalled();
    const rejectedHandle = handles.find((handle) => handle.path === path)!;
    expect(rejectedHandle.read).not.toHaveBeenCalled();
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("also requires trusted root-owned CA ancestors", async () => {
    const { parents, handles } = installFixture();
    parents.set("/etc/gpt02-dev", { gid: 999 });
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(mocks.open).not.toHaveBeenCalledWith(ROOT_CA, expect.anything());
    expect(mocks.createPool).not.toHaveBeenCalled();
    expect(handles[0].close).toHaveBeenCalledOnce();
  });

  it.each([
    ["malformed credential JSON", CREDENTIAL, Buffer.from('{"password":"SYNTHETIC_PRIVATE_MARKER"')],
    ["invalid UTF-8 credential", CREDENTIAL, Buffer.from([0xff, 0xfe])],
    ["invalid UTF-8 CA", ROOT_CA, Buffer.concat([Buffer.from(CA), Buffer.from([0xff])])],
    ["missing certificate marker", ROOT_CA, Buffer.from("SYNTHETIC_PRIVATE_NOT_A_CERTIFICATE")],
  ])("sanitizes %s and closes all descriptors", async (_name, path, data) => {
    const { replaceContent, handles } = installFixture();
    replaceContent(path as string, data as Buffer);
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(mocks.createPool).not.toHaveBeenCalled();
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["different host", { host: "db.attacker.example.invalid" }],
    ["writer role", { user: "aicore_dev_runtime" }],
    ["disabled TLS", { sslMode: "disable" }],
    ["extra connection option", { connectionString: "synthetic-untrusted-connection" }],
  ] as const)("refuses credential configuration with %s", async (_name, patch) => {
    const { replaceContent, handles } = installFixture();
    replaceContent(CREDENTIAL, Buffer.from(JSON.stringify({ ...CONFIG, ...patch })));
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(mocks.createPool).not.toHaveBeenCalled();
    expect(handles[0].close).toHaveBeenCalledOnce();
  });

  it.each([[CREDENTIAL, 4_096], [ROOT_CA, 16_384]] as const)(
    "bounds %s even when it grows after stat", async (path, maxBytes) => {
      const { files, handles } = installFixture();
      files.get(path)!.data = Buffer.alloc(maxBytes * 2, 0x61);
      await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
      expect(mocks.createPool).not.toHaveBeenCalled();
      const changed = handles.find((handle) => handle.path === path)!;
      const returnedBytes = await Promise.all(changed.read.mock.results.map((result) => result.value));
      expect(returnedBytes.reduce((sum, result) => sum + result.bytesRead, 0)).toBe(maxBytes + 1);
      for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
    },
  );

  it("keeps valid reads on the exact TLS-verified role, read-only transaction, and owner binding", async () => {
    const { client, pool, handles } = installFixture();
    const receipt = await readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR);
    expect(receipt).toEqual({
      challengeId: CHALLENGE, scope: "GPT02_RELOCK_CST_DEV", status: "CONSUMED", decision: "APPROVED",
      manifestSha256: "a".repeat(64), decidedAt: DECISION.decided_at.toISOString(),
    });
    expect(mocks.createPool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      host: CONFIG.host, port: 5432, database: "postgres", user: CONFIG.user, password: CONFIG.password,
      ssl: { ca: CA, rejectUnauthorized: true, servername: CONFIG.host }, max: 1,
    }));
    expect(mocks.open.mock.calls.map(([path]) => path)).toEqual([CREDENTIAL, ROOT_CA]);
    for (const [, flags] of mocks.open.mock.calls) {
      expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.readFileSync).not.toHaveBeenCalled();
    const sql = client.query.mock.calls.map((call) => call[0]);
    expect(sql[0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(sql[1]).toContain("transaction_read_only");
    expect(sql[2]).toContain("d.decided_at = c.consumed_at");
    expect(sql[2]).toContain("d.owner_auth_supabase_id = $3::uuid");
    expect(client.query.mock.calls[2][1]).toEqual([
      CHALLENGE, ACTOR.email, ACTOR.authSupabaseId, `owner:${ACTOR.id}`,
    ]);
    expect(sql[3]).toBe("COMMIT");
    expect(sql.some((query) => /UPDATE\s|INSERT\s|DELETE\s|ALTER\s/i.test(query))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(JSON.stringify(receipt)).not.toContain(CONFIG.password);
    expect(JSON.stringify(receipt)).not.toContain(CA);
  });

  it.each([
    ["writer session user", { actor: "aicore_dev_runtime" }],
    ["writer effective role", { effective: "aicore_dev_runtime" }],
    ["different database", { database_name: "other" }],
    ["writable transaction", { transaction_read_only: "off" }],
    ["writable role default", { default_read_only: "off" }],
  ] as const)("rejects %s before querying owner decisions", async (_name, patch) => {
    const { client, pool } = installFixture({ ...IDENTITY, ...patch });
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    const sql = client.query.mock.calls.map((call) => call[0]);
    expect(sql).not.toContainEqual(expect.stringContaining("FROM gpt02_owner_approval."));
    expect(sql).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("rejects a mismatched decision digest without disclosing a decision", async () => {
    const { client, pool } = installFixture(IDENTITY, { ...DECISION, manifest_sha256: "b".repeat(64) });
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("returns no receipt when the scoped owner decision is absent", async () => {
    const { client, pool } = installFixture(IDENTITY, null);
    await expect(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR)).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("sanitizes database connection errors and closes the isolated pool", async () => {
    const { pool, handles } = installFixture();
    pool.connect.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_DATABASE_DIAGNOSTIC"));
    await expectCustodyDenied(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR));
    expect(pool.end).toHaveBeenCalledOnce();
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });
});
