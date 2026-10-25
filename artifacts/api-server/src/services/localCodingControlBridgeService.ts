import { randomUUID } from "crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingBridgePresenceTable,
  aiCodingBridgeResponsesTable,
  db,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { enqueueAiCoreMcpBridgeLifecycleEvent } from "./aiCoreMcpEventWebhookService.js";
import {
  notifyCodingBridgeResponse,
  waitForCodingWhatsappDelivery,
} from "./codingWhatsappNotificationService.js";
import { enqueueAiCoreChatInboxMessage } from "./aiCoreChatInboxService.js";
import { ensureCodingControlBridgeTables } from "./codingControlBridgeSchemaService.js";
import { ensureGcpCodingWorkerStarted } from "./gcpCodingWorkerLifecycleService.js";
import { readHandshakeSopSettings } from "./handshakeSopSettingsService.js";
import { renderReplyTemplate } from "./handshakeSopConfiguration.js";
import { notifyExternalAgentWork } from "./externalAgentWorkEventService.js";
import { devContinuityResultFromCommittedCommand, emitDevContinuityWakeResult, isDevContinuityWakeWorker } from "./devContinuityWakeEvents.js";
import { devAssistantPublicKeyForWorker } from "./devAssistantAttestation.js";
import { commandMatchesDevWakeTarget, DEV_WAKE_DEFAULT_WORKER, DEV_WAKE_DELL_WORKER, DEV_WAKE_PCHP_WORKER, DEV_WAKE_PC2_WORKER, DEV_WAKE_VMSC_WORKER, loadDevWakeRuntimeConfig, readDevWakeBinding, resolveConfiguredDevWakeTarget, type DevWakeBinding } from "./devChatGptWakeBindingService.js";
import { verifyDevWakeCommandReceipt } from "./devChatGptWakeEvidenceService.js";

const DEFAULT_LEASE_SECONDS = 180;
const MAX_LEASE_SECONDS = 300;
const DEFAULT_COMMAND_LEASE_SECONDS = 300;
const DEFAULT_CHATGPT_EVENT_LEASE_SECONDS = 24 * 60 * 60;
const MAX_CHATGPT_EVENT_LEASE_SECONDS = 7 * 24 * 60 * 60;

