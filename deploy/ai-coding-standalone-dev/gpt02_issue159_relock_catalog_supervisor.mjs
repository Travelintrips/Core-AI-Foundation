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
      connectionTimeoutMillis: 4000, query_timeout: 2500,
      statement_timeout: 2000,
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
    // Do not invoke or install any privileged routine until its two-phase
    // owner-defined implementation and exact EXECUTE grant have been reviewed.
    const state = await client.query(
      "SELECT to_regprocedure('gpt02_relock_audit.relock_expired_phase_a()')" +
      " IS NOT NULL AS phase_a," +
      "to_regprocedure('gpt02_relock_audit.relock_expired_phase_b()')" +
      " IS NOT NULL AS phase_b"
    );
    if (state.rows.length !== 1 ||
        state.rows[0].phase_a !== true ||
        state.rows[0].phase_b !== true) {
      console.log(JSON.stringify(result('RELOCK_PHASE_FUNCTIONS_NOT_INSTALLED')));
      return 3;
    }
    // Each query is its own AUTOCOMMITTED transaction; never enclose both
    // phases in BEGIN/COMMIT. This prevents the proven late-login race.
    // SQL names and argument counts are exact and NOT user controlled.
    const a = await client.query(
      'SELECT gpt02_relock_audit.relock_expired_phase_a() AS count'
    );
    validateResult(a.rows.length === 1 ? a.rows[0].count : null, 'PHASE_A');
    const b = await client.query(
      'SELECT gpt02_relock_audit.relock_expired_phase_b() AS count'
    );
    validateResult(b.rows.length === 1 ? b.rows[0].count : null, 'PHASE_B');
    // Even successfully completed cleanup is NOT a release authorization.
    console.log(JSON.stringify(result('RELOCK_CLEANUP_ONLY')));
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
