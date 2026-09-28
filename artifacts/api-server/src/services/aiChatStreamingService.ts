import { getProviderApiKey } from "./aiSecretService.js";
import {
  anthropicModelSupportsTemperature,
  openAIModelSupportsTemperature,
  type ObservabilityContext,
} from "./aiExecutionService.js";
import { logExecutionSafe } from "./observabilityService.js";

export type ChatStreamUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export interface CloudChatStreamInput {
  providerSlug: string;
  modelId: string;
  baseUrl?: string | null;
  systemPrompt?: string | null;
  prompt: string;
  maxOutputTokens: number;
  temperature?: number | null;
  signal?: AbortSignal;
  /** Maximum silence between provider SSE chunks before failing over. */
  idleTimeoutMs?: number;
  observability?: ObservabilityContext;
  onDelta: (text: string) => void;
}

export interface CloudChatStreamResult {
  provider: string;
  model: string;
  providerRequestId?: string;
  usage: ChatStreamUsage | null;
  latencyMs: number;
}

type StreamAccumulator = {
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

function cleanBaseUrl(value: string | null | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

function safeDetail(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

async function assertOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  const detail = safeDetail(await response.text().catch(() => ""));
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${provider} streaming authentication failed.`);
  }
  if (response.status === 429) {
    throw new Error(`${provider} streaming rate limit or quota exceeded.`);
  }
  throw new Error(
    `${provider} streaming request failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
  );
}

function usageFrom(acc: StreamAccumulator): ChatStreamUsage | null {
  const input = acc.inputTokens;
  const output = acc.outputTokens;
  const total = acc.totalTokens;

  if (
    typeof input !== "number" ||
    typeof output !== "number" ||
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  ) {
    return null;
  }

  const normalizedInput = Math.floor(input);
  const normalizedOutput = Math.floor(output);
  const normalizedTotal =
    typeof total === "number" &&
    Number.isFinite(total) &&
    total >= normalizedInput + normalizedOutput
      ? Math.floor(total)
      : normalizedInput + normalizedOutput;

  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    totalTokens: normalizedTotal,
  };
}

