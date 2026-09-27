import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  keys: new Map<string, string>(),
}));

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: vi.fn((slug: string) => mocks.keys.get(slug) ?? null),
}));

vi.mock("../observabilityService.js", () => ({
  logExecutionSafe: vi.fn(),
}));

import { streamCloudChatNoFallback } from "../aiChatStreamingService.js";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

describe("AI Core cloud chat streaming", () => {
  beforeEach(() => {
    mocks.keys = new Map([
      ["openai", "test-openai"],
      ["anthropic", "test-anthropic"],
      ["gemini", "test-gemini"],
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams OpenAI text deltas and captures final usage", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Halo "}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"dunia"}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    const result = await streamCloudChatNoFallback({
      providerSlug: "openai",
      modelId: "gpt-5.6-sol",
      systemPrompt: "system",
      prompt: "hello",
      maxOutputTokens: 100,
      temperature: 0,
      onDelta: (value) => deltas.push(value),
    });

    expect(deltas.join("")).toBe("Halo dunia");
    expect(result).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-sol",
      providerRequestId: "chatcmpl-1",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.temperature).toBeUndefined();
  });

  it("keeps streaming when CRLF separators are split across network chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"id":"chatcmpl-split","choices":[{"delta":{"content":"A"}}]}\\r',
          '\\n\\r',
          '\\ndata: {"id":"chatcmpl-split","choices":[{"delta":{"content":"B"}}]}\\r',
          '\\n\\r',
          '\\ndata: {"id":"chatcmpl-split","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}\\r\\n\\r\\n',
          "data: [DONE]\\r\\n\\r\\n",
        ]),
      ),
    );

    const deltas: string[] = [];
    const result = await streamCloudChatNoFallback({
      providerSlug: "openai",
      modelId: "gpt-5.6-sol",
      prompt: "hello",
      maxOutputTokens: 100,
      onDelta: (value) => deltas.push(value),
    });

    expect(deltas.join("")).toBe("AB");
    expect(result.usage).toEqual({
      inputTokens: 2,
      outputTokens: 2,
      totalTokens: 4,
    });
  });

  it("streams Anthropic text deltas and usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":8,"output_tokens":0}}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Jawab"}}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n',
        ]),
      ),
    );

    const deltas: string[] = [];
    const result = await streamCloudChatNoFallback({
      providerSlug: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
      prompt: "hello",
      maxOutputTokens: 100,
      onDelta: (value) => deltas.push(value),
    });

    expect(deltas).toEqual(["Jawab"]);
    expect(result.usage).toEqual({
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 11,
    });
    expect(result.providerRequestId).toBe("msg_1");
  });

  it("streams Gemini SSE chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"A"}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"B"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}\n\n',
        ]),
      ),
    );

    const deltas: string[] = [];
    const result = await streamCloudChatNoFallback({
      providerSlug: "gemini",
      modelId: "gemini-2.5-flash",
      prompt: "hello",
      maxOutputTokens: 100,
      onDelta: (value) => deltas.push(value),
    });

    expect(deltas.join("")).toBe("AB");
    expect(result.usage).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      totalTokens: 7,
    });
  });

  it("rejects providers without a configured key before network access", async () => {
    mocks.keys = new Map();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamCloudChatNoFallback({
        providerSlug: "openai",
        modelId: "gpt-5.6-sol",
        prompt: "hello",
        maxOutputTokens: 100,
        onDelta: () => undefined,
      }),
    ).rejects.toThrow("No API key configured");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
