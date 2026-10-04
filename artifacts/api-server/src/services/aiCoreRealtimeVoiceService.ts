import { getProviderApiKey } from "./aiSecretService.js";

export const DEFAULT_AI_CORE_REALTIME_MODEL =
  process.env["AI_CORE_REALTIME_MODEL"]?.trim() || "gpt-realtime-2.1-mini";
export const DEFAULT_AI_CORE_REALTIME_VOICE =
  process.env["AI_CORE_REALTIME_VOICE"]?.trim() || "marin";

export function isAiCoreRealtimeVoiceConfigured(): boolean {
  return process.env["AI_CORE_VOICE_ENABLED"] !== "false" && Boolean(getProviderApiKey("openai"));
}

function safeRealtimeProviderError(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

export type AiCoreRealtimeSession = {
  clientSecret: string;
  expiresAt: number | null;
  model: string;
  voice: string;
  webrtcUrl: string;
};

export async function createAiCoreRealtimeSession(): Promise<AiCoreRealtimeSession> {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) throw new Error("OpenAI Realtime belum dikonfigurasi.");

  const model = DEFAULT_AI_CORE_REALTIME_MODEL;
  const voice = DEFAULT_AI_CORE_REALTIME_VOICE;
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions: [
          "Anda adalah AI Core Voice, asisten internal AI Core.",
          "Gunakan Bahasa Indonesia kecuali pengguna meminta bahasa lain.",
          "Jawab ringkas, jelas, dan natural untuk percakapan suara.",
          "Jangan pernah mengungkap secret, API key, password, atau token.",
          "Izinkan pengguna menyela jawaban; setelah interupsi, dengarkan instruksi terbaru.",
        ].join(" "),
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = safeRealtimeProviderError(await response.text().catch(() => ""));
    throw new Error(`OpenAI Realtime session gagal (HTTP ${response.status})${detail ? ": " + detail : ""}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const value =
    typeof payload["value"] === "string"
      ? payload["value"]
      : payload["client_secret"] && typeof payload["client_secret"] === "object"
        ? String((payload["client_secret"] as Record<string, unknown>)["value"] ?? "")
        : "";
  if (!value) throw new Error("OpenAI Realtime tidak mengembalikan ephemeral client secret.");

  const expiresAtRaw =
    typeof payload["expires_at"] === "number"
      ? payload["expires_at"]
      : payload["client_secret"] && typeof payload["client_secret"] === "object"
        ? (payload["client_secret"] as Record<string, unknown>)["expires_at"]
        : null;
  const expiresAt = typeof expiresAtRaw === "number" ? expiresAtRaw : null;

  return {
    clientSecret: value,
    expiresAt,
    model,
    voice,
    webrtcUrl: "https://api.openai.com/v1/realtime/calls",
  };
}
