/**
 * GPT02 Issue #159 / DEV. Non-mounted, non-authorizing source adapter.
 * Reads one immutable issuer lineage through a separately scoped PostgreSQL
 * reader. Never loads signer credentials, signs, consumes nonce, or dispatches.
 *
 * IMPORTANT: A caller-injected pool can be mocked. The source therefore NEVER
 * asserts operational trusted-read provenance, even when all rows match.
 * Production activation requires an independently reviewed pool factory,
 * native restricted-role/TLS proof and authorized signer integration.
 */
import { createHash } from "node:crypto";
import {
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
  canonicalGpt02Issue159IssuerEvidence,
} from "./gpt02Issue159FourSignerContract.js";
import {
  inspectGpt02Issue159IssuerAuthorizerEvidence,
} from "./gpt02Issue159IssuerAuthorizerEvidence.js";

const ROLE = "gpt02_issuer_evidence_reader";
const WORKER = "openclaw-dell-chatgpt-wake-dev";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

type Row = Record<string, unknown>;
type QueryResult = { rows: Row[] };
type Client = {
  query(sql: string, params?: readonly unknown[]): Promise<QueryResult>;
  release(destroy?: boolean): void;
  connection?: { stream?: { encrypted?: boolean; authorized?: boolean; authorizationError?: unknown } };
};
type Pool = { connect(): Promise<Client> };
type Request = { claims: unknown; observedAt: number };

const denied = (reason: string, readOnlySessionVerified = false) => Object.freeze({
  environment: "DEV" as const,
  reason,
  readOnlySessionVerified,
  issuerLedgerMatched: false,
  persistedTrustedReadProven: false,
  cryptographicSignaturesVerified: false,
  privateKeyLoaded: false,
  signingPermitted: false,
  authorizationGranted: false,
  dispatchPermitted: false,
  commandCreated: false,
  releaseDecision: "NO_GO" as const,
});

export const GPT02_ISSUE159_ISSUER_IDENTITY_SQL = [
  "SELECT current_database() AS db,current_user AS login,session_user AS session,",
  " current_setting('transaction_read_only')='on' AS tx_readonly,",
  " current_setting('search_path')='pg_catalog' AS search_path_locked,",
  " current_setting('statement_timeout')='5s' AS statement_timeout_locked,",
  " current_setting('lock_timeout')='1s' AS lock_timeout_locked,",
  " current_setting('idle_in_transaction_session_timeout')='10s' AS idle_timeout_locked,",
  " pg_backend_pid() AS backend_pid,",
  " EXISTS(SELECT 1 FROM pg_stat_ssl s WHERE s.pid=pg_backend_pid() AND s.ssl) AS db_tls,",
  " r.rolcanlogin AND r.rolconnlimit=1 AND NOT (r.rolsuper OR r.rolcreatedb",
  " OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR r.rolinherit)",
  " AS restricted_role,",
  " NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS no_memberships,",
  " NOT pg_has_role(current_user,'pg_read_all_data','USAGE') AS no_global_read,",
  " NOT pg_has_role(current_user,'pg_write_all_data','USAGE') AS no_global_write,",
  " NOT has_database_privilege(current_user,current_database(),'CREATE') AS no_db_create,",
  " NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
  " WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
  " AND c.relkind IN ('r','p','f','m','v')",
  " AND (has_table_privilege(current_user,c.oid,'INSERT')",
  " OR has_table_privilege(current_user,c.oid,'UPDATE')",
  " OR has_table_privilege(current_user,c.oid,'DELETE')",
  " OR has_table_privilege(current_user,c.oid,'TRUNCATE')",
  " OR has_table_privilege(current_user,c.oid,'TRIGGER')",
  " OR has_table_privilege(current_user,c.oid,'REFERENCES')))",
  " AS no_relation_writes,",
  " NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace",
  " WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'",
  " AND p.prosecdef AND has_schema_privilege(current_user,n.oid,'USAGE')",
  " AND has_function_privilege(current_user,p.oid,'EXECUTE'))",
  " AS no_privileged_routines",
  " FROM pg_roles r WHERE r.rolname=current_user",
].join(" ");

