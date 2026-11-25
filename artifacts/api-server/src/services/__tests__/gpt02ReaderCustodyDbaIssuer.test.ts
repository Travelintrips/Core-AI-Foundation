import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: vi.fn(), readProtected: vi.fn(), lstat: vi.fn(), open: vi.fn(),
  rename: vi.fn(), link: vi.fn(), unlink: vi.fn(),
}));
// A standalone custodian must never initialize the application's writer pool.
vi.mock("@workspace/db", () => { throw new Error("APPLICATION_WRITER_POOL_IMPORT_FORBIDDEN"); });
vi.mock("@workspace/db/pg", () => ({ Pool: mocks.pool }));
vi.mock("../gpt02ProtectedRuntimeFile.js", () => ({ readProtectedRuntimeFile: mocks.readProtected }));
vi.mock("node:fs/promises", () => ({
  lstat: mocks.lstat, open: mocks.open, rename: mocks.rename, link: mocks.link, unlink: mocks.unlink,
}));

import {
  createGpt02ReaderCustodyDbaIssuer, Gpt02DbaCustodianError,
  GPT02_DBA_CUSTODIAN_PATHS as PATHS, GPT02_DBA_PREPARATION_FLAG,
  GPT02_DBA_PROBE_IDENTITY_SQL, GPT02_DBA_PROBE_PRIVILEGES_SQL,
  GPT02_DBA_PROBE_CHALLENGE_COLUMNS_SQL, GPT02_DBA_PROBE_DECISION_COLUMNS_SQL,
  type Gpt02DbaCustodianDeps, type Gpt02DbaCustodyAudit, type Gpt02DbaCustodyEnvelope,
} from "../gpt02ReaderCustodyDbaIssuer.js";
import {
  GPT02_WORKER_ATTESTATION_TARGET, gpt02CustodyCredentialBinding,
  verifyGpt02CustodyWorkerAttestation, verifyGpt02DbaCustodyReceipt,
} from "../gpt02ReaderCustodyAttestation.js";

const NOW = 1_800_000_000_000;
const ID = "11111111-2222-4333-8444-555555555555";
const RECEIPT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PRIVATE_MARKER = "SYNTHETIC_PRIVATE_DIAGNOSTIC_NEVER_RETURNED";
const TOKEN_HASH = createHash("sha256").update("synthetic-dba-test-worker").digest("hex");
const BINDING = gpt02CustodyCredentialBinding(TOKEN_HASH);
const CONFIG = {
  database: "postgres", host: "db.xssrfshdrtdfupgqwfdw.supabase.co", port: 5432,
  password: "synthetic-test-only-reader-password-123456789", projectId: "xssrfshdrtdfupgqwfdw",
  sslMode: "verify-full", user: "gpt02_owner_ledger_reader_dev",
};
const CA = "-----BEGIN CERTIFICATE-----\nSYNTHETIC_TEST_ONLY\n-----END CERTIFICATE-----";
const IDENTITY = {
  actor: CONFIG.user, effective: CONFIG.user, database_name: "postgres",
  transaction_read_only: "on", default_read_only: "on", ssl: true,
  role_superuser: false, role_bypassrls: false, role_inherit: false,
  role_create_db: false, role_create_role: false, role_replication: false,
  role_can_login: true, role_connection_limit: 1,
};
const PRIVILEGES = ["gpt02_relock_owner_approval_challenges", "gpt02_relock_owner_approval_decisions"].map((relation) => ({
  relation, schema_usage: true, schema_create: false, table_select: false,
  write_privileges: false, row_security: true, force_row_security: true,
}));

function keys() {
  const pair = generateKeyPairSync("ed25519");
  const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
  return {
    ...pair, privateDer: pair.privateKey.export({ type: "pkcs8", format: "der" }),
    publicB64: publicDer.toString("base64"), fingerprint: createHash("sha256").update(publicDer).digest("hex"),
  };
}

