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

export type CodingWhatsappNotifyResult =
  | { status: "skipped"; reason: "kind_not_notifiable" | "missing_config"; configured: { baseUrl: boolean; apiKey: boolean; to: boolean } }
  | { status: "queued"; gatewayStatus: number; messageId: string | null }
  | { status: "rejected"; gatewayStatus: number; body: string }
  | { status: "failed"; error: string };

async function sendGatewayMessage(input: {
  idempotencyKey: string;
  clientMessageId: string;
  text: string;
  buttons?: Array<{ id: string; label: string }>;
  footer?: string;
}): Promise<CodingWhatsappNotifyResult> {
  const configured = getCodingWhatsappConfigStatus();
  const { baseUrl, apiKey, to } = config();
  if (!baseUrl || !apiKey || !to) {
    return { status: "skipped", reason: "missing_config", configured };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(
        input.buttons?.length
          ? {
              type: "buttons",
              to,
              text: input.text,
              ...(input.footer ? { footer: input.footer } : {}),
              buttons: input.buttons,
              clientMessageId: input.clientMessageId,
            }
          : {
              type: "text",
              to,
              text: input.text,
              clientMessageId: input.clientMessageId,
            },
      ),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        status: "rejected",
        gatewayStatus: response.status,
        body: body.slice(0, 500),
      };
    }

    const body = await response.json().catch(() => null) as { messageId?: unknown } | null;
    return {
      status: "queued",
      gatewayStatus: response.status,
      messageId: typeof body?.messageId === "string" ? body.messageId : null,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type CodingWhatsappDeliveryResult =
  | { status: "sent"; messageId: string; gatewayStatus: number; sentAt?: string; waMessageId?: string | null }
  | { status: "failed"; messageId: string; reason: string; attemptsMade?: number }
  | { status: "timeout"; messageId: string; lastStatus: string | null }
  | { status: "unavailable"; reason: string };

export async function waitForCodingWhatsappDelivery(
  messageId: string | null,
  options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<CodingWhatsappDeliveryResult> {
  if (!messageId) {
    return { status: "unavailable", reason: "Gateway did not return a messageId." };
  }

  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    return { status: "unavailable", reason: "WhatsApp gateway configuration is incomplete." };
  }

  const timeoutMs = Math.max(1_000, Math.min(options?.timeoutMs ?? 30_000, 60_000));
  const pollIntervalMs = Math.max(250, Math.min(options?.pollIntervalMs ?? 1_000, 5_000));
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | null = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/v1/messages/${encodeURIComponent(messageId)}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const body = await response.json().catch(() => null) as {
          status?: unknown;
          sentAt?: unknown;
          waMessageId?: unknown;
          failedReason?: unknown;
          attemptsMade?: unknown;
        } | null;

        lastStatus = typeof body?.status === "string" ? body.status : null;
        if (lastStatus === "sent") {
          return {
            status: "sent",
            messageId,
            gatewayStatus: response.status,
            ...(typeof body?.sentAt === "string" ? { sentAt: body.sentAt } : {}),
            waMessageId:
              typeof body?.waMessageId === "string" || body?.waMessageId === null
                ? body.waMessageId
                : null,
          };
        }
        if (lastStatus === "failed") {
          return {
            status: "failed",
            messageId,
            reason:
              typeof body?.failedReason === "string"
                ? body.failedReason
                : "WhatsApp worker reported a failed send.",
            ...(typeof body?.attemptsMade === "number"
              ? { attemptsMade: body.attemptsMade }
              : {}),
          };
        }
      }
    } catch (error) {
      logger.warn(
        { messageId, err: error },
        "[coding-wa] delivery status poll failed",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { status: "timeout", messageId, lastStatus };
}

export function getCodingWhatsappConfigStatus() {
  const { baseUrl, apiKey, to } = config();
  return {
    baseUrl: Boolean(baseUrl),
    apiKey: Boolean(apiKey),
    to: Boolean(to),
  };
}

export async function notifyCodingBridgeResponse(input: {
  responseId: string;
  commandId: string;
  taskId?: string | null;
  kind: CodingBridgeKind;
  message: string;
}): Promise<CodingWhatsappNotifyResult> {
  const configured = getCodingWhatsappConfigStatus();
  if (!NOTIFIABLE_KINDS.has(input.kind)) {
    return { status: "skipped", reason: "kind_not_notifiable", configured };
  }

  const taskLine = input.taskId ? `Task: ${input.taskId}\n` : "";
  const text = [
    "AI Core Coding Update",
    `Status: ${input.kind}`,
    taskLine.trimEnd(),
    input.message.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  const result = await sendGatewayMessage({
    idempotencyKey: `ai-core-coding-${input.responseId}`,
    clientMessageId: input.responseId,
    text,
  });

  if (result.status === "queued") {
    logger.info(
      {
        responseId: input.responseId,
        commandId: input.commandId,
        kind: input.kind,
      },
      "[coding-wa] coding notification queued",
    );
  } else if (result.status !== "skipped") {
    logger.warn(
      {
        result,
        responseId: input.responseId,
        commandId: input.commandId,
      },
      "[coding-wa] coding notification not queued",
    );
  }
  return result;
}


export async function sendCodingApprovalRequest(input: {
  approvalId: string;
  taskId: string | null;
  actionType: string;
  summary: string;
  token: string;
  expiresAt: string;
}): Promise<CodingWhatsappNotifyResult> {
  const text = [
    "AI Core - APPROVAL REQUIRED",
    input.taskId ? `Task: ${input.taskId}` : "",
    `Action: ${input.actionType}`,
    input.summary.trim(),
    `Berlaku sampai: ${input.expiresAt}`,
    "",
    "Pilih tindakan di bawah.",
    `Jika tombol tidak tampil, balas: APPROVE ${input.token}`,
    `atau: REJECT ${input.token}`,
  ].filter(Boolean).join("\n");

  return sendGatewayMessage({
    idempotencyKey: `ai-core-approval-${input.approvalId}`,
    clientMessageId: input.approvalId,
    text,
    footer: "AI Core Admin Approval",
    buttons: [
      { id: `APPROVE ${input.token}`, label: "✅ APPROVE" },
      { id: `REJECT ${input.token}`, label: "❌ REJECT" },
    ],
  });
}

export async function sendCodingApprovalResult(input: {
  approvalId: string;
  taskId: string | null;
  actionType: string;
  status: "REJECTED" | "EXECUTING" | "COMPLETED" | "FAILED";
  message: string;
}): Promise<CodingWhatsappNotifyResult> {
  const text = [
    "AI Core - Approval Update",
    input.taskId ? `Task: ${input.taskId}` : "",
    `Action: ${input.actionType}`,
    `Status: ${input.status}`,
    input.message.trim(),
  ].filter(Boolean).join("\n");

  return sendGatewayMessage({
    idempotencyKey: `ai-core-approval-result-${input.approvalId}-${input.status}`,
    clientMessageId: `${input.approvalId}-${input.status.toLowerCase()}`,
    text,
  });
}