async function readSse(
  response: Response,
  onData: (data: string) => void,
  idleTimeoutMs = 30_000,
): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming provider returned an empty response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBlock = (block: string) => {
    const data = block
      .replace(/\r/g, "")
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) onData(data);
  };

  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Streaming provider stalled for ${idleTimeoutMs}ms without data.`)),
              idleTimeoutMs,
            );
          }),
        ]);
        const { done, value } = result;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      } finally {
        if (timer) clearTimeout(timer);
      }

      // Normalize the accumulated buffer, not only the latest chunk. A CRLF
      // pair may itself be split across network chunks.
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        consumeBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.trim()) consumeBlock(buffer);
  } catch (error) {
    await reader.cancel("provider stream ended").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function parseJsonEvent(data: string, provider: string): Record<string, unknown> {
  try {
    const value = JSON.parse(data) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("non-object event");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error(`${provider} returned malformed streaming JSON.`);
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

async function streamOpenAiCompatible(
  input: CloudChatStreamInput,
  apiKey: string,
  providerLabel: string,
  endpoint: string,
): Promise<CloudChatStreamResult> {
  const started = Date.now();
  const acc: StreamAccumulator = {};
  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) messages.push({ role: "system", content: input.systemPrompt });
  messages.push({ role: "user", content: input.prompt });

  const body: Record<string, unknown> = {
    model: input.modelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: input.maxOutputTokens,
  };

  if (providerLabel === "Mistral") {
    delete body.max_completion_tokens;
    body.max_tokens = input.maxOutputTokens;
  }

  if (
    input.temperature != null &&
    (providerLabel !== "OpenAI" || openAIModelSupportsTemperature(input.modelId))
  ) {
    body.temperature = input.temperature;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  await assertOk(response, providerLabel);

  await readSse(response, (data) => {
    if (data === "[DONE]") return;
    const event = parseJsonEvent(data, providerLabel);

    if (typeof event.id === "string" && event.id) {
      acc.providerRequestId = event.id.slice(0, 200);
    }

    const usage =
      event.usage && typeof event.usage === "object" && !Array.isArray(event.usage)
        ? (event.usage as Record<string, unknown>)
        : null;
    if (usage) {
      acc.inputTokens =
        numberOrUndefined(usage.prompt_tokens) ?? acc.inputTokens;
      acc.outputTokens =
        numberOrUndefined(usage.completion_tokens) ?? acc.outputTokens;
      acc.totalTokens =
        numberOrUndefined(usage.total_tokens) ?? acc.totalTokens;
    }

    const choices = Array.isArray(event.choices) ? event.choices : [];
    const first =
      choices[0] && typeof choices[0] === "object"
        ? (choices[0] as Record<string, unknown>)
        : null;
    const delta =
      first?.delta && typeof first.delta === "object" && !Array.isArray(first.delta)
        ? (first.delta as Record<string, unknown>)
        : null;
    const text = typeof delta?.content === "string" ? delta.content : "";
    if (text) input.onDelta(text);
  }, input.idleTimeoutMs);

  return {
    provider: input.providerSlug,
    model: input.modelId,
    ...(acc.providerRequestId ? { providerRequestId: acc.providerRequestId } : {}),
    usage: usageFrom(acc),
    latencyMs: Date.now() - started,
  };
}

async function streamAnthropic(
  input: CloudChatStreamInput,
  apiKey: string,
): Promise<CloudChatStreamResult> {
  const started = Date.now();
  const acc: StreamAccumulator = {};

  const body: Record<string, unknown> = {
    model: input.modelId,
    max_tokens: input.maxOutputTokens,
    stream: true,
    messages: [{ role: "user", content: input.prompt }],
  };
  if (input.systemPrompt) body.system = input.systemPrompt;
  if (
    input.temperature != null &&
    anthropicModelSupportsTemperature(input.modelId)
  ) {
    body.temperature = input.temperature;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  await assertOk(response, "Anthropic");

  await readSse(response, (data) => {
    const event = parseJsonEvent(data, "Anthropic");
    if (typeof event.message === "object" && event.message && !Array.isArray(event.message)) {
      const message = event.message as Record<string, unknown>;
      if (typeof message.id === "string" && message.id) {
        acc.providerRequestId = message.id.slice(0, 200);
      }
      const usage =
        message.usage && typeof message.usage === "object" && !Array.isArray(message.usage)
          ? (message.usage as Record<string, unknown>)
          : null;
      if (usage) {
        acc.inputTokens =
          numberOrUndefined(usage.input_tokens) ?? acc.inputTokens;
        acc.outputTokens =
          numberOrUndefined(usage.output_tokens) ?? acc.outputTokens;
      }
    }

    if (event.usage && typeof event.usage === "object" && !Array.isArray(event.usage)) {
      const usage = event.usage as Record<string, unknown>;
      acc.inputTokens =
        numberOrUndefined(usage.input_tokens) ?? acc.inputTokens;
      acc.outputTokens =
        numberOrUndefined(usage.output_tokens) ?? acc.outputTokens;
    }

    const delta =
      event.delta && typeof event.delta === "object" && !Array.isArray(event.delta)
        ? (event.delta as Record<string, unknown>)
        : null;
    const text =
      delta?.type === "text_delta" && typeof delta.text === "string"
        ? delta.text
        : "";
    if (text) input.onDelta(text);
  }, input.idleTimeoutMs);

  return {
    provider: input.providerSlug,
    model: input.modelId,
    ...(acc.providerRequestId ? { providerRequestId: acc.providerRequestId } : {}),
    usage: usageFrom(acc),
    latencyMs: Date.now() - started,
  };
}

async function streamGemini(
  input: CloudChatStreamInput,
  apiKey: string,
): Promise<CloudChatStreamResult> {
  const started = Date.now();
  const acc: StreamAccumulator = {};
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      maxOutputTokens: input.maxOutputTokens,
      ...(input.temperature != null ? { temperature: input.temperature } : {}),
    },
  };
  if (input.systemPrompt) {
    body.systemInstruction = { parts: [{ text: input.systemPrompt }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  await assertOk(response, "Gemini");

  await readSse(response, (data) => {
    const event = parseJsonEvent(data, "Gemini");
    const usage =
      event.usageMetadata &&
      typeof event.usageMetadata === "object" &&
      !Array.isArray(event.usageMetadata)
        ? (event.usageMetadata as Record<string, unknown>)
        : null;
    if (usage) {
      acc.inputTokens =
        numberOrUndefined(usage.promptTokenCount) ?? acc.inputTokens;
      acc.outputTokens =
        numberOrUndefined(usage.candidatesTokenCount) ?? acc.outputTokens;
      acc.totalTokens =
        numberOrUndefined(usage.totalTokenCount) ?? acc.totalTokens;
    }

    const candidates = Array.isArray(event.candidates) ? event.candidates : [];
    const candidate =
      candidates[0] && typeof candidates[0] === "object"
        ? (candidates[0] as Record<string, unknown>)
        : null;
    const content =
      candidate?.content && typeof candidate.content === "object" && !Array.isArray(candidate.content)
        ? (candidate.content as Record<string, unknown>)
        : null;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const text = parts
      .map((part) =>
        part && typeof part === "object" && !Array.isArray(part) &&
        typeof (part as Record<string, unknown>).text === "string"
          ? String((part as Record<string, unknown>).text)
          : "",
      )
      .join("");
    if (text) input.onDelta(text);
  }, input.idleTimeoutMs);

  return {
    provider: input.providerSlug,
    model: input.modelId,
    usage: usageFrom(acc),
    latencyMs: Date.now() - started,
  };
}

export async function streamCloudChatNoFallback(
  input: CloudChatStreamInput,
): Promise<CloudChatStreamResult> {
  const slug = input.providerSlug.trim().toLowerCase();
  const apiKey = getProviderApiKey(slug);
  if (!apiKey) {
    throw new Error(`No API key configured for streaming provider '${slug}'.`);
  }

  const startedAt = new Date();

  try {
    let result: CloudChatStreamResult;
    if (slug === "openai") {
      result = await streamOpenAiCompatible(
        input,
        apiKey,
        "OpenAI",
        cleanBaseUrl(input.baseUrl, "https://api.openai.com/v1") + "/chat/completions",
      );
    } else if (slug === "mistral") {
      result = await streamOpenAiCompatible(
        input,
        apiKey,
        "Mistral",
        cleanBaseUrl(input.baseUrl, "https://api.mistral.ai/v1") + "/chat/completions",
      );
    } else if (["anthropic", "claude"].includes(slug)) {
      result = await streamAnthropic(input, apiKey);
    } else if (["google", "google-gemini", "gemini"].includes(slug)) {
      result = await streamGemini(input, apiKey);
    } else {
      throw new Error(`Streaming is not supported for provider '${slug}'.`);
    }

    if (input.observability) {
      logExecutionSafe({
        ...input.observability,
        providerName: input.observability.providerName ?? slug,
        modelName: input.observability.modelName ?? input.modelId,
        requestType: input.observability.requestType ?? "chat-stream",
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        latencyMs: result.latencyMs,
        startedAt,
        finishedAt: new Date(),
        status: "success",
      });
    }

    return result;
  } catch (error) {
    if (input.observability) {
      logExecutionSafe({
        ...input.observability,
        providerName: input.observability.providerName ?? slug,
        modelName: input.observability.modelName ?? input.modelId,
        requestType: input.observability.requestType ?? "chat-stream",
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt.getTime(),
        startedAt,
        finishedAt: new Date(),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