function fixture() {
  const workerKey = keys(); const dbaKey = keys();
  const env: NodeJS.ProcessEnv = {
    APP_ENV: "development", NODE_ENV: "development", [GPT02_DBA_PREPARATION_FLAG]: "true",
    SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co", CREDENTIALS_DIRECTORY: PATHS.credentialsDirectory,
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64: workerKey.publicB64,
    GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256: workerKey.fingerprint,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64: dbaKey.publicB64,
    GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256: dbaKey.fingerprint,
  };
  const workerReceipt = {
    ...GPT02_WORKER_ATTESTATION_TARGET, credentialId: ID, credentialBinding: BINDING,
    issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN", notBefore: NOW - 1_000, expiresAt: NOW + 3_600_000,
  };
  const files = new Map<string, Buffer>([
    [PATHS.reader, Buffer.from(JSON.stringify(CONFIG))], [PATHS.ca, Buffer.from(CA)],
    [PATHS.privateKey, Buffer.from(dbaKey.privateDer)],
  ]);
  const replaceWorker = (patch: Record<string, unknown> = {}) => {
    const receipt = { ...workerReceipt, ...patch };
    const document = { receipt, signature: sign(null, Buffer.from(JSON.stringify(receipt)), workerKey.privateKey).toString("base64url") };
    files.set(PATHS.worker, Buffer.from(JSON.stringify(document)));
    return document;
  };
  replaceWorker();
  const state = {
    now: NOW, uid: 0, gid: 0, identity: { ...IDENTITY }, privileges: PRIVILEGES.map((row) => ({ ...row })),
    events: [] as string[], audits: [] as Gpt02DbaCustodyAudit[], published: [] as Gpt02DbaCustodyEnvelope[],
    readBuffers: [] as Array<{ path: string; bytes: Buffer }>,
    afterQuery: undefined as ((sql: string) => void) | undefined,
    afterAudit: undefined as (() => void) | undefined,
    beforeCommit: undefined as (() => void) | undefined,
    afterPublication: undefined as (() => void) | undefined,
  };
  const client = {
    query: vi.fn(async (sql: string) => {
      state.events.push(sql.trim().split(/\s+/)[0]);
      state.afterQuery?.(sql);
      if (sql === GPT02_DBA_PROBE_IDENTITY_SQL) return { rowCount: 1, rows: [state.identity] };
      if (sql === GPT02_DBA_PROBE_PRIVILEGES_SQL) return { rowCount: state.privileges.length, rows: state.privileges };
      if ([GPT02_DBA_PROBE_CHALLENGE_COLUMNS_SQL, GPT02_DBA_PROBE_DECISION_COLUMNS_SQL].includes(sql)) return { rowCount: 0, rows: [] };
      if (["BEGIN TRANSACTION READ ONLY", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: null, rows: [] };
      throw new Error(PRIVATE_MARKER);
    }),
    release: vi.fn(() => { state.events.push("release"); }),
  };
  const pool = {
    connect: vi.fn(async () => { state.events.push("connect"); return client; }),
    end: vi.fn(async () => { state.events.push("end"); }),
  };
  const deps = {
    environment: () => env, uid: () => state.uid, gid: () => state.gid, now: () => state.now,
    readProtectedFile: vi.fn(async (path: string): Promise<Buffer> => {
      const file = files.get(path); if (!file) throw new Error(PRIVATE_MARKER);
      const bytes = Buffer.from(file); state.readBuffers.push({ path, bytes }); return bytes;
    }),
    createPool: vi.fn((_config: Record<string, unknown>) => pool), newReceiptId: () => RECEIPT_ID,
    writeAudit: vi.fn(async (audit: Gpt02DbaCustodyAudit) => {
      state.events.push("audit"); state.audits.push(audit); state.afterAudit?.();
    }),
    publishReceipt: vi.fn(async (envelope: Gpt02DbaCustodyEnvelope, beforeCommit: () => Promise<void>) => {
      state.beforeCommit?.(); await beforeCommit();
      state.events.push("publish"); state.published.push(envelope); state.afterPublication?.();
    }),
  } satisfies Gpt02DbaCustodianDeps;
  const verify = (document: unknown) => verifyGpt02DbaCustodyReceipt({
    document, trustedIssuerPublicDerB64: dbaKey.publicB64, trustedIssuerSha256: dbaKey.fingerprint, now: state.now,
    verifiedWorker: verifyGpt02CustodyWorkerAttestation({
      document: JSON.parse(files.get(PATHS.worker)!.toString("utf8")),
      trustedIssuerPublicDerB64: workerKey.publicB64, trustedIssuerSha256: workerKey.fingerprint,
      authenticatedCredentialId: ID, authenticatedCredentialBinding: BINDING, now: state.now,
    }),
  });
  return { env, workerKey, dbaKey, workerReceipt, files, replaceWorker, state, client, pool, deps, verify,
    issuer: createGpt02ReaderCustodyDbaIssuer(deps) };
}

async function denied(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(Gpt02DbaCustodianError);
  expect(error).toMatchObject({ code, message: code });
  expect(error).not.toHaveProperty("cause");
  expect(String(error)).not.toContain(PRIVATE_MARKER);
}

describe("separate host DBA custody issuer", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("probes the exact readonly TLS role, durably audits and publishes a real V2 proof without granting execution", async () => {
    const f = fixture();
    const result = await f.issuer.issueAndPublish();
    expect(result).toEqual({
      state: "CUSTODY_EVIDENCE_PUBLISHED", receiptId: RECEIPT_ID, expiresAt: NOW + 15 * 60_000,
      readerE2eVerified: false, credentialGenerationChecked: false, authorizationGranted: false, dispatchPermitted: false,
    });
    expect(f.state.published).toHaveLength(1);
    expect(f.verify(f.state.published[0])).toEqual({ verified: true, receiptId: RECEIPT_ID });
    expect(f.state.audits).toEqual([expect.objectContaining({
      envelope: f.state.published[0], attestorPublicKeySha256: f.workerKey.fingerprint,
      issuerPublicKeySha256: f.dbaKey.fingerprint, tlsVerified: true, readOnlyVerified: true, columnSelectVerified: true,
      readerE2eVerified: false, credentialGenerationChecked: false, authorizationGranted: false, dispatchPermitted: false,
    })]);
    expect(f.state.events.indexOf("end")).toBeLessThan(f.state.events.indexOf("audit"));
    expect(f.state.events.indexOf("audit")).toBeLessThan(f.state.events.indexOf("publish"));
    expect(f.deps.createPool).toHaveBeenCalledWith({
      host: CONFIG.host, port: 5432, database: "postgres", user: CONFIG.user, password: CONFIG.password,
      ssl: { ca: CA, rejectUnauthorized: true, servername: CONFIG.host }, max: 1,
      connectionTimeoutMillis: 4000, idleTimeoutMillis: 500, query_timeout: 3000, statement_timeout: 3000,
      application_name: "gpt02-reader-custodian-dev",
    });
    expect(f.client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN TRANSACTION READ ONLY", GPT02_DBA_PROBE_IDENTITY_SQL, GPT02_DBA_PROBE_PRIVILEGES_SQL,
      GPT02_DBA_PROBE_CHALLENGE_COLUMNS_SQL, GPT02_DBA_PROBE_DECISION_COLUMNS_SQL, "COMMIT",
    ]);
    expect(f.client.release).toHaveBeenCalledOnce(); expect(f.pool.end).toHaveBeenCalledOnce();
    const publicResult = JSON.stringify([result, f.state.audits, f.state.published]);
    for (const secret of [CONFIG.password, TOKEN_HASH, f.dbaKey.privateDer.toString("base64")]) expect(publicResult).not.toContain(secret);
    const secretBuffers = f.state.readBuffers.filter(({ path }) => path === PATHS.reader || path === PATHS.privateKey);
    expect(secretBuffers.length).toBeGreaterThan(1);
    expect(secretBuffers.every(({ bytes }) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it("tests every real reader projection, predicate and join column while retrieving zero ledger rows", async () => {
    const f = fixture(); await f.issuer.issueAndPublish();
    for (const [sql, columns] of [
      [GPT02_DBA_PROBE_CHALLENGE_COLUMNS_SQL, ["id", "status", "manifest_sha256", "manifest_json", "consumed_at", "expires_at", "scope", "environment", "project_id", "worker_principal", "owner_email", "owner_auth_supabase_id", "owner_subject", "issued_at"]],
      [GPT02_DBA_PROBE_DECISION_COLUMNS_SQL, ["challenge_id", "decision", "decided_at", "approval_method", "owner_email", "owner_auth_supabase_id", "owner_subject", "scope", "worker_principal", "manifest_sha256"]],
    ] as const) {
      expect(sql).toMatch(/WHERE\s+false\s+LIMIT\s+0/i);
      for (const column of columns) expect(sql).toMatch(new RegExp(`\\b${column}\\b`));
      expect(sql).not.toMatch(/SELECT\s+\*/i);
    }
    const sql = f.client.query.mock.calls.map(([text]) => text).join("\n");
    expect(sql).not.toMatch(/ai_agent_service_tokens|token_hash|password_hash|task189|task190/i);
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL)\b/im);
  });

  it.each([
    ["disabled", { [GPT02_DBA_PREPARATION_FLAG]: "false" }, "CUSTODY_DBA_DISABLED"],
    ["APP_ENV", { APP_ENV: "production" }, "CUSTODY_DBA_DEV_REQUIRED"],
    ["NODE_ENV", { NODE_ENV: "test" }, "CUSTODY_DBA_DEV_REQUIRED"],
    ["other project", { SUPABASE_URL_DEV: "https://other-project.supabase.co" }, "CUSTODY_DBA_DEV_REQUIRED"],
    ["generic project URL", { SUPABASE_URL: "https://other-project.supabase.co" }, "CUSTODY_DBA_DEV_REQUIRED"],
    ["application admin credential", { SUPABASE_SERVICE_ROLE_KEY: PRIVATE_MARKER }, "CUSTODY_DBA_DEV_REQUIRED"],
    ["different systemd unit", { CREDENTIALS_DIRECTORY: "/run/credentials/other.service" }, "CUSTODY_DBA_SYSTEMD_REQUIRED"],
  ] as const)("rejects %s before protected IO", async (_name, patch, code) => {
    const f = fixture(); Object.assign(f.env, patch);
    await denied(f.issuer.issueAndPublish(), code);
    expect(f.deps.readProtectedFile).not.toHaveBeenCalled(); expect(f.deps.createPool).not.toHaveBeenCalled();
    expect(f.deps.writeAudit).not.toHaveBeenCalled(); expect(f.deps.publishReceipt).not.toHaveBeenCalled();
  });

  it.each(["uid", "gid"] as const)("requires root %s before files or connections", async (field) => {
    const f = fixture(); f.state[field] = 1000;
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_ROOT_REQUIRED");
    expect(f.deps.readProtectedFile).not.toHaveBeenCalled(); expect(f.deps.createPool).not.toHaveBeenCalled();
  });

  it.each(["missing pin", "pin mismatch", "same authority key"])("rejects %s before secrets", async (kind) => {
    const f = fixture();
    if (kind === "missing pin") delete f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256;
    else if (kind === "pin mismatch") f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 = "0".repeat(64);
    else {
      f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64 = f.workerKey.publicB64;
      f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 = f.workerKey.fingerprint;
    }
    await denied(f.issuer.issueAndPublish(), kind === "same authority key" ? "CUSTODY_DBA_KEYS_NOT_SEPARATE" : "CUSTODY_DBA_TRUST_UNAVAILABLE");
    expect(f.deps.readProtectedFile).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", { expiresAt: NOW }], ["not yet valid", { notBefore: NOW + 1 }],
    ["legacy V1", { audience: "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v1" }],
    ["different scope", { scope: "TASK190_RECOVERY" }],
  ])("rejects correctly signed but %s worker evidence before reading secrets", async (_name, patch) => {
    const f = fixture(); f.replaceWorker(patch as Record<string, unknown>);
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_WORKER_PROOF_INVALID");
    expect(f.deps.readProtectedFile.mock.calls.map(([path]) => path)).toEqual([PATHS.worker]);
    expect(f.deps.createPool).not.toHaveBeenCalled(); expect(f.deps.writeAudit).not.toHaveBeenCalled();
  });

  it.each(["missing", "forged"])("rejects %s worker proof", async (kind) => {
    const f = fixture();
    if (kind === "missing") f.files.delete(PATHS.worker);
    else {
      const document = f.replaceWorker(); document.signature = "A".repeat(86);
      f.files.set(PATHS.worker, Buffer.from(JSON.stringify(document)));
    }
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_WORKER_PROOF_INVALID");
    expect(f.deps.createPool).not.toHaveBeenCalled(); expect(f.deps.publishReceipt).not.toHaveBeenCalled();
  });

  it("bounds DBA evidence by a shorter worker lifetime", async () => {
    const f = fixture(); f.replaceWorker({ expiresAt: NOW + 10_000 });
    const result = await f.issuer.issueAndPublish();
    expect(result.expiresAt).toBe(NOW + 10_000);
    f.state.now = result.expiresAt;
    expect(f.verify(f.state.published[0]).verified).toBe(false);
  });

  it("accepts safe existing role settings without requiring historical inheritance, connection-limit or FORCE RLS changes", async () => {
    const f = fixture();
    f.state.identity.role_inherit = true; f.state.identity.role_connection_limit = -1;
    for (const row of f.state.privileges) row.force_row_security = false;
    await f.issuer.issueAndPublish();
    expect(f.verify(f.state.published[0]).verified).toBe(true);
    expect(f.deps.createPool).toHaveBeenCalledWith(expect.objectContaining({ max: 1 }));
    expect(f.client.query.mock.calls.every(([sql]) => !/^\s*(ALTER|GRANT|REVOKE)\b/i.test(sql))).toBe(true);
  });

  it.each([
    ["different host", { host: "other-project.invalid" }], ["different role", { user: "postgres" }],
    ["unverified TLS", { sslMode: "require" }], ["extra credential field", { token: PRIVATE_MARKER }],
  ])("does not connect using %s", async (_name, patch) => {
    const f = fixture(); f.files.set(PATHS.reader, Buffer.from(JSON.stringify({ ...CONFIG, ...patch })));
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_READER_UNAVAILABLE");
    expect(f.deps.createPool).not.toHaveBeenCalled(); expect(f.deps.writeAudit).not.toHaveBeenCalled();
  });

  it("requires the externally provisioned private key to match the separate DBA pin", async () => {
    const f = fixture(); f.files.set(PATHS.privateKey, Buffer.from(f.workerKey.privateDer));
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_PRIVATE_KEY_UNAVAILABLE");
    expect(f.deps.writeAudit).not.toHaveBeenCalled(); expect(f.deps.publishReceipt).not.toHaveBeenCalled();
    expect(f.state.readBuffers.filter(({ path }) => path === PATHS.privateKey).every(({ bytes }) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it.each([
    ["login identity", { actor: "postgres" }], ["effective identity", { effective: "postgres" }],
    ["database", { database_name: "other" }], ["transaction writes", { transaction_read_only: "off" }],
    ["default writes", { default_read_only: "off" }], ["plaintext connection", { ssl: false }],
    ["superuser", { role_superuser: true }], ["RLS bypass", { role_bypassrls: true }],
  ])("rejects unsafe reader %s and closes the dedicated connection", async (_name, patch) => {
    const f = fixture(); Object.assign(f.state.identity, patch);
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_PROBE_FAILED");
    expect(f.client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.client.release).toHaveBeenCalledOnce(); expect(f.pool.end).toHaveBeenCalledOnce();
    expect(f.deps.writeAudit).not.toHaveBeenCalled(); expect(f.deps.publishReceipt).not.toHaveBeenCalled();
  });

  it.each([
    ["schema writes", { schema_create: true }], ["table-wide SELECT", { table_select: true }],
    ["column/table writes", { write_privileges: true }], ["RLS disabled", { row_security: false }],
  ])("rejects %s despite a readonly transaction", async (_name, patch) => {
    const f = fixture(); Object.assign(f.state.privileges[0], patch);
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_PROBE_FAILED");
    expect(f.client.query).toHaveBeenCalledWith("ROLLBACK"); expect(f.deps.publishReceipt).not.toHaveBeenCalled();
  });

  it.each(["connect", "column SELECT", "COMMIT"])("bounds %s failures and releases all acquired resources", async (stage) => {
    const f = fixture();
    if (stage === "connect") f.pool.connect.mockRejectedValue(new Error(PRIVATE_MARKER));
    else f.state.afterQuery = (sql) => {
      if (sql === (stage === "COMMIT" ? "COMMIT" : GPT02_DBA_PROBE_DECISION_COLUMNS_SQL)) throw new Error(PRIVATE_MARKER);
    };
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_PROBE_FAILED");
    expect(f.client.release).toHaveBeenCalledTimes(stage === "connect" ? 0 : 1);
    expect(f.pool.end).toHaveBeenCalledOnce(); expect(f.deps.writeAudit).not.toHaveBeenCalled();
    if (stage !== "connect") expect(f.client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("reports the dedicated one-connection role as busy without retries or role mutation", async () => {
    const f = fixture(); f.pool.connect.mockRejectedValue(Object.assign(new Error(PRIVATE_MARKER), { code: "53300" }));
    await denied(f.issuer.issueAndPublish(), "CUSTODY_DBA_READER_BUSY");
    expect(f.pool.connect).toHaveBeenCalledOnce(); expect(f.client.query).not.toHaveBeenCalled();
    expect(f.pool.end).toHaveBeenCalledOnce(); expect(f.deps.publishReceipt).not.toHaveBeenCalled();
  });

  it.each(["audit", "publication"])("does not return evidence when %s fails", async (stage) => {
    const f = fixture();
    if (stage === "audit") f.deps.writeAudit.mockRejectedValue(new Error(PRIVATE_MARKER));
    else f.deps.publishReceipt.mockRejectedValue(new Error(PRIVATE_MARKER));
    await denied(f.issuer.issueAndPublish(), stage === "audit" ? "CUSTODY_DBA_AUDIT_UNAVAILABLE" : "CUSTODY_DBA_PUBLICATION_FAILED");
    expect(f.state.published).toEqual([]);
    if (stage === "audit") expect(f.deps.publishReceipt).not.toHaveBeenCalled();
  });

  it.each(["probe", "audit", "before atomic commit", "after publication"])("rechecks expiry after %s awaits", async (stage) => {
    const f = fixture(); const expire = () => { f.state.now = NOW + 15 * 60_000; };
    if (stage === "probe") {
      f.replaceWorker({ expiresAt: NOW + 15 * 60_000 });
      f.state.afterQuery = (sql) => { if (sql === "COMMIT") expire(); };
    } else if (stage === "audit") f.state.afterAudit = expire;
    else if (stage === "before atomic commit") f.state.beforeCommit = expire;
    else f.state.afterPublication = expire;
    await denied(f.issuer.issueAndPublish(), stage === "probe" ? "CUSTODY_DBA_WORKER_PROOF_INVALID" : "CUSTODY_DBA_EXPIRED");
    expect(f.state.published).toHaveLength(stage === "after publication" ? 1 : 0);
    if (stage === "after publication") expect(f.verify(f.state.published[0]).verified).toBe(false);
  });

  it.each(["worker", "reader", "CA", "trust", "flag"])("revalidates %s immediately before atomic publication", async (what) => {
    const f = fixture();
    f.state.beforeCommit = () => {
      if (what === "worker") f.replaceWorker({ notBefore: NOW });
      if (what === "reader") f.files.set(PATHS.reader, Buffer.from(JSON.stringify({ ...CONFIG, password: CONFIG.password + "-rotated" })));
      if (what === "CA") f.files.set(PATHS.ca, Buffer.from(CA + "\nchanged"));
      if (what === "trust") f.env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256 = "0".repeat(64);
      if (what === "flag") f.env[GPT02_DBA_PREPARATION_FLAG] = "false";
    };
    const codes: Record<string, string> = {
      worker: "CUSTODY_DBA_WORKER_PROOF_CHANGED", reader: "CUSTODY_DBA_READER_CHANGED", CA: "CUSTODY_DBA_CA_UNAVAILABLE",
      trust: "CUSTODY_DBA_TRUST_UNAVAILABLE", flag: "CUSTODY_DBA_DISABLED",
    };
    await denied(f.issuer.issueAndPublish(), codes[what]);
    expect(f.state.audits).toHaveLength(1); expect(f.state.published).toEqual([]);
  });
});

function metadata(directory: boolean, inode: number, size = 0): Stats {
  return {
    uid: 0, gid: 0, mode: directory ? 0o40700 : 0o100600, nlink: 1, size, dev: 1, ino: inode,
    isDirectory: () => directory, isFile: () => !directory, isSymbolicLink: () => false,
  } as Stats;
}

/** In-memory descriptors exercise the real fsync/link/rename adapter. */
function filesystemFixture(f: ReturnType<typeof fixture>) {
  const auditTarget = `/proc/self/fd/41/${RECEIPT_ID}.json`;
  const receiptTarget = "/proc/self/fd/42/issuer-receipt.json";
  const custodyDirectory = PATHS.receipt.slice(0, PATHS.receipt.lastIndexOf("/"));
  const files = new Map<string, Buffer>();
  const events: string[] = [];
  const handles: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const parents = new Map([
    [PATHS.auditDirectory, { fd: 41, stat: vi.fn(async () => metadata(true, 41)), sync: vi.fn(async () => { events.push("audit-directory-sync"); }), close: vi.fn(async () => {}) }],
    [custodyDirectory, { fd: 42, stat: vi.fn(async () => metadata(true, 42)), sync: vi.fn(async () => { events.push("receipt-directory-sync"); }), close: vi.fn(async () => {}) }],
  ]);
  const state = { afterReceiptSync: undefined as (() => void) | undefined };
  mocks.readProtected.mockImplementation(f.deps.readProtectedFile);
  mocks.pool.mockImplementation(function () { return f.pool; });
  mocks.lstat.mockImplementation(async (path: string) => {
    if (path.startsWith("/proc/self/fd/")) {
      const bytes = files.get(path);
      if (!bytes) throw Object.assign(new Error(PRIVATE_MARKER), { code: "ENOENT" });
      return metadata(false, 99, bytes.length);
    }
    return metadata(true, parents.get(path)?.fd ?? 1);
  });
  mocks.open.mockImplementation(async (path: string, flags: number, mode?: number) => {
    const parent = parents.get(path);
    if (parent) {
      expect(flags & constants.O_DIRECTORY).toBe(constants.O_DIRECTORY);
      expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      handles.push(parent); return parent;
    }
    expect(path).toMatch(/^\/proc\/self\/fd\/(41|42)\/\..+\.tmp$/);
    expect(flags & constants.O_EXCL).toBe(constants.O_EXCL);
    expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW); expect(mode).toBe(0o600);
    const handle = {
      chmod: vi.fn(async () => {}), close: vi.fn(async () => {}),
      writeFile: vi.fn(async (bytes: Buffer) => { files.set(path, Buffer.from(bytes)); }),
      sync: vi.fn(async () => {
        events.push(path.includes("/41/") ? "audit-file-sync" : "receipt-file-sync");
        if (path.includes("/42/")) state.afterReceiptSync?.();
      }),
      stat: vi.fn(async () => metadata(false, 100, files.get(path)?.length ?? 0)),
    };
    handles.push(handle); return handle;
  });
  mocks.link.mockImplementation(async (source: string, target: string) => {
    if (files.has(target)) throw Object.assign(new Error(PRIVATE_MARKER), { code: "EEXIST" });
    files.set(target, Buffer.from(files.get(source)!)); events.push("audit-link");
  });
  mocks.rename.mockImplementation(async (source: string, target: string) => {
    files.set(target, Buffer.from(files.get(source)!)); files.delete(source); events.push("receipt-rename");
  });
  mocks.unlink.mockImplementation(async (path: string) => { files.delete(path); });
  const { createPool: _pool, readProtectedFile: _read, writeAudit: _audit, publishReceipt: _publish, ...overrides } = f.deps;
  return { files, events, handles, parents, state, auditTarget, receiptTarget,
    issuer: createGpt02ReaderCustodyDbaIssuer(overrides) };
}

describe("default durable DBA publication adapter", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the pure pg adapter, protected fixed inputs, immutable synced audit and atomic synced receipt", async () => {
    const f = fixture(); const fs = filesystemFixture(f);
    await fs.issuer.issueAndPublish();
    expect(mocks.pool).toHaveBeenCalledOnce();
    expect(mocks.readProtected).toHaveBeenCalledWith(PATHS.privateKey, { maxBytes: 48, forbiddenPermissionBits: 0o177, requireRootGroup: true });
    expect(mocks.readProtected).toHaveBeenCalledWith(PATHS.reader, { maxBytes: 4096, forbiddenPermissionBits: 0o077, requireRootGroup: true });
    expect(mocks.readProtected).toHaveBeenCalledWith(PATHS.ca, { maxBytes: 16_384, forbiddenPermissionBits: 0o022, requireRootGroup: true });
    expect(mocks.readProtected).toHaveBeenCalledWith(PATHS.worker, { maxBytes: 8192, forbiddenPermissionBits: 0o077, requireRootGroup: true });
    expect(fs.events).toEqual(["audit-file-sync", "audit-link", "audit-directory-sync", "receipt-file-sync", "receipt-rename", "receipt-directory-sync"]);
    const envelope = JSON.parse(fs.files.get(fs.receiptTarget)!.toString("utf8"));
    expect(f.verify(envelope).verified).toBe(true);
    expect(JSON.parse(fs.files.get(fs.auditTarget)!.toString("utf8")).envelope).toEqual(envelope);
    expect([...fs.files.keys()].sort()).toEqual([fs.auditTarget, fs.receiptTarget].sort());
    expect(mocks.rename).toHaveBeenCalledOnce(); expect(mocks.link).toHaveBeenCalledOnce();
    for (const handle of fs.handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("never publishes when audit durability cannot be confirmed", async () => {
    const f = fixture(); const fs = filesystemFixture(f);
    fs.parents.get(PATHS.auditDirectory)!.sync.mockRejectedValue(new Error(PRIVATE_MARKER));
    await denied(fs.issuer.issueAndPublish(), "CUSTODY_DBA_AUDIT_UNAVAILABLE");
    expect(mocks.rename).not.toHaveBeenCalled(); expect(fs.files.has(fs.receiptTarget)).toBe(false);
    for (const handle of fs.handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("preserves an existing audit on receipt-id collision without overwriting or publishing", async () => {
    const f = fixture(); const fs = filesystemFixture(f);
    const previous = Buffer.from("existing-public-audit"); fs.files.set(fs.auditTarget, previous);
    await denied(fs.issuer.issueAndPublish(), "CUSTODY_DBA_AUDIT_UNAVAILABLE");
    expect(fs.files.get(fs.auditTarget)).toEqual(previous);
    expect(mocks.link).not.toHaveBeenCalled(); expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });

  it("cleans its own temporary receipt and preserves the prior proof when atomic rename fails", async () => {
    const f = fixture(); const fs = filesystemFixture(f);
    const previous = Buffer.from("existing-public-receipt"); fs.files.set(fs.receiptTarget, previous);
    mocks.rename.mockRejectedValue(new Error(PRIVATE_MARKER));
    await denied(fs.issuer.issueAndPublish(), "CUSTODY_DBA_PUBLICATION_FAILED");
    expect(fs.files.get(fs.receiptTarget)).toEqual(previous); expect(fs.files.has(fs.auditTarget)).toBe(true);
    expect([...fs.files.keys()].some((path) => path.endsWith(".tmp"))).toBe(false);
    for (const handle of fs.handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it("runs the real beforeCommit check after temporary fsync and blocks a worker replaced during that wait", async () => {
    const f = fixture(); const fs = filesystemFixture(f);
    fs.state.afterReceiptSync = () => { f.replaceWorker({ notBefore: NOW }); };
    await denied(fs.issuer.issueAndPublish(), "CUSTODY_DBA_WORKER_PROOF_CHANGED");
    expect(fs.files.has(fs.auditTarget)).toBe(true); expect(fs.files.has(fs.receiptTarget)).toBe(false);
    expect(mocks.rename).not.toHaveBeenCalled();
    expect([...fs.files.keys()].some((path) => path.endsWith(".tmp"))).toBe(false);
    for (const handle of fs.handles) expect(handle.close).toHaveBeenCalledOnce();
  });
});
