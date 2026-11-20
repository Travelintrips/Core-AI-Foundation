#!/usr/bin/env node
// DEV-only independent GPT02 relock supervisor. Operational custody is
// deliberately separate from signer/issuer credentials and identities.
// Never authorizes signing or dispatch. Existing backend pg driver reused.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HOST = 'db.xssrfshdrtdfupgqwfdw.supabase.co';
const ROLE = 'dev_gpt02_relock_catalog_auditor';
const CERT = '/etc/gpt02-dev/supabase-root-ca-2021.crt';
const CRED = 'relock-catalog-dsn';
const EXPECTED = ['database','host','password','port','projectRef','sslMode','user'];
// Keep the harder deadline model ALREADY INSTALLED on the authorized VPS.
// The reviewed 3s/backend termination budget must not be silently replaced
// by a shorter timeout when adding the scoped reader cleanup lane.
export const RELOCK_TERMINATION_BUDGET = Object.freeze({
  roleSlots: 3,
  perBackendWaitMs: 3000,
  connectionTimeoutMs: 4000,
  preflightQueryTimeoutMs: 2500,
  phaseAQueryTimeoutMs: 4500,
  statementTimeoutMs: 12000,
  queryTimeoutMs: 15000,
  systemdStartTimeoutMs: 45000,
});


export function validateCredentials(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('RELOCK_CREDENTIAL_SHAPE_INVALID');
  }
  const keys = Object.keys(candidate).sort();
  if (keys.length !== EXPECTED.length ||
      keys.some((value, index) => value !== EXPECTED[index])) {
    throw new Error('RELOCK_CREDENTIAL_FIELDS_INVALID');
  }
  if (candidate.host !== HOST ||
      candidate.projectRef !== 'xssrfshdrtdfupgqwfdw' ||
      candidate.database !== 'postgres' ||
      candidate.user !== ROLE ||
      candidate.port !== 5432 ||
      candidate.sslMode !== 'verify-full' ||
      typeof candidate.password !== 'string' ||
      candidate.password.length < 45 ||
      candidate.password.length > 256) {
    throw new Error('RELOCK_IDENTITY_OR_TLS_PIN_INVALID');
  }
  return true;
}

export function validateResult(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000) {
    throw new Error('RELOCK_' + label + '_RESULT_NOT_BOUNDED_INTEGER');
  }
  return value;
}

function result(reason, extra = {}) {
  return {
    environment: 'DEV', independentSupervisor: true,
    authorizationGranted: false, signingPermitted: false,
    dispatchPermitted: false, releaseDecision: 'NO_GO',
    reason, ...extra,
  };
}

// Reuse ONE existing relock timer/service. This does not grant access:
// writer Phase A/B remain the original installed functions; optional reader
// Phase A/B are additive and handle ONLY exact task-scoped ephemeral roles.
// Each query uses its own committed transaction (no BEGIN/COMMIT wrapper).
// Historical live cleanup counts are observations, NOT proof that a
// connected backend was killed. Preserve this existing public contract.
export function cleanupEvidence(phaseA, phaseB) {
  return result('RELOCK_CLEANUP_ONLY', {
    phaseAWindowCount: validateResult(phaseA, 'PHASE_A'),
    phaseBCleanedWindowCount: validateResult(phaseB, 'PHASE_B'),
    connectedSessionTerminationProven: false,
  });
}

const WRITER_PHASES = [
  'SELECT gpt02_relock_audit.relock_expired_phase_a() AS count',
  'SELECT gpt02_relock_audit.relock_expired_phase_b() AS count',
];
const READER_PHASES = [
  'SELECT gpt02_relock_audit.relock_reader_phase_a() AS count',
  'SELECT gpt02_relock_audit.relock_reader_phase_b() AS count',
];

async function runPair(client, statements, label) {
  const a = await client.query({
    text: statements[0],
    query_timeout: RELOCK_TERMINATION_BUDGET.phaseAQueryTimeoutMs,
  });
  const phaseAWindowCount = validateResult(
    a.rows.length === 1 ? a.rows[0].count : null, label + '_A'
  );
  // The separate statement MUST commit before phase B opens.
  const b = await client.query({
    text: statements[1],
    query_timeout: RELOCK_TERMINATION_BUDGET.queryTimeoutMs,
  });
  const phaseBCleanedWindowCount = validateResult(
    b.rows.length === 1 ? b.rows[0].count : null, label + '_B'
  );
  return {phaseAWindowCount, phaseBCleanedWindowCount};
}

