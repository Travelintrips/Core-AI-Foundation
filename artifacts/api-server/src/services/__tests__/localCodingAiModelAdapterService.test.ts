import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSTRAINED_MODEL_CAPABILITIES,
  MODEL_INVOCATION_LIMITS,
  ConstrainedModelInvocationAdapter,
  ModelInvocationError,
  ProviderInvocationError,
  type ConstrainedModelProvider,
  type ModelRequest,
  type ProviderModelInvocation,
  type ProviderModelResult,
} from "../localCodingAiModelAdapterService.js";

const textRequest = (
  overrides: Partial<ModelRequest> = {},
): ModelRequest => ({
  requestId: "req-1",
  target: {
    provider: "fake-provider",
    model: "fake-model-1",
  },
  input: "Return only a bounded coding proposal.",
  responseFormat: { type: "text" },
  maxOutputTokens: 256,
  timeoutMs: 1_000,
  ...overrides,
});

class FakeProvider implements ConstrainedModelProvider {
  readonly provider = "fake-provider";
  readonly model = "fake-model-1";
  readonly capabilities = CONSTRAINED_MODEL_CAPABILITIES;
  readonly calls: Array<{
    request: ProviderModelInvocation;
    signal: AbortSignal;
  }> = [];

  constructor(
    private readonly handler: (
      request: ProviderModelInvocation,
      signal: AbortSignal,
    ) => Promise<ProviderModelResult>,
  ) {}

  async invoke(
    request: ProviderModelInvocation,
    context: { signal: AbortSignal },
  ): Promise<ProviderModelResult> {
    this.calls.push({ request, signal: context.signal });
    return this.handler(request, context.signal);
  }
}

