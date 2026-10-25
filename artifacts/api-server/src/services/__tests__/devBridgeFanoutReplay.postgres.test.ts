import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DevBridgeFanoutReplayStore, replayOne, type ReplayClaim, type ReplaySql } from "../devBridgeFanoutReplayStore.js";

const databaseUrl = process.env["DEV_BRIDGE_REPLAY_TEST_DATABASE_URL"];
const packageUrl = new URL("../../../../../lib/db/package.json", import.meta.url);
interface FixturePool extends ReplaySql {
  connect(): Promise<ReplaySql & { release(): void }>;
  end(): Promise<void>;
}
const { Pool } = createRequire(packageUrl)("pg") as { Pool: new (options: { connectionString: string }) => FixturePool };

// Never redirect this destructive fixture to DEV or PROD. The only accepted
// target is the disposable loopback database provisioned by this CI workflow.
describe.skipIf(!databaseUrl)("real PostgreSQL terminal fanout crash recovery", () => {
  let pool: FixturePool;
  let store: DevBridgeFanoutReplayStore;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/dev_bridge_replay_test') {
      throw new Error('REFUSING_NON_DISPOSABLE_POSTGRES_FIXTURE');
    }
    pool = new Pool({ connectionString: databaseUrl! });
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ai_platform;
      CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_bridge_responses (
        id uuid PRIMARY KEY, command_id uuid NOT NULL, task_id uuid, kind text NOT NULL,
        message text NOT NULL, checkpoint_json jsonb NOT NULL DEFAULT '{}',
        metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS ai_platform.replay_test_projection (
        response_id uuid NOT NULL, sink text NOT NULL, PRIMARY KEY(response_id,sink));`);
    const installer = await pool.connect();
    try { await new DevBridgeFanoutReplayStore(installer).install(); }
    finally { installer.release(); }
    store = new DevBridgeFanoutReplayStore(pool, 1_000);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE ai_platform.dev_bridge_fanout_v1, ai_platform.ai_coding_bridge_responses, ai_platform.replay_test_projection');
  });
  afterAll(async () => { await pool?.end(); });

  const insertResponse = async (sql: ReplaySql = pool): Promise<string> => {
    const id = randomUUID();
    await sql.query("INSERT INTO ai_platform.ai_coding_bridge_responses(id,command_id,kind,message) VALUES($1,$2,'COMPLETED','fixture')", [id, randomUUID()]);
    return id;
  };
  const project = async (claim: ReplayClaim): Promise<void> => {
    await pool.query('INSERT INTO ai_platform.replay_test_projection(response_id,sink) VALUES($1,$2) ON CONFLICT DO NOTHING', [claim.responseId, claim.sink]);
  };

  it('commits the response and both pending sinks atomically', async () => {
    const id = await insertResponse();
    const rows = await pool.query('SELECT * FROM ai_platform.dev_bridge_fanout_v1 WHERE response_id=$1', [id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row['state'] === 'PENDING')).toBe(true);
  });
  it('rolls back the response and outbox together when the writer transaction fails', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insertResponse(client);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    expect((await pool.query('SELECT * FROM ai_platform.ai_coding_bridge_responses')).rows).toHaveLength(0);
    expect((await pool.query('SELECT * FROM ai_platform.dev_bridge_fanout_v1')).rows).toHaveLength(0);
  });
  it('allows only one live claimant per response and sink under concurrency', async () => {
    await insertResponse();
    const claims = (await Promise.all(Array.from({ length: 8 }, () => store.claim()))).filter((value): value is ReplayClaim => value !== null);
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((claim) => claim.responseId + ':' + claim.sink)).size).toBe(2);
  });
  it.each(['BEFORE_PROJECTION', 'AFTER_PROJECTION'])('recovers a real process exit at %s without losing or duplicating a projection', async (point) => {
    const id = await insertResponse();
    const code = `
      import { createRequire } from 'node:module';
      import { DevBridgeFanoutReplayStore } from ${JSON.stringify(new URL('../devBridgeFanoutReplayStore.ts', import.meta.url).href)};
      const { Pool } = createRequire(${JSON.stringify(packageUrl.href)})('pg');
      const p = new Pool({ connectionString: process.env.DEV_BRIDGE_REPLAY_TEST_DATABASE_URL });
      const s = new DevBridgeFanoutReplayStore({ query: (t,v) => p.query(t,v) }, 1000);
      const claim = await s.claim();
      if (!claim) process.exit(24);
      if (${JSON.stringify(point)} === 'AFTER_PROJECTION') {
        await p.query('INSERT INTO ai_platform.replay_test_projection(response_id,sink) VALUES($1,$2) ON CONFLICT DO NOTHING',[claim.responseId,claim.sink]);
      }
      process.stdout.write(JSON.stringify(claim), () => process.exit(23));
    `;
    const exited = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: process.env,
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      child.on('error', reject);
      child.on('exit', (exitCode) => resolve({ code: exitCode, stdout, stderr }));
    });
    expect(exited.code, exited.stderr).toBe(23);
    const oldClaim = JSON.parse(exited.stdout) as ReplayClaim;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const restarted = new DevBridgeFanoutReplayStore(pool, 1_000);
    while (await replayOne(restarted, project) !== 'IDLE') { /* Drain persisted work after restart. */ }
    expect(await restarted.projected(oldClaim)).toBe(false);
    expect((await pool.query('SELECT * FROM ai_platform.replay_test_projection WHERE response_id=$1', [id])).rows).toHaveLength(2);
    const ledger = await pool.query('SELECT * FROM ai_platform.dev_bridge_fanout_v1 WHERE response_id=$1', [id]);
    expect(ledger.rows.every((row) => row['state'] === 'PROJECTED')).toBe(true);
    expect(ledger.rows.some((row) => Number(row['attempts']) === 2)).toBe(true);
  }, 20_000);
  it('retains canonical work and blocked retries when a destination remains unavailable', async () => {
    const id = await insertResponse();
    for (let i = 0; i < 16; i += 1) {
      const claim = await store.claim();
      expect(claim).not.toBeNull();
      await store.failed(claim!, { code: 'ECONNREFUSED' });
      await pool.query("UPDATE ai_platform.dev_bridge_fanout_v1 SET next_attempt_at=NOW() WHERE state='PENDING'");
    }
    expect(await store.claim()).toBeNull();
    expect(await store.nextDelay()).toBeNull();
    expect((await pool.query("SELECT * FROM ai_platform.dev_bridge_fanout_v1 WHERE state='BLOCKED'")).rows).toHaveLength(2);
    expect((await pool.query('SELECT id FROM ai_platform.ai_coding_bridge_responses WHERE id=$1', [id])).rows).toHaveLength(1);
  });
});
