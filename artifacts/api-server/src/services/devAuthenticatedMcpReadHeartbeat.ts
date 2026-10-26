/**
 * DEV-only authenticated MCP receiver-presence heartbeat.
 *
 * This is observational metadata on an EXISTING, explicitly subscribed
 * OAuth-principal-owned channel. It never creates/renews a subscription or
 * access token, never touches response ACK or command state, and never
 * accepts a client-supplied owner identity: only the MCP OAuth handler calls it
 * with its server-derived scoped conversation ID.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const OWNER_PATTERN = /^ai-engine-oauth:[a-f0-9]{64}$/;

export function canRecordDevAuthenticatedMcpRead(input: {
  environment: string | undefined;
  identityKind: string;
  conversationId: string;
}): boolean {
  return input.environment === "development" &&
    input.identityKind === "oauth" &&
    OWNER_PATTERN.test(input.conversationId);
}

export async function recordDevAuthenticatedMcpRead(conversationId: string): Promise<boolean> {
  if (!canRecordDevAuthenticatedMcpRead({
    environment: process.env["APP_ENV"],
    identityKind: "oauth",
    conversationId,
  })) return false;

  // Preserve owner-scoped RLS. Do not renew the server lease, grant access
  // to a different client, or create a new presence for a login-only session.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${conversationId}, true)`);
    return tx.execute(sql`
      UPDATE ai_platform.ai_coding_bridge_presence
      SET last_seen_at = now(),
        updated_at = now(),
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) ||
          jsonb_build_object(
            'lastAuthenticatedMcpReadAt', now()::text,
            'deliveryState', 'CLIENT_RECENTLY_SEEN'
          )
      WHERE client_id = ${"chatgpt:" + conversationId}::text
        AND source = 'chatgpt-mcp'
        AND metadata_json ->> 'autoRenewUntilTerminal' = 'true'
        AND NOT (metadata_json ? 'unsubscribedAt')
        AND COALESCE(metadata_json ->> 'subscriptionLifecycle', '') NOT IN ('REVOKED', 'CLOSED_PASS')
        AND (last_seen_at IS NULL OR last_seen_at < now() - interval '60 seconds')
      RETURNING client_id
    `);
  });
  return Boolean(result.rows?.length);
}
