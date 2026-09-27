import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";

let ensurePromise: Promise<void> | null = null;

async function ensureTablesInternal(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_bridge_commands (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE SET NULL,
      external_command_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'chatgpt',
      command_type TEXT NOT NULL DEFAULT 'INSTRUCTION',
      instruction TEXT NOT NULL,
      authority_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_coding_bridge_commands_status_check
        CHECK (status IN ('RECEIVED','PROCESSING','COMPLETED','FAILED','CANCELLED'))
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_bridge_commands_external_uidx
      ON ai_platform.ai_coding_bridge_commands(source, external_command_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_bridge_commands_task_idx
      ON ai_platform.ai_coding_bridge_commands(task_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_bridge_commands_status_idx
      ON ai_platform.ai_coding_bridge_commands(status)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_bridge_responses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      command_id UUID NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id) ON DELETE CASCADE,
      task_id UUID REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      checkpoint_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      acknowledged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_coding_bridge_responses_kind_check
        CHECK (kind IN ('ACK','PROGRESS','CHECKPOINT','BLOCKER','COMPLETED','FAILED'))
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_bridge_responses_command_idx
      ON ai_platform.ai_coding_bridge_responses(command_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_bridge_responses_task_idx
      ON ai_platform.ai_coding_bridge_responses(task_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_bridge_responses_ack_idx
      ON ai_platform.ai_coding_bridge_responses(acknowledged_at)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_bridge_presence (
      client_id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'chatgpt',
      lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
      lease_expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_bridge_presence_expiry_idx
      ON ai_platform.ai_coding_bridge_presence(lease_expires_at)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_critical_approvals (
      id UUID PRIMARY KEY,
      task_id UUID REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE SET NULL,
      command_id UUID REFERENCES ai_platform.ai_coding_bridge_commands(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      action_digest TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      decided_at TIMESTAMPTZ,
      decided_by_suffix TEXT,
      execution_started_at TIMESTAMPTZ,
      execution_error TEXT,
      CONSTRAINT ai_coding_critical_approvals_status_check
        CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','EXECUTING','COMPLETED','FAILED'))
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_critical_approvals_task_idx
      ON ai_platform.ai_coding_critical_approvals(task_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_critical_approvals_status_idx
      ON ai_platform.ai_coding_critical_approvals(status, expires_at)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_critical_approvals_pending_digest_uidx
      ON ai_platform.ai_coding_critical_approvals(action_digest)
      WHERE status IN ('PENDING','APPROVED','EXECUTING')
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_autonomous_tasks (
      task_id UUID PRIMARY KEY REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      cycle_count INTEGER NOT NULL DEFAULT 0,
      max_cycles INTEGER NOT NULL DEFAULT 40,
      last_action TEXT,
      last_error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_cycle_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_coding_autonomous_tasks_status_check
        CHECK (status IN ('ACTIVE','WAITING','APPROVAL_REQUIRED','COMPLETED','BLOCKED','FAILED','DISABLED'))
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_coding_autonomous_tasks_active_idx
      ON ai_platform.ai_coding_autonomous_tasks(status, enabled, updated_at)
  `);

  logger.info("[coding-bridge] Control bridge tables ensured");
}

/**
 * Idempotent schema guard for the durable coding control bridge.
 * The memoized promise prevents concurrent first requests from racing the same DDL.
 * On failure the memo is cleared so a later request/startup attempt can retry.
 */
export async function ensureCodingControlBridgeTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = ensureTablesInternal().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}
