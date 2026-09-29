
import {
  CONSTRAINED_MODEL_CAPABILITIES,
  ProviderInvocationError,
  type ConstrainedModelProvider,
} from "./localCodingAiModelAdapterService.js";
import {
  releaseOllamaWorkerReservation,
  reserveOllamaWorker,
} from "./ollamaWorkerRegistryService.js";
import {
  enqueueRemoteOllamaInvocation,
  hasRemoteOllamaWorker,
  waitForRemoteOllamaInvocation,
} from "./remoteOllamaWorkerService.js";
import { ensureGcpOllamaVmStarted } from "./gcpOllamaVmLifecycleService.js";

function parseBoundedPrompt(
  input: string,
): { system: string; user: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ProviderInvocationError(
      "Bounded coding model input is malformed",
      "BAD_REQUEST",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderInvocationError(
      "Bounded coding model input is invalid",
      "BAD_REQUEST",
    );
  }

  const value = parsed as Record<string, unknown>;

  if (
    value["version"] !== 1 ||
    typeof value["system"] !== "string" ||
    typeof value["user"] !== "string" ||
    Object.keys(value).some(
      (key) => !["version", "system", "user"].includes(key),
    )
  ) {
    throw new ProviderInvocationError(
      "Bounded coding model input is invalid",
      "BAD_REQUEST",
    );
  }

  return {
    system: value["system"],
    user: value["user"],
  };
}

function parseStructuredJsonText(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try next bounded candidate
    }
  }

  throw new ProviderInvocationError(
    "Ollama worker returned malformed structured JSON: " +
      trimmed.slice(0, 500),
    "UNKNOWN",
  );
}

function mapHttpFailure(status: number): ProviderInvocationError {
  if (status === 429) {
    return new ProviderInvocationError(
      "Ollama worker is rate limited",
      "RATE_LIMIT",
    );
  }

  if ([400, 404, 422].includes(status)) {
    return new ProviderInvocationError(
      "Ollama worker rejected the request",
      "BAD_REQUEST",
    );
  }

  if ([401, 403].includes(status)) {
    return new ProviderInvocationError(
      "Ollama worker authentication failed",
      "AUTH",
    );
  }

  if (status >= 500) {
    return new ProviderInvocationError(
      "Ollama worker is unavailable",
      "UNAVAILABLE",
    );
  }

  return new ProviderInvocationError(
    "Ollama worker invocation failed",
    "UNKNOWN",
  );
}

export function createScheduledOllamaProviderAdapter(input: {
  modelId: string;
  apiKey?: string;
}): ConstrainedModelProvider {
  return {
    provider: "ollama",
    model: input.modelId,
    capabilities: CONSTRAINED_MODEL_CAPABILITIES,

    async invoke(request, context) {
      const bounded = parseBoundedPrompt(request.input);

      // Prefer a directly registered hosted worker when capacity is available.
      // Remote pull workers remain a fallback for environments that cannot
      // expose an authenticated Ollama endpoint.
      const reservation = await reserveOllamaWorker(input.modelId);

      if (!reservation) {
        let remoteReady = await hasRemoteOllamaWorker(input.modelId);

        if (!remoteReady) {
          remoteReady = await ensureGcpOllamaVmStarted().catch(() => false);
        }

        if (remoteReady) {
          const job = await enqueueRemoteOllamaInvocation({
            requestId: request.requestId,
            modelId: input.modelId,
            input: request.input,
            responseFormat: request.responseFormat as unknown as Record<string, unknown>,
            maxOutputTokens: request.maxOutputTokens,
          });
          return await waitForRemoteOllamaInvocation(
            job.id,
            context.signal,
          ) as {
            providerRequestId?: string;
            output:
              | { type: "text"; text: string }
              | { type: "structured"; value: unknown };
            usage: { inputTokens: number; outputTokens: number; totalTokens: number };
          };
        }

        throw new ProviderInvocationError(
          "No healthy Ollama worker has available capacity and GCP auto-start is unavailable",
          "UNAVAILABLE",
        );
      }

      const started = Date.now();
      let outcome: "success" | "failure" = "failure";

      try {
        const apiKey = (input.apiKey ?? process.env["OLLAMA_WORKER_API_KEY"] ?? "").trim();
        const response = await fetch(
          reservation.endpointUrl + "/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            },
            body: JSON.stringify({
              model: reservation.modelId,
              messages: [
                {
                  role: "system",
                  content:
                    request.responseFormat.type === "structured"
                      ? [
                          bounded.system,
                          "",
                          "Return exactly one JSON object and no Markdown.",
                          "The JSON object must satisfy this schema:",
                          JSON.stringify(request.responseFormat.jsonSchema),
                        ].join("\n")
                      : bounded.system,
                },
                {
                  role: "user",
                  content: bounded.user,
                },
              ],
              stream: false,
              temperature: 0,
              max_tokens: request.maxOutputTokens,
              ...(request.responseFormat.type === "structured"
                ? {
                    response_format: {
                      type: "json_object",
                    },
                  }
                : {}),
            }),
            signal: context.signal,
          },
        );

        if (!response.ok) {
          throw mapHttpFailure(response.status);
        }

        const data = (await response.json()) as {
          id?: unknown;
          choices?: Array<{
            message?: { content?: unknown };
          }>;
          usage?: {
            prompt_tokens?: unknown;
            completion_tokens?: unknown;
            total_tokens?: unknown;
          };
        };

        const text =
          data.choices?.[0]?.message?.content;

        if (typeof text !== "string") {
          throw new ProviderInvocationError(
            "Ollama worker returned a malformed response",
            "UNKNOWN",
          );
        }

        let output:
          | { type: "text"; text: string }
          | { type: "structured"; value: unknown };

        if (request.responseFormat.type === "structured") {
          output = {
            type: "structured",
            value: parseStructuredJsonText(text),
          };
        } else {
          output = {
            type: "text",
            text,
          };
        }

        const inputTokens =
          typeof data.usage?.prompt_tokens === "number" &&
          Number.isInteger(data.usage.prompt_tokens) &&
          data.usage.prompt_tokens >= 0
            ? data.usage.prompt_tokens
            : 0;

        const outputTokens =
          typeof data.usage?.completion_tokens === "number" &&
          Number.isInteger(data.usage.completion_tokens) &&
          data.usage.completion_tokens >= 0
            ? data.usage.completion_tokens
            : 0;

        const totalTokens =
          typeof data.usage?.total_tokens === "number" &&
          Number.isInteger(data.usage.total_tokens) &&
          data.usage.total_tokens >= inputTokens + outputTokens
            ? data.usage.total_tokens
            : inputTokens + outputTokens;

        outcome = "success";

        return {
          ...(typeof data.id === "string" && data.id
            ? {
                providerRequestId:
                  data.id.slice(0, 200),
              }
            : {}),
          output,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens,
          },
        };
      } catch (error) {
        if (error instanceof ProviderInvocationError) {
          throw error;
        }

        throw new ProviderInvocationError(
          "Ollama worker is unavailable",
          "UNAVAILABLE",
        );
      } finally {
        await releaseOllamaWorkerReservation(
          reservation.id,
          outcome,
          Date.now() - started,
        ).catch(() => undefined);
      }
    },
  };
}
