import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, timingSafeEqual } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, rename, link, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Pool, type PoolConfig } from "@workspace/db/pg";
import { readProtectedRuntimeFile, type ProtectedRuntimeFilePolicy } from "./gpt02ProtectedRuntimeFile.js";
import { GPT02_CUSTODY_READER_ROLE, resolveGpt02ReaderDbTransport, type Gpt02PinnedReaderDbTransport } from "./gpt02ReaderCustodyDbTransport.js";
import {
  GPT02_DBA_CUSTODY_TARGET, verifyGpt02CustodyWorkerAttestation,
  verifyGpt02DbaCustodyReceipt, type VerifiedGpt02CustodyWorker,
} from "./gpt02ReaderCustodyAttestation.js";

export const GPT02_DBA_PREPARATION_FLAG = "GPT02_DEV_CUSTODY_DBA_PREPARATION_ENABLED";
export const GPT02_DBA_CUSTODIAN_PATHS = Object.freeze({
  credentialsDirectory: "/run/credentials/gpt02-reader-custodian.service",
  privateKey: "/run/credentials/gpt02-reader-custodian.service/private-key.pkcs8",
  worker: "/run/credentials/gpt02-reader-custody/worker-attestation.json",
  receipt: "/run/credentials/gpt02-reader-custody/issuer-receipt.json",
  reader: "/run/credentials/gpt02-owner-ledger-reader/reader.json",
  ca: "/etc/gpt02-dev/supabase-root-ca-2021.crt",
  auditDirectory: "/var/lib/gpt02-reader-custodian-audit",
});
const ROLE = GPT02_CUSTODY_READER_ROLE;
const TTL_MS = 15 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const CODES = [
  "CUSTODY_DBA_DISABLED", "CUSTODY_DBA_DEV_REQUIRED", "CUSTODY_DBA_ROOT_REQUIRED",
  "CUSTODY_DBA_SYSTEMD_REQUIRED", "CUSTODY_DBA_TRUST_UNAVAILABLE", "CUSTODY_DBA_KEYS_NOT_SEPARATE",
  "CUSTODY_DBA_WORKER_PROOF_INVALID", "CUSTODY_DBA_WORKER_PROOF_CHANGED",
  "CUSTODY_DBA_PRIVATE_KEY_UNAVAILABLE", "CUSTODY_DBA_READER_UNAVAILABLE", "CUSTODY_DBA_READER_CHANGED",
  "CUSTODY_DBA_CA_UNAVAILABLE", "CUSTODY_DBA_PROBE_FAILED", "CUSTODY_DBA_READER_BUSY",
  "CUSTODY_DBA_EXPIRED", "CUSTODY_DBA_AUDIT_UNAVAILABLE", "CUSTODY_DBA_PUBLICATION_FAILED",
  "CUSTODY_DBA_ARGUMENTS_INVALID", "CUSTODY_DBA_UNAVAILABLE",
] as const;
export type Gpt02DbaCustodianErrorCode = typeof CODES[number];
export class Gpt02DbaCustodianError extends Error {
  readonly code: Gpt02DbaCustodianErrorCode;
  constructor(code: Gpt02DbaCustodianErrorCode) {
    const safe = CODES.includes(code) ? code : "CUSTODY_DBA_UNAVAILABLE";
    super(safe); this.code = safe;
  }
}
const deny = (code: Gpt02DbaCustodianErrorCode): never => { throw new Gpt02DbaCustodianError(code); };