export const GPT02_ISSUE159_ISSUER_LEDGER_SQL = [
  "SELECT a.claims AS approval_claims,a.digest AS approval_digest,",
  " l.claims AS link_claims,l.link_digest AS stored_link_digest,",
  " r.id::text AS receipt_id,r.command_id::text AS receipt_command_id,",
  " r.nonce AS receipt_nonce,r.digest AS receipt_digest,",
  " floor(extract(epoch FROM r.consumed_at)*1000)::float8 AS consumed_ms,",
  " i.receipt_id::text AS identity_receipt_id,",
  " i.command_id::text AS identity_command_id,i.link_id::text AS identity_link_id,",
  " i.operator_user_id AS identity_operator_user_id,",
  " i.hub_operator_id AS identity_hub_operator_id,i.link_digest AS identity_link_digest,",
  " i.binding_verified,i.may_dispatch_worker,i.may_issue_grant,",
  " i.may_close_job,i.core_ledger_written AS identity_core_ledger_written,",
  " f.fence_id::text AS fence_id,f.receipt_id::text AS fence_receipt_id,",
  " f.command_id::text AS fence_command_id,f.link_id::text AS fence_link_id,",
  " f.hub_execution_id::text AS fence_hub_execution_id,",
  " f.core_task_id::text AS fence_core_task_id,",
  " f.attempt_id::text AS fence_attempt_id,f.worker_id AS fence_worker_id,",
  " f.lease_epoch::int AS lease_epoch,",
  " floor(extract(epoch FROM f.lease_started_at)*1000)::float8 AS lease_started_ms,",
  " floor(extract(epoch FROM f.lease_expires_at)*1000)::float8 AS lease_expires_ms,",
  " f.dispatch_allowed,f.core_ledger_written AS fence_core_ledger_written",
  " FROM gpt02_private.approvals a",
  " JOIN gpt02_private.operator_links l ON l.command_id=a.command_id",
  " AND l.attempt_id=a.attempt_id AND l.hub_task_id=a.task_id",
  " AND l.company_id=a.company_id AND l.hub_operator_id=a.approver_id",
  " AND l.approval_digest=a.digest",
  " JOIN gpt02_private.receipts r ON r.command_id=a.command_id",
  " AND r.nonce=a.nonce AND r.digest=a.digest",
  " JOIN gpt02_private.core_identity_receipts i ON i.receipt_id=r.id",
  " AND i.command_id=r.command_id AND i.link_id=l.link_id",
  " JOIN gpt02_private.post_consumption_fences f ON f.receipt_id=r.id",
  " AND f.command_id=r.command_id AND f.link_id=l.link_id",
  " AND f.hub_execution_id=l.hub_execution_id AND f.core_task_id=l.core_task_id",
  " AND f.attempt_id=l.attempt_id",
  " WHERE a.task_id=$1 AND a.company_id=$2 AND a.command_id=$3::uuid",
  " AND a.attempt_id=$4::uuid AND l.link_id=$5::uuid",
  " AND r.id=$6::uuid AND f.fence_id=$7::uuid LIMIT 2",
].join(" ");

function validRequest(input: unknown): input is Request {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== "claims,observedAt") return false;
  const x = input as Request;
  if (!Number.isSafeInteger(x.observedAt) || x.observedAt <= 0) return false;
  let c: Row;
  try {
    canonicalGpt02Issue159IssuerEvidence(x.claims);
    c = x.claims as Row;
  } catch { return false; }
  return c.environment === "DEV" &&
    c.audience === "GPT02_ISSUER_LEASE_EVIDENCE_V1" &&
    c.companyId === "default" &&
    Number.isSafeInteger(c.hubTaskId) && Number(c.hubTaskId) > 136 &&
    c.workerId === WORKER && c.issuerRole === "dev_gpt02_issuer_evidence" &&
    c.leaseEpoch === 1 &&
    Number.isSafeInteger(c.issuedAt) && Number.isSafeInteger(c.expiresAt) &&
    Number(c.issuedAt) <= x.observedAt && Number(c.expiresAt) > x.observedAt &&
    Number(c.expiresAt) - Number(c.issuedAt) <= 15_000 &&
    ["hubExecutionId","coreTaskId","commandId","attemptId","receiptId","linkId","fenceId"]
      .every((k) => typeof c[k] === "string" && UUID.test(c[k] as string));
}

