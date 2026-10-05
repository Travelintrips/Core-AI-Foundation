import { and, desc, eq } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingBridgeResponsesTable,
  db,
} from "@workspace/db";
import { appendCodingBridgeResponse } from "./localCodingControlBridgeService.js";

export type CodingTaskTerminalStatus = "COMPLETED" | "FAILED";

export async function reportCodingTaskTerminalTransition(input: {
  taskId: string;
  status: CodingTaskTerminalStatus;
  message: string;
  source?: string;
}): Promise<
  | { reported: true; responseId: string }
  | { reported: false; reason: "NO_BINDING" | "ALREADY_REPORTED"; responseId?: string }
> {
  const [command] = await db
    .select({ id: aiCodingBridgeCommandsTable.id })
    .from(aiCodingBridgeCommandsTable)
    .where(eq(aiCodingBridgeCommandsTable.taskId, input.taskId))
    .orderBy(desc(aiCodingBridgeCommandsTable.createdAt))
    .limit(1);

  if (!command) {
    return { reported: false, reason: "NO_BINDING" };
  }

  const [existing] = await db
    .select({ id: aiCodingBridgeResponsesTable.id })
    .from(aiCodingBridgeResponsesTable)
    .where(
      and(
        eq(aiCodingBridgeResponsesTable.commandId, command.id),
        eq(aiCodingBridgeResponsesTable.taskId, input.taskId),
        eq(aiCodingBridgeResponsesTable.kind, input.status),
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
    kind: input.status,
    message: input.message.trim(),
    checkpoint: {
      eventType: input.status,
      status: input.status,
      source: input.source ?? "coding-task-status-transition",
    },
  });

  return { reported: true, responseId: response.id };
}
