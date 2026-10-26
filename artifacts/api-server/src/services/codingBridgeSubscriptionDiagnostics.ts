import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";
import { classifySubscriptionLease } from "./subscriptionLeaseHealth.js";
import { codingBridgeTerminalEventPredicate } from "./codingBridgeTerminalEventPredicate.js";

const OWNER_CHANNEL = /^ai-engine-oauth:[a-f0-9]{64}$/;
/** Diagnostic only; does not renew a subscription or acknowledge any event.
 * Caller must have a verified MCP conversation identity before invoking.
 */
export async function readCodingBridgeSubscriptionHealth(conversationId: string) {
  if (!OWNER_CHANNEL.test(conversationId)) {
    return { state: "NOT_SUBSCRIBED" as const, renewalRequired: true, expiresAt: null, pendingCount: 0 };
  }
  await ensureCodingControlBridgeTables();
  // Preserve the same owner-bound RLS context as read_ai_core_events.
  const { lease, backlog } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${conversationId}, true)`);
    const [lease, backlog] = await Promise.all([
    tx.execute(sql`
      SELECT lease_expires_at, metadata_json ->> 'unsubscribedAt' AS unsubscribed_at
      FROM ai_platform.ai_coding_bridge_presence
      WHERE client_id = ${"chatgpt:" + conversationId}::text
      LIMIT 1
    `),
    tx.execute(sql`
      SELECT count(*)::integer AS pending,
        count(*) FILTER (WHERE ${codingBridgeTerminalEventPredicate()})::integer AS terminal_pending
      FROM ai_platform.ai_coding_bridge_responses response
      JOIN ai_platform.ai_coding_bridge_commands command ON command.id = response.command_id
      WHERE command.metadata_json ->> 'conversationId' = ${conversationId}::text
        AND response.acknowledged_at IS NULL
    `),
    ]);
    return { lease, backlog };
  });
  const row = lease.rows?.[0];
  const state = classifySubscriptionLease({
    leaseExpiresAt: row?.["lease_expires_at"] as Date | string | null | undefined,
    unsubscribedAt: typeof row?.["unsubscribed_at"] === "string" ? row["unsubscribed_at"] : null,
  });
  const count = Number(backlog.rows?.[0]?.["pending"] ?? 0);
  const terminal = Number(backlog.rows?.[0]?.["terminal_pending"] ?? 0);
  return { ...state,
    pendingCount: Number.isFinite(count) ? count : 0,
    pendingTerminalCount: Number.isFinite(terminal) ? terminal : 0,
    pendingTransportCount: Number.isFinite(count - terminal) ? Math.max(0, count - terminal) : 0,
  };
}
