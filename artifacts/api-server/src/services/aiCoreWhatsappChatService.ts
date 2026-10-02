import crypto from "node:crypto";
import { retrieveRecentChatContext } from "./aiCoreChatLearningService.js";

type AiCoreWhatsappChatResult = {
  reply: string;
  route: string | null;
  provider: string | null;
  model: string | null;
};

type AiCoreWhatsappSendResult =
  | { status: "queued"; gatewayStatus: number; messageId: string | null }
  | { status: "rejected"; gatewayStatus: number; body: string }
  | { status: "failed"; error: string };

function loopbackBaseUrl(): string {
  const port = (process.env["PORT"] ?? "3000").trim() || "3000";
  return `http://127.0.0.1:${port}`;
}

export function resolveAiCoreInternalBaseUrl(): string {
  const configured = (
    process.env["AI_CORE_INTERNAL_BASE_URL"] ??
    process.env["PUBLIC_APP_URL"] ??
    ""
  ).trim().replace(/\/$/, "");
  if (configured) return configured;
  if (process.env["NODE_ENV"] === "production") {
    return "https://aicore.cstlogistic.co.id";
  }
  return loopbackBaseUrl();
}

function gatewayConfig() {
  return {
    baseUrl: (process.env["CST_WA_GATEWAY_URL"] ?? "").trim().replace(/\/$/, ""),
    apiKey: (process.env["CST_WA_GATEWAY_API_KEY"] ?? "").trim(),
  };
}

function resolveReplyDeviceId(inboundDeviceId?: string | null): string | null {
  const configured = (process.env["AI_CORE_WA_REPLY_DEVICE_ID"] ?? "").trim();
  if (configured) return configured;

  if (process.env["AI_CORE_WA_REPLY_USE_INBOUND_DEVICE"] === "true") {
    return inboundDeviceId?.trim() || null;
  }

  // By default, let the gateway choose the device assigned to this API client
  // (or its configured default). The inbound device can belong to a different
  // client scope, which would make an otherwise valid AI Core reply fail with
  // DEVICE_NOT_ASSIGNED / DEVICE_ACCESS_DENIED.
  return null;
}

export function buildWhatsappConversationId(senderDigits: string, destination: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${senderDigits}|${destination}`, "utf8")
    .digest("hex")
    .slice(0, 40);
  return `wa:${digest}`;
}

export async function requestAiCoreWhatsappChat(input: {
  message: string;
  conversationId: string;
}): Promise<AiCoreWhatsappChatResult> {
  const adminKey = (process.env["ADMIN_API_KEY"] ?? "").trim();
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY is not configured for internal AI Core WhatsApp chat.");
  }

  const context = await retrieveRecentChatContext(
    { sessionId: input.conversationId },
    10,
  ).catch(() => []);

  const response = await fetch(`${resolveAiCoreInternalBaseUrl()}/api/ai/core-chat/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-api-key": adminKey,
    },
    body: JSON.stringify({
      message: input.message,
      mode: "ask",
      modelPolicy: "smart",
      conversationId: input.conversationId,
      source: "text",
      context,
    }),
    signal: AbortSignal.timeout(75_000),
  });

  const payload = await response.json().catch(() => null) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    const detail =
      payload && typeof payload["error"] === "string"
        ? payload["error"]
        : `HTTP ${response.status}`;
    throw new Error(`AI Core WhatsApp chat request failed: ${detail}`);
  }

  const reply =
    payload && typeof payload["reply"] === "string"
      ? payload["reply"].trim()
      : "";
  if (!reply) {
    throw new Error("AI Core WhatsApp chat returned an empty reply.");
  }

  return {
    reply,
    route: payload && typeof payload["route"] === "string" ? payload["route"] : null,
    provider: payload && typeof payload["provider"] === "string" ? payload["provider"] : null,
    model: payload && typeof payload["model"] === "string" ? payload["model"] : null,
  };
}

export async function sendAiCoreWhatsappReply(input: {
  to: string;
  deviceId?: string | null;
  incomingMessageId: string;
  text: string;
}): Promise<AiCoreWhatsappSendResult> {
  const { baseUrl, apiKey } = gatewayConfig();
  if (!baseUrl || !apiKey) {
    return { status: "failed", error: "WhatsApp gateway configuration is incomplete." };
  }

  const clientMessageId = `aicore-chat-${input.incomingMessageId}`.slice(0, 160);
  const idempotencyKey = `ai-core-chat-${input.incomingMessageId}`.slice(0, 200);
  const replyDeviceId = resolveReplyDeviceId(input.deviceId);

  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        type: "text",
        ...(replyDeviceId ? { deviceId: replyDeviceId } : {}),
        to: input.to,
        text: input.text.slice(0, 10_000),
        clientMessageId,
        ...(replyDeviceId
          ? { replyToProviderMessageId: input.incomingMessageId.slice(0, 200) }
          : {}),
      }),
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

    const body = await response.json().catch(() => null) as
      | { messageId?: unknown }
      | null;
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
