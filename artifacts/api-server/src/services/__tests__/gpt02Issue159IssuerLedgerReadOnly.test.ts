import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
} from "../gpt02Issue159FourSignerContract.js";
import {
  GPT02_ISSUE159_ISSUER_IDENTITY_SQL,
  GPT02_ISSUE159_ISSUER_LEDGER_SQL,
  readGpt02Issue159IssuerLedgerReadOnly,
} from "../gpt02Issue159IssuerLedgerReadOnly.js";

const approvalClaims = {
  v: 2, environment: "DEV", audience: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
  taskId: 137, commandId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  nonce: "A".repeat(44), operatorNamespace: "ai-task-hub.public.users",
  superAdminId: "google_fixture_super_admin", companyId: "default",
  issuedAt: 1000, expiresAt: 20000,
};
const approvalDigest = createHash("sha256")
  .update(canonicalGpt02Issue159Approval(approvalClaims)).digest("hex");
const nonceDigest = createHash("sha256").update(approvalClaims.nonce).digest("hex");
const linkClaims = {
  v: 1, environment: "DEV", audience: "GPT02_DUAL_ACCOUNT_COMMAND_LINK",
  linkId: "66666666-6666-4666-8666-666666666666", companyId: "default",
  hubTaskId: 137, hubExecutionId: "11111111-1111-4111-8111-111111111111",
  coreTaskId: "22222222-2222-4222-8222-222222222222",
  coreCommandId: approvalClaims.commandId, attemptId: approvalClaims.attemptId,
  attemptNumber: 1, assigneeId: 5, accountableOwnerId: "fixture-owner",
  hubOperatorNamespace: "ai-task-hub.public.users",
  hubOperatorId: approvalClaims.superAdminId, hubRole: "super_admin", hubActive: true,
  coreOperatorNamespace: "ai-core.ai_platform.internal_users",
  coreOperatorUserId: 77, coreRole: "admin", coreActive: true, corePasswordChanged: true,
  workerId: "openclaw-dell-chatgpt-wake-dev", approvalDigest, nonce: approvalClaims.nonce,
  issuedAt: 1100, expiresAt: 12000,
};
const linkDigest = createHash("sha256")
  .update(canonicalGpt02Issue159OperatorLink(linkClaims)).digest("hex");

const claims = () => ({
  v: 1, environment: "DEV", audience: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
  companyId: "default", hubTaskId: 137,
  hubExecutionId: linkClaims.hubExecutionId, coreTaskId: linkClaims.coreTaskId,
  commandId: approvalClaims.commandId, attemptId: approvalClaims.attemptId,
  workerId: "openclaw-dell-chatgpt-wake-dev",
  receiptId: "55555555-5555-4555-8555-555555555555",
  linkId: linkClaims.linkId, fenceId: "77777777-7777-4777-8777-777777777777",
  approvalDigest, nonceDigest, issuerRole: "dev_gpt02_issuer_evidence",
  leaseEpoch: 1, issuedAt: 3000, expiresAt: 10000,
});
const identity = () => ({
  db: "postgres", login: "gpt02_issuer_evidence_reader",
  session: "gpt02_issuer_evidence_reader", tx_readonly: true,
  search_path_locked: true, statement_timeout_locked: true,
  lock_timeout_locked: true, idle_timeout_locked: true,
  backend_pid: 3210, db_tls: true, restricted_role: true,
  no_memberships: true, no_global_read: true, no_global_write: true,
  no_db_create: true, no_relation_writes: true, no_privileged_routines: true,
});
const row = () => ({
  approval_claims: approvalClaims, approval_digest: approvalDigest,
  link_claims: linkClaims, stored_link_digest: linkDigest,
  receipt_id: claims().receiptId, receipt_command_id: claims().commandId,
  receipt_nonce: approvalClaims.nonce, receipt_digest: approvalDigest,
  consumed_ms: 2000,
  identity_receipt_id: claims().receiptId,
  identity_command_id: claims().commandId, identity_link_id: claims().linkId,
  identity_operator_user_id: 77, identity_hub_operator_id: approvalClaims.superAdminId,
  identity_link_digest: linkDigest, binding_verified: false,
  may_dispatch_worker: false, may_issue_grant: false,
  may_close_job: false, identity_core_ledger_written: false,
  fence_id: claims().fenceId, fence_receipt_id: claims().receiptId,
  fence_command_id: claims().commandId, fence_link_id: claims().linkId,
  fence_hub_execution_id: claims().hubExecutionId,
  fence_core_task_id: claims().coreTaskId, fence_attempt_id: claims().attemptId,
  fence_worker_id: claims().workerId, lease_epoch: 1,
  lease_started_ms: 2500, lease_expires_ms: 12000,
  dispatch_allowed: false, fence_core_ledger_written: false,
});
type Patch = { identity?: Record<string, unknown>; rows?: Record<string, unknown>[];
  queryFailure?: string; tls?: boolean; };
