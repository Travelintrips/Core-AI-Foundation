import { getProviderApiKey } from "./aiSecretService.js";
import { logExecutionSafe, type ObservabilityContext } from "./observabilityService.js";

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
}

export interface ExecutionOutput {
  content: string;
  promptTokens: number;
  completionTokens: number;
  tokensUsed: number;
  latencyMs: number;
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function executeOpenAI(input: ExecutionInput, apiKey: string): Promise<ExecutionOutput> {
  const startTime = Date.now();

  const modelId = input.model.modelId;
  const isOSeries = /^o\d/i.test(modelId);
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
  if (!isOSeries) body.temperature = input.temperature ?? 0.7;

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
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
  if (input.temperature != null) body.temperature = input.temperature;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
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
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
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
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mistral API error ${response.status}: ${errText}`);
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

// ─── Replicate ───────────────────────────────────────────────────────────────

async function executeReplicate(input: ExecutionInput, apiKey: string): Promise<ExecutionOutput> {
  const startTime = Date.now();

  // Create prediction
  const createResponse = await fetch(
    `https://api.replicate.com/v1/models/${input.model.modelId}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({ input: { prompt: input.prompt } }),
    },
  );

  if (!createResponse.ok) {
    const errText = await createResponse.text();
    throw new Error(`Replicate API error ${createResponse.status}: ${errText}`);
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
        headers: { Authorization: `Bearer ${apiKey}` },
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

// ─── Main dispatcher ─────────────────────────────────────────────────────────

/**
 * Execute an AI call against the appropriate provider.
 * Throws on failure — callers handle fallback logic.
 * When input.observability is set, fires-and-forgets a log to ai_execution_logs.
 */
export async function executeAI(input: ExecutionInput): Promise<ExecutionOutput> {
  const apiKey = getProviderApiKey(input.provider.slug);

  if (!apiKey) {
    const hint = input.provider.slug.toUpperCase().replace(/-/g, "_");
    throw new Error(
      `No API key configured for provider '${input.provider.slug}'. ` +
        `Set the ${hint}_API_KEY (or equivalent) environment variable.`,
    );
  }

  const slug = input.provider.slug.toLowerCase();
  const startedAt = new Date();

  let result: ExecutionOutput;
  try {
    switch (slug) {
      case "openai":
        result = await executeOpenAI(input, apiKey);
        break;
      case "anthropic":
        result = await executeAnthropic(input, apiKey);
        break;
      case "google":
      case "google-gemini":
      case "gemini":
        result = await executeGemini(input, apiKey);
        break;
      case "replicate":
        result = await executeReplicate(input, apiKey);
        break;
      case "mistral":
        result = await executeMistral(input, apiKey);
        break;
      default:
        throw new Error(
          `Unsupported provider slug '${input.provider.slug}'. Add a handler in aiExecutionService.`,
        );
    }
  } catch (err) {
    // Log failure (fire-and-forget)
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

  // Log success (fire-and-forget)
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
