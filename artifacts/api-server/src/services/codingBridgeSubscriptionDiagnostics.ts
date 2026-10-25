import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";

const OWNER_CHANNEL = /^ai-engine-oauth:[a-f0-9]{64}$/;
export type SubscriptionHealthState = "ACTIVE" | "EXPIRED" | "UNSUBSCRIBED" | "NOT_SUBSCRIBED";

export function classifySubscriptionLease(input: {
  leaseExpiresAt: Date | string | null | undefined;
  unsubscribedAt?: string | null;
}, now = Date.now()): { state: SubscriptionHealthState; renewalRequired: boolean; expiresAt: string | null } {
  if (input.leaseExpiresAt == null) {
    return { state: "NOT_SUBSCRIBED", renewalRequired: true, expiresAt: null };
  }
  const expires = input.leaseExpiresAt instanceof Date
    ? input.leaseExpiresAt : new Date(input.leaseExpiresAt);
  if (!Number.isFinite(expires.getTime())) {
    return { state: "EXPIRED", renewalRequired: true, expiresAt: null };
  }
  const expiresAt = expires.toISOString();
  if (input.unsubscribedAt) {
    return { state: "UNSUBSCRIBED", renewalRequired: true, expiresAt };
  }
  return expires.getTime() > now
    ? { state: "ACTIVE", renewalRequired: false, expiresAt }
    : { state: "EXPIRED", renewalRequired: true, expiresAt };
}

/** Diagnostic only; does not renew a subscription or acknowledge any event.
 * Caller must have a verified MCP conversation identity before invoking.
 */
export async function readCodingBridgeSubscriptionHealth(conversationId: string) {
  if (!OWNER_CHANNEL.test(conversationId)) {
    return { state: "NOT_SUBSCRIBED" as const, renewalRequired: true, expiresAt: null, pendingCount: 0 };
  }
  await ensureCodingControlBridgeTables();
  const [lease, backlog] = await Promise.all([
    db.execute(sql`
      SELECT lease_expires_at, metadata_json ->> 'unsubscribedAt' AS unsubscribed_at
      FROM ai_platform.ai_coding_bridge_presence
      WHERE client_id = ${"chatgpt:" + conversationId}::text
      LIMIT 1
    `),
    db.execute(sql`
      SELECT count(*)::integer AS pending
      FROM ai_platform.ai_coding_bridge_responses response
      JOIN ai_platform.ai_coding_bridge_commands command ON command.id = response.command_id
      WHERE command.metadata_json ->> 'conversationId' = ${conversationId}::text
        AND response.acknowledged_at IS NULL
    `),
  ]);
  const row = lease.rows?.[0];
  const state = classifySubscriptionLease({
    leaseExpiresAt: row?.["lease_expires_at"] as Date | string | null | undefined,
    unsubscribedAt: typeof row?.["unsubscribed_at"] === "string" ? row["unsubscribed_at"] : null,
  });
  const count = Number(backlog.rows?.[0]?.["pending"] ?? 0);
  return { ...state, pendingCount: Number.isFinite(count) ? count : 0 };
}
