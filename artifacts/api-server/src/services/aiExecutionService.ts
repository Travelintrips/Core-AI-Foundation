import { getProviderApiKey } from "./aiSecretService.js";
import { logExecutionSafe, type ObservabilityContext } from "./observabilityService.js";
import { readZeroLlmLocalConfig } from "./zeroLlmLocalService.js";
import { readOllamaLocalConfig } from "./ollamaLocalService.js";

export type { ObservabilityContext };

export interface ExecutionInput {
  prompt: string;
  systemPrompt?: string | null;
  model: {
    modelId: string;
    maxOutputTokens?: number | null;
    [key: string]: unknown;
  };
  provider: {
    slug: string;
    baseUrl?: string | null;
    [key: string]: unknown;
  };
  temperature?: number | null;
  maxTokens?: number | null;
  /** Optional image to attach as vision input (OpenAI/Gemini only). Ignored by
   * providers/models without vision support — callers should check before relying on it. */
  imageUrl?: string | null;
  /** Optional: when present, every call is fire-and-forget logged to ai_execution_logs. */
  observability?: ObservabilityContext;
  /** Optional bounded cancellation signal for constrained one-shot calls. */
  signal?: AbortSignal;
}

export interface ExecutionOutput {
  content: string;
  promptTokens: number;
  completionTokens: number;
  tokensUsed: number;
  latencyMs: number;
}

function providerRequestError(
  provider: string,
  status: number,
  detail?: string,
): Error {
  if (status === 401 || status === 403) {
    return new Error(`${provider} authentication failed. Check the configured API key.`);
  }
  if (status === 429) {
    return new Error(`${provider} rate limit or quota exceeded. Check the provider account.`);
  }

  const safeDetail = (detail ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);

  return new Error(
    `${provider} API request failed (HTTP ${status})${safeDetail ? `: ${safeDetail}` : "."}`,
  );
}

export function openAIModelSupportsTemperature(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (/^o\d/.test(normalized)) return false;
  if (/^gpt-5(?:[.\-]|$)/.test(normalized)) return false;
  return true;
}

export function anthropicModelSupportsTemperature(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.includes("mythos")) return false;
  const match = normalized.match(/^claude-[a-z]+-(\d+)(?:-(\d+))?/);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? "0");
  return major < 4 || (major === 4 && minor < 7);
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function executeOpenAI(input: ExecutionInput, apiKey: string): Promise<ExecutionOutput> {
  const startTime = Date.now();

  const modelId = input.model.modelId;
  const isOSeries = /^o\d/i.test(modelId);
  const supportsTemperature = openAIModelSupportsTemperature(modelId);
  const baseURL = (input.provider.baseUrl as string | undefined) || "https://api.openai.com/v1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: Array<{ role: string; content: any }> = [];
  if (input.systemPrompt && !isOSeries) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  if (input.imageUrl) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: input.prompt },
        { type: "image_url", image_url: { url: input.imageUrl } },
      ],
    });
  } else {
    messages.push({ role: "user", content: input.prompt });
  }

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    max_completion_tokens: input.maxTokens ?? (input.model.maxOutputTokens as number | null) ?? 4096,
  };
  if (supportsTemperature) body.temperature = input.temperature ?? 0.7;

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw providerRequestError("OpenAI", response.status, detail);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string | null } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const content = data.choices[0]?.message.content ?? "";
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;

  return {
    content,
    promptTokens,
    completionTokens,
    tokensUsed: promptTokens + completionTokens,
    latencyMs,
  };
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

