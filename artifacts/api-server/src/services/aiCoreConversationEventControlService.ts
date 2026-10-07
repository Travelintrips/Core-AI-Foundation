import { randomUUID } from "node:crypto";
import {
  appendCodingBridgeResponse,
  submitCodingBridgeCommand,
} from "./localCodingControlBridgeService.js";

export type DirectConversationEventRequest = {
  conversationId: string;
  eventType: "COMPLETED" | "FAILED" | "BLOCKED";
  message: string;
};

const CONVERSATION_ID =
  /\bconversation(?:Id)?\s*[:=]?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

const DIRECT_EVENT_INTENT =
  /\b(?:kirim|send|emit|buat|create)\b[\s\S]{0,160}\b(?:chatgpt|conversation|bridge|event|native\s+mcp)\b/i;

const EVENT_CONTEXT =
  /\b(?:bridge(?:\/event)?|event\s+binding|native\s+(?:mcp\s+)?event|ai_core\.task\.terminal)\b/i;

function requestedEventType(message: string): "COMPLETED" | "FAILED" | "BLOCKED" {
  const explicit = message.match(/\b(?:native\s+(?:mcp\s+)?event|eventType|kind)\s*[:=]?\s*(COMPLETED|FAILED|BLOCKED)\b/i)?.[1];
  if (explicit) return explicit.toUpperCase() as "COMPLETED" | "FAILED" | "BLOCKED";
  const standalone = message.match(/\b(COMPLETED|FAILED|BLOCKED)\b/i)?.[1];
  return standalone
    ? standalone.toUpperCase() as "COMPLETED" | "FAILED" | "BLOCKED"
    : "COMPLETED";
}

function requestedMessage(message: string): string | null {
  const quoted = message.match(
    /(?:isi\s+pesan\s+persis|message\s+persis|dengan\s+pesan|message)\s*[:=]?\s*["'`]([^"'\`]+)["'\`]/i,
  )?.[1]?.trim();
  if (quoted) return quoted.slice(0, 4_000);

  const raw = message.match(
    /(?:isi\s+pesan\s+persis|message\s+persis|dengan\s+pesan|message)\s*[:=]\s*([^\n\r]+)/i,
  )?.[1]?.trim();
  if (!raw) return null;

  const value = raw
    .split(/\.(?=\s+(?:gunakan|jangan|do\s+not|don't|without|via|melalui|dengan\s+checkpoint|checkpoint|kind|eventType)\b)/i)[0]
    ?.trim();

  return value
    ? value.replace(/^["'`]+|["'`.,;]+$/g, "").trim().slice(0, 4_000)
    : null;
}

export function parseDirectConversationEventRequest(
  message: string,
): DirectConversationEventRequest | null {
  const text = message.trim();
  if (!text || !DIRECT_EVENT_INTENT.test(text) || !EVENT_CONTEXT.test(text)) return null;
  const conversationId = text.match(CONVERSATION_ID)?.[1];
  const eventMessage = requestedMessage(text);
  if (!conversationId || !eventMessage) return null;
  return {
    conversationId,
    eventType: requestedEventType(text),
    message: eventMessage,
  };
}

export async function executeDirectConversationEvent(
  request: DirectConversationEventRequest,
): Promise<Record<string, unknown>> {
  const submitted = await submitCodingBridgeCommand({
    externalCommandId: `ai-core-direct-event:${randomUUID()}`,
    instruction: `Direct ChatGPT conversation event: ${request.eventType}`,
    source: "ai-core-chat-direct-event",
    commandType: "EVENT_BINDING",
    metadata: {
      conversationId: request.conversationId,
      passiveEventBinding: true,
      directChatEvent: true,
      eventTypes: [request.eventType],
    },
  });

  const kind = request.eventType === "BLOCKED" ? "BLOCKER" : request.eventType;
  const response = await appendCodingBridgeResponse({
    commandId: submitted.command.id,
    kind,
    message: request.message,
    checkpoint: {
      status: request.eventType,
      eventType: request.eventType,
      source: "ai-core-chat-direct-event",
    },
    metadata: {
      conversationId: request.conversationId,
      directChatEvent: true,
    },
  });

  return {
    kind: "execution",
    route: "CHATGPT_EVENT_CONTROL_PLANE",
    executionLane: "NO_WORKER",
    provider: null,
    model: null,
    usage: null,
    estimatedCostUsd: 0,
    mutating: true,
    conversationId: request.conversationId,
    eventType: request.eventType,
    responseId: response.id,
    reply: `Event ${request.eventType} berhasil dipersist dan dikirim ke ChatGPT conversation ${request.conversationId}.`,
    message: request.message,
  };
}
