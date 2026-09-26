
import {
  CONSTRAINED_MODEL_CAPABILITIES,
  ProviderInvocationError,
  type ConstrainedModelProvider,
} from "./localCodingAiModelAdapterService.js";
import {
  releaseOllamaWorkerReservation,
  reserveOllamaWorker,
} from "./ollamaWorkerRegistryService.js";

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
}): ConstrainedModelProvider {
  return {
    provider: "ollama",
    model: input.modelId,
    capabilities: CONSTRAINED_MODEL_CAPABILITIES,

    async invoke(request, context) {
      const bounded = parseBoundedPrompt(request.input);
      const reservation = await reserveOllamaWorker(input.modelId);

      if (!reservation) {
        throw new ProviderInvocationError(
          "No healthy Ollama worker has available capacity for the requested model",
          "UNAVAILABLE",
        );
      }

      const started = Date.now();
      let outcome: "success" | "failure" = "failure";

      try {
        const response = await fetch(
          reservation.endpointUrl + "/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              model: reservation.modelId,
              messages: [
                {
                  role: "system",
                  content: bounded.system,
                },
                {
                  role: "user",
                  content: bounded.user,
                },
              ],
              stream: false,
              temperature: 0,
              max_tokens: request.maxOutputTokens,
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
          try {
            output = {
              type: "structured",
              value: JSON.parse(text) as unknown,
            };
          } catch {
            throw new ProviderInvocationError(
              "Ollama worker returned malformed structured JSON",
              "UNKNOWN",
            );
          }
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
