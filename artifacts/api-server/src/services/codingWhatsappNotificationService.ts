import { logger } from "../lib/logger.js";

type CodingBridgeKind =
  | "ACK"
  | "PROGRESS"
  | "CHECKPOINT"
  | "BLOCKER"
  | "COMPLETED"
  | "FAILED";

const NOTIFIABLE_KINDS = new Set<CodingBridgeKind>([
  "CHECKPOINT",
  "BLOCKER",
  "COMPLETED",
  "FAILED",
]);

function config() {
  const baseUrl = (process.env.CST_WA_GATEWAY_URL ?? "").trim().replace(/\/$/, "");
  const apiKey = (process.env.CST_WA_GATEWAY_API_KEY ?? "").trim();
  const to = (process.env.AI_CODING_WA_NOTIFY_TO ?? "").trim();
  return { baseUrl, apiKey, to };
}

export async function notifyCodingBridgeResponse(input: {
  responseId: string;
  commandId: string;
  taskId?: string | null;
  kind: CodingBridgeKind;
  message: string;
}): Promise<void> {
  if (!NOTIFIABLE_KINDS.has(input.kind)) return;

  const { baseUrl, apiKey, to } = config();
  if (!baseUrl || !apiKey || !to) return;

  const taskLine = input.taskId ? `Task: ${input.taskId}\n` : "";
  const text = [
    "AI Core Coding Update",
    `Status: ${input.kind}`,
    taskLine.trimEnd(),
    input.message.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `ai-core-coding-${input.responseId}`,
      },
      body: JSON.stringify({
        to,
        text,
        clientMessageId: input.responseId,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn(
        {
          status: response.status,
          responseId: input.responseId,
          commandId: input.commandId,
          body: body.slice(0, 500),
        },
        "[coding-wa] CST WA Gateway rejected coding notification",
      );
      return;
    }

    logger.info(
      {
        responseId: input.responseId,
        commandId: input.commandId,
        kind: input.kind,
      },
      "[coding-wa] coding notification queued",
    );
  } catch (error) {
    logger.warn(
      {
        err: error,
        responseId: input.responseId,
        commandId: input.commandId,
      },
      "[coding-wa] coding notification failed",
    );
  }
}
