import { randomUUID } from "node:crypto";
import {
  appendCodingBridgeResponse,
  submitCodingBridgeCommand,
} from "./localCodingControlBridgeService.js";

/** Persist synchronous MCP results on the same durable channel as coding tasks. */
export async function recordAiCoreMcpTerminalResult(input: {
  conversationId?: string;
  instruction: string;
  payload: unknown;
}): Promise<void> {
  if (!input.conversationId || !input.payload || typeof input.payload !== "object") return;
  const result = input.payload as Record<string, unknown>;
  // Queued work publishes its own lifecycle; acceptance is not completion.
  if (result.taskId || result.commandId || result.kind === "multi_agent") return;
  const execution = result.execution as Record<string, unknown> | undefined;
  const status = result.status ?? execution?.status;
  if (status && !["COMPLETED", "FAILED", "SUCCESS", "SUCCEEDED"].includes(String(status))) return;
  const failed = status === "FAILED" || result.error ||
    ["validation", "clarification"].includes(String(result.kind)) ||
    (result.route === "NO_LLM" && result.workload !== "DETERMINISTIC");
  const eventType = failed ? "FAILED" : "COMPLETED";
  const { command } = await submitCodingBridgeCommand({
    externalCommandId: `chatgpt-mcp-result:${randomUUID()}`,
    instruction: input.instruction,
    source: "chatgpt-mcp-events",
    commandType: "EVENT_BINDING",
    metadata: { conversationId: input.conversationId, passiveEventBinding: true },
  });
  await appendCodingBridgeResponse({
    commandId: command.id,
    kind: eventType,
    message: String(result.reply ?? result.error ?? "AI Core command finished."),
    checkpoint: { eventType, status: status ?? eventType },
    metadata: { eventType, route: result.route ?? null, jobId: result.jobId ?? null },
  });
}
