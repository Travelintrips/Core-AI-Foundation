import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";

const DEFAULT_WORKER_TOKEN_HASH =
  "f55a77cc62cffba99c3f24cee68fd69e8dc78a88d52b8e945755ca7bf8ce18c5";
const WORKER_TOKEN_NAME = "gcp-ai-workers-primary";

let ensurePromise: Promise<void> | null = null;

function workerTokenHash(): string {
  const configured = (
    process.env["AI_CORE_WORKER_TOKEN_HASH"] ?? DEFAULT_WORKER_TOKEN_HASH
  ).trim().toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(configured)) {
    throw new Error("AI_CORE_WORKER_TOKEN_HASH must be a SHA-256 hex digest");
  }

  return configured;
}

async function ensureInternal(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_agent_service_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      scopes TEXT[] NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_service_tokens_name_uidx
      ON ai_platform.ai_agent_service_tokens(name)
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_service_tokens_hash_uidx
      ON ai_platform.ai_agent_service_tokens(token_hash)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_agent_service_tokens_active_idx
      ON ai_platform.ai_agent_service_tokens(is_active)
  `);

  const tokenHash = workerTokenHash();

  // Keep an existing canonical row aligned when the configured worker token is
  // rotated, but never overwrite another row that already owns the new hash.
  await db.execute(sql`
    UPDATE ai_platform.ai_agent_service_tokens AS token
    SET token_hash = ${tokenHash},
        scopes = ARRAY['model:chat','agent:presence','agent:work']::text[],
        is_active = TRUE,
        expires_at = NULL,
        metadata = token.metadata || '{"source":"gcp-ai-workers-bootstrap"}'::jsonb,
        updated_at = NOW()
    WHERE token.name = ${WORKER_TOKEN_NAME}
      AND token.token_hash <> ${tokenHash}
      AND NOT EXISTS (
        SELECT 1
        FROM ai_platform.ai_agent_service_tokens AS existing
        WHERE existing.token_hash = ${tokenHash}
      )
  `);

  // The same scoped token can already exist under the legacy ai-workers stack
  // name. The credential hash is the stable identity, so make bootstrap
  // idempotent on token_hash instead of failing on a second descriptive name.
  await db.execute(sql`
    INSERT INTO ai_platform.ai_agent_service_tokens (
      name, token_hash, scopes, is_active, metadata, created_at, updated_at
    )
    VALUES (
      ${WORKER_TOKEN_NAME},
      ${tokenHash},
      ARRAY['model:chat','agent:presence','agent:work']::text[],
      TRUE,
      '{"source":"gcp-ai-workers-bootstrap"}'::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (token_hash) DO UPDATE
      SET scopes = EXCLUDED.scopes,
          is_active = TRUE,
          expires_at = NULL,
          metadata =
            ai_agent_service_tokens.metadata || EXCLUDED.metadata,
          updated_at = NOW()
  `);

  logger.info({ name: WORKER_TOKEN_NAME }, "[agent-runtime] worker token bootstrap ensured");
}

export async function ensureAgentServiceTokenBootstrap(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = ensureInternal().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}