function identityMatches(r: Row, client: Client) {
  const stream = client.connection?.stream;
  return r.db === "postgres" && r.login === ROLE && r.session === ROLE &&
    r.tx_readonly === true && r.search_path_locked === true &&
    r.statement_timeout_locked === true && r.lock_timeout_locked === true &&
    r.idle_timeout_locked === true && r.db_tls === true &&
    Number.isSafeInteger(r.backend_pid) && Number(r.backend_pid) > 0 &&
    r.restricted_role === true && r.no_memberships === true &&
    r.no_global_read === true && r.no_global_write === true &&
    r.no_db_create === true && r.no_relation_writes === true &&
    r.no_privileged_routines === true && stream?.encrypted === true &&
    stream?.authorized === true && !stream.authorizationError;
}

function mapEvidence(row: Row) {
  return {
    approvalClaims: row.approval_claims,
    operatorLinkClaims: row.link_claims,
    nonceReceipt: {
      receiptId: row.receipt_id, commandId: row.receipt_command_id,
      nonce: row.receipt_nonce, digest: row.receipt_digest,
      consumedAt: row.consumed_ms,
    },
    identityReceipt: {
      receiptId: row.identity_receipt_id, commandId: row.identity_command_id,
      linkId: row.identity_link_id, operatorUserId: row.identity_operator_user_id,
      hubOperatorId: row.identity_hub_operator_id, linkDigest: row.identity_link_digest,
      bindingVerified: row.binding_verified, mayDispatchWorker: row.may_dispatch_worker,
      mayIssueGrant: row.may_issue_grant, mayCloseJob: row.may_close_job,
      coreLedgerWritten: row.identity_core_ledger_written,
    },
    fence: {
      fenceId: row.fence_id, receiptId: row.fence_receipt_id,
      commandId: row.fence_command_id, linkId: row.fence_link_id,
      hubExecutionId: row.fence_hub_execution_id,
      coreTaskId: row.fence_core_task_id, attemptId: row.fence_attempt_id,
      workerId: row.fence_worker_id, leaseEpoch: row.lease_epoch,
      leaseStartedAt: row.lease_started_ms, leaseExpiresAt: row.lease_expires_ms,
      dispatchAllowed: row.dispatch_allowed,
      coreLedgerWritten: row.fence_core_ledger_written,
    },
  };
}

/** Injectable pool is strictly a source/test seam, never a signer authority. */
export async function readGpt02Issue159IssuerLedgerReadOnly(
  pool: Pool, input: unknown,
) {
  if (!validRequest(input)) return denied("ISSUER_LEDGER_REQUEST_INVALID");
  let client: Client | undefined;
  let began = false;
  let verified = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    began = true;
    await client.query("SET LOCAL search_path=pg_catalog");
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    await client.query("SET LOCAL row_security=on");
    const identity = await client.query(GPT02_ISSUE159_ISSUER_IDENTITY_SQL);
    if (identity.rows.length !== 1 || !identityMatches(identity.rows[0], client))
      return denied("ISSUER_RESTRICTED_READER_IDENTITY_NOT_VERIFIED");
    verified = true;
    const c = input.claims as Row;
    const data = await client.query(GPT02_ISSUE159_ISSUER_LEDGER_SQL, [
      c.hubTaskId, c.companyId, c.commandId, c.attemptId,
      c.linkId, c.receiptId, c.fenceId,
    ]);
    if (data.rows.length !== 1) return denied("ISSUER_LEDGER_MISSING_OR_NOT_UNIQUE", true);
    const row = data.rows[0];
    const approvalDigest = createHash("sha256")
      .update(canonicalGpt02Issue159Approval(row.approval_claims)).digest("hex");
    const linkDigest = createHash("sha256")
      .update(canonicalGpt02Issue159OperatorLink(row.link_claims)).digest("hex");
    if (row.approval_digest !== approvalDigest || row.stored_link_digest !== linkDigest)
      return denied("ISSUER_LEDGER_STORED_DIGEST_MISMATCH", true);
    const evidence = mapEvidence(row);
    inspectGpt02Issue159IssuerAuthorizerEvidence({
      claims: c,
      ...evidence,
      observedAt: input.observedAt,
    });
    return Object.freeze({
      ...denied("ISSUER_LEDGER_LINEAGE_MATCHED_NO_AUTHORITY", true),
      issuerLedgerMatched: true as const,
      // A caller-supplied pool cannot attest its own independent custody.
      persistedTrustedReadProven: false as const,
    });
  } catch {
    return denied("ISSUER_LEDGER_READ_FAILED_CLOSED", verified);
  } finally {
    if (client) {
      if (began) try { await client.query("ROLLBACK"); } catch { /* fail-closed */ }
      try { client.release(true); } catch { /* fail-closed */ }
    }
  }
}
