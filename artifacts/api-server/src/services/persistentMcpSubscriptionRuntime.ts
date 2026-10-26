/**
 * DEV-only durable subscription reconciler.
 *
 * The original authenticated MCP subscribe is the authorization record. Its
 * short lease is renewed server-side while any event/job lacks verified Final
 * ACK; this NEVER renews OAuth, fabricates ACK, or dispatches worker jobs.
 * Restart recovery reads the same durable presence row from Postgres.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";
import { verifyMcpHandshakeEvidenceRow } from "./localCodingControlBridgeService.js";
import { codingBridgeTerminalEventPredicate } from "./codingBridgeTerminalEventPredicate.js";
import {
  decidePersistentMcpSubscription,
  devPersistentMcpRuntimeEnabled,
  persistentMcpDeliveryState,
} from "./persistentMcpSubscriptionPolicy.js";

const INTERVAL_MS = 60_000;
const RENEWAL_SECONDS = 24 * 60 * 60;
const RENEW_WHEN_LESS_THAN_MS = 6 * 60 * 60_000;
const MAX_SUBSCRIPTIONS_PER_CYCLE = 30;
const MAX_COMMANDS_TO_VERIFY = 200;
const CHANNEL_FORMAT = /^chatgpt:ai-engine-oauth:[a-f0-9]{64}$/;

type Presence = {
  client_id: string;
  lease_expires_at: Date | string;
  last_seen_at: Date | string | null;
  metadata_json: Record<string, unknown>;
};

type BridgeCommandProof = {
  command_id: string;
  status: string;
  source: string;
  command_type: string;
  received_at: Date | string;
  command_metadata: Record<string, unknown> | null;
  response_id: string | null;
  response_metadata: Record<string, unknown> | null;
  response_created_at: Date | string | null;
  acknowledged_at: Date | string | null;
};

export interface PersistentMcpSubscriptionTickResult {
  scanned: number;
  renewed: number;
  closedPass: number;
  skipped: number;
  failures: number;
}

async function reconcileOwner(clientId: string): Promise<"RENEWED" | "CLOSED_PASS" | "SKIPPED"> {
  if (!CHANNEL_FORMAT.test(clientId)) return "SKIPPED";
  return db.transaction(async (tx) => {
    const response = await tx.execute(sql`
      SELECT client_id, lease_expires_at, last_seen_at, metadata_json
      FROM ai_platform.ai_coding_bridge_presence
      WHERE client_id = ${clientId}::text AND source = 'chatgpt-mcp'
      FOR UPDATE
    `);
    const row = response.rows?.[0] as Presence | undefined;
    if (!row) return "SKIPPED";
    const meta = row.metadata_json ?? {};
    const optedIn = meta["autoRenewUntilTerminal"] === true;
    const revoked = typeof meta["unsubscribedAt"] === "string" ||
      meta["subscriptionLifecycle"] === "REVOKED" ||
      meta["subscriptionLifecycle"] === "CLOSED_PASS";
    if (!optedIn || revoked) return "SKIPPED";

    const conversationId = clientId.slice("chatgpt:".length);
    // Maintain the same conversation isolation used for authenticated event
    // reads. Never extend any user's OAuth identity or bearer token.
    await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${conversationId}, true)`);
    const counts = await tx.execute(sql`
      SELECT count(DISTINCT command.id)::integer AS total_commands,
        count(response.id) FILTER (WHERE response.acknowledged_at IS NULL AND ${codingBridgeTerminalEventPredicate()})::integer AS pending_responses
      FROM ai_platform.ai_coding_bridge_commands command
      LEFT JOIN ai_platform.ai_coding_bridge_responses response
        ON response.command_id = command.id
      WHERE command.metadata_json ->> 'conversationId' = ${conversationId}::text
    `);
    const totalCommands = Number(counts.rows?.[0]?.["total_commands"] ?? -1);
    const pendingResponses = Number(counts.rows?.[0]?.["pending_responses"] ?? -1);

    // Closing requires zero pending TERMINAL lifecycle events, not zero
    // internal worker ACK / PROGRESS rows: those are not deliverable ChatGPT
    // events and cannot be ACKed by a lifecycle-only MCP client.
    // Still require original signed handshake evidence for EVERY command.
    // A time-based timeout, callback label or transport receipt never suffices.
    let verifiedCommands = 0;
    let verificationComplete = false;
    if (pendingResponses === 0 && totalCommands > 0 &&
        totalCommands <= MAX_COMMANDS_TO_VERIFY) {
      const proof = await tx.execute(sql`
        SELECT command.id AS command_id, command.status, command.source,
          command.command_type, command.received_at,
          command.metadata_json AS command_metadata,
          receipt.id AS response_id, receipt.metadata_json AS response_metadata,
          receipt.created_at AS response_created_at, receipt.acknowledged_at
        FROM ai_platform.ai_coding_bridge_commands command
        LEFT JOIN ai_platform.ai_coding_bridge_responses receipt
          ON receipt.command_id = command.id AND
             receipt.id::text = command.metadata_json ->> 'mcpAckResponseId'
        WHERE command.metadata_json ->> 'conversationId' = ${conversationId}::text
        ORDER BY command.created_at ASC, command.id ASC
        LIMIT ${MAX_COMMANDS_TO_VERIFY + 1}::integer
      `);
      const commands = (proof.rows ?? []) as BridgeCommandProof[];
      verificationComplete = commands.length === totalCommands;
      if (verificationComplete) {
        for (const command of commands) {
          const metadata = command.command_metadata ?? {};
          const signed = command.status === "COMPLETED" &&
            command.source === "ai-core" &&
            command.command_type === "EXTERNAL_AGENT_WORK" &&
            metadata["e2eCode"] === "MCP_ACK_VERIFIED" &&
            metadata["deliveryCode"] === "DELIVERY_CONFIRMED" &&
            metadata["conversationId"] === conversationId &&
            metadata["mcpAckConversationId"] === conversationId &&
            Boolean(command.response_id && command.acknowledged_at &&
              verifyMcpHandshakeEvidenceRow(conversationId, {
                commandId: command.command_id,
                commandReceivedAt: command.received_at,
                commandMetadata: metadata,
                responseId: command.response_id,
                responseMetadata: command.response_metadata ?? {},
                responseCreatedAt: command.response_created_at,
                acknowledgedAt: command.acknowledged_at,
              }));
          if (signed) verifiedCommands++;
        }
      }
    }
    const action = decidePersistentMcpSubscription({
      optedIn, explicitlyRevoked: revoked, pendingResponses, totalCommands,
      verifiedCommands, verificationComplete,
    });
    if (action === "CLOSE_PASS") {
      await tx.execute(sql`
        UPDATE ai_platform.ai_coding_bridge_presence
        SET lease_expires_at = now(),
          updated_at = now(),
          metadata_json = metadata_json || jsonb_build_object(
            'subscriptionLifecycle', 'CLOSED_PASS',
            'deliveryState', 'COMPLETE',
            'closedReason', 'ALL_COMMANDS_SIGNED_FINAL_ACK',
            'closedAt', now()::text
          )
        WHERE client_id = ${clientId}::text
          AND source = 'chatgpt-mcp'
          AND metadata_json ->> 'autoRenewUntilTerminal' = 'true'
          AND NOT (metadata_json ? 'unsubscribedAt')
      `);
      return "CLOSED_PASS";
    }
    if (action !== "RENEW") return "SKIPPED";
    const now = Date.now();
    const delivery = persistentMcpDeliveryState(row.last_seen_at, now);
    const expires = new Date(row.lease_expires_at).getTime();
    const stateChanged = meta["subscriptionLifecycle"] !== "PERSISTENT_ACTIVE" ||
      meta["deliveryState"] !== delivery;
    if (!stateChanged && Number.isFinite(expires) &&
        expires > now + RENEW_WHEN_LESS_THAN_MS) return "SKIPPED";
    // No lease-token rotation and no updates to last_seen_at: the client has
    // not reauthenticated or checked in merely because the server is alive.
    await tx.execute(sql`
      UPDATE ai_platform.ai_coding_bridge_presence
      SET lease_expires_at = now() + (${RENEWAL_SECONDS}::integer * interval '1 second'),
        updated_at = now(),
        metadata_json = metadata_json || jsonb_build_object(
          'subscriptionLifecycle', 'PERSISTENT_ACTIVE',
          'deliveryState', ${delivery}::text,
          'lastServerRenewedAt', now()::text,
          'leasePolicy', 'signed-final-ack-gated/v1'
        )
      WHERE client_id = ${clientId}::text
        AND source = 'chatgpt-mcp'
        AND metadata_json ->> 'autoRenewUntilTerminal' = 'true'
        AND NOT (metadata_json ? 'unsubscribedAt')
    `);
    return "RENEWED";
  });
}

export async function reconcilePersistentMcpSubscriptions(): Promise<PersistentMcpSubscriptionTickResult> {
  const result: PersistentMcpSubscriptionTickResult = {
    scanned: 0, renewed: 0, closedPass: 0, skipped: 0, failures: 0,
  };
  if (!devPersistentMcpRuntimeEnabled(process.env)) return result;
  await ensureCodingControlBridgeTables();
  const eligible = await db.execute(sql`
    SELECT client_id
    FROM ai_platform.ai_coding_bridge_presence
    WHERE source = 'chatgpt-mcp'
      AND client_id ~ '^chatgpt:ai-engine-oauth:[a-f0-9]{64}$'
      AND metadata_json ->> 'autoRenewUntilTerminal' = 'true'
      AND NOT (metadata_json ? 'unsubscribedAt')
      AND COALESCE(metadata_json ->> 'subscriptionLifecycle', '') NOT IN
        ('REVOKED', 'CLOSED_PASS')
    ORDER BY updated_at ASC
    LIMIT ${MAX_SUBSCRIPTIONS_PER_CYCLE}::integer
  `);
  for (const row of eligible.rows ?? []) {
    const clientId = String(row["client_id"] ?? "");
    if (!CHANNEL_FORMAT.test(clientId)) continue;
    result.scanned++;
    try {
      const status = await reconcileOwner(clientId);
      if (status === "RENEWED") result.renewed++;
      else if (status === "CLOSED_PASS") result.closedPass++;
      else result.skipped++;
    } catch (error) {
      result.failures++;
      logger.warn({ error }, "[persistent-mcp-subscription] owner reconciliation failed");
    }
  }
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

export function startPersistentMcpSubscriptionRuntime(): void {
  if (!devPersistentMcpRuntimeEnabled(process.env) || timer) return;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await reconcilePersistentMcpSubscriptions();
      if (result.renewed || result.closedPass || result.failures)
        logger.info(result, "[persistent-mcp-subscription] DEV reconciliation");
    } catch (error) {
      logger.warn({ error }, "[persistent-mcp-subscription] DEV will retry");
    } finally {
      busy = false;
    }
  };
  void run();
  timer = setInterval(() => void run(), INTERVAL_MS);
  timer.unref?.();
}

export function stopPersistentMcpSubscriptionRuntime(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
