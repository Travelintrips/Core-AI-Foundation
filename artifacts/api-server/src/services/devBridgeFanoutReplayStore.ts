import { randomUUID } from "node:crypto";

export const DEV_FANOUT_CHANNEL = "ai_dev_bridge_fanout_v1";
export const DEV_FANOUT_SINKS = ["CHAT_INBOX", "MCP_EVENT_QUEUE"] as const;
export type DevFanoutSink = typeof DEV_FANOUT_SINKS[number];
export interface ReplaySql {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export type ReplayClaim = {
  responseId: string; sink: DevFanoutSink; claimToken: string; attempts: number;
  commandId: string; taskId: string | null; kind: "COMPLETED" | "FAILED" | "BLOCKER";
  message: string; checkpoint: Record<string, unknown>; metadata: Record<string, unknown>;
  createdAt: Date | string;
};

// Installed only by the separately guarded DEV worker. The trigger is SECURITY
// INVOKER: it adds no privileges and runs inside the response writer's transaction.
// A committed response and its pending projection cannot be separated by a crash.
export const DEV_FANOUT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ai_platform.dev_bridge_fanout_v1 (
  response_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_responses(id),
  sink text NOT NULL CHECK (sink IN ('CHAT_INBOX','MCP_EVENT_QUEUE')),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PROCESSING','PROJECTED','BLOCKED')),
  attempts integer NOT NULL DEFAULT 0,
  claim_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  projected_at timestamptz,
  PRIMARY KEY(response_id,sink)
);
CREATE INDEX IF NOT EXISTS dev_bridge_fanout_due_v1
  ON ai_platform.dev_bridge_fanout_v1(state,next_attempt_at,lease_expires_at);
CREATE OR REPLACE FUNCTION ai_platform.queue_dev_bridge_fanout_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ('COMPLETED','FAILED','BLOCKER') THEN
    INSERT INTO ai_platform.dev_bridge_fanout_v1(response_id,sink)
      VALUES (NEW.id,'CHAT_INBOX'),(NEW.id,'MCP_EVENT_QUEUE')
      ON CONFLICT DO NOTHING;
    PERFORM pg_notify('ai_dev_bridge_fanout_v1', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='dev_bridge_fanout_v1'
      AND tgrelid='ai_platform.ai_coding_bridge_responses'::regclass) THEN
    CREATE TRIGGER dev_bridge_fanout_v1 AFTER INSERT ON ai_platform.ai_coding_bridge_responses
      FOR EACH ROW EXECUTE FUNCTION ai_platform.queue_dev_bridge_fanout_v1();
  END IF;
END $$;
`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function replayErrorCode(error: unknown): string {
  const code = asRecord(error)["code"];
  return typeof code === "string" && /^[A-Za-z0-9_]{1,48}$/.test(code)
    ? code : "PROJECTION_FAILED";
}

export class DevBridgeFanoutReplayStore {
  constructor(private readonly sql: ReplaySql, private readonly leaseMs = 60_000) {}

  async install(): Promise<void> {
    // One simple-query message is one implicit PostgreSQL transaction. Serialize
    // concurrent installer instances without changing the application's tables.
    await this.sql.query("BEGIN; SELECT pg_advisory_xact_lock(1359, 1360); " +
      DEV_FANOUT_SCHEMA_SQL + " COMMIT;").catch(async (error: unknown) => {
        // Runtime supplies a pinned installation client (not a pooled BEGIN).
        await this.sql.query("ROLLBACK").catch(() => undefined);
        throw error;
      });
  }

  async claim(): Promise<ReplayClaim | null> {
    await this.sql.query(`UPDATE ai_platform.dev_bridge_fanout_v1
      SET state='BLOCKED',claim_token=NULL,lease_expires_at=NULL,last_error_code='RETRY_EXHAUSTED'
      WHERE attempts>=8 AND ((state='PENDING' AND next_attempt_at<=NOW()) OR
        (state='PROCESSING' AND lease_expires_at<=NOW()))`);
    const token = randomUUID();
    const result = await this.sql.query(`
      WITH picked AS (
        SELECT o.response_id,o.sink,r.command_id,r.task_id,r.kind,r.message,
          r.checkpoint_json,r.metadata_json,r.created_at AS response_created_at
        FROM ai_platform.dev_bridge_fanout_v1 o
        JOIN ai_platform.ai_coding_bridge_responses r ON r.id=o.response_id
        WHERE o.attempts<8 AND ((o.state='PENDING' AND o.next_attempt_at<=NOW()) OR
          (o.state='PROCESSING' AND o.lease_expires_at<=NOW()))
        ORDER BY o.created_at,o.response_id,o.sink
        FOR UPDATE OF o SKIP LOCKED LIMIT 1
      )
      UPDATE ai_platform.dev_bridge_fanout_v1 o SET state='PROCESSING',
        attempts=o.attempts+1,claim_token=$1::uuid,
        lease_expires_at=NOW()+($2::integer * INTERVAL '1 millisecond')
      FROM picked p WHERE o.response_id=p.response_id AND o.sink=p.sink
      RETURNING o.*,p.command_id,p.task_id,p.kind,p.message,p.checkpoint_json,
        p.metadata_json,p.response_created_at`,
    [token, Math.max(1_000, Math.min(300_000, Math.floor(this.leaseMs)))]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      responseId: String(row["response_id"]), sink: row["sink"] as DevFanoutSink,
      claimToken: token, attempts: Number(row["attempts"]),
      commandId: String(row["command_id"]), taskId: row["task_id"] ? String(row["task_id"]) : null,
      kind: row["kind"] as ReplayClaim["kind"], message: String(row["message"]),
      checkpoint: asRecord(row["checkpoint_json"]), metadata: asRecord(row["metadata_json"]),
      createdAt: row["response_created_at"] as Date | string,
    };
  }

  async projected(claim: ReplayClaim): Promise<boolean> {
    const result = await this.sql.query(`UPDATE ai_platform.dev_bridge_fanout_v1
      SET state='PROJECTED',projected_at=NOW(),claim_token=NULL,lease_expires_at=NULL,last_error_code=NULL
      WHERE response_id=$1::uuid AND sink=$2 AND state='PROCESSING' AND claim_token=$3::uuid
      RETURNING response_id`, [claim.responseId, claim.sink, claim.claimToken]);
    return result.rows.length === 1;
  }

  async failed(claim: ReplayClaim, error: unknown): Promise<void> {
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(6, claim.attempts - 1));
    await this.sql.query(`UPDATE ai_platform.dev_bridge_fanout_v1
      SET state=CASE WHEN attempts>=8 THEN 'BLOCKED' ELSE 'PENDING' END,
        claim_token=NULL,lease_expires_at=NULL,last_error_code=$4,
        next_attempt_at=NOW()+($5::integer * INTERVAL '1 millisecond')
      WHERE response_id=$1::uuid AND sink=$2 AND state='PROCESSING' AND claim_token=$3::uuid`,
    [claim.responseId, claim.sink, claim.claimToken, replayErrorCode(error), delay]);
  }

  async nextDelay(): Promise<number | null> {
    const result = await this.sql.query(`SELECT EXTRACT(EPOCH FROM
      (MIN(CASE WHEN state='PROCESSING' THEN lease_expires_at ELSE next_attempt_at END)-NOW()))*1000 AS delay
      FROM ai_platform.dev_bridge_fanout_v1 WHERE state IN ('PENDING','PROCESSING')`);
    const delay = result.rows[0]?.["delay"];
    return delay == null ? null : Math.max(100, Number(delay));
  }
}

export async function replayOne(
  store: DevBridgeFanoutReplayStore,
  project: (claim: ReplayClaim) => Promise<void>,
): Promise<"IDLE" | "PROJECTED" | "RETRY"> {
  const claim = await store.claim();
  if (!claim) return "IDLE";
  try {
    await project(claim);
    return await store.projected(claim) ? "PROJECTED" : "RETRY";
  } catch (error) {
    await store.failed(claim, error);
    return "RETRY";
  }
}