export async function runCleanupPhases(client) {
  const writer = await client.query(
    "SELECT to_regprocedure('gpt02_relock_audit.relock_expired_phase_a()')" +
    " IS NOT NULL AS phase_a," +
    "to_regprocedure('gpt02_relock_audit.relock_expired_phase_b()')" +
    " IS NOT NULL AS phase_b"
  );
  if (writer.rows.length !== 1 ||
      writer.rows[0].phase_a !== true ||
      writer.rows[0].phase_b !== true) {
    throw new Error('RELOCK_PHASE_FUNCTIONS_NOT_INSTALLED');
  }
  // Never allow an exception in the original writer lane to starve reader
  // cleanup. Both independent workloads are attempted, but any failure is
  // propagated. If writer A fails, writer B is NOT started uncommitted.
  let writerError;
  let writerCounts;
  try {
    writerCounts = await runPair(client, WRITER_PHASES, 'WRITER');
  } catch (error) {
    writerError = error;
  }
  let readerError;
  let readerInstalled = false;
  let readerCounts = null;
  try {
    const state = await client.query(
      "SELECT to_regprocedure('gpt02_relock_audit.relock_reader_phase_a()')" +
      " IS NOT NULL AS phase_a," +
      "to_regprocedure('gpt02_relock_audit.relock_reader_phase_b()')" +
      " IS NOT NULL AS phase_b"
    );
    if (state.rows.length !== 1 ||
        typeof state.rows[0].phase_a !== 'boolean' ||
        typeof state.rows[0].phase_b !== 'boolean') {
      throw new Error('RELOCK_READER_CATALOG_UNKNOWN');
    }
    if (state.rows[0].phase_a !== state.rows[0].phase_b) {
      throw new Error('RELOCK_READER_PARTIAL_INSTALL_DENIED');
    }
    readerInstalled = state.rows[0].phase_a;
    if (readerInstalled) {
      readerCounts = await runPair(client, READER_PHASES, 'READER');
    } else {
      // The original writer-only runtime is safe only when NO scoped reader
      // identity exists. A partial migration may have created a LOGIN but
      // omitted relock RPCs; never report successful cleanup in that state.
      const roles = await client.query(
        "SELECT count(*)::integer AS scoped_roles FROM pg_roles " +
        "WHERE left(rolname::text,15)='dev_gpt02_task_'"
      );
      if (roles.rows.length !== 1 ||
          !Number.isSafeInteger(roles.rows[0].scoped_roles) ||
          roles.rows[0].scoped_roles !== 0) {
        throw new Error('RELOCK_SCOPED_ROLE_EXISTS_WITHOUT_CLEANUP');
      }
    }
  } catch (error) {
    readerError = error;
  }
  if (writerError) throw writerError;
  if (readerError) throw readerError;
  return {readerInstalled, writerCounts, readerCounts};
}

export async function main() {
  let client;
  try {
    if (process.env.APP_ENV !== 'development') {
      throw new Error('RELOCK_EXPLICIT_DEV_MODE_REQUIRED');
    }
    const directory = process.env.CREDENTIALS_DIRECTORY;
    if (!directory?.startsWith('/run/credentials/') ||
        directory.includes('..')) {
      throw new Error('RELOCK_SYSTEMD_CREDENTIALS_REQUIRED');
    }
    const path = directory + '/' + CRED;
    const credentials = JSON.parse(readFileSync(path, { encoding: 'utf8' }));
    validateCredentials(credentials);
    const { Client } = require('/opt/gpt02-reader-runtime/node_modules/pg');
    const ca = readFileSync(CERT, 'utf8');
    client = new Client({
      host: HOST, port: 5432, database: 'postgres', user: ROLE,
      password: credentials.password,
      ssl: { ca, rejectUnauthorized: true, servername: HOST },
      application_name: 'gpt02-issue159-independent-relock-dev',
      connectionTimeoutMillis: RELOCK_TERMINATION_BUDGET.connectionTimeoutMs,
      query_timeout: RELOCK_TERMINATION_BUDGET.preflightQueryTimeoutMs,
      statement_timeout: RELOCK_TERMINATION_BUDGET.statementTimeoutMs,
    });
    await client.connect();
    const identity = await client.query(
      'SELECT session_user::text AS actor,current_database()::text AS database'
    );
    if (identity.rows.length !== 1 ||
        identity.rows[0].actor !== ROLE ||
        identity.rows[0].database !== 'postgres') {
      throw new Error('RELOCK_NATIVE_DATABASE_IDENTITY_INVALID');
    }
    const {readerInstalled, writerCounts, readerCounts} =
      await runCleanupPhases(client);
    // Preserve LIVE counts/evidence semantics: success is NOT proof that a
    // connected client backend terminated, nor authority to issue/dispatch.
    const evidence = cleanupEvidence(
      writerCounts.phaseAWindowCount, writerCounts.phaseBCleanedWindowCount
    );
    console.log(JSON.stringify({
      ...evidence,
      reason: readerInstalled ? 'RELOCK_CLEANUP_ONLY' :
        'RELOCK_WRITER_ONLY_READER_NOT_INSTALLED',
      readerPhaseAWindowCount: readerCounts?.phaseAWindowCount ?? 0,
      readerPhaseBCleanedWindowCount: readerCounts?.phaseBCleanedWindowCount ?? 0,
      readerLaneInstalled: readerInstalled,
    }));
    return 0;
  } catch (error) {
    // No SQL text, connection strings, passwords or raw DB errors in logs.
    const reason = typeof error?.message === 'string' &&
      error.message.startsWith('RELOCK_') ? error.message :
      'RELOCK_DATABASE_OR_CUSTODY_UNAVAILABLE';
    console.error(JSON.stringify(result(reason)));
    return 3;
  } finally {
    if (client) {
      try { await client.end(); } catch { /* fail closed */ }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