async function executeAnthropic(input: ExecutionInput, apiKey: string): Promise<ExecutionOutput> {
  const startTime = Date.now();

  const body: Record<string, unknown> = {
    model: input.model.modelId,
    max_tokens: input.maxTokens ?? (input.model.maxOutputTokens as number | null) ?? 4096,
    messages: [{ role: "user", content: input.prompt }],
  };

  if (input.systemPrompt) body.system = input.systemPrompt;
  if (
    input.temperature != null &&
    anthropicModelSupportsTemperature(input.model.modelId)
  ) {
    body.temperature = input.temperature;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw providerRequestError("Anthropic", response.status, detail);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const content = data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    content,
    promptTokens: data.usage.input_tokens,
    completionTokens: data.usage.output_tokens,
    tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
    latencyMs,
  };
}

// ─── Google Gemini ───────────────────────────────────────────────────────────

async function executeGemini(input: ExecutionInput, apiKey: string): Promise<ExecutionOutput> {
  const startTime = Date.now();
  const modelId = input.model.modelId;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      maxOutputTokens: input.maxTokens ?? (input.model.maxOutputTokens as number | null) ?? 4096,
      ...(input.temperature != null ? { temperature: input.temperature } : {}),
    },
  };

  if (input.systemPrompt) {
    body.systemInstruction = { parts: [{ text: input.systemPrompt }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw providerRequestError("Gemini", response.status, detail);
  }

  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const content =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    content,
    promptTokens,
    completionTokens,
    tokensUsed: promptTokens + completionTokens,
    latencyMs,
  };
}

// ─── Mistral (OpenAI-compatible) ─────────────────────────────────────────────

async function executeMistral(input: ExecutionInput, apiKey: string): Promise<ExecutionOutput> {
  const startTime = Date.now();

  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) messages.push({ role: "system", content: input.systemPrompt });
  messages.push({ role: "user", content: input.prompt });

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model.modelId,
      messages,
      max_tokens: input.maxTokens ?? (input.model.maxOutputTokens as number | null) ?? 4096,
      ...(input.temperature != null ? { temperature: input.temperature } : {}),
    }),
    signal: input.signal,
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw providerRequestError("Mistral", response.status, detail);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;

  return { content, promptTokens, completionTokens, tokensUsed: promptTokens + completionTokens, latencyMs };
}

// ─── Ollama local runtime (OpenAI-compatible, loopback-only) ─────────────────

async function executeOllama(input: ExecutionInput): Promise<ExecutionOutput> {
  if (input.imageUrl) {
    throw new Error("Ollama constrained local provider does not accept image input.");
  }

  const configuredBaseUrl =
    typeof input.provider.baseUrl === "string" && input.provider.baseUrl.trim()
      ? input.provider.baseUrl.trim()
      : process.env["OLLAMA_BASE_URL"];

  const config = readOllamaLocalConfig({
    ...process.env,
    OLLAMA_ENABLED: "true",
    OLLAMA_BASE_URL: configuredBaseUrl,
    OLLAMA_MODEL: input.model.modelId,
  });

  const started = Date.now();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (input.systemPrompt) messages.push({ role: "system", content: input.systemPrompt });
  messages.push({ role: "user", content: input.prompt });

  const response = await fetch(config.baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      max_tokens:
        input.maxTokens ??
        (input.model.maxOutputTokens as number | null | undefined) ??
        4096,
      ...(input.temperature != null ? { temperature: input.temperature } : {}),
    }),
    signal: input.signal,
  });

  const latencyMs = Date.now() - started;
  if (!response.ok) throw providerRequestError("Ollama", response.status);

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;

  return {
    content,
    promptTokens,
    completionTokens,
    tokensUsed: data.usage?.total_tokens ?? promptTokens + completionTokens,
    latencyMs,
  };
}

// ─── ZeroLLM local sidecar (OpenAI-compatible, loopback-only) ───────────────

