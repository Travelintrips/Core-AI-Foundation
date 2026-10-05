import { submitCodingBridgeCommand } from "./localCodingControlBridgeService.js";

export const AI_CORE_TERMINAL_REPORT_EVENT_TYPES = [
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "MERGED",
  "DEPLOYED",
] as const;

export async function bindAiCoreTaskLifecycleReporting(input: {
  taskId: string;
  conversationId?: string | null;
}) {
  const conversationId = input.conversationId?.trim() || null;

  return submitCodingBridgeCommand({
    externalCommandId: `ai-core-task-lifecycle:${input.taskId}`,
    instruction: "Passive lifecycle reporting binding for AI Core task.",
    taskId: input.taskId,
    source: "ai-core-task-lifecycle",
    commandType: "EVENT_BINDING",
    metadata: {
      ...(conversationId ? { conversationId } : {}),
      passiveEventBinding: true,
      eventTypes: [...AI_CORE_TERMINAL_REPORT_EVENT_TYPES],
    },
  });
}