export type Gpt02DbaCustodyEnvelope = Readonly<{
  receipt: Readonly<typeof GPT02_DBA_CUSTODY_TARGET & {
    credentialId: string; credentialBinding: string; workerAttestationSha256: string;
    receiptId: string; notBefore: number; expiresAt: number;
  }>;
  signature: string;
}>;
export type Gpt02DbaCustodyPublication = Readonly<{
  state: "CUSTODY_EVIDENCE_PUBLISHED"; receiptId: string; expiresAt: number;
  readerE2eVerified: false; credentialGenerationChecked: false;
  authorizationGranted: false; dispatchPermitted: false;
}>;
export type Gpt02DbaCustodyAudit = Readonly<{
  event: "gpt02_reader_custody_dba_receipt_prepared";
  envelope: Gpt02DbaCustodyEnvelope;
  workerAttestationSha256: string; attestorPublicKeySha256: string; issuerPublicKeySha256: string;
  project: "xssrfshdrtdfupgqwfdw"; readerRole: typeof ROLE;
  tlsVerified: true; readOnlyVerified: true; columnSelectVerified: true;
  readerE2eVerified: false; credentialGenerationChecked: false;
  authorizationGranted: false; dispatchPermitted: false;
}>;
export interface Gpt02DbaProbeClient {
  query(sql: string): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface Gpt02DbaProbePool { connect(): Promise<Gpt02DbaProbeClient>; end(): Promise<void>; }
export interface Gpt02DbaCustodianDeps {
  environment: () => NodeJS.ProcessEnv;
  uid: () => number; gid: () => number; now: () => number;
  readProtectedFile: (path: string, policy: ProtectedRuntimeFilePolicy) => Promise<Buffer>;
  createPool: (config: Record<string, unknown>) => Gpt02DbaProbePool;
  newReceiptId: () => string;
  writeAudit: (audit: Gpt02DbaCustodyAudit) => Promise<void>;
  publishReceipt: (envelope: Gpt02DbaCustodyEnvelope, beforeCommit: () => Promise<void>) => Promise<void>;
}

export const GPT02_DBA_PROBE_IDENTITY_SQL = `
SELECT session_user::text AS actor, current_user::text AS effective,
       pg_catalog.current_database()::text AS database_name,
       pg_catalog.current_setting('transaction_read_only') AS transaction_read_only,
       pg_catalog.current_setting('default_transaction_read_only') AS default_read_only,
       s.ssl, r.rolsuper AS role_superuser, r.rolbypassrls AS role_bypassrls,
       r.rolinherit AS role_inherit, r.rolcreatedb AS role_create_db,
       r.rolcreaterole AS role_create_role, r.rolreplication AS role_replication,
       r.rolcanlogin AS role_can_login, r.rolconnlimit AS role_connection_limit
FROM pg_catalog.pg_roles AS r
JOIN pg_catalog.pg_stat_ssl AS s ON s.pid = pg_catalog.pg_backend_pid()
WHERE r.rolname = session_user`;

export const GPT02_DBA_PROBE_PRIVILEGES_SQL = `
SELECT c.relname::text AS relation,
       pg_catalog.has_schema_privilege(current_user, n.oid, 'USAGE') AS schema_usage,
       pg_catalog.has_schema_privilege(current_user, n.oid, 'CREATE') AS schema_create,
       pg_catalog.has_table_privilege(current_user, c.oid, 'SELECT') AS table_select,
       (pg_catalog.has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES')) AS write_privileges,
       c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'gpt02_owner_approval'
  AND c.relname IN ('gpt02_relock_owner_approval_challenges', 'gpt02_relock_owner_approval_decisions')
  AND c.relkind = 'r'`;

// Include every output, predicate and join column used by the real reader.
// The native role must execute these SELECTs, but no Owner ledger row is read.
export const GPT02_DBA_PROBE_CHALLENGE_COLUMNS_SQL = `
SELECT id, status, manifest_sha256, manifest_json, consumed_at, expires_at,
       scope, environment, project_id, worker_principal, owner_email,
       owner_auth_supabase_id, owner_subject, issued_at
FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges
WHERE false LIMIT 0`;
export const GPT02_DBA_PROBE_DECISION_COLUMNS_SQL = `
SELECT challenge_id, decision, decided_at, approval_method, owner_email,
       owner_auth_supabase_id, owner_subject, scope, worker_principal, manifest_sha256
FROM gpt02_owner_approval.gpt02_relock_owner_approval_decisions
WHERE false LIMIT 0`;

export async function probeGpt02ReaderCustodyRole(
  createPool: Gpt02DbaCustodianDeps["createPool"], config: Record<string, unknown>,
): Promise<void> {
  let pool: Gpt02DbaProbePool | undefined;
  let client: Gpt02DbaProbeClient | undefined;
  let transaction = false;
  try {
    pool = createPool(config);
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION READ ONLY"); transaction = true;
    const result = await client.query(GPT02_DBA_PROBE_IDENTITY_SQL);
    const row = result.rows[0];
    if (result.rowCount !== 1 || !row || row.actor !== ROLE || row.effective !== ROLE ||
        row.database_name !== "postgres" || row.transaction_read_only !== "on" ||
        row.default_read_only !== "on" || row.ssl !== true || row.role_can_login !== true ||
        ["role_superuser", "role_bypassrls", "role_create_db", "role_create_role", "role_replication"]
          .some((name) => row[name] !== false)) deny("CUSTODY_DBA_PROBE_FAILED");
    const privileges = await client.query(GPT02_DBA_PROBE_PRIVILEGES_SQL);
    const required = new Set(["gpt02_relock_owner_approval_challenges", "gpt02_relock_owner_approval_decisions"]);
    if (privileges.rowCount !== 2 || privileges.rows.length !== 2) deny("CUSTODY_DBA_PROBE_FAILED");
    for (const item of privileges.rows) {
      if (typeof item.relation !== "string" || !required.delete(item.relation) ||
          item.schema_usage !== true || item.schema_create !== false || item.table_select !== false ||
          item.write_privileges !== false || item.row_security !== true) {
        deny("CUSTODY_DBA_PROBE_FAILED");
      }
    }
    for (const sql of [GPT02_DBA_PROBE_CHALLENGE_COLUMNS_SQL, GPT02_DBA_PROBE_DECISION_COLUMNS_SQL]) {
      const projection = await client.query(sql);
      if (projection.rowCount !== 0 || projection.rows.length !== 0) deny("CUSTODY_DBA_PROBE_FAILED");
    }
    await client.query("COMMIT"); transaction = false;
  } catch (error) {
    if (error instanceof Gpt02DbaCustodianError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "53300") {
      deny("CUSTODY_DBA_READER_BUSY");
    }
    deny("CUSTODY_DBA_PROBE_FAILED");
  } finally {
    if (client) {
      if (transaction) await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    if (pool) await pool.end();
  }
}

type Trust = Readonly<{ der: Buffer; encoded: string; fingerprint: string }>;
function publicTrust(encoded: unknown, fingerprint: unknown): Trust {
  try {
    if (typeof encoded !== "string" || encoded.length !== 60 || typeof fingerprint !== "string" || !SHA256.test(fingerprint)) {
      throw new Error();
    }
    const der = Buffer.from(encoded, "base64");
    const key = createPublicKey({ key: der, type: "spki", format: "der" });
    const canonical = key.export({ type: "spki", format: "der" });
    if (der.length !== 44 || der.toString("base64") !== encoded || key.asymmetricKeyType !== "ed25519" ||
        !canonical.equals(der) || createHash("sha256").update(der).digest("hex") !== fingerprint) throw new Error();
    return { der, encoded, fingerprint };
  } catch { return deny("CUSTODY_DBA_TRUST_UNAVAILABLE"); }
}

function json(bytes: Buffer): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function readerConfig(bytes: Buffer): { password: string; transport: Gpt02PinnedReaderDbTransport } {
  try {
    const config = json(bytes) as Record<string, unknown>;
    if (!config || typeof config !== "object" || Array.isArray(config) ||
        Object.keys(config).sort().join(",") !== "database,host,password,port,projectId,sslMode,user" ||
        typeof config.password !== "string" || config.password.length < 32 || config.password.length > 256) throw new Error();
    const transport = resolveGpt02ReaderDbTransport(config);
    if (!transport) throw new Error();
    return { password: config.password, transport };
  } catch { return deny("CUSTODY_DBA_READER_UNAVAILABLE"); }
}

function trustedDirectory(meta: Stats, privateDirectory = false): boolean {
  return meta.isDirectory() && !meta.isSymbolicLink() && meta.uid === 0 && meta.gid === 0 &&
    (meta.mode & 0o022) === 0 && (!privateDirectory || (meta.mode & 0o777) === 0o700);
}

/** Linux host publication is anchored to an opened root-only directory. The
 * /proc/self/fd path is derived solely from our descriptor, never caller input.
 * Audit filenames are immutable; the existing custody directory is preserved. */
async function atomicPublicFile(
  directory: string, filename: string, bytes: Buffer, replaceExisting: boolean,
  beforeCommit: () => Promise<void>,
): Promise<void> {
  let parent: Awaited<ReturnType<typeof open>> | undefined;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let ownedTemporary: string | undefined;
  try {
    let path = directory;
    while (true) {
      if (!trustedDirectory(await lstat(path), path === directory)) throw new Error();
      if (path === "/") break;
      path = dirname(path);
    }
    parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const identity = await parent.stat();
    if (!trustedDirectory(identity, true)) throw new Error();
    const fdPath = `/proc/self/fd/${parent.fd}`;
    const target = `${fdPath}/${filename}`;
    const temporary = `${fdPath}/.${filename}.${randomUUID()}.tmp`;
    const checkTarget = async () => {
      try {
        const stat = await lstat(target);
        if (!replaceExisting || !stat.isFile() || stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 ||
            (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > 8192) throw new Error();
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      }
    };
    await checkTarget();
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    ownedTemporary = temporary;
    await file.chmod(0o600);
    await file.writeFile(bytes); await file.sync();
    const written = await file.stat();
    if (!written.isFile() || written.uid !== 0 || written.gid !== 0 || written.nlink !== 1 ||
        (written.mode & 0o777) !== 0o600 || written.size !== bytes.length) throw new Error();
    await file.close(); file = undefined;
    await beforeCommit();
    const current = await lstat(directory);
    if (!trustedDirectory(current, true) || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error();
    await checkTarget();
    if (replaceExisting) {
      await rename(temporary, target);
    } else {
      // Exclusive link creation prevents overwriting a durable prior audit.
      await link(temporary, target); await unlink(temporary);
    }
    ownedTemporary = undefined;
    await parent.sync();
  } finally {
    await file?.close().catch(() => undefined);
    if (ownedTemporary) await unlink(ownedTemporary).catch(() => undefined);
    await parent?.close().catch(() => undefined);
  }
}

async function durableAudit(audit: Gpt02DbaCustodyAudit): Promise<void> {
  if (!UUID.test(audit.envelope.receipt.receiptId)) deny("CUSTODY_DBA_AUDIT_UNAVAILABLE");
  const bytes = Buffer.from(JSON.stringify(audit) + "\n");
  if (bytes.length > 8192) deny("CUSTODY_DBA_AUDIT_UNAVAILABLE");
  await atomicPublicFile(GPT02_DBA_CUSTODIAN_PATHS.auditDirectory, `${audit.envelope.receipt.receiptId}.json`, bytes, false, async () => {});
}

async function publishReceipt(envelope: Gpt02DbaCustodyEnvelope, beforeCommit: () => Promise<void>): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(envelope) + "\n");
  if (bytes.length > 8192) deny("CUSTODY_DBA_PUBLICATION_FAILED");
  await atomicPublicFile(dirname(GPT02_DBA_CUSTODIAN_PATHS.receipt), "issuer-receipt.json", bytes, true, beforeCommit);
}

export function createGpt02ReaderCustodyDbaIssuer(overrides: Partial<Gpt02DbaCustodianDeps> = {}) {
  const deps: Gpt02DbaCustodianDeps = {
    environment: () => process.env, uid: () => process.geteuid?.() ?? -1, gid: () => process.getegid?.() ?? -1,
    now: Date.now, readProtectedFile: readProtectedRuntimeFile,
    createPool: (config) => new Pool(config as PoolConfig) as unknown as Gpt02DbaProbePool,
    newReceiptId: randomUUID, writeAudit: durableAudit, publishReceipt, ...overrides,
  };
  function context() {
    const env = deps.environment();
    if (env[GPT02_DBA_PREPARATION_FLAG] !== "true") deny("CUSTODY_DBA_DISABLED");
    if (env.APP_ENV !== "development" || env.NODE_ENV !== "development" ||
        env.SUPABASE_URL_DEV !== `https://${GPT02_DBA_CUSTODY_TARGET.project}.supabase.co` ||
        env.SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY) deny("CUSTODY_DBA_DEV_REQUIRED");
    if (deps.uid() !== 0 || deps.gid() !== 0) deny("CUSTODY_DBA_ROOT_REQUIRED");
    if (env.CREDENTIALS_DIRECTORY !== GPT02_DBA_CUSTODIAN_PATHS.credentialsDirectory) deny("CUSTODY_DBA_SYSTEMD_REQUIRED");
    const attestor = publicTrust(env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64, env.GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256);
    const issuer = publicTrust(env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64, env.GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256);
    if (attestor.fingerprint === issuer.fingerprint) deny("CUSTODY_DBA_KEYS_NOT_SEPARATE");
    return { attestor, issuer };
  }
  const read = (path: string, maxBytes: number, permissionBits = 0o077) => deps.readProtectedFile(path, {
    maxBytes, forbiddenPermissionBits: permissionBits, requireRootGroup: true,
  });
  return {
    async issueAndPublish(): Promise<Gpt02DbaCustodyPublication> {
      let originalReader: Buffer | undefined;
      let keyBytes: Buffer | undefined;
      let canonicalKey: Buffer | undefined;
      try {
        const trust = context();
        let lastTime = -1;
        const clock = () => {
          const now = deps.now();
          if (!Number.isSafeInteger(now) || now < 0 || now < lastTime) deny("CUSTODY_DBA_EXPIRED");
          lastTime = now; return now;
        };
        const readWorker = async (): Promise<VerifiedGpt02CustodyWorker> => {
          try {
            const document = json(await read(GPT02_DBA_CUSTODIAN_PATHS.worker, 8192));
            const raw = document as { receipt?: { credentialId?: unknown; credentialBinding?: unknown } };
            const currentTrust = context();
            if (currentTrust.attestor.fingerprint !== trust.attestor.fingerprint || currentTrust.issuer.fingerprint !== trust.issuer.fingerprint) {
              deny("CUSTODY_DBA_TRUST_UNAVAILABLE");
            }
            // Verify the signed identity/generation claim. This host process
            // does NOT authenticate a live worker token or claim current-token
            // verification; the broker independently enforces that on use.
            const result = verifyGpt02CustodyWorkerAttestation({
              document, trustedIssuerPublicDerB64: trust.attestor.encoded,
              trustedIssuerSha256: trust.attestor.fingerprint,
              authenticatedCredentialId: typeof raw?.receipt?.credentialId === "string" ? raw.receipt.credentialId : "",
              authenticatedCredentialBinding: typeof raw?.receipt?.credentialBinding === "string" ? raw.receipt.credentialBinding : "",
              now: clock(),
            });
            if (!result) return deny("CUSTODY_DBA_WORKER_PROOF_INVALID");
            return result;
          } catch (error) {
            if (error instanceof Gpt02DbaCustodianError) throw error;
            return deny("CUSTODY_DBA_WORKER_PROOF_INVALID");
          }
        };
        const worker = await readWorker();
        try { originalReader = await read(GPT02_DBA_CUSTODIAN_PATHS.reader, 4096); }
        catch { deny("CUSTODY_DBA_READER_UNAVAILABLE"); }
        const config = readerConfig(originalReader!);
        let caBytes: Buffer;
        let ca: string;
        try {
          caBytes = await read(GPT02_DBA_CUSTODIAN_PATHS.ca, 16_384, 0o022);
          ca = new TextDecoder("utf-8", { fatal: true }).decode(caBytes);
          if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error();
        } catch { return deny("CUSTODY_DBA_CA_UNAVAILABLE"); }
        await probeGpt02ReaderCustodyRole(deps.createPool, {
          host: config.transport.host, port: 5432, database: "postgres",
          user: config.transport.databaseUser, password: config.password,
          ssl: { ca, rejectUnauthorized: true, servername: config.transport.tlsServerName }, max: 1,
          connectionTimeoutMillis: 4000, idleTimeoutMillis: 500, query_timeout: 3000,
          statement_timeout: 3000, application_name: "gpt02-reader-custodian-dev",
        });
        const afterProbe = await readWorker();
        if (afterProbe.digest !== worker.digest) deny("CUSTODY_DBA_WORKER_PROOF_CHANGED");
        let key;
        try {
          keyBytes = await read(GPT02_DBA_CUSTODIAN_PATHS.privateKey, 48, 0o177);
          if (keyBytes.length !== 48 || !keyBytes.subarray(0, 16).equals(PKCS8_PREFIX)) throw new Error();
          key = createPrivateKey({ key: keyBytes, type: "pkcs8", format: "der" });
          canonicalKey = key.export({ type: "pkcs8", format: "der" });
          if (key.asymmetricKeyType !== "ed25519" || !canonicalKey.equals(keyBytes) ||
              !createPublicKey(key).export({ type: "spki", format: "der" }).equals(trust.issuer.der)) throw new Error();
        } catch { return deny("CUSTODY_DBA_PRIVATE_KEY_UNAVAILABLE"); }
        finally { keyBytes?.fill(0); canonicalKey?.fill(0); }
        const receiptId = deps.newReceiptId();
        if (!UUID.test(receiptId)) deny("CUSTODY_DBA_UNAVAILABLE");
        const notBefore = clock();
        const expiresAt = Math.min(notBefore + TTL_MS, worker.expiresAt);
        if (expiresAt <= notBefore) deny("CUSTODY_DBA_EXPIRED");
        const receipt: Gpt02DbaCustodyEnvelope["receipt"] = Object.freeze({
          ...GPT02_DBA_CUSTODY_TARGET, credentialId: worker.credentialId,
          credentialBinding: worker.credentialBinding, workerAttestationSha256: worker.digest,
          receiptId, notBefore, expiresAt,
        });
        const envelope: Gpt02DbaCustodyEnvelope = Object.freeze({
          receipt, signature: sign(null, Buffer.from(JSON.stringify(receipt)), key).toString("base64url"),
        });
        const revalidate = async () => {
          const currentWorker = await readWorker();
          if (currentWorker.digest !== worker.digest) deny("CUSTODY_DBA_WORKER_PROOF_CHANGED");
          let currentReader: Buffer | undefined;
          try {
            currentReader = await read(GPT02_DBA_CUSTODIAN_PATHS.reader, 4096);
            if (currentReader.length !== originalReader!.length || !timingSafeEqual(currentReader, originalReader!)) {
              deny("CUSTODY_DBA_READER_CHANGED");
            }
          } catch (error) {
            if (error instanceof Gpt02DbaCustodianError) throw error;
            deny("CUSTODY_DBA_READER_CHANGED");
          } finally { currentReader?.fill(0); }
          try {
            if (!(await read(GPT02_DBA_CUSTODIAN_PATHS.ca, 16_384, 0o022)).equals(caBytes)) throw new Error();
          } catch { deny("CUSTODY_DBA_CA_UNAVAILABLE"); }
          if (!verifyGpt02DbaCustodyReceipt({
            document: envelope, trustedIssuerPublicDerB64: trust.issuer.encoded,
            trustedIssuerSha256: trust.issuer.fingerprint, verifiedWorker: currentWorker, now: clock(),
          }).verified) deny("CUSTODY_DBA_EXPIRED");
        };
        await revalidate();
        try {
          await deps.writeAudit({
            event: "gpt02_reader_custody_dba_receipt_prepared", envelope,
            workerAttestationSha256: worker.digest, attestorPublicKeySha256: trust.attestor.fingerprint,
            issuerPublicKeySha256: trust.issuer.fingerprint, project: GPT02_DBA_CUSTODY_TARGET.project,
            readerRole: ROLE, tlsVerified: true, readOnlyVerified: true, columnSelectVerified: true,
            readerE2eVerified: false, credentialGenerationChecked: false, authorizationGranted: false, dispatchPermitted: false,
          });
        } catch { deny("CUSTODY_DBA_AUDIT_UNAVAILABLE"); }
        await revalidate();
        try { await deps.publishReceipt(envelope, revalidate); }
        catch (error) {
          if (error instanceof Gpt02DbaCustodianError) throw error;
          deny("CUSTODY_DBA_PUBLICATION_FAILED");
        }
        // A publication wait can cross expiry. Never report expired evidence
        // as a successful live result, even if the atomic write already ran.
        await revalidate();
        return Object.freeze({
          state: "CUSTODY_EVIDENCE_PUBLISHED", receiptId, expiresAt,
          readerE2eVerified: false, credentialGenerationChecked: false,
          authorizationGranted: false, dispatchPermitted: false,
        });
      } catch (error) {
        if (error instanceof Gpt02DbaCustodianError) throw error;
        return deny("CUSTODY_DBA_UNAVAILABLE");
      } finally { originalReader?.fill(0); keyBytes?.fill(0); canonicalKey?.fill(0); }
    },
  };
}
