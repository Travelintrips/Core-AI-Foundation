import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  readFile: vi.fn(),
  createPool: vi.fn(),
  digest: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, lstatSync: mocks.lstat, readFileSync: mocks.readFile };
});
vi.mock("@workspace/db", () => ({ PostgresPool: mocks.createPool }));
vi.mock("../gpt02RelockOwnerApprovalService.js", () => ({
  digestGpt02RelockManifest: mocks.digest,
}));

import { readGpt02SuperAdminLedgerReceipt } from "../gpt02SuperAdminLedgerReader.js";

const CHALLENGE = "9c4f21e1-48af-4f7f-9830-931b84e3e846";
const ACTOR = {
  id: "google_103728868378401731050",
  role: "super_admin",
  companyId: "default",
  email: "admcst001@gmail.com",
  authSource: "supabase_google_identity",
  authSupabaseId: "11111111-2222-4333-8444-555555555555",
  authVerifiedAt: Date.now(),
};
const CONFIG = {
  database: "postgres",
  host: "db.xssrfshdrtdfupgqwfdw.supabase.co",
  password: "synthetic-test-only-not-real-credential",
  port: 5432,
  projectId: "xssrfshdrtdfupgqwfdw",
  sslMode: "verify-full",
  user: "gpt02_owner_ledger_reader_dev",
};
const identity = {
  actor: CONFIG.user,
  effective: CONFIG.user,
  database_name: "postgres",
  transaction_read_only: "on",
  default_read_only: "on",
};
const DECISION = {
  challenge_id: CHALLENGE, status: "CONSUMED", decision: "APPROVED",
  manifest_sha256: "a".repeat(64), manifest_json: { scope: "GPT02_RELOCK_CST_DEV" },
  decided_at: new Date("2026-11-24T07:25:16.637Z"),
  consumed_at: new Date("2026-11-24T07:25:16.637Z"),
  expires_at: new Date("2026-11-24T07:27:11.791Z"),
  approval_method: "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION",
};

function installFixture(nextIdentity = identity, nextDecision = DECISION) {
  mocks.lstat.mockReturnValue({
    isFile: () => true, isSymbolicLink: () => false, mode: 0o100600, size: 400,
  });
  mocks.readFile.mockImplementation((path: string) =>
    path.includes("/run/credentials/") ? JSON.stringify(CONFIG) : "-----BEGIN CERTIFICATE-----\nTEST_ONLY\n-----END CERTIFICATE-----");
  mocks.digest.mockReturnValue("a".repeat(64));
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: null, rows: [] };
      if (sql.includes("session_user::text")) return { rowCount: 1, rows: [nextIdentity] };
      if (sql.includes("FROM gpt02_owner_approval.")) return { rowCount: 1, rows: [nextDecision] };
      throw new Error("Unexpected SQL");
    }),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client), end: vi.fn().mockResolvedValue(undefined) };
  mocks.createPool.mockImplementation(function () { return pool; });
  return { client, pool };
}

describe("GPT02 separated Super Admin ledger custody", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "development";
    delete process.env.GPT02_OWNER_LEDGER_READER_ENABLED;
  });
  afterEach(() => {
    delete process.env.GPT02_OWNER_LEDGER_READER_ENABLED;
  });

  it("fails closed without the separate reader flag and does not open a connection", async () => {
    await expect(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR))
      .rejects.toThrow("GPT02_LEDGER_SEPARATE_READER_CUSTODY_UNAVAILABLE");
    expect(mocks.createPool).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("fails closed if the encrypted credential file is unavailable", async () => {
    process.env.GPT02_OWNER_LEDGER_READER_ENABLED = "true";
    mocks.lstat.mockImplementation(() => { throw new Error("not present"); });
    await expect(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR)).rejects.toThrow();
    expect(mocks.createPool).not.toHaveBeenCalled();
  });

  it("accepts only the verified isolated PostgreSQL reader role and returns redacted receipt", async () => {
    process.env.GPT02_OWNER_LEDGER_READER_ENABLED = "true";
    const { client } = installFixture();
    const receipt = await readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR);
    expect(receipt).toEqual({
      challengeId: CHALLENGE, scope: "GPT02_RELOCK_CST_DEV",
      status: "CONSUMED", decision: "APPROVED",
      manifestSha256: "a".repeat(64), decidedAt: DECISION.decided_at.toISOString(),
    });
    const sql = client.query.mock.calls.map((c) => c[0]);
    expect(sql[0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(sql[1]).toContain("transaction_read_only");
    expect(sql[2]).toContain("d.decided_at = c.consumed_at");
    expect(sql[2]).toContain("d.owner_auth_supabase_id = $3::uuid");
    expect(sql[3]).toBe("COMMIT");
    expect(sql.some((s) => /UPDATE\s|INSERT\s|DELETE\s|ALTER\s/i.test(s))).toBe(false);
  });

  it("rejects writer identity even if the query returns valid rows", async () => {
    process.env.GPT02_OWNER_LEDGER_READER_ENABLED = "true";
    const { client } = installFixture({ ...identity, actor: "aicore_dev_runtime" });
    await expect(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR)).rejects.toThrow();
    const sql = client.query.mock.calls.map((c) => c[0]);
    expect(sql).not.toContainEqual(expect.stringContaining("FROM gpt02_owner_approval."));
    expect(sql).toContain("ROLLBACK");
  });

  it("rejects mismatched digest without returning a decision", async () => {
    process.env.GPT02_OWNER_LEDGER_READER_ENABLED = "true";
    const { client } = installFixture(identity, { ...DECISION, manifest_sha256: "b".repeat(64) });
    await expect(readGpt02SuperAdminLedgerReceipt(CHALLENGE, ACTOR)).rejects.toThrow();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects a malformed owner actor before opening credentials", async () => {
    process.env.GPT02_OWNER_LEDGER_READER_ENABLED = "true";
    await expect(readGpt02SuperAdminLedgerReceipt(CHALLENGE, { ...ACTOR, role: "viewer" }))
      .rejects.toThrow();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
