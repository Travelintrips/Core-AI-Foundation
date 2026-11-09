import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const DEV_DELL_WAKE_CLIENT_ID = "openclaw-dell-chatgpt-wake-dev";
const DEV_URL = "https://dev.cstlogistic.co.id";

/**
 * Read-only snapshot on SSE subscription; never an execution grant.
 * Quarantine recovery-marked commands BEFORE notifying a generic native worker.
 * The ordinary claim/submit gates remain authoritative and must independently
 * reject the recovery attempt, including direct-ID claims.
 *
 * This metadata barrier is not sufficient for untagged legacy attempts.
 * Do not enable GPT02 recovery until durable lineage and fencing are enforced
 * within the issuer, claim, renewal, result and native ACK boundaries.
 */
export async function listDevDellQueuedWakeCommandIds(clientId: string): Promise<string[]> {
  if (process.env["PUBLIC_APP_URL"]?.replace(/\/$/, "") !== DEV_URL ||
      clientId !== DEV_DELL_WAKE_CLIENT_ID) return [];

  const result = await db.execute(sql`
    SELECT id
    FROM ai_platform.ai_coding_bridge_commands
    WHERE status = 'RECEIVED'
      AND metadata_json ->> 'assignedClientId' = ${clientId}::text
      AND NOT (
        COALESCE(metadata_json ?| ARRAY[
          'gpt02Recovery','gpt02RecoveryParentCommandId',
          'recoveryParentCommandId','recovery_parent_command_id'
        ]::text[], FALSE)
        OR (
          metadata_json ->> 'capability' = 'chatgpt:wake'
          AND COALESCE(metadata_json ? 'parentCommandId', FALSE)
        )
      )
    ORDER BY received_at ASC, id ASC
    LIMIT 128
  `);
  return (result.rows ?? [])
    .map((row) => row["id"])
    .filter((id): id is string =>
      typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
}
