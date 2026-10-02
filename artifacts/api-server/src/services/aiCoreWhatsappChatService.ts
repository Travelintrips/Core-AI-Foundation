import crypto from "node:crypto";
import { retrieveRecentChatContext } from "./aiCoreChatLearningService.js";
import { getProviderApiKey } from "./aiSecretService.js";

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
  const configured = (process.env["AI_CORE_INTERNAL_BASE_URL"] ?? "")
    .trim()
    .replace(/\/$/, "");
  if (configured) return configured;

  // WhatsApp inbound handling already runs inside the AI Core API process.
  // Keep the chat hop on loopback by default instead of leaving the host,
  // traversing DNS/TLS/reverse-proxy, and re-entering the same application.
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

function canSkipWhatsappConversationContext(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  return /^(?:hello|hi|halo|hai|hey|help|bantuan|status|cek status|health|healthz|model|model status|routing|routing biaya|cost|biaya)$/.test(
    normalized,
  );
}

async function retrieveWhatsappContextFast(
  conversationId: string,
  message: string,
): Promise<Awaited<ReturnType<typeof retrieveRecentChatContext>>> {
  if (canSkipWhatsappConversationContext(message)) return [];

  const lookup = retrieveRecentChatContext(
    { sessionId: conversationId },
    6,
  ).catch(() => []);

  // Recent context improves follow-ups, but a slow/cold database must not hold
  // the WhatsApp reply path hostage. Fall back to a stateless answer quickly;
  // the learning store remains the durable source for later turns.
  const budgetMs = Math.max(
    100,
    Math.min(
      1_000,
      Number.parseInt(process.env["AI_CORE_WA_CONTEXT_BUDGET_MS"] ?? "300", 10) || 300,
    ),
  );
  const timeout = new Promise<Awaited<ReturnType<typeof retrieveRecentChatContext>>>(
    (resolve) => {
      const timer = setTimeout(() => resolve([]), budgetMs);
      timer.unref?.();
    },
  );

  return Promise.race([lookup, timeout]);
}

type AiCoreWhatsappVoiceTranscription = {
  text: string;
  provider: "openai" | "gemini";
  model: string;
};

const MAX_WHATSAPP_VOICE_BYTES = 8 * 1024 * 1024;

function normalizeAudioMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() || "audio/ogg";
}

function audioFileExtension(mimeType: string): string {
  switch (normalizeAudioMimeType(mimeType)) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    default:
      return "bin";
  }
}

function decodeWhatsappVoiceBase64(value: string): Buffer {
  const audio = Buffer.from(value, "base64");
  if (!audio.length) throw new Error("WhatsApp voice note kosong.");
  if (audio.length > MAX_WHATSAPP_VOICE_BYTES) {
    throw new Error("WhatsApp voice note terlalu besar untuk diproses.");
  }
  return audio;
}

async function transcribeWithOpenAi(
  audio: Buffer,
  mimeType: string,
): Promise<AiCoreWhatsappVoiceTranscription> {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) throw new Error("OPENAI_NOT_CONFIGURED");

  const model = process.env["AI_CORE_WA_TRANSCRIBE_MODEL"]?.trim() || "gpt-transcribe";
  const form = new FormData();
  form.append("model", model);
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: normalizeAudioMimeType(mimeType) }),
    `voice-note.${audioFileExtension(mimeType)}`,
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail =
      payload && typeof payload["error"] === "object" && payload["error"] !== null
        ? String((payload["error"] as Record<string, unknown>)["message"] ?? "")
        : `HTTP ${response.status}`;
    throw new Error(`OPENAI_TRANSCRIBE_FAILED:${detail.slice(0, 200)}`);
  }
  const text = payload && typeof payload["text"] === "string" ? payload["text"].trim() : "";
  if (!text) throw new Error("OPENAI_TRANSCRIBE_EMPTY");
  return { text, provider: "openai", model };
}

function extractGeminiText(payload: Record<string, unknown> | null): string {
  const candidates = Array.isArray(payload?.["candidates"]) ? payload?.["candidates"] as unknown[] : [];
  const parts: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const content = (candidate as Record<string, unknown>)["content"];
    if (!content || typeof content !== "object" || Array.isArray(content)) continue;
    const candidateParts = Array.isArray((content as Record<string, unknown>)["parts"])
      ? (content as Record<string, unknown>)["parts"] as unknown[]
      : [];
    for (const part of candidateParts) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const text = (part as Record<string, unknown>)["text"];
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n").trim();
}

async function transcribeWithGemini(
  audio: Buffer,
  mimeType: string,
): Promise<AiCoreWhatsappVoiceTranscription> {
  const apiKey = getProviderApiKey("gemini");
  if (!apiKey) throw new Error("GEMINI_NOT_CONFIGURED");

  const model = process.env["AI_CORE_WA_VOICE_GEMINI_MODEL"]?.trim() || "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            {
              text:
                "Transkripsikan voice note ini secara verbatim. Kembalikan hanya teks ucapan, tanpa penjelasan, tanpa markdown.",
            },
            {
              inlineData: {
                mimeType: normalizeAudioMimeType(mimeType),
                data: audio.toString("base64"),
              },
            },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(`GEMINI_TRANSCRIBE_FAILED:HTTP_${response.status}`);
  const text = extractGeminiText(payload);
  if (!text) throw new Error("GEMINI_TRANSCRIBE_EMPTY");
  return { text, provider: "gemini", model };
}

export async function transcribeAiCoreWhatsappVoiceNote(input: {
  audioBase64: string;
  mimeType: string;
}): Promise<AiCoreWhatsappVoiceTranscription> {
  const audio = decodeWhatsappVoiceBase64(input.audioBase64);
  const failures: string[] = [];

  try {
    return await transcribeWithOpenAi(audio, input.mimeType);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  try {
    return await transcribeWithGemini(audio, input.mimeType);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const configured =
    Boolean(getProviderApiKey("openai")) || Boolean(getProviderApiKey("gemini"));
  if (!configured) {
    throw new Error("Voice transcription provider belum dikonfigurasi.");
  }
  throw new Error(
    "Voice note gagal ditranskripsikan: " +
      failures.map((value) => value.replace(/[\r\n\t]+/g, " ").slice(0, 160)).join(" | "),
  );
}

export async function requestAiCoreWhatsappChat(input: {
  message: string;
  conversationId: string;
  source?: "text" | "whatsapp_voice";
}): Promise<AiCoreWhatsappChatResult> {
  const adminKey = (process.env["ADMIN_API_KEY"] ?? "").trim();
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY is not configured for internal AI Core WhatsApp chat.");
  }

  const context = await retrieveWhatsappContextFast(
    input.conversationId,
    input.message,
  );

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
      source: input.source ?? "text",
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
