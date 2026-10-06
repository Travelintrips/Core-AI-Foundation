import { and, desc, eq, sql } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingBridgeResponsesTable,
  db,
} from "@workspace/db";
import { appendCodingBridgeResponse } from "./localCodingControlBridgeService.js";

export type CodingTaskTerminalStatus = "COMPLETED" | "FAILED" | "BLOCKED";

const TERMINAL_REPORT_MAX_ATTEMPTS = 3;
const TERMINAL_REPORT_RETRY_DELAY_MS = 100;

type TerminalReportResult =
  | { reported: true; responseId: string }
  | { reported: false; reason: "NO_BINDING" | "ALREADY_REPORTED"; responseId?: string };

async function reportCodingTaskTerminalTransitionOnce(input: {
  taskId: string;
  status: CodingTaskTerminalStatus;
  message: string;
  source?: string;
}): Promise<TerminalReportResult> {
  const [command] = await db
    .select({ id: aiCodingBridgeCommandsTable.id })
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

  const bridgeKind = input.status === "BLOCKED" ? "BLOCKER" : input.status;

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
      eventType: input.status,
      status: input.status,
      source: input.source ?? "coding-task-status-transition",
    },
  });

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
