import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const DEV_DELL_WAKE_CLIENT_ID = "openclaw-dell-chatgpt-wake-dev";
const DEV_URL = "https://dev.cstlogistic.co.id";

/**
 * A single read-only snapshot on SSE subscription, not periodic polling.
 * Only unclaimed RECEIVED commands are emitted. PROCESSING leases are never
 * auto-replayed by a reconnecting native worker.
 * Disabled outside the server-owned DEV URL.
 */
export async function listDevDellQueuedWakeCommandIds(clientId: string): Promise<string[]> {
  if (process.env["PUBLIC_APP_URL"]?.replace(/\/$/, "") !== DEV_URL ||
      clientId !== DEV_DELL_WAKE_CLIENT_ID) return [];

  const result = await db.execute(sql`
    SELECT id
    FROM ai_platform.ai_coding_bridge_commands
    WHERE status = 'RECEIVED'
      AND metadata_json ->> 'assignedClientId' = ${clientId}::text
    ORDER BY received_at ASC, id ASC
    LIMIT 128
  `);
  return (result.rows ?? [])
    .map((row) => row["id"])
    .filter((id): id is string =>
      typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
}