async function executeZeroLlm(input: ExecutionInput): Promise<ExecutionOutput> {
  if (input.imageUrl) {
    throw new Error("ZeroLLM constrained local provider does not accept image input.");
  }

  const configuredBaseUrl =
    typeof input.provider.baseUrl === "string" && input.provider.baseUrl.trim()
      ? input.provider.baseUrl.trim()
      : process.env["ZEROLLM_BASE_URL"];

  const config = readZeroLlmLocalConfig({
    ...process.env,
    ZEROLLM_ENABLED: "true",
    ZEROLLM_BASE_URL: configuredBaseUrl,
    ZEROLLM_MODEL: input.model.modelId,
  });

  const started = Date.now();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  messages.push({ role: "user", content: input.prompt });

  const response = await fetch(config.baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens:
        input.maxTokens ??
        (input.model.maxOutputTokens as number | null | undefined) ??
        4096,
      ...(input.temperature != null ? { temperature: input.temperature } : {}),
    }),
    signal: input.signal,
  });

  const latencyMs = Date.now() - started;
  if (!response.ok) {
    throw providerRequestError("ZeroLLM", response.status);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;

  return {
    content,
    promptTokens,
    completionTokens,
    tokensUsed:
      data.usage?.total_tokens ?? promptTokens + completionTokens,
    latencyMs,
  };
}

// ─── Replicate ───────────────────────────────────────────────────────────────