const okTextResult = (): ProviderModelResult => ({
  providerRequestId: "provider-request-1",
  output: { type: "text", text: "{\"version\":1}" },
  usage: {
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  },
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConstrainedModelInvocationAdapter", () => {
  it("invokes exactly one explicitly selected provider with all agentic capabilities disabled", async () => {
    const provider = new FakeProvider(async () => okTextResult());
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    const response = await adapter.invoke(textRequest());

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request).toEqual({
      requestId: "req-1",
      input: "Return only a bounded coding proposal.",
      responseFormat: { type: "text" },
      maxOutputTokens: 256,
      capabilities: {
        tools: false,
        shell: false,
        repositoryConnector: false,
        filesystem: false,
        network: false,
        browser: false,
        git: false,
        commitPushMerge: false,
      },
    });
    expect(Object.keys(provider.calls[0]?.request ?? {}).sort()).toEqual([
      "capabilities",
      "input",
      "maxOutputTokens",
      "requestId",
      "responseFormat",
    ]);
    expect(response.output).toEqual({
      type: "text",
      text: "{\"version\":1}",
    });
    expect(response.metadata).toMatchObject({
      requestId: "req-1",
      providerRequestId: "provider-request-1",
      provider: "fake-provider",
      model: "fake-model-1",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      },
      timeoutMs: 1_000,
      maxOutputTokens: 256,
      attempts: 1,
      retries: 0,
      fallbackUsed: false,
      capabilities: CONSTRAINED_MODEL_CAPABILITIES,
    });
    expect(response.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("supports structured response mode without adding tools or arbitrary provider options", async () => {
    const provider = new FakeProvider(async () => ({
      output: {
        type: "structured",
        value: {
          version: 1,
          operations: [],
        },
      },
      usage: {
        inputTokens: 30,
        outputTokens: 10,
        totalTokens: 40,
      },
    }));
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    const response = await adapter.invoke(
      textRequest({
        responseFormat: {
          type: "structured",
          schemaName: "coding_proposal_v1",
          jsonSchema: {
            type: "object",
            required: ["version", "operations"],
          },
        },
      }),
    );

    expect(response.output).toEqual({
      type: "structured",
      value: {
        version: 1,
        operations: [],
      },
    });
    expect(provider.calls[0]?.request.responseFormat.type).toBe("structured");
  });

  it("fails closed on target mismatch and never routes or falls back to another model", async () => {
    const provider = new FakeProvider(async () => okTextResult());
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    await expect(
      adapter.invoke(
        textRequest({
          target: {
            provider: "another-provider",
            model: "another-model",
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_TARGET",
    });

    expect(provider.calls).toHaveLength(0);
  });

  it("rejects unexpected request fields such as tools before provider invocation", async () => {
    const provider = new FakeProvider(async () => okTextResult());
    const adapter = new ConstrainedModelInvocationAdapter(provider);
    const request = {
      ...textRequest(),
      tools: [{ type: "shell" }],
    } as unknown as ModelRequest;

    await expect(adapter.invoke(request)).rejects.toMatchObject({
      code: "POLICY_VIOLATION",
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a provider that advertises any agentic capability", async () => {
    const provider = new FakeProvider(async () => okTextResult());
    const unsafeProvider = provider as unknown as ConstrainedModelProvider & {
      capabilities: Record<string, boolean>;
    };
    unsafeProvider.capabilities = {
      ...CONSTRAINED_MODEL_CAPABILITIES,
      network: true,
    };

    const adapter = new ConstrainedModelInvocationAdapter(
      unsafeProvider as unknown as ConstrainedModelProvider,
    );

    await expect(adapter.invoke(textRequest())).rejects.toMatchObject({
      code: "POLICY_VIOLATION",
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("enforces bounded input, timeout, output tokens, and structured schema", async () => {
    const provider = new FakeProvider(async () => okTextResult());
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    const invalidRequests: ModelRequest[] = [
      textRequest({
        input: "x".repeat(MODEL_INVOCATION_LIMITS.maxInputChars + 1),
      }),
      textRequest({
        timeoutMs: MODEL_INVOCATION_LIMITS.maxTimeoutMs + 1,
      }),
      textRequest({
        timeoutMs: MODEL_INVOCATION_LIMITS.minTimeoutMs - 1,
      }),
      textRequest({
        maxOutputTokens: MODEL_INVOCATION_LIMITS.maxOutputTokens + 1,
      }),
      textRequest({
        responseFormat: {
          type: "structured",
          schemaName: "too-large",
          jsonSchema: {
            description: "x".repeat(
              MODEL_INVOCATION_LIMITS.maxSchemaChars + 1,
            ),
          },
        },
      }),
    ];

    for (const request of invalidRequests) {
      await expect(adapter.invoke(request)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    expect(provider.calls).toHaveLength(0);
  });

  it("aborts and returns TIMEOUT when the provider exceeds the bounded timeout", async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    const provider = new FakeProvider(
      async (_request, signal) =>
        new Promise<ProviderModelResult>(() => {
          providerSignal = signal;
        }),
    );
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    const pending = adapter.invoke(
      textRequest({
        timeoutMs: MODEL_INVOCATION_LIMITS.minTimeoutMs,
      }),
    );

    await vi.advanceTimersByTimeAsync(
      MODEL_INVOCATION_LIMITS.minTimeoutMs + 1,
    );

    await expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(providerSignal?.aborted).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it("handles caller cancellation before and during invocation", async () => {
    const preCancelled = new AbortController();
    preCancelled.abort();

    const provider = new FakeProvider(
      async () =>
        new Promise<ProviderModelResult>(() => undefined),
    );
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    await expect(
      adapter.invoke(textRequest({ signal: preCancelled.signal })),
    ).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(provider.calls).toHaveLength(0);

    const active = new AbortController();
    const pending = adapter.invoke(
      textRequest({ signal: active.signal }),
    );
    active.abort();

    await expect(pending).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.signal.aborted).toBe(true);
  });

  it.each([
    ["AUTH", "PROVIDER_AUTH", false],
    ["RATE_LIMIT", "PROVIDER_RATE_LIMIT", true],
    ["UNAVAILABLE", "PROVIDER_UNAVAILABLE", true],
    ["BAD_REQUEST", "PROVIDER_BAD_REQUEST", false],
    ["UNKNOWN", "PROVIDER_ERROR", false],
  ] as const)(
    "maps provider %s errors to explicit taxonomy without retry",
    async (providerCode, expectedCode, retryable) => {
      const provider = new FakeProvider(async () => {
        throw new ProviderInvocationError("provider failed", providerCode);
      });
      const adapter = new ConstrainedModelInvocationAdapter(provider);

      let caught: unknown;
      try {
        await adapter.invoke(textRequest());
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ModelInvocationError);
      expect(caught).toMatchObject({
        code: expectedCode,
        details: {
          provider: "fake-provider",
          model: "fake-model-1",
          retryable,
        },
      });
      expect(provider.calls).toHaveLength(1);
    },
  );

  it("does not retry or switch models on an untyped provider failure", async () => {
    const provider = new FakeProvider(async () => {
      throw new Error("boom");
    });
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    await expect(adapter.invoke(textRequest())).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });

    expect(provider.calls).toHaveLength(1);
  });

  it("rejects malformed, tool-bearing, or output-limit-violating provider responses", async () => {
    const cases: Array<ProviderModelResult> = [
      {
        ...okTextResult(),
        toolCalls: [{ name: "shell" }],
      } as unknown as ProviderModelResult,
      {
        ...okTextResult(),
        usage: {
          inputTokens: 1,
          outputTokens: 257,
          totalTokens: 258,
        },
      },
      {
        ...okTextResult(),
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 3,
        },
      },
    ];

    for (const result of cases) {
      const provider = new FakeProvider(async () => result);
      const adapter = new ConstrainedModelInvocationAdapter(provider);
      await expect(adapter.invoke(textRequest())).rejects.toBeInstanceOf(
        ModelInvocationError,
      );
      expect(provider.calls).toHaveLength(1);
    }
  });

  it("rejects a response mode mismatch instead of coercing provider output", async () => {
    const provider = new FakeProvider(async () => ({
      output: {
        type: "structured",
        value: { version: 1 },
      },
      usage: {
        inputTokens: 2,
        outputTokens: 2,
        totalTokens: 4,
      },
    }));
    const adapter = new ConstrainedModelInvocationAdapter(provider);

    await expect(adapter.invoke(textRequest())).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
    expect(provider.calls).toHaveLength(1);
  });
});