function fixture(patch: Patch = {}) {
  const calls: { sql: string; args?: readonly unknown[] }[] = [];
  let releases = 0;
  const client = {
    connection: { stream: { encrypted: patch.tls ?? true, authorized: patch.tls ?? true } },
    async query(sql: string, args?: readonly unknown[]) {
      calls.push({ sql, args });
      if (sql === patch.queryFailure) throw Error("SENSITIVE_DB_EXCEPTION");
      if (sql === GPT02_ISSUE159_ISSUER_IDENTITY_SQL) {
        return { rows: [{ ...identity(), ...patch.identity }] };
      }
      if (sql === GPT02_ISSUE159_ISSUER_LEDGER_SQL) {
        return { rows: patch.rows ?? [row()] };
      }
      return { rows: [] as Record<string, unknown>[] };
    },
    release(force?: boolean) { expect(force).toBe(true); releases++; },
  };
  const pool = { async connect() { return client; } };
  return { pool, calls, released: () => releases };
}

describe("Issue159 restricted issuer persisted-ledger source adapter", () => {
  it("joins one exact stored lineage under restricted read-only connection yet never authorizes", async () => {
    const f = fixture();
    const result = await readGpt02Issue159IssuerLedgerReadOnly(f.pool, {
      claims: claims(), observedAt: 5000,
    });
    expect(result.issuerLedgerMatched).toBe(true);
    expect(result.readOnlySessionVerified).toBe(true);
    expect(result.clientTlsVerified).toBe(true);
    expect(result.backendTlsVerified).toBe(true);
    expect(result.persistedTrustedReadProven).toBe(false);
    expect(result.cryptographicSignaturesVerified).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
    expect(f.calls.some(c => c.sql === "BEGIN READ ONLY")).toBe(true);
    expect(f.calls.some(c => c.sql === "ROLLBACK")).toBe(true);
    const ledger = f.calls.find(c => c.sql === GPT02_ISSUE159_ISSUER_LEDGER_SQL);
    expect(ledger?.args).toEqual([
      137, "default", claims().commandId, claims().attemptId,
      claims().linkId, claims().receiptId, claims().fenceId,
    ]);
    expect(f.released()).toBe(1);
  });

  it("rejects historical, stale, wrong tenant and injected input before DB connect", async () => {
    let connected = false;
    const pool = { async connect() { connected = true; throw Error("unexpected"); } };
    for (const bad of [
      { ...claims(), hubTaskId: 136 },
      { ...claims(), companyId: "other" },
      { ...claims(), workerId: "not-dell" },
      { ...claims(), expiresAt: 5000 },
      { ...claims(), linkId: "invalid" },
      { ...claims(), permitted: true },
    ]) {
      const result = await readGpt02Issue159IssuerLedgerReadOnly(pool, {
        claims: bad, observedAt: 5000,
      });
      expect(result.reason).toBe("ISSUER_LEDGER_REQUEST_INVALID");
    }
    expect(connected).toBe(false);
  });

  it("accepts pinned client TLS when the provider backend TLS flag is false", async () => {
    const f = fixture({ identity: { db_tls: false } });
    const result = await readGpt02Issue159IssuerLedgerReadOnly(f.pool, {
      claims: claims(), observedAt: 5000,
    });
    expect(result.issuerLedgerMatched).toBe(true);
    expect(result.readOnlySessionVerified).toBe(true);
    expect(result.clientTlsVerified).toBe(true);
    expect(result.tlsVerified).toBe(true);
    expect(result.backendTlsVerified).toBe(false);
    expect(result.signingPermitted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
    expect(f.released()).toBe(1);
  });

  it("refuses privileged role, wrong session, no TLS or altered bounds before ledger query", async () => {
    for (const patch of [
      { identity: { login: "postgres" } },
      { identity: { tx_readonly: false } },
      { identity: { no_relation_writes: false } },
      { identity: { no_privileged_routines: false } },
      { identity: { restricted_role: false } },
      { identity: { no_memberships: false } },
      { tls: false },
    ]) {
      const f = fixture(patch);
      const result = await readGpt02Issue159IssuerLedgerReadOnly(f.pool, {
        claims: claims(), observedAt: 5000,
      });
      expect(result.reason).toBe("ISSUER_RESTRICTED_READER_IDENTITY_NOT_VERIFIED");
      expect(f.calls.some(c=>c.sql===GPT02_ISSUE159_ISSUER_LEDGER_SQL)).toBe(false);
      expect(f.calls.some(c=>c.sql==="ROLLBACK")).toBe(true);
      expect(f.released()).toBe(1);
    }
  });

  it("refuses empty, duplicate, altered, authority-enabled or mismatched persisted evidence", async () => {
    for (const rows of [
      [], [row(), row()],
      [{ ...row(), stored_link_digest: "f".repeat(64) }],
      [{ ...row(), approval_digest: "f".repeat(64) }],
      [{ ...row(), fence_worker_id: "other-worker" }],
      [{ ...row(), dispatch_allowed: true }],
      [{ ...row(), binding_verified: true }],
      [{ ...row(), receipt_nonce: "B".repeat(44) }],
      [{ ...row(), lease_expires_ms: 1000 }],
      [{ ...row(), identity_link_digest: "f".repeat(64) }],
    ]) {
      const f = fixture({rows});
      const result = await readGpt02Issue159IssuerLedgerReadOnly(f.pool, {
        claims: claims(), observedAt: 5000,
      });
      expect(result.issuerLedgerMatched).toBe(false);
      expect(result.signingPermitted).toBe(false);
      expect(result.releaseDecision).toBe("NO_GO");
      expect(f.released()).toBe(1);
    }
  });

  it("sanitizes read errors and always rolls back/relinquishes client", async () => {
    for (const queryFailure of [
      GPT02_ISSUE159_ISSUER_IDENTITY_SQL, GPT02_ISSUE159_ISSUER_LEDGER_SQL,
    ]) {
      const f = fixture({queryFailure});
      const result = await readGpt02Issue159IssuerLedgerReadOnly(f.pool, {
        claims: claims(), observedAt: 5000,
      });
      expect(result.reason).toBe("ISSUER_LEDGER_READ_FAILED_CLOSED");
      expect(JSON.stringify(result)).not.toContain("SENSITIVE_DB_EXCEPTION");
      expect(f.calls.some(c=>c.sql==="ROLLBACK")).toBe(true);
      expect(f.released()).toBe(1);
    }
  });

  it("uses only fixed SELECTs and cannot load signer secrets or send commands", async () => {
    expect(GPT02_ISSUE159_ISSUER_LEDGER_SQL).toMatch(/^SELECT /);
    expect(GPT02_ISSUE159_ISSUER_LEDGER_SQL).toContain("LIMIT 2");
    for (const t of ["approvals","operator_links","receipts",
      "core_identity_receipts","post_consumption_fences"]) {
      expect(GPT02_ISSUE159_ISSUER_LEDGER_SQL).toContain("gpt02_private."+t);
    }
    expect(GPT02_ISSUE159_ISSUER_LEDGER_SQL).toContain("a.task_id=$1");
    expect(GPT02_ISSUE159_ISSUER_LEDGER_SQL).toContain("l.link_id=$5::uuid");
    expect(GPT02_ISSUE159_ISSUER_LEDGER_SQL).toContain("f.fence_id=$7::uuid");
    expect(GPT02_ISSUE159_ISSUER_IDENTITY_SQL).toMatch(/^SELECT /);
    const src=await readFile(new URL("../gpt02Issue159IssuerLedgerReadOnly.ts", import.meta.url), "utf8");
    for (const forbidden of ["createPrivateKey","sign(","node:fs",
      "fetch(","http://","https://","process.env","dispatchPermitted: true"]) {
      expect(src).not.toContain(forbidden);
    }
  });
});
