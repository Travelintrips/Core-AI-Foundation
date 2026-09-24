const MAX_INPUT_CHARS = 200_000;
const MAX_SCHEMA_CHARS = 32_000;
const MAX_OUTPUT_CHARS = 256_000;
const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 8_192;

export const MODEL_INVOCATION_LIMITS = Object.freeze({
  maxInputChars: MAX_INPUT_CHARS,
  maxSchemaChars: MAX_SCHEMA_CHARS,
  maxOutputChars: MAX_OUTPUT_CHARS,
  minTimeoutMs: MIN_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
});

export interface ModelInvocationCapabilities {
  tools: false;
  shell: false;
  repositoryConnector: false;
  filesystem: false;
  network: false;
  browser: false;
  git: false;
  commitPushMerge: false;
}

export const CONSTRAINED_MODEL_CAPABILITIES: ModelInvocationCapabilities =
  Object.freeze({
    tools: false,
    shell: false,
    repositoryConnector: false,
    filesystem: false,
    network: false,
    browser: false,
    git: false,
    commitPushMerge: false,
  });

export interface ModelTarget {
  provider: string;
  model: string;
}

export interface TextModelResponseFormat {
  type: "text";
}

export interface StructuredModelResponseFormat {
  type: "structured";
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}

export type ModelResponseFormat =
  | TextModelResponseFormat
  | StructuredModelResponseFormat;

export interface ModelRequest {
  requestId: string;
  target: ModelTarget;
  input: string;
  responseFormat: ModelResponseFormat;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ModelTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelInvocationMetadata {
  requestId: string;
  providerRequestId?: string;
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  usage: ModelTokenUsage;
  timeoutMs: number;
  maxOutputTokens: number;
  attempts: 1;
  retries: 0;
  fallbackUsed: false;
  capabilities: ModelInvocationCapabilities;
}

export interface ModelTextOutput {
  type: "text";
  text: string;
}

export interface ModelStructuredOutput {
  type: "structured";
  value: unknown;
}

export interface ModelResponse {
  output: ModelTextOutput | ModelStructuredOutput;
  metadata: ModelInvocationMetadata;
}

export interface ProviderModelInvocation {
  requestId: string;
  input: string;
  responseFormat: ModelResponseFormat;
  maxOutputTokens: number;
  capabilities: ModelInvocationCapabilities;
}

export interface ProviderModelResult {
  providerRequestId?: string;
  output: ModelTextOutput | ModelStructuredOutput;
  usage: ModelTokenUsage;
}

export type ProviderInvocationErrorCode =
  | "AUTH"
  | "RATE_LIMIT"
  | "UNAVAILABLE"
  | "BAD_REQUEST"
  | "UNKNOWN";

export class ProviderInvocationError extends Error {
  constructor(
    message: string,
    readonly code: ProviderInvocationErrorCode,
  ) {
    super(message);
    this.name = "ProviderInvocationError";
  }
}

export interface ConstrainedModelProvider {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: ModelInvocationCapabilities;
  invoke(
    request: ProviderModelInvocation,
    context: { signal: AbortSignal },
  ): Promise<ProviderModelResult>;
}

export type ModelInvocationErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_TARGET"
  | "POLICY_VIOLATION"
  | "TIMEOUT"
  | "CANCELLED"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_ERROR"
  | "MALFORMED_RESPONSE"
  | "OUTPUT_LIMIT_EXCEEDED";

export class ModelInvocationError extends Error {
  constructor(
    message: string,
    readonly code: ModelInvocationErrorCode,
    readonly details: {
      provider?: string;
      model?: string;
      latencyMs?: number;
      retryable: boolean;
    },
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ModelInvocationError";
  }
}

const REQUEST_KEYS = new Set([
  "requestId",
  "target",
  "input",
  "responseFormat",
  "maxOutputTokens",
  "timeoutMs",
  "signal",
]);

const RESULT_KEYS = new Set([
  "providerRequestId",
  "output",
  "usage",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeIdentifier(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\r\n\0]/.test(value)
  );
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new ModelInvocationError(
      context + " contains unsupported fields: " + unexpected.join(", "),
      "POLICY_VIOLATION",
      { retryable: false },
    );
  }
}

function serializedSize(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return -1;
    return serialized.length;
  } catch {
    return -1;
  }
}

