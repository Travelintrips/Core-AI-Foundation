/**
 * DEV-only, strictly session-user-scoped, read-only diagnostic.
 * A browser login NEVER creates an OAuth MCP bearer token or Final ACK.
 * A static ChatGPT MAIN client owns a different channel than Codex and other
 * internal users. Never accept an arbitrary owner/client/channel from HTTP.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { oauthIssuer } from "./aiCoreMcpOAuthService.js";
import { readCodingBridgeSubscriptionHealth } from "./codingBridgeSubscriptionDiagnostics.js";

const MAIN_CLIENT_ID = "https://chatgpt.com/oauth/client.json";

export function deriveDevOauthMainClientChannel(issuer: string, userId: number): string {
  if (!Number.isSafeInteger(userId) || userId < 1 ||
      !/^https:\/\/dev\.cstlogistic\.co\.id\/?$/.test(issuer)) {
    throw new Error("DEV_OAUTH_MAIN_IDENTITY_INVALID");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([issuer.replace(/\/$/, ""), userId, MAIN_CLIENT_ID]))
    .digest("hex");
  return "ai-engine-oauth:" + digest;
}

export async function readDevOauthMainClientReadiness(userId: number) {
  if (process.env["APP_ENV"] !== "development" ||
      process.env["NODE_ENV"] !== "development") {
    throw new Error("DEV_ONLY");
  }
  const channel = deriveDevOauthMainClientChannel(oauthIssuer(), userId);
  const health = await readCodingBridgeSubscriptionHealth(channel);

  const presence = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${channel}, true)`);
    const result = await tx.execute(sql`
      SELECT last_seen_at, metadata_json ->> 'deliveryState' AS delivery_state
      FROM ai_platform.ai_coding_bridge_presence
      WHERE client_id = ${"chatgpt:" + channel}::text
        AND source = 'chatgpt-mcp'
      LIMIT 1
    `);
    return result.rows?.[0] as {
      last_seen_at?: Date | string | null;
      delivery_state?: string | null;
    } | undefined;
  });

  const stamp = presence?.last_seen_at ? new Date(presence.last_seen_at).getTime() : NaN;
  const recentlySeen = Number.isFinite(stamp) && Date.now() - stamp >= 0 &&
    Date.now() - stamp <= 15 * 60_000;
  return {
    checkedFor: "AUTHENTICATED_SESSION_USER_CHATGPT_MAIN_CLIENT",
    issuer: "https://dev.cstlogistic.co.id",
    subscriptionState: health.state,
    pendingEventCount: health.pendingCount ?? 0,
    pendingTerminalCount: "pendingTerminalCount" in health ? health.pendingTerminalCount ?? 0 : 0,
    lastAuthenticatedMcpSubscriptionAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : null,
    authenticatedMcpSubscriptionRecentlySeen: recentlySeen,
    receiverState: recentlySeen ? "RECENT_MCP_SUBSCRIBE" : "WAITING_CHATGPT_MCP",
    finalAckAssessed: false, // Only the authenticated ChatGPT MCP ACK tool can verify this.
  };
}