async function executeReplicate(input: ExecutionInput, apiKey: string): Promise<ExecutionOutput> {
  const startTime = Date.now();

  // Create prediction
  const createResponse = await fetch(
    `https://api.replicate.com/v1/models/${input.model.modelId}/predictions`,
    {
      method: "POST",
      headers: {
        // Replicate uses the "Token" auth scheme (unlike OpenAI/Mistral).
        Authorization: `Token ${apiKey}`,
        "content-type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({ input: { prompt: input.prompt } }),
      signal: input.signal,
    },
  );

  if (!createResponse.ok) {
    throw providerRequestError("Replicate", createResponse.status);
  }

  const prediction = (await createResponse.json()) as {
    id: string;
    status: string;
    output?: unknown;
    urls?: { get: string };
    error?: string;
  };

  // Poll if not immediately done
  let result = prediction;
  if (result.status !== "succeeded" && result.status !== "failed") {
    const pollUrl = result.urls?.get ?? `https://api.replicate.com/v1/predictions/${result.id}`;
    let attempts = 0;
    while (result.status !== "succeeded" && result.status !== "failed" && attempts < 90) {
      await new Promise<void>((r) => setTimeout(r, 1000));
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Token ${apiKey}` },
        signal: input.signal,
      });
      result = (await pollRes.json()) as typeof result;
      attempts++;
    }
  }

  const latencyMs = Date.now() - startTime;

  if (result.status === "failed") {
    throw new Error(`Replicate prediction failed: ${result.error ?? "unknown error"}`);
  }

  const output = Array.isArray(result.output)
    ? (result.output as string[]).join("\n")
    : String(result.output ?? "");

  return { content: output, promptTokens: 0, completionTokens: 0, tokensUsed: 0, latencyMs };
}

// ─── Quota fallback ───────────────────────────────────────────────────────────

/** Error message patterns that signal quota/billing exhaustion (not transient errors). */
const QUOTA_ERROR_PATTERNS = [
  "insufficient_quota",
  "exceeded your current quota",
  "rate limit exceeded",
  "billing_hard_limit_reached",
  "quota exceeded",
];

function isQuotaExhausted(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return QUOTA_ERROR_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Fallback: if the primary provider fails with a quota/billing error, retry
 * using Anthropic (claude-haiku — fast, cheap, OpenAI-compatible quality).
 * Only activates when ANTHROPIC_API_KEY is set.
 */
async function executeWithQuotaFallback(
  input: ExecutionInput,
  primaryFn: () => Promise<ExecutionOutput>,
): Promise<ExecutionOutput> {
  try {
    return await primaryFn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isQuotaExhausted(msg)) throw err;

    const anthropicKey = getProviderApiKey("anthropic");
    if (!anthropicKey) throw err; // no fallback configured

    console.warn(
      `[executeAI] Primary provider quota exhausted — falling back to Anthropic claude-haiku-4-5. Original error: ${msg}`,
    );

    return executeAnthropic(
      {
        ...input,
        provider: { slug: "anthropic" },
        model: { ...input.model, modelId: "claude-haiku-4-5" },
      },
      anthropicKey,
    );
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * Execute an AI call against the appropriate provider.
 * Throws on failure — callers handle fallback logic.
 * When input.observability is set, fires-and-forgets a log to ai_execution_logs.
 */
async function executeAIInternal(
  input: ExecutionInput,
  allowQuotaFallback: boolean,
): Promise<ExecutionOutput> {
  const slug = input.provider.slug.toLowerCase();
  const localProvider = slug === "zerollm" || slug === "ollama";
  const apiKey = localProvider ? null : getProviderApiKey(input.provider.slug);

  if (!localProvider && !apiKey) {
    const hint = input.provider.slug.toUpperCase().replace(/-/g, "_");
    throw new Error(
      `No API key configured for provider '${input.provider.slug}'. ` +
        `Set the ${hint}_API_KEY (or equivalent) environment variable.`,
    );
  }

  const startedAt = new Date();

  let result: ExecutionOutput;
  try {
    switch (slug) {
      case "openai":
        result = allowQuotaFallback
          ? await executeWithQuotaFallback(input, () => executeOpenAI(input, apiKey!))
          : await executeOpenAI(input, apiKey!);
        break;
      case "anthropic":
        result = await executeAnthropic(input, apiKey!);
        break;
      case "google":
      case "google-gemini":
      case "gemini":
        result = allowQuotaFallback
          ? await executeWithQuotaFallback(input, () => executeGemini(input, apiKey!))
          : await executeGemini(input, apiKey!);
        break;
      case "replicate":
        result = await executeReplicate(input, apiKey!);
        break;
      case "mistral":
        result = allowQuotaFallback
          ? await executeWithQuotaFallback(input, () => executeMistral(input, apiKey!))
          : await executeMistral(input, apiKey!);
        break;
      case "ollama":
        // Ollama is loopback-only and never falls back to an external provider.
        result = await executeOllama(input);
        break;
      case "zerollm":
        // Local provider never falls back to an external provider.
        result = await executeZeroLlm(input);
        break;
      default:
        throw new Error(
          `Unsupported provider slug '${input.provider.slug}'. Add a handler in aiExecutionService.`,
        );
    }
  } catch (err) {
    if (input.observability) {
      logExecutionSafe({
        ...input.observability,
        providerName: input.observability.providerName ?? input.provider.slug,
        modelName:    input.observability.modelName    ?? input.model.modelId,
        requestType:  input.observability.requestType  ?? "text",
        promptTokens:     0,
        completionTokens: 0,
        latencyMs:   Date.now() - startedAt.getTime(),
        startedAt,
        finishedAt:  new Date(),
        status:      "failed",
        errorMessage: String(err),
      });
    }
    throw err;
  }

  if (input.observability) {
    logExecutionSafe({
      ...input.observability,
      providerName: input.observability.providerName ?? input.provider.slug,
      modelName:    input.observability.modelName    ?? input.model.modelId,
      requestType:  input.observability.requestType  ?? "text",
      promptTokens:     result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs:   result.latencyMs,
      startedAt,
      finishedAt:  new Date(),
      status:      "success",
    });
  }

  return result;
}


/**
 * One-shot provider execution for constrained coding. No provider fallback and no retry.
 */
export async function executeAINoFallback(
  input: ExecutionInput,
): Promise<ExecutionOutput> {
  return executeAIInternal(input, false);
}

/**
 * Legacy execution path. Existing quota fallback behavior is preserved for callers
 * outside the constrained coding execution gate.
 */
export async function executeAI(input: ExecutionInput): Promise<ExecutionOutput> {
  return executeAIInternal(input, true);
}