function boundedLeaseSeconds(
  value: number | undefined,
  fallback: number,
  maxSeconds = MAX_LEASE_SECONDS,
): number {
  return Math.max(30, Math.min(maxSeconds, Math.floor(value ?? fallback)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isIdempotentCodingBridgeLifecycleKind(
  kind: "ACK" | "PROGRESS" | "CHECKPOINT" | "BLOCKER" | "COMPLETED" | "FAILED",
): boolean {
  return kind === "BLOCKER" || kind === "COMPLETED" || kind === "FAILED";
}

const GITHUB_REPOSITORY = "Travelintrips/Core-AI-Foundation";

function githubIssueNumberFromCommand(command: {
  source?: string | null;
  metadataJson?: unknown;
}): number | null {
  if (command.source !== "github-trigger" || !isRecord(command.metadataJson)) {
    return null;
  }
  const value = command.metadataJson["issueNumber"];
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

async function syncTerminalBridgeResponseToGitHub(input: {
  responseId: string;
  commandId: string;
  taskId: string | null;
  kind: "BLOCKER" | "COMPLETED" | "FAILED";
}): Promise<void> {
  const token = process.env["AI_CODING_GITHUB_TOKEN"]?.trim();
  if (!token) return;

  const [command] = await db
    .select()
    .from(aiCodingBridgeCommandsTable)
    .where(eq(aiCodingBridgeCommandsTable.id, input.commandId))
    .limit(1);
  if (!command) return;

  const issueNumber = githubIssueNumberFromCommand(command);
  if (!issueNumber) return;

  // A task may generate hundreds of terminal bridge rows as its checkpoint
  // changes. Publishing every BLOCKER as a fresh GitHub comment caused >1,000
  // comments on issue #658. A single issue/task/kind gets one summary; full
  // details remain in the durable bridge timeline. Preserve distinct kinds so
  // a later BLOCKER can contradict an earlier COMPLETED (#942).
  //
  // Correlate by issue AND task, not just command: the same task can be
  // resubmitted under several bridge command IDs.
  // Historical rows may have NULL response.task_id even when callbacks carry
  // the task UUID (#658): use this-command fallback to avoid dropping alerts.
  const earliest = input.taskId
    ? await db.execute(sql`
        SELECT response.id
        FROM ai_platform.ai_coding_bridge_responses AS response
        JOIN ai_platform.ai_coding_bridge_commands AS command
          ON command.id = response.command_id
        WHERE command.source = 'github-trigger'
          AND command.metadata_json ->> 'issueNumber' = ${String(issueNumber)}::text
          AND response.kind = ${input.kind}
          AND (
            response.task_id = ${input.taskId}::uuid
            OR (
              -- Legacy github-trigger responses often stored NULL task_id
              -- despite the callback carrying a valid task UUID. Correlate
              -- those only to this command, never unrelated issue callbacks.
              response.task_id IS NULL
              AND response.command_id = ${input.commandId}::uuid
            )
          )
        ORDER BY response.created_at ASC, response.id ASC
        LIMIT 1
      `)
    : await db.execute(sql`
        SELECT response.id
        FROM ai_platform.ai_coding_bridge_responses AS response
        WHERE response.command_id = ${input.commandId}::uuid
          AND response.task_id IS NULL
          AND response.kind = ${input.kind}
        ORDER BY response.created_at ASC, response.id ASC
        LIMIT 1
      `);
  if (String(earliest.rows?.[0]?.["id"] ?? "") !== input.responseId) {
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const terminalLabel =
    input.kind === "COMPLETED"
      ? "completed"
      : input.kind === "FAILED"
        ? "failed"
        : "blocked";
  const commentResponse = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        body:
          `AI Core terminal callback: **${terminalLabel.toUpperCase()}**\n\n` +
          `- Task: ${input.taskId ?? "unknown"}\n` +
          `- Bridge response: ${input.responseId}\n` +
          `- Source: AI Core coding bridge\n\n` +
          (input.kind === "COMPLETED"
            ? "The originating AI Core task reached a terminal completed state."
            : "The originating AI Core task requires follow-up and remains open."),
      }),
    },
  );
  if (!commentResponse.ok) {
    throw new Error(
      `GitHub terminal callback comment failed with HTTP ${commentResponse.status}`,
    );
  }

  // A bridge COMPLETED response is not evidence that the originating work
  // is fully finished. Later BLOCKER/FAILED callbacks are possible (#942).
  // Record the callback above, but leave the issue open until an independent
  // reconciler checks authoritative task state and required PR/CI/deploy proof.
  // Never close GitHub issues from an unverified bridge callback alone.
}

export async function submitCodingBridgeCommand(input: {
  externalCommandId: string;
  instruction: string;
  taskId?: string | null;
  source?: string;
  commandType?: string;
  assignedClientId?: string | null;
  authority?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  let stage = "SCHEMA_CHECK_FAILED";
  try {
  await ensureCodingControlBridgeTables();
  stage = "COMMAND_LOOKUP_FAILED";
  const source = input.source ?? "chatgpt";
  const [existing] = await db
    .select()
    .from(aiCodingBridgeCommandsTable)
    .where(
      and(
        eq(aiCodingBridgeCommandsTable.source, source),
        eq(aiCodingBridgeCommandsTable.externalCommandId, input.externalCommandId),
      ),
    )
    .limit(1);
  if (existing) {
    stage = "EXISTING_COMMAND_NOTIFICATION_FAILED";
    if (input.assignedClientId) await notifyExternalAgentWork(input.assignedClientId, existing.id);
    return { command: existing, created: false };
  }

  const { operationalSop, operationalSopSource, replyTemplates } =
    await readHandshakeSopSettings();
  const metadataJson = {
    ...(input.metadata ?? {}),
    operationalSop,
    operationalSopSource,
    ...(input.assignedClientId
      ? { assignedClientId: input.assignedClientId }
      : {}),
  };

  stage = "COMMAND_INSERT_FAILED";
  const [command] = await db
    .insert(aiCodingBridgeCommandsTable)
    .values({
      taskId: input.taskId ?? null,
      externalCommandId: input.externalCommandId,
      source,
      commandType: input.commandType ?? "INSTRUCTION",
      instruction: input.instruction,
      authorityJson: input.authority ?? {},
      metadataJson,
    })
    .returning();
  if (!command) throw new Error("Failed to persist bridge command");

  stage = "ACK_INSERT_FAILED";
  await db.insert(aiCodingBridgeResponsesTable).values({
    commandId: command.id,
    taskId: command.taskId,
    kind: "ACK",
    message: renderReplyTemplate(replyTemplates,
      input.assignedClientId ? "JOB_QUEUED" : "JOB_RECEIVED", {
        job_id: String(command.id), status: String(command.status),
        worker: input.assignedClientId ?? "AI Core",
      }) ?? (input.assignedClientId
      ? `Command queued for ${input.assignedClientId} by AI Core.`
      : "Command received by AI Core."),
    checkpointJson: { status: command.status },
  });

  stage = "EVENT_PUBLISH_FAILED";
  publishSafe({
    eventType: "coding.bridge.command.received",
    sourceModule: "coding-control-bridge",
    sourceId: command.id,
    correlationId: command.id,
    payload: {
      commandId: command.id,
      taskId: command.taskId,
      commandType: command.commandType,
      assignedClientId: input.assignedClientId ?? null,
    },
  });

  stage = "WORKER_DISPATCH_FAILED";
  if (input.assignedClientId) {
    // Notification is an optimization: a persisted command must remain claimable
    // even when the external event transport is temporarily unavailable.
    try {
      await notifyExternalAgentWork(input.assignedClientId, command.id);
    } catch (error) {
      console.error("[coding-bridge] work notification failed after persistence", {
        commandId: command.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    void ensureGcpCodingWorkerStarted().catch(() => undefined);
  }

  return { command, created: true };
  } catch (error) {
    console.error("[coding-bridge] submission stage failed", { stage, error: error instanceof Error ? error.message : String(error) });
    const wrapped = new Error("Coding bridge submission failed at " + stage);
    Object.assign(wrapped, { bridgeStage: stage });
    throw wrapped;
  }
}

async function deliverCodingBridgeWhatsappNotification(input: {
  responseId: string;
  commandId: string;
  taskId?: string | null;
  kind: "ACK" | "PROGRESS" | "CHECKPOINT" | "BLOCKER" | "COMPLETED" | "FAILED";
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  eventTimestamp?: string | Date | null;
}): Promise<void> {
  const dispatch = await notifyCodingBridgeResponse({
    ...input,
    eventTimestamp: input.eventTimestamp ?? null,
  });
  const delivery =
    dispatch.status === "queued"
      ? await waitForCodingWhatsappDelivery(dispatch.messageId, {
          timeoutMs: 45_000,
          pollIntervalMs: 1_000,
        })
      : null;

  const [current] = await db
    .select({ metadataJson: aiCodingBridgeResponsesTable.metadataJson })
    .from(aiCodingBridgeResponsesTable)
    .where(eq(aiCodingBridgeResponsesTable.id, input.responseId))
    .limit(1);

  await db
    .update(aiCodingBridgeResponsesTable)
    .set({
      metadataJson: {
        ...(isRecord(current?.metadataJson) ? current.metadataJson : {}),
        whatsappNotification: {
          dispatch,
          delivery,
          auditedAt: new Date().toISOString(),
        },
      },
    })
    .where(eq(aiCodingBridgeResponsesTable.id, input.responseId));
}

export async function appendCodingBridgeResponse(input: {
  commandId: string;
  taskId?: string | null;
  kind:
    | "ACK"
    | "PROGRESS"
    | "CHECKPOINT"
    | "BLOCKER"
    | "COMPLETED"
    | "FAILED";
  message: string;
  checkpoint?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  await ensureCodingControlBridgeTables();
  const checkpointJson = input.checkpoint ?? {};
  const metadataJson = input.metadata ?? {};

  let created = true;
  let response;

  if (isIdempotentCodingBridgeLifecycleKind(input.kind)) {
    const persisted = await db.transaction(async (tx) => {
      // Concurrent autonomous cycles can report the same lifecycle transition
      // within milliseconds. Serialize identical lifecycle writes by
      // command/task/kind, then reuse the existing durable response when the
      // message and checkpoint are identical. Returning the existing row also
      // prevents duplicate WA, Inbox, GitHub and MCP fan-out below.
      const lockKey =
        `coding-bridge-lifecycle:${input.commandId}:${input.taskId ?? "none"}:${input.kind}`;
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`,
      );

      const taskPredicate = input.taskId
        ? eq(aiCodingBridgeResponsesTable.taskId, input.taskId)
        : isNull(aiCodingBridgeResponsesTable.taskId);

      const [existing] = await tx
        .select()
        .from(aiCodingBridgeResponsesTable)
        .where(
          and(
            eq(aiCodingBridgeResponsesTable.commandId, input.commandId),
            taskPredicate,
            eq(aiCodingBridgeResponsesTable.kind, input.kind),
            eq(aiCodingBridgeResponsesTable.message, input.message),
            sql`${aiCodingBridgeResponsesTable.checkpointJson} = ${JSON.stringify(checkpointJson)}::jsonb`,
          ),
        )
        .orderBy(desc(aiCodingBridgeResponsesTable.createdAt))
        .limit(1);

      if (existing) {
        return { response: existing, created: false };
      }

      const [inserted] = await tx
        .insert(aiCodingBridgeResponsesTable)
        .values({
          commandId: input.commandId,
          taskId: input.taskId ?? null,
          kind: input.kind,
          message: input.message,
          checkpointJson,
          metadataJson,
        })
        .returning();
      if (!inserted) throw new Error("Failed to persist bridge response");
      return { response: inserted, created: true };
    });

    response = persisted.response;
    created = persisted.created;
  } else {
    const [inserted] = await db
      .insert(aiCodingBridgeResponsesTable)
      .values({
        commandId: input.commandId,
        taskId: input.taskId ?? null,
        kind: input.kind,
        message: input.message,
        checkpointJson,
        metadataJson,
      })
      .returning();
    if (!inserted) throw new Error("Failed to persist bridge response");
    response = inserted;
  }

  if (!created) return response;

  return publishPersistedCodingBridgeResponse(response,input);
}

// Publish after transactional persistence. The durable response remains queryable
// for reconciliation even if a process exits before this fan-out finishes.
async function publishPersistedCodingBridgeResponse(response: typeof aiCodingBridgeResponsesTable.$inferSelect,input: {
  commandId:string; taskId?:string|null; kind:"ACK"|"PROGRESS"|"CHECKPOINT"|"BLOCKER"|"COMPLETED"|"FAILED";
  message:string; checkpoint?:Record<string,unknown>; metadata?:Record<string,unknown>;
}) {
  publishSafe({
    eventType: "coding.bridge.response.created",
    sourceModule: "coding-control-bridge",
    sourceId: response.id,
    correlationId: input.commandId,
    payload: {
      responseId: response.id,
      commandId: input.commandId,
      kind: input.kind,
    },
  });

  void deliverCodingBridgeWhatsappNotification({
    responseId: response.id,
    commandId: input.commandId,
    taskId: input.taskId ?? null,
    kind: input.kind,
    message: input.message,
    checkpoint: input.checkpoint ?? {},
    metadata: input.metadata ?? {},
    eventTimestamp: response.createdAt,
  }).catch(() => undefined);

  void enqueueAiCoreChatInboxMessage({
    responseId: response.id,
    commandId: input.commandId,
    taskId: input.taskId ?? null,
    kind: input.kind,
    message: input.message,
    checkpoint: input.checkpoint ?? {},
    metadata: input.metadata ?? {},
  }).catch(() => undefined);

  if (
    input.kind === "COMPLETED" ||
    input.kind === "FAILED" ||
    input.kind === "BLOCKER"
  ) {
    void syncTerminalBridgeResponseToGitHub({
      responseId: response.id,
      commandId: input.commandId,
      taskId: input.taskId ?? null,
      kind: input.kind,
    }).catch(() => undefined);
    void enqueueAiCoreMcpBridgeLifecycleEvent({
      responseId: response.id,
      taskId: input.taskId ?? null,
      kind: input.kind,
      message: input.message,
      checkpoint: input.checkpoint ?? {},
      metadata: input.metadata ?? {},
      createdAt: response.createdAt,
    }).catch(() => undefined);
  }

  return response;
}

export async function listPendingCodingBridgeResponses(limit = 50) {
  await ensureCodingControlBridgeTables();
  return db
    .select()
    .from(aiCodingBridgeResponsesTable)
    .where(isNull(aiCodingBridgeResponsesTable.acknowledgedAt))
    .orderBy(asc(aiCodingBridgeResponsesTable.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
}

export async function acknowledgeCodingBridgeResponse(id: string) {
  await ensureCodingControlBridgeTables();
  const [row] = await db
    .update(aiCodingBridgeResponsesTable)
    .set({ acknowledgedAt: new Date() })
    .where(eq(aiCodingBridgeResponsesTable.id, id))
    .returning();
  return row ?? null;
}

/** Only ACK events belonging to the explicitly addressed ChatGPT conversation.
 * A browser-visible message or a worker completion alone is not a bridge event. */
export async function acknowledgeCodingBridgeResponseForConversation(input: {
  responseId: string;
  conversationId: string;
}) {
  await ensureCodingControlBridgeTables();
  // A receiver-side MCP ACK is durable evidence of delivery to the subscribed
  // conversation. It is not proof of browser automation or other external E2E paths.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${input.conversationId}, true)`);
    return tx.execute(sql`
    WITH acknowledged AS (
      UPDATE ai_platform.ai_coding_bridge_responses AS response
      SET acknowledged_at = NOW()
      FROM ai_platform.ai_coding_bridge_commands AS command
      WHERE response.command_id = command.id
        AND response.id = ${input.responseId}::uuid
        AND command.metadata_json ->> 'conversationId' = ${input.conversationId}::text
        AND response.acknowledged_at IS NULL
      RETURNING response.id, response.command_id, response.acknowledged_at
    ),
    marked AS (
      UPDATE ai_platform.ai_coding_bridge_commands AS command
      SET metadata_json = COALESCE(command.metadata_json, '{}'::jsonb) ||
        jsonb_build_object(
          'deliveryCode', 'DELIVERY_CONFIRMED',
          'e2eCode', 'MCP_ACK_VERIFIED',
          'mcpAckResponseId', acknowledged.id::text,
          'mcpAckConversationId', ${input.conversationId}::text,
          'mcpAcknowledgedAt', acknowledged.acknowledged_at::text
        ),
        updated_at = NOW()
      FROM acknowledged
      WHERE command.id = acknowledged.command_id
      RETURNING command.id
    )
    SELECT id FROM marked
    `);
  });
  return (result.rows ?? []).length > 0;
}

export type VerifiedMcpHandshakeEvidence = {
  commandId: string;
  responseId: string;
  ownerChannel: string;
  targetConversationId: string;
  workerId: string;
  eventId: string;
  acknowledgedAt: string;
  browserWakeVerified: true;
  conversationAckVerified: true;
  wakeBinding?: DevWakeBinding;
};

type McpHandshakeEvidenceRow = {
  commandId: unknown;
  commandReceivedAt: unknown;
  commandMetadata: unknown;
  responseId: unknown;
  responseMetadata: unknown;
  responseCreatedAt: unknown;
  acknowledgedAt: unknown;
};

/**
 * Revalidates the durable browser receipt before surfacing global handshake state.
 * The MCP ACK marker alone is insufficient: the same row must still carry a
 * trusted worker identity, exact owner/target/event bindings and a valid
 * Ed25519 assistant attestation.
 */
export function verifyMcpHandshakeEvidenceRow(
  ownerChannel: string,
  row: McpHandshakeEvidenceRow,
  publicKeyDerBase64?: string,
): VerifiedMcpHandshakeEvidence | null {
  if (!/^ai-engine-oauth:[a-f0-9]{64}$/.test(ownerChannel) ||
      !isRecord(row.commandMetadata) || !isRecord(row.responseMetadata)) return null;
  const command = row.commandMetadata;
  const response = row.responseMetadata;
  const workerId = command["assignedClientId"];
  const targetConversationId = command["targetConversationId"];
  const eventId = command["eventId"];
  if (!isDevContinuityWakeWorker(workerId) ||
      command["completedBy"] !== workerId ||
      command["conversationId"] !== ownerChannel ||
      command["mcpAckConversationId"] !== ownerChannel ||
      command["capability"] !== "chatgpt:wake" ||
      command["explicitWorkerTarget"] !== true ||
      command["deliveryCode"] !== "DELIVERY_CONFIRMED" ||
      command["e2eCode"] !== "MCP_ACK_VERIFIED" ||
      typeof targetConversationId !== "string" ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(targetConversationId) ||
      typeof eventId !== "string" || !/^[a-f0-9]{64}$/.test(eventId) ||
      response["deliveryCode"] !== "DELIVERY_CONFIRMED" ||
      response["e2eCode"] !== "E2E_VERIFIED" ||
      response["browserConfirmed"] !== true ||
      response["browserPairingVerified"] !== true ||
      response["chatgptSubmitted"] !== true ||
      response["verifiedAssistantReply"] !== true ||
      response["conversationId"] !== targetConversationId ||
      response["eventId"] !== eventId ||
      response["exitCode"] !== 0 ||
      typeof row.commandId !== "string" ||
      typeof row.responseId !== "string" ||
      command["mcpAckResponseId"] !== row.responseId) return null;

  const commandReceivedAt = row.commandReceivedAt instanceof Date
    ? row.commandReceivedAt.toISOString() : String(row.commandReceivedAt ?? "");
  const responseCreatedAt = row.responseCreatedAt instanceof Date
    ? row.responseCreatedAt.toISOString() : String(row.responseCreatedAt ?? "");
  const acknowledgedAt = row.acknowledgedAt instanceof Date
    ? row.acknowledgedAt.toISOString() : String(row.acknowledgedAt ?? "");
  if (!Number.isFinite(Date.parse(commandReceivedAt)) ||
      !Number.isFinite(Date.parse(responseCreatedAt)) ||
      !Number.isFinite(Date.parse(acknowledgedAt))) return null;

  const attestation = verifyDevWakeCommandReceipt({
    metadata: command,
    details: response,
    notBefore: commandReceivedAt,
    receivedAt: responseCreatedAt,
    publicKeyDerBase64: publicKeyDerBase64 ?? devAssistantPublicKeyForWorker(workerId),
  });
  if (!attestation.verified) return null;

  return {
    commandId: row.commandId,
    responseId: row.responseId,
    ownerChannel,
    targetConversationId,
    workerId,
    eventId,
    acknowledgedAt,
    browserWakeVerified: true,
    conversationAckVerified: true,
    ...(readDevWakeBinding(command["wakeBinding"]) ? { wakeBinding: readDevWakeBinding(command["wakeBinding"])! } : {}),
  };
}

export async function getVerifiedMcpHandshakeEvidenceForConversation(
  ownerChannel: string,
  options?: { requestHost?: string; publicKeyDerBase64?: string },
): Promise<VerifiedMcpHandshakeEvidence | null> {
  const requestHost = options?.requestHost?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  const trustedDevHost = requestHost === "dev-aicore.cstlogistic.co.id" || requestHost === "dev.cstlogistic.co.id";
  const localDevRuntime = process.env["APP_ENV"] === "development" && process.env["NODE_ENV"] !== "production";
  if ((!localDevRuntime && !trustedDevHost) ||
      !/^ai-engine-oauth:[a-f0-9]{64}$/.test(ownerChannel)) return null;
  const config = await loadDevWakeRuntimeConfig(options?.requestHost).catch(() => null);
  if (!config?.enabled) return null;
  await ensureCodingControlBridgeTables();
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${ownerChannel}, true)`);
    return tx.execute(sql`
      SELECT
        command.id AS command_id,
        command.received_at AS command_received_at,
        command.metadata_json AS command_metadata_json,
        response.id AS response_id,
        response.metadata_json AS response_metadata_json,
        response.created_at AS response_created_at,
        response.acknowledged_at AS acknowledged_at
      FROM ai_platform.ai_coding_bridge_commands AS command
      JOIN ai_platform.ai_coding_bridge_responses AS response
        ON response.command_id = command.id
       AND response.id::text = command.metadata_json ->> 'mcpAckResponseId'
      WHERE command.source = 'ai-core'
        AND command.command_type = 'EXTERNAL_AGENT_WORK'
        AND command.status = 'COMPLETED'
        AND command.metadata_json ->> 'conversationId' = ${ownerChannel}::text
        AND command.metadata_json ->> 'mcpAckConversationId' = ${ownerChannel}::text
        AND command.metadata_json ->> 'e2eCode' = 'MCP_ACK_VERIFIED'
        AND response.acknowledged_at IS NOT NULL
      ORDER BY response.acknowledged_at DESC
      LIMIT 5
    `);
  });
  for (const raw of result.rows ?? []) {
    const row = raw as Record<string, unknown>;
    const metadata = row["command_metadata_json"];
    if (!isRecord(metadata) || typeof metadata["targetConversationId"] !== "string") continue;
    const target = resolveConfiguredDevWakeTarget(config, { ownerChannel, targetConversationId: metadata["targetConversationId"] });
    if (!target || !commandMatchesDevWakeTarget(metadata, target)) continue;
    const verified = verifyMcpHandshakeEvidenceRow(ownerChannel, {
      commandId: row["command_id"],
      commandReceivedAt: row["command_received_at"],
      commandMetadata: row["command_metadata_json"],
      responseId: row["response_id"],
      responseMetadata: row["response_metadata_json"],
      responseCreatedAt: row["response_created_at"],
      acknowledgedAt: row["acknowledged_at"],
    }, options?.publicKeyDerBase64 ?? devAssistantPublicKeyForWorker(target.workerId) ?? (target.workerId === DEV_WAKE_DELL_WORKER ? config.attestationPublicKeyDerB64 : undefined));
    if (verified) return verified;
  }
  return null;
}
export async function listPendingCodingBridgeResponsesForConversation(input: {
  conversationId: string;
  limit?: number;
}) {
  await ensureCodingControlBridgeTables();
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${input.conversationId}, true)`);
    return tx.execute(sql`
    SELECT
      response.id,
      response.command_id,
      response.task_id,
      response.kind,
      response.message,
      response.checkpoint_json,
      response.metadata_json,
      response.created_at
    FROM ai_platform.ai_coding_bridge_responses AS response
    JOIN ai_platform.ai_coding_bridge_commands AS command
      ON command.id = response.command_id
    WHERE response.acknowledged_at IS NULL
      AND command.metadata_json ->> 'conversationId' = ${input.conversationId}::text
    ORDER BY response.created_at ASC
    LIMIT ${limit}::integer
    `);
  });

  return (result.rows ?? []).map((row) => ({
    id: String(row["id"]),
    commandId: String(row["command_id"]),
    taskId: row["task_id"] ? String(row["task_id"]) : null,
    kind: String(row["kind"] ?? ""),
    message: String(row["message"] ?? ""),
    checkpoint:
      isRecord(row["checkpoint_json"]) ? row["checkpoint_json"] : {},
    metadata:
      isRecord(row["metadata_json"]) ? row["metadata_json"] : {},
    createdAt: row["created_at"] ?? null,
  }));
}

export async function subscribeCodingBridgeConversation(input: {
  conversationId: string;
  eventTypes?: string[];
  leaseSeconds?: number;
}) {
  return renewCodingBridgePresence({
    clientId: `chatgpt:${input.conversationId}`,
    source: "chatgpt-mcp",
    leaseSeconds: input.leaseSeconds ?? DEFAULT_CHATGPT_EVENT_LEASE_SECONDS,
    maxLeaseSeconds: MAX_CHATGPT_EVENT_LEASE_SECONDS,
    metadata: {
      conversationId: input.conversationId,
      eventTypes: input.eventTypes ?? ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"],
      autoRenewUntilTerminal: true,
      leasePolicy: "chatgpt-terminal-events",
    },
  });
}

export async function unsubscribeCodingBridgeConversation(
  conversationId: string,
): Promise<boolean> {
  await ensureCodingControlBridgeTables();
  const result = await db.execute(sql`
    UPDATE ai_platform.ai_coding_bridge_presence
    SET lease_expires_at = NOW(),
        metadata_json = metadata_json || jsonb_build_object('unsubscribedAt', NOW()::text),
        updated_at = NOW()
    WHERE client_id = ${`chatgpt:${conversationId}`}::text
    RETURNING client_id
  `);
  return Boolean(result.rows?.[0]);
}

export async function claimCodingBridgeCommand(input: {
  clientId: string;
  leaseSeconds?: number;
}) {
  await ensureCodingControlBridgeTables();
  const leaseSeconds = boundedLeaseSeconds(
    input.leaseSeconds,
    DEFAULT_COMMAND_LEASE_SECONDS,
  );

  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id, metadata_json ->> 'assignedClientId' AS assigned_client_id
      FROM ai_platform.ai_coding_bridge_commands
      WHERE metadata_json ->> 'assignedClientId' = ${input.clientId}::text
        AND command_type <> 'DEV_CONTINUITY_WATCH'
        AND CASE WHEN command_type = 'EXTERNAL_AGENT_WORK'
          AND metadata_json ->> 'capability' = 'chatgpt:wake'
          AND metadata_json ? 'devContinuity'
          THEN COALESCE(
            (metadata_json #>> '{devContinuity,expiresAt}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'
            AND (metadata_json #>> '{devContinuity,expiresAt}') >
              to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), false)
          ELSE true END
        AND (
          status = 'RECEIVED'
          OR (
            status = 'PROCESSING'
            AND COALESCE(
              NULLIF(metadata_json ->> 'claimLeaseExpiresAt', '')::timestamptz,
              to_timestamp(0)
            ) <= NOW()
          )
        )
      ORDER BY received_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ai_platform.ai_coding_bridge_commands AS command
    SET status = 'PROCESSING',
        processed_at = COALESCE(command.processed_at, NOW()),
        metadata_json = command.metadata_json || jsonb_build_object(
          'claimToken', gen_random_uuid()::text,
          'claimLeaseExpiresAt', (NOW() + (${leaseSeconds}::integer * INTERVAL '1 second'))::text,
          'claimedBy', candidate.assigned_client_id,
          'claimedAt', NOW()::text
        ),
        updated_at = NOW()
    FROM candidate
    WHERE command.id = candidate.id
    RETURNING
      command.id,
      command.task_id,
      command.external_command_id,
      command.command_type,
      command.instruction,
      command.authority_json,
      command.metadata_json,
      command.status,
      command.received_at
  `);

  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const metadata = isRecord(row["metadata_json"]) ? row["metadata_json"] : {};
  const claimToken =
    typeof metadata["claimToken"] === "string" ? metadata["claimToken"] : "";
  if (!claimToken) {
    throw new Error("Claimed bridge command did not contain a claim token");
  }

  return {
    commandId: String(row["id"]),
    taskId: row["task_id"] ? String(row["task_id"]) : null,
    externalCommandId: String(row["external_command_id"] ?? ""),
    commandType: String(row["command_type"] ?? "INSTRUCTION"),
    instruction: String(row["instruction"] ?? ""),
    authority: isRecord(row["authority_json"]) ? row["authority_json"] : {},
    metadata,
    status: String(row["status"] ?? "PROCESSING"),
    receivedAt: row["received_at"] ?? null,
    claimToken,
    leaseSeconds,
  };
}

export async function renewCodingBridgeCommandClaim(input: {
  clientId: string;
  commandId: string;
  claimToken: string;
  leaseSeconds?: number;
}): Promise<boolean> {
  await ensureCodingControlBridgeTables();
  const leaseSeconds = boundedLeaseSeconds(
    input.leaseSeconds,
    DEFAULT_COMMAND_LEASE_SECONDS,
  );

  const result = await db.execute(sql`
    UPDATE ai_platform.ai_coding_bridge_commands
    SET metadata_json = metadata_json || jsonb_build_object(
          'claimLeaseExpiresAt', (NOW() + (${leaseSeconds}::integer * INTERVAL '1 second'))::text
        ),
        updated_at = NOW()
    WHERE id = ${input.commandId}::uuid
      AND status = 'PROCESSING'
      AND command_type <> 'DEV_CONTINUITY_WATCH'
      AND metadata_json ->> 'assignedClientId' = ${input.clientId}::text
      AND metadata_json ->> 'claimToken' = ${input.claimToken}::text
    RETURNING id
  `);

  return Boolean(result.rows?.[0]);
}

/**
 * A worker process exit is not proof of a successful browser E2E test.
 * Only the narrow case where the worker itself explicitly reports the
 * browser/callback test could not run is downgraded, avoiding accidental
 * failure of unrelated external-agent jobs.
 */
export function hasUnverifiedExternalBrowserCompletion(input: {
  message: string;
  details?: Record<string, unknown>;
}): boolean {
  const details = input.details ?? {};
  const text = input.message;
  const terminalReply = isRecord(details["terminalReply"])
    ? String(details["terminalReply"]["text"] ?? "")
    : "";
  const combined = [text, terminalReply].join("\n");
  const mentionsBrowserTest = /(?:chatgpt|browser)/i.test(combined);
  const explicitlyUnable = /(?:unable to perform|cannot perform|could not perform|do not support direct interaction|tidak dapat menjalankan|tidak bisa menjalankan)/i.test(combined);
  const deliveryMissing =
    details["sourceReplyDeliveryState"] === "missing" ||
    /["']?sourceReplyDeliveryState["']?\s*:\s*["']missing["']/i.test(text);
  return mentionsBrowserTest && explicitlyUnable && deliveryMissing;
}

export type EvidenceStatusCode =
  | "JOB_COMPLETED" | "RESULT_VERIFIED" | "DELIVERY_SUBMITTED"
  | "DELIVERY_CONFIRMED" | "CALLBACK_RECEIVED" | "E2E_VERIFIED"
  | "FAILED" | "UNKNOWN_UNVERIFIED";

/** A worker's own narrative is never a destination receipt. */
export function classifyBridgeCompletion(input: {
  status: "COMPLETED" | "FAILED";
  details?: Record<string, unknown>;
}): { statusCode: EvidenceStatusCode; deliveryCode: EvidenceStatusCode; e2eCode: EvidenceStatusCode } {
  if (input.status === "FAILED") {
    return { statusCode: "FAILED", deliveryCode: "UNKNOWN_UNVERIFIED", e2eCode: "UNKNOWN_UNVERIFIED" };
  }
  const details = input.details ?? {};
  // A direct, bounded read-only check can prove the result, but not callback delivery.
  const verifiedHostingerSsh = details["sshVerified"] === true &&
    details["mode"] === "ssh-readonly-hostinger" && details["exitCode"] === 0;
  // A bounded Windows hostname proof is local execution evidence only.
  // Callback delivery and chat reception still need independent ACKs.
  const verifiedPcHostname =
    details["mode"] === "model-free-hostname" &&
    details["runtime"] === "openclaw-pc" &&
    details["workerId"] === "openclaw-pc-worker" &&
    details["hostname"] === "Travelintrips" &&
    details["verified"] === true &&
    details["modelInvoked"] === false &&
    details["exitCode"] === 0;
  const verifiedResult = verifiedHostingerSsh || verifiedPcHostname;
  // The PC browser worker supplies a bounded proof of the ChatGPT reply,
  // not just a narrative or successful process exit. Keep unrelated jobs unverified.
  const verifiedBrowserReply =
    details["chatgptSubmitted"] === true &&
    details["verifiedAssistantReply"] === true &&
    details["exitCode"] === 0 &&
    typeof details["eventId"] === "string" &&
    /^[a-zA-Z0-9:_-]{8,160}$/.test(details["eventId"]) &&
    typeof details["conversationId"] === "string" &&
    /^[a-zA-Z0-9-]{30,64}$/.test(details["conversationId"]) &&
    typeof details["evidenceFingerprint"] === "string" &&
    /^[a-f0-9]{64}$/.test(details["evidenceFingerprint"]) &&
    typeof details["verifiedAt"] === "string" &&
    !Number.isNaN(Date.parse(details["verifiedAt"]));
  return {
    statusCode: verifiedResult ? "RESULT_VERIFIED" : "JOB_COMPLETED",
    deliveryCode: verifiedBrowserReply ? "DELIVERY_CONFIRMED" : "UNKNOWN_UNVERIFIED",
    e2eCode: verifiedBrowserReply ? "E2E_VERIFIED" : "UNKNOWN_UNVERIFIED",
  };
}

export async function completeCodingBridgeCommand(input: {
  clientId: string;
  commandId: string;
  claimToken: string;
  status: "COMPLETED" | "FAILED";
  message: string;
  details?: Record<string, unknown>;
  requestHost?: string;
}) {
  await ensureCodingControlBridgeTables();
  const details = input.details ?? {};
  // Prevent a successful process exit from masquerading as a passed E2E.
  const verifiedStatus = input.status === "COMPLETED" &&
    hasUnverifiedExternalBrowserCompletion({ message: input.message, details })
    ? "FAILED"
    : input.status;
  const evidence = classifyBridgeCompletion({ status: verifiedStatus, details });
  const encoded = JSON.stringify(details);
  if (encoded.length > 64_000) {
    throw new Error("Bridge command result details exceed 64000 bytes");
  }
  const wakeConfig = (input.clientId === DEV_WAKE_DELL_WORKER || input.clientId === DEV_WAKE_DEFAULT_WORKER || input.clientId === DEV_WAKE_PCHP_WORKER || input.clientId === DEV_WAKE_PC2_WORKER || input.clientId === DEV_WAKE_VMSC_WORKER)
    ? await loadDevWakeRuntimeConfig(input.requestHost).catch(() => null) : null;

  // Command terminal status and durable response must commit together.
  // If insert fails, the PROCESSING claim remains retryable after rollback.
  const persisted = await db.transaction(async (tx) => {
  const result = await tx.execute(sql`
    UPDATE ai_platform.ai_coding_bridge_commands
    SET status = ${verifiedStatus},
        processed_at = NOW(),
        metadata_json = (
          metadata_json - 'claimToken' - 'claimLeaseExpiresAt'
        ) || jsonb_build_object(
          'completedBy', ${input.clientId}::text,
          'completedAt', NOW()::text,
          'statusCode', ${evidence.statusCode}::text,
          'deliveryCode', ${evidence.deliveryCode}::text,
          'e2eCode', ${evidence.e2eCode}::text
        ),
        updated_at = NOW()
    WHERE id = ${input.commandId}::uuid
      AND status = 'PROCESSING'
      AND command_type <> 'DEV_CONTINUITY_WATCH'
      AND metadata_json ->> 'assignedClientId' = ${input.clientId}::text
      AND metadata_json ->> 'claimToken' = ${input.claimToken}::text
    RETURNING id, task_id, source, command_type, metadata_json, received_at
  `);
    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    // The terminal UPDATE holds the claim row lock. Reject a forged or downgraded
    // browser receipt inside this transaction, before either completion can commit.
    if (input.status === "COMPLETED") {
      const metadata = row["metadata_json"];
      const wakeBinding = isRecord(metadata) ? readDevWakeBinding(metadata["wakeBinding"]) : null;
      const mustVerifyWake = input.clientId === DEV_WAKE_DELL_WORKER || wakeBinding !== null;
      if (mustVerifyWake) {
        const targetId = isRecord(metadata) ? metadata["targetConversationId"] : null;
        const owner = isRecord(metadata) ? metadata["conversationId"] : null;
        const target = wakeConfig && typeof targetId === "string" && typeof owner === "string"
          ? resolveConfiguredDevWakeTarget(wakeConfig, {
              ownerChannel: owner,
              targetConversationId: targetId,
              ...(wakeBinding ? { bindingFingerprint: wakeBinding.bindingFingerprint } : {}),
            })
          : null;
        if (row["source"] !== "ai-core" || row["command_type"] !== "EXTERNAL_AGENT_WORK" ||
            !target || !commandMatchesDevWakeTarget(metadata, target)) {
          throw new Error("DEV_CHATGPT_WAKE_CALLBACK_BINDING_INVALID");
        }
        const receivedAt = row["received_at"] instanceof Date ? row["received_at"].toISOString() : String(row["received_at"] ?? "");
        const publicKeyDerBase64 = devAssistantPublicKeyForWorker(input.clientId) ||
          (input.clientId === DEV_WAKE_DELL_WORKER ? wakeConfig?.attestationPublicKeyDerB64 : undefined);
        const receipt = verifyDevWakeCommandReceipt({ metadata, details, notBefore: receivedAt,
          receivedAt: new Date().toISOString(), publicKeyDerBase64 });
        if (!receipt.verified) throw new Error("DEV_CHATGPT_WAKE_CALLBACK_ATTESTATION_INVALID");
      }
    }
    const taskId=row["task_id"] ? String(row["task_id"]) : null;
    const [response]=await tx.insert(aiCodingBridgeResponsesTable).values({
      commandId:input.commandId,taskId,kind:verifiedStatus,message:input.message,
      checkpointJson:{status:verifiedStatus,statusCode:evidence.statusCode,deliveryCode:evidence.deliveryCode,e2eCode:evidence.e2eCode,clientId:input.clientId},
      metadataJson:{...details,...evidence},
    }).returning();
    if(!response)throw new Error("Failed to persist terminal bridge response");
    return {response,taskId,command:row};
  });
  if(!persisted)return null;
  const continuityResult = devContinuityResultFromCommittedCommand({
    id: persisted.command["id"], source: persisted.command["source"],
    commandType: persisted.command["command_type"], metadata: persisted.command["metadata_json"],
    authenticatedWorkerId: input.clientId, status: verifiedStatus, details,
  });
  if (continuityResult) await emitDevContinuityWakeResult(continuityResult);
  const response=await publishPersistedCodingBridgeResponse(persisted.response,{
    commandId:input.commandId,taskId:persisted.taskId,kind:verifiedStatus,message:input.message,
    checkpoint:{status:verifiedStatus,statusCode:evidence.statusCode,deliveryCode:evidence.deliveryCode,e2eCode:evidence.e2eCode,clientId:input.clientId},
    metadata:{...details,...evidence},
  });

  return { commandId: input.commandId, status: verifiedStatus, ...evidence, response };
}

export async function getExternalAgentDiagnostic(input: {
  commandId?: string | null;
  clientIdContains?: string | null;
} = {}) {
  await ensureCodingControlBridgeTables();

  const commandId = input.commandId?.trim() || null;
  const clientIdContains = (input.clientIdContains?.trim() || "openclaw").toLowerCase();

  const result = commandId
    ? await db.execute(sql`
        SELECT
          command.id,
          command.external_command_id,
          command.status,
          command.metadata_json,
          command.updated_at,
          response.id AS response_id,
          response.kind AS response_kind,
          response.message AS response_message,
          response.checkpoint_json AS response_checkpoint_json,
          response.metadata_json AS response_metadata_json,
          response.created_at AS response_created_at
        FROM ai_platform.ai_coding_bridge_commands AS command
        LEFT JOIN LATERAL (
          SELECT *
          FROM ai_platform.ai_coding_bridge_responses AS response
          WHERE response.command_id = command.id
          ORDER BY response.created_at DESC
          LIMIT 1
        ) AS response ON TRUE
        WHERE command.id = ${commandId}::uuid
        LIMIT 1
      `)
    : await db.execute(sql`
        SELECT
          command.id,
          command.external_command_id,
          command.status,
          command.metadata_json,
          command.updated_at,
          response.id AS response_id,
          response.kind AS response_kind,
          response.message AS response_message,
          response.checkpoint_json AS response_checkpoint_json,
          response.metadata_json AS response_metadata_json,
          response.created_at AS response_created_at
        FROM ai_platform.ai_coding_bridge_commands AS command
        LEFT JOIN LATERAL (
          SELECT *
          FROM ai_platform.ai_coding_bridge_responses AS response
          WHERE response.command_id = command.id
          ORDER BY response.created_at DESC
          LIMIT 1
        ) AS response ON TRUE
        WHERE command.status = 'FAILED'
          AND LOWER(COALESCE(command.metadata_json ->> 'assignedClientId', ''))
              LIKE '%' || ${clientIdContains}::text || '%'
        ORDER BY command.updated_at DESC
        LIMIT 1
      `);

  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    commandId: String(row["id"]),
    externalCommandId: String(row["external_command_id"] ?? ""),
    status: String(row["status"] ?? ""),
    assignedClientId:
      isRecord(row["metadata_json"]) &&
      typeof row["metadata_json"]["assignedClientId"] === "string"
        ? row["metadata_json"]["assignedClientId"]
        : null,
    updatedAt: row["updated_at"] ?? null,
    latestResponse: row["response_id"]
      ? {
          id: String(row["response_id"]),
          kind: String(row["response_kind"] ?? ""),
          message: String(row["response_message"] ?? ""),
          checkpoint: isRecord(row["response_checkpoint_json"])
            ? row["response_checkpoint_json"]
            : {},
          metadata: isRecord(row["response_metadata_json"])
            ? row["response_metadata_json"]
            : {},
          createdAt: row["response_created_at"] ?? null,
        }
      : null,
  };
}

/** Nonterminal callbacks remain visible while awaiting a worker or verified reply. */
export function classifyCallbackProcessingState(input: {
  status: string;
  metadata?: Record<string, unknown> | null;
}): "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" {
  if (input.status === "COMPLETED") return "COMPLETED";
  if (input.status === "FAILED" || input.status === "CANCELLED") return "FAILED";
  if (input.status === "PROCESSING" || input.status === "RUNNING") return "PROCESSING";
  return "QUEUED";
}

export async function getCodingBridgeCommandExecutionState(commandId: string) {
  await ensureCodingControlBridgeTables();
  const [command] = await db
    .select()
    .from(aiCodingBridgeCommandsTable)
    .where(eq(aiCodingBridgeCommandsTable.id, commandId))
    .limit(1);
  if (!command) return null;

  const [latestResponse] = await db
    .select()
    .from(aiCodingBridgeResponsesTable)
    .where(eq(aiCodingBridgeResponsesTable.commandId, commandId))
    .orderBy(desc(aiCodingBridgeResponsesTable.createdAt))
    .limit(1);

  return {
    command,
    latestResponse: latestResponse ?? null,
    // Derived only from durable command state, never assumed from a green CI.
    callbackProcessingState: classifyCallbackProcessingState({ status: command.status }),
  };
}

export async function renewCodingBridgePresence(input: {
  clientId: string;
  source?: string;
  leaseSeconds?: number;
  maxLeaseSeconds?: number;
  metadata?: Record<string, unknown>;
}) {
  await ensureCodingControlBridgeTables();
  const seconds = boundedLeaseSeconds(
    input.leaseSeconds,
    DEFAULT_LEASE_SECONDS,
    input.maxLeaseSeconds ?? MAX_LEASE_SECONDS,
  );
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + seconds * 1000);
  const leaseToken = randomUUID();
  const insertValues = {
    clientId: input.clientId,
    source: input.source ?? "chatgpt",
    leaseToken,
    leaseExpiresAt,
    lastSeenAt: now,
    metadataJson: input.metadata ?? {},
  };
  const updateValues = {
    source: input.source ?? "chatgpt",
    leaseToken,
    leaseExpiresAt,
    lastSeenAt: now,
    metadataJson: input.metadata ?? {},
    updatedAt: now,
  };
  const [row] = await db
    .insert(aiCodingBridgePresenceTable)
    .values(insertValues)
    .onConflictDoUpdate({
      target: aiCodingBridgePresenceTable.clientId,
      set: updateValues,
    })
    .returning();
  if (!row) throw new Error("Failed to renew bridge presence");
  return row;
}

export async function getCodingBridgeAvailability(clientId: string) {
  await ensureCodingControlBridgeTables();
  const [row] = await db
    .select()
    .from(aiCodingBridgePresenceTable)
    .where(eq(aiCodingBridgePresenceTable.clientId, clientId))
    .limit(1);
  if (!row) {
    return {
      clientId,
      state: "UNAVAILABLE" as const,
      leaseExpiresAt: null,
      lastSeenAt: null,
    };
  }
  return {
    clientId,
    state:
      row.leaseExpiresAt.getTime() > Date.now()
        ? ("ACTIVE" as const)
        : ("UNAVAILABLE" as const),
    leaseExpiresAt: row.leaseExpiresAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/** Read-only correlated timeline; never exposes other bridge sources or tenants. */
export async function getAiTaskBridgeTimeline(externalCommandId: string) {
  await ensureCodingControlBridgeTables();
  const [command] = await db.select().from(aiCodingBridgeCommandsTable).where(
    and(eq(aiCodingBridgeCommandsTable.source, "ai-task-hub"), eq(aiCodingBridgeCommandsTable.externalCommandId, externalCommandId))
  ).limit(1);
  if (!command) return null;
  const responses = await db.select({
    id: aiCodingBridgeResponsesTable.id,
    kind: aiCodingBridgeResponsesTable.kind,
    message: aiCodingBridgeResponsesTable.message,
    checkpoint: aiCodingBridgeResponsesTable.checkpointJson,
    metadata: aiCodingBridgeResponsesTable.metadataJson,
    createdAt: aiCodingBridgeResponsesTable.createdAt,
  }).from(aiCodingBridgeResponsesTable)
    .where(eq(aiCodingBridgeResponsesTable.commandId, command.id))
    .orderBy(asc(aiCodingBridgeResponsesTable.createdAt)).limit(100);
  return {
    commandId: command.id,
    status: command.status,
    commandMetadata: command.metadataJson,
    responses,
  };
}


/** Read-only AI Task ChatGPT wake timeline, scoped to the exact DEV correlation. */
export async function getAiTaskChatGptBridgeTimeline(commandId: string, correlationId: string) {
  await ensureCodingControlBridgeTables();
  const [command] = await db.select().from(aiCodingBridgeCommandsTable).where(and(
    eq(aiCodingBridgeCommandsTable.id, commandId),
    eq(aiCodingBridgeCommandsTable.source, "ai-core"),
    eq(aiCodingBridgeCommandsTable.commandType, "EXTERNAL_AGENT_WORK"),
    sql`${aiCodingBridgeCommandsTable.metadataJson} ->> 'correlationId' = ${correlationId}::text`,
    sql`${aiCodingBridgeCommandsTable.metadataJson} ->> 'capability' = 'chatgpt:wake'`,
    sql`COALESCE((${aiCodingBridgeCommandsTable.metadataJson} ->> 'devOnly')::boolean, false) = true`,
  )).limit(1);
  if (!command) return null;
  const responses = await db.select({
    id: aiCodingBridgeResponsesTable.id,
    kind: aiCodingBridgeResponsesTable.kind,
    message: aiCodingBridgeResponsesTable.message,
    checkpoint: aiCodingBridgeResponsesTable.checkpointJson,
    metadata: aiCodingBridgeResponsesTable.metadataJson,
    createdAt: aiCodingBridgeResponsesTable.createdAt,
  }).from(aiCodingBridgeResponsesTable)
    .where(eq(aiCodingBridgeResponsesTable.commandId, command.id))
    .orderBy(asc(aiCodingBridgeResponsesTable.createdAt)).limit(100);
  return {
    commandId: command.id,
    status: command.status,
    commandMetadata: command.metadataJson,
    responses,
  };
}