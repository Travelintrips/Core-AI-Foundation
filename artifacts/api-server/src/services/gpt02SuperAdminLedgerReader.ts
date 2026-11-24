import { PostgresPool, type PostgresPoolClient } from "@workspace/db";
import { readProtectedRuntimeFile } from "./gpt02ProtectedRuntimeFile.js";
import {
  digestGpt02RelockManifest,
  type Gpt02OwnerActor,
  type Gpt02RelockManifest,
} from "./gpt02RelockOwnerApprovalService.js";
import type { OwnerLedgerReceipt } from "../routes/gpt02-owner-ledger-read.js";

type ReaderClient = PostgresPoolClient;
const HOST = "db.xssrfshdrtdfupgqwfdw.supabase.co";
const ROLE = "gpt02_owner_ledger_reader_dev";
const OWNER_EMAIL = "admcst001@gmail.com";
const CREDENTIAL_FILE = "/run/credentials/gpt02-owner-ledger-reader/reader.json";
const ROOT_CA = "/etc/gpt02-dev/supabase-root-ca-2021.crt";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function deny(): never {
  throw new Error("GPT02_LEDGER_SEPARATE_READER_CUSTODY_UNAVAILABLE");
}

type ReaderConfig = Readonly<{
  host: string;
  database: string;
  user: string;
  port: number;
  sslMode: string;
  password: string;
  projectId: string;
}>;

async function readSealedCredential(): Promise<ReaderConfig> {
  if (
    process.env.APP_ENV !== "development" ||
    process.env.NODE_ENV === "production" ||
    process.env.GPT02_OWNER_LEDGER_READER_ENABLED !== "true"
  ) deny();
  try {
    const bytes = await readProtectedRuntimeFile(CREDENTIAL_FILE, {
      maxBytes: 4_096, forbiddenPermissionBits: 0o077, requireRootGroup: true,
    });
    const config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as ReaderConfig;
    if (
      !config || typeof config !== "object" ||
      Object.keys(config).sort().join(",") !== "database,host,password,port,projectId,sslMode,user" ||
      config.host !== HOST || config.database !== "postgres" ||
      config.projectId !== "xssrfshdrtdfupgqwfdw" ||
      config.port !== 5432 || config.user !== ROLE ||
      config.sslMode !== "verify-full" ||
      typeof config.password !== "string" || config.password.length < 32 || config.password.length > 256
    ) deny();
    return config;
  } catch {
    return deny();
  }
}

export async function readGpt02SuperAdminLedgerReceipt(
  challengeId: string,
  actor: Gpt02OwnerActor,
): Promise<OwnerLedgerReceipt | null> {
  if (typeof challengeId !== "string" || !UUID.test(challengeId) ||
      !actor || typeof actor !== "object" || typeof actor.email !== "string" ||
      actor.email.toLowerCase() !== OWNER_EMAIL || actor.role !== "super_admin" ||
      typeof actor.authSupabaseId !== "string" || !UUID.test(actor.authSupabaseId)) deny();
  const config = await readSealedCredential();
  let ca: string;
  try {
    // Public CA data may be readable by other users, but never writable by them.
    const bytes = await readProtectedRuntimeFile(ROOT_CA, {
      maxBytes: 16_384, forbiddenPermissionBits: 0o022, requireRootGroup: true,
    });
    ca = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return deny(); }
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) deny();
  const pool = new PostgresPool({
    host: HOST, port: 5432, database: "postgres", user: ROLE,
    password: config.password,
    ssl: { ca, rejectUnauthorized: true, servername: HOST },
    max: 1, connectionTimeoutMillis: 4_000, idleTimeoutMillis: 500,
    query_timeout: 4_000, statement_timeout: 3_000,
    application_name: "gpt02-owner-superadmin-ledger-read-dev",
  });
  let client: ReaderClient | undefined;
  let inTransaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    inTransaction = true;
    const identity = await client.query<{
      actor: string; effective: string; database_name: string;
      transaction_read_only: string; default_read_only: string;
    }>(`
      SELECT session_user::text AS actor, current_user::text AS effective,
             current_database()::text AS database_name,
             current_setting('transaction_read_only') AS transaction_read_only,
             current_setting('default_transaction_read_only') AS default_read_only
    `);
    if (
      identity.rowCount !== 1 || identity.rows[0]?.actor !== ROLE ||
      identity.rows[0]?.effective !== ROLE ||
      identity.rows[0]?.database_name !== "postgres" ||
      identity.rows[0]?.transaction_read_only !== "on" ||
      identity.rows[0]?.default_read_only !== "on"
    ) deny();

    const decision = await client.query<{
      challenge_id: string; status: string; decision: string;
      manifest_sha256: string; manifest_json: Gpt02RelockManifest;
      decided_at: Date; consumed_at: Date; expires_at: Date; approval_method: string;
    }>(`
      SELECT c.id::text AS challenge_id, c.status, d.decision,
             c.manifest_sha256, c.manifest_json, d.decided_at,
             c.consumed_at, c.expires_at, d.approval_method
      FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges AS c
      JOIN gpt02_owner_approval.gpt02_relock_owner_approval_decisions AS d
        ON d.challenge_id = c.id
      WHERE c.id = $1::uuid
        AND c.scope = 'GPT02_RELOCK_CST_DEV' AND c.environment = 'DEV'
        AND c.project_id = 'xssrfshdrtdfupgqwfdw'
        AND c.worker_principal = 'openclaw-vps-main'
        AND c.owner_email = $2 AND c.owner_auth_supabase_id = $3::uuid
        AND c.owner_subject = $4
        AND c.status = 'CONSUMED' AND d.decision = 'APPROVED'
        AND d.owner_email = $2 AND d.owner_auth_supabase_id = $3::uuid
        AND d.owner_subject = $4
        AND d.scope = c.scope AND d.worker_principal = c.worker_principal
        AND d.manifest_sha256 = c.manifest_sha256
        AND d.approval_method = 'FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION'
        AND d.decided_at = c.consumed_at
        AND d.decided_at >= c.issued_at AND d.decided_at < c.expires_at
      LIMIT 2
    `, [challengeId, OWNER_EMAIL, actor.authSupabaseId.toLowerCase(), `owner:${actor.id}`]);
    await client.query("COMMIT");
    inTransaction = false;
    if (decision.rowCount === 0) return null;
    const row = decision.rows[0];
    if (decision.rowCount !== 1 || !row || row.challenge_id !== challengeId ||
        row.status !== "CONSUMED" || row.decision !== "APPROVED" ||
        !DIGEST.test(row.manifest_sha256) ||
        digestGpt02RelockManifest(row.manifest_json) !== row.manifest_sha256 ||
        row.approval_method !== "FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION" ||
        !(row.decided_at instanceof Date) || !Number.isFinite(row.decided_at.getTime()) ||
        !(row.consumed_at instanceof Date) || row.consumed_at.getTime() !== row.decided_at.getTime() ||
        !(row.expires_at instanceof Date) || row.decided_at.getTime() >= row.expires_at.getTime()) deny();
    return {
      challengeId,
      scope: "GPT02_RELOCK_CST_DEV",
      status: "CONSUMED",
      decision: "APPROVED",
      manifestSha256: row.manifest_sha256,
      decidedAt: row.decided_at.toISOString(),
    };
  } catch {
    return deny();
  } finally {
    if (client) {
      if (inTransaction) await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    await pool.end().catch(() => undefined);
  }
}
