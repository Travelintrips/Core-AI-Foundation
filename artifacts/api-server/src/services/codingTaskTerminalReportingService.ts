import { and, desc, eq, sql } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingBridgeResponsesTable,
  aiCodingTasksTable,
  db,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  dispatchExternalAgentWork,
  OPENCLAW_AGENT_CLIENT_ID,
} from "./externalAgentDispatchService.js";
import { appendCodingBridgeResponse } from "./localCodingControlBridgeService.js";

export type CodingTaskTerminalStatus = "COMPLETED" | "FAILED" | "BLOCKED";

const TERMINAL_REPORT_MAX_ATTEMPTS = 3;
const TERMINAL_REPORT_RETRY_DELAY_MS = 100;

type TerminalReportResult =
  | { reported: true; responseId: string }
  | { reported: false; reason: "NO_BINDING" | "ALREADY_REPORTED"; responseId?: string };

export function canonicalTerminalEventStatus(
  requestedStatus: CodingTaskTerminalStatus,
  persistedStatus: unknown,
): CodingTaskTerminalStatus {
  return persistedStatus === "COMPLETED" ||
    persistedStatus === "FAILED" ||
    persistedStatus === "BLOCKED"
    ? persistedStatus
    : requestedStatus;
}

function conversationIdFromMetadata(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const conversationId = (value as Record<string, unknown>)["conversationId"];
  return typeof conversationId === "string" && conversationId.trim()
    ? conversationId.trim()
    : null;
}

async function dispatchOpenClawConversationWake(input: {
  taskId: string;
  conversationId: string;
  status: CodingTaskTerminalStatus;
  message: string;
  responseId: string;
  source?: string;
}): Promise<void> {
  const eventMarker = `AI_CORE_WAKE:${input.responseId}`;
  const instruction = [
    "Relay this AI Core lifecycle update to the already-bound ChatGPT conversation through the paired PC.",
    `Conversation ID: ${input.conversationId}`,
    `Event marker: ${eventMarker}`,
    `Event type: ${input.status}`,
    `Message: ${input.message.trim()}`,
    "Send the lifecycle update once. If the same event marker is already present, do not send it again.",
    "After ChatGPT finishes responding, return the newest assistant response as the OpenClaw result.",
  ].join("\n");

  try {
    await dispatchExternalAgentWork({
      clientId: OPENCLAW_AGENT_CLIENT_ID,
      instruction,
      taskId: input.taskId,
      source: "ai-core-chatgpt-wake",
      metadata: {
        conversationId: input.conversationId,
        sourceResponseId: input.responseId,
        eventType: input.status,
        openClawChatgptWake: true,
        source: input.source ?? "coding-task-status-transition",
      },
    });
  } catch (error) {
    logger.warn(
      {
        error,
        taskId: input.taskId,
        conversationId: input.conversationId,
        responseId: input.responseId,
      },
      "[ai-core-chatgpt-wake] failed to enqueue OpenClaw conversation wake",
    );
  }
}

async function reportCodingTaskTerminalTransitionOnce(input: {
  taskId: string;
  status: CodingTaskTerminalStatus;
  message: string;
  source?: string;
}): Promise<TerminalReportResult> {
  const [task] = await db
    .select({ status: aiCodingTasksTable.status })
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, input.taskId))
    .limit(1);
  const status = canonicalTerminalEventStatus(input.status, task?.status);

  const [command] = await db
    .select({
      id: aiCodingBridgeCommandsTable.id,
      metadataJson: aiCodingBridgeCommandsTable.metadataJson,
    })
    .from(aiCodingBridgeCommandsTable)
    .where(eq(aiCodingBridgeCommandsTable.taskId, input.taskId))
    .orderBy(
      // Prefer the canonical lifecycle binding created by AI Core Chat. Later
      // worker/control commands can belong to a different client and would
      // otherwise steal the terminal event from the originating conversation.
      sql`CASE
        WHEN ${aiCodingBridgeCommandsTable.source} = 'ai-core-task-lifecycle'
         AND ${aiCodingBridgeCommandsTable.commandType} = 'EVENT_BINDING'
        THEN 0
        ELSE 1
      END`,
      desc(aiCodingBridgeCommandsTable.createdAt),
    )
    .limit(1);

  if (!command) {
    return { reported: false, reason: "NO_BINDING" };
  }

  const bridgeKind = status === "BLOCKED" ? "BLOCKER" : status;

  const [existing] = await db
    .select({ id: aiCodingBridgeResponsesTable.id })
    .from(aiCodingBridgeResponsesTable)
    .where(
      and(
        eq(aiCodingBridgeResponsesTable.commandId, command.id),
        eq(aiCodingBridgeResponsesTable.taskId, input.taskId),
        eq(aiCodingBridgeResponsesTable.kind, bridgeKind),
      ),
    )
    .orderBy(desc(aiCodingBridgeResponsesTable.createdAt))
    .limit(1);

  if (existing) {
    return {
      reported: false,
      reason: "ALREADY_REPORTED",
      responseId: existing.id,
    };
  }

  const response = await appendCodingBridgeResponse({
    commandId: command.id,
    taskId: input.taskId,
    kind: bridgeKind,
    message: input.message.trim(),
    checkpoint: {
      eventType: status,
      status,
      source: input.source ?? "coding-task-status-transition",
    },
  });

  const conversationId = conversationIdFromMetadata(command.metadataJson);
  if (conversationId) {
    await dispatchOpenClawConversationWake({
      taskId: input.taskId,
      conversationId,
      status,
      message: input.message,
      responseId: response.id,
      source: input.source,
    });
  }

  return { reported: true, responseId: response.id };
}

export async function reportCodingTaskTerminalTransition(input: {
  taskId: string;
  status: CodingTaskTerminalStatus;
  message: string;
  source?: string;
}): Promise<TerminalReportResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TERMINAL_REPORT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await reportCodingTaskTerminalTransitionOnce(input);
    } catch (error) {
      lastError = error;
      if (attempt >= TERMINAL_REPORT_MAX_ATTEMPTS) break;
      await new Promise((resolve) =>
        setTimeout(resolve, TERMINAL_REPORT_RETRY_DELAY_MS * attempt),
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Coding task lifecycle reporting failed");
}
