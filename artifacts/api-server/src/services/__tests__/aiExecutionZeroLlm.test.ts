import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAINoFallback } from "../aiExecutionService.js";

describe("ZeroLLM local execution adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes the OpenAI-compatible local sidecar without an API key", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:8765/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();

      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload).toMatchObject({
        model: "Qwen/Qwen3.5-4B",
        max_tokens: 512,
      });

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"version\":1}" } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 13,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeAINoFallback({
        prompt: "Return JSON only.",
        systemPrompt: "You are bounded.",
        model: {
          modelId: "Qwen/Qwen3.5-4B",
          maxOutputTokens: 512,
        },
        provider: {
          slug: "zerollm",
          baseUrl: "http://127.0.0.1:8765/v1",
        },
        maxTokens: 512,
        temperature: 0,
      }),
    ).resolves.toEqual({
      content: "{\"version\":1}",
      promptTokens: 10,
      completionTokens: 3,
      tokensUsed: 13,
      latencyMs: expect.any(Number),
    });
  });

  it("rejects an external ZeroLLM URL before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeAINoFallback({
        prompt: "test",
        model: { modelId: "Qwen/Qwen3.5-4B" },
        provider: {
          slug: "zerollm",
          baseUrl: "http://example.com:8765/v1",
        },
      }),
    ).rejects.toThrow(/loopback-only/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