function assertCapabilities(
  capabilities: unknown,
  provider: string,
  model: string,
): asserts capabilities is ModelInvocationCapabilities {
  const value = isRecord(capabilities) ? capabilities : null;
  if (
    !value ||
    value.tools !== false ||
    value.shell !== false ||
    value.repositoryConnector !== false ||
    value.filesystem !== false ||
    value.network !== false ||
    value.browser !== false ||
    value.git !== false ||
    value.commitPushMerge !== false
  ) {
    throw new ModelInvocationError(
      "Provider is not configured for constrained non-agentic invocation",
      "POLICY_VIOLATION",
      { provider, model, retryable: false },
    );
  }
}

function validateResponseFormat(format: unknown): ModelResponseFormat {
  if (!isRecord(format)) {
    throw new ModelInvocationError(
      "responseFormat must be an object",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }

  if (format.type === "text") {
    assertOnlyKeys(format, new Set(["type"]), "Text response format");
    return { type: "text" };
  }

  if (format.type === "structured") {
    assertOnlyKeys(
      format,
      new Set(["type", "schemaName", "jsonSchema"]),
      "Structured response format",
    );
    if (!isSafeIdentifier(format.schemaName, 120)) {
      throw new ModelInvocationError(
        "Structured response schemaName is invalid",
        "INVALID_REQUEST",
        { retryable: false },
      );
    }
    if (!isRecord(format.jsonSchema)) {
      throw new ModelInvocationError(
        "Structured response jsonSchema must be an object",
        "INVALID_REQUEST",
        { retryable: false },
      );
    }
    const schemaChars = serializedSize(format.jsonSchema);
    if (schemaChars < 0 || schemaChars > MAX_SCHEMA_CHARS) {
      throw new ModelInvocationError(
        "Structured response schema exceeds the bounded size",
        "INVALID_REQUEST",
        { retryable: false },
      );
    }
    return {
      type: "structured",
      schemaName: format.schemaName,
      jsonSchema: format.jsonSchema,
    };
  }

  throw new ModelInvocationError(
    "Only text or structured model responses are allowed",
    "POLICY_VIOLATION",
    { retryable: false },
  );
}

function validateRequest(request: ModelRequest): ModelResponseFormat {
  if (!isRecord(request)) {
    throw new ModelInvocationError(
      "Model request must be an object",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }
  assertOnlyKeys(request, REQUEST_KEYS, "Model request");

  if (!isSafeIdentifier(request.requestId, 160)) {
    throw new ModelInvocationError(
      "requestId is required and must be bounded",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }
  if (!isRecord(request.target)) {
    throw new ModelInvocationError(
      "Model target is required",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }
  assertOnlyKeys(request.target, new Set(["provider", "model"]), "Model target");
  if (
    !isSafeIdentifier(request.target.provider, 120) ||
    !isSafeIdentifier(request.target.model, 200)
  ) {
    throw new ModelInvocationError(
      "Model provider/model target is invalid",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }
  if (
    typeof request.input !== "string" ||
    request.input.length === 0 ||
    request.input.length > MAX_INPUT_CHARS
  ) {
    throw new ModelInvocationError(
      "Model input is empty or exceeds the bounded size",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }
  if (
    !Number.isInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 ||
    request.maxOutputTokens > MAX_OUTPUT_TOKENS
  ) {
    throw new ModelInvocationError(
      "maxOutputTokens is outside the allowed bound",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }
  if (
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < MIN_TIMEOUT_MS ||
    request.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new ModelInvocationError(
      "timeoutMs is outside the allowed bound",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }
  if (
    request.signal !== undefined &&
    !(request.signal instanceof AbortSignal)
  ) {
    throw new ModelInvocationError(
      "signal must be an AbortSignal",
      "INVALID_REQUEST",
      { retryable: false },
    );
  }

  return validateResponseFormat(request.responseFormat);
}

function validateUsage(
  usage: unknown,
  maxOutputTokens: number,
): ModelTokenUsage {
  if (!isRecord(usage)) {
    throw new ModelInvocationError(
      "Provider token usage is missing",
      "MALFORMED_RESPONSE",
      { retryable: false },
    );
  }

  const values = [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
  ];
  if (
    values.some(
      (value) =>
        !Number.isInteger(value) ||
        typeof value !== "number" ||
        value < 0,
    )
  ) {
    throw new ModelInvocationError(
      "Provider token usage is invalid",
      "MALFORMED_RESPONSE",
      { retryable: false },
    );
  }

  const inputTokens = usage.inputTokens as number;
  const outputTokens = usage.outputTokens as number;
  const totalTokens = usage.totalTokens as number;

  if (totalTokens < inputTokens + outputTokens) {
    throw new ModelInvocationError(
      "Provider total token usage is inconsistent",
      "MALFORMED_RESPONSE",
      { retryable: false },
    );
  }
  if (outputTokens > maxOutputTokens) {
    throw new ModelInvocationError(
      "Provider exceeded the requested output token limit",
      "OUTPUT_LIMIT_EXCEEDED",
      { retryable: false },
    );
  }

  return { inputTokens, outputTokens, totalTokens };
}

function validateProviderResult(
  result: unknown,
  requestedFormat: ModelResponseFormat,
  maxOutputTokens: number,
): {
  providerRequestId?: string;
  output: ModelTextOutput | ModelStructuredOutput;
  usage: ModelTokenUsage;
} {
  if (!isRecord(result)) {
    throw new ModelInvocationError(
      "Provider returned a non-object response",
      "MALFORMED_RESPONSE",
      { retryable: false },
    );
  }
  assertOnlyKeys(result, RESULT_KEYS, "Provider response");

  const providerRequestId =
    result.providerRequestId === undefined
      ? undefined
      : isSafeIdentifier(result.providerRequestId, 200)
        ? result.providerRequestId
        : null;
  if (providerRequestId === null) {
    throw new ModelInvocationError(
      "Provider request id is invalid",
      "MALFORMED_RESPONSE",
      { retryable: false },
    );
  }

  const output = isRecord(result.output) ? result.output : null;
  if (!output) {
    throw new ModelInvocationError(
      "Provider output is missing",
      "MALFORMED_RESPONSE",
      { retryable: false },
    );
  }

  let normalizedOutput: ModelTextOutput | ModelStructuredOutput;
  if (requestedFormat.type === "text") {
    if (output.type !== "text") {
      throw new ModelInvocationError(
        "Provider response type does not match text request",
        "MALFORMED_RESPONSE",
        { retryable: false },
      );
    }
    assertOnlyKeys(output, new Set(["type", "text"]), "Provider text output");
    if (
      typeof output.text !== "string" ||
      output.text.length > MAX_OUTPUT_CHARS
    ) {
      throw new ModelInvocationError(
        "Provider text output is malformed or oversized",
        typeof output.text === "string"
          ? "OUTPUT_LIMIT_EXCEEDED"
          : "MALFORMED_RESPONSE",
        { retryable: false },
      );
    }
    normalizedOutput = { type: "text", text: output.text };
  } else {
    if (output.type !== "structured") {
      throw new ModelInvocationError(
        "Provider response type does not match structured request",
        "MALFORMED_RESPONSE",
        { retryable: false },
      );
    }
    assertOnlyKeys(
      output,
      new Set(["type", "value"]),
      "Provider structured output",
    );
    const chars = serializedSize(output.value);
    if (chars < 0) {
      throw new ModelInvocationError(
        "Provider structured output is not JSON serializable",
        "MALFORMED_RESPONSE",
        { retryable: false },
      );
    }
    if (chars > MAX_OUTPUT_CHARS) {
      throw new ModelInvocationError(
        "Provider structured output exceeds the bounded size",
        "OUTPUT_LIMIT_EXCEEDED",
        { retryable: false },
      );
    }
    normalizedOutput = { type: "structured", value: output.value };
  }

  return {
    ...(providerRequestId ? { providerRequestId } : {}),
    output: normalizedOutput,
    usage: validateUsage(result.usage, maxOutputTokens),
  };
}

function mapProviderError(
  error: unknown,
  provider: string,
  model: string,
  latencyMs: number,
): ModelInvocationError {
  if (error instanceof ModelInvocationError) return error;

  if (error instanceof ProviderInvocationError) {
    const mapped: Record<ProviderInvocationErrorCode, ModelInvocationErrorCode> = {
      AUTH: "PROVIDER_AUTH",
      RATE_LIMIT: "PROVIDER_RATE_LIMIT",
      UNAVAILABLE: "PROVIDER_UNAVAILABLE",
      BAD_REQUEST: "PROVIDER_BAD_REQUEST",
      UNKNOWN: "PROVIDER_ERROR",
    };
    return new ModelInvocationError(
      "Constrained model provider failed with " + mapped[error.code],
      mapped[error.code],
      {
        provider,
        model,
        latencyMs,
        retryable: error.code === "RATE_LIMIT" || error.code === "UNAVAILABLE",
      },
      { cause: error },
    );
  }

  return new ModelInvocationError(
    "Constrained model provider failed",
    "PROVIDER_ERROR",
    { provider, model, latencyMs, retryable: false },
    { cause: error },
  );
}

export class ConstrainedModelInvocationAdapter {
  constructor(private readonly providerAdapter: ConstrainedModelProvider) {}

  async invoke(request: ModelRequest): Promise<ModelResponse> {
    const responseFormat = validateRequest(request);
    const provider = this.providerAdapter.provider;
    const model = this.providerAdapter.model;

    if (
      !isSafeIdentifier(provider, 120) ||
      !isSafeIdentifier(model, 200)
    ) {
      throw new ModelInvocationError(
        "Provider identity is invalid",
        "POLICY_VIOLATION",
        { retryable: false },
      );
    }

    assertCapabilities(this.providerAdapter.capabilities, provider, model);

    if (
      request.target.provider !== provider ||
      request.target.model !== model
    ) {
      throw new ModelInvocationError(
        "Requested model target does not match the explicitly configured provider",
        "INVALID_TARGET",
        { provider, model, retryable: false },
      );
    }

    if (request.signal?.aborted) {
      throw new ModelInvocationError(
        "Model invocation was cancelled before dispatch",
        "CANCELLED",
        { provider, model, latencyMs: 0, retryable: false },
      );
    }

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const controller = new AbortController();

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectGate: ((reason: ModelInvocationError) => void) | undefined;

    const cancellationGate = new Promise<never>((_resolve, reject) => {
      rejectGate = reject;
    });

    const rejectCancelled = () => {
      controller.abort();
      rejectGate?.(
        new ModelInvocationError(
          "Model invocation was cancelled",
          "CANCELLED",
          {
            provider,
            model,
            latencyMs: Math.max(0, Date.now() - startedAtMs),
            retryable: false,
          },
        ),
      );
    };

    request.signal?.addEventListener("abort", rejectCancelled, { once: true });

    timeout = setTimeout(() => {
      controller.abort();
      rejectGate?.(
        new ModelInvocationError(
          "Model invocation exceeded the bounded timeout",
          "TIMEOUT",
          {
            provider,
            model,
            latencyMs: Math.max(0, Date.now() - startedAtMs),
            retryable: true,
          },
        ),
      );
    }, request.timeoutMs);

    const providerRequest: ProviderModelInvocation = {
      requestId: request.requestId,
      input: request.input,
      responseFormat,
      maxOutputTokens: request.maxOutputTokens,
      capabilities: CONSTRAINED_MODEL_CAPABILITIES,
    };

    try {
      const result = await Promise.race([
        this.providerAdapter
          .invoke(providerRequest, { signal: controller.signal })
          .catch((error: unknown) => {
            throw mapProviderError(
              error,
              provider,
              model,
              Math.max(0, Date.now() - startedAtMs),
            );
          }),
        cancellationGate,
      ]);

      const validated = validateProviderResult(
        result,
        responseFormat,
        request.maxOutputTokens,
      );
      const completedAtMs = Date.now();

      return {
        output: validated.output,
        metadata: {
          requestId: request.requestId,
          ...(validated.providerRequestId
            ? { providerRequestId: validated.providerRequestId }
            : {}),
          provider,
          model,
          startedAt,
          completedAt: new Date(completedAtMs).toISOString(),
          latencyMs: Math.max(0, completedAtMs - startedAtMs),
          usage: validated.usage,
          timeoutMs: request.timeoutMs,
          maxOutputTokens: request.maxOutputTokens,
          attempts: 1,
          retries: 0,
          fallbackUsed: false,
          capabilities: CONSTRAINED_MODEL_CAPABILITIES,
        },
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      request.signal?.removeEventListener("abort", rejectCancelled);
    }
  }
}

export function createConstrainedModelInvocationAdapter(
  provider: ConstrainedModelProvider,
): ConstrainedModelInvocationAdapter {
  return new ConstrainedModelInvocationAdapter(provider);
}
