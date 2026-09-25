import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkOllamaHealth,
  isLoopbackOllamaBaseUrl,
  readOllamaLocalConfig,
} from "../ollamaLocalService.js";

describe("Ollama local provider configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts only unauthenticated loopback HTTP endpoints", () => {
    expect(isLoopbackOllamaBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLoopbackOllamaBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLoopbackOllamaBaseUrl("https://127.0.0.1:11434/v1")).toBe(false);
    expect(isLoopbackOllamaBaseUrl("http://10.0.0.25:11434/v1")).toBe(false);
    expect(isLoopbackOllamaBaseUrl("http://user:pass@127.0.0.1:11434/v1")).toBe(false);
  });

  it("enables Ollama when configured as coding fallback", () => {
    expect(
      readOllamaLocalConfig({
        AI_CODING_FALLBACK_PROVIDER: "ollama",
        AI_CODING_FALLBACK_MODEL: "qwen2.5-coder:7b",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      enabled: true,
      required: false,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5-coder:7b",
    });
  });

  it("treats explicit Ollama primary selection as required", () => {
    expect(
      readOllamaLocalConfig({
        AI_CODING_PROVIDER: "ollama",
        OLLAMA_MODEL: "qwen2.5-coder:7b",
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      enabled: true,
      required: true,
      model: "qwen2.5-coder:7b",
    });
  });

  it("fails closed for a non-loopback base URL", () => {
    expect(() =>
      readOllamaLocalConfig({
        OLLAMA_ENABLED: "true",
        OLLAMA_BASE_URL: "http://10.0.0.25:11434/v1",
      } as NodeJS.ProcessEnv),
    ).toThrow(/loopback-only/);
  });

  it("requires the configured model to be present in Ollama", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [{ id: "qwen2.5-coder:7b", object: "model", owned_by: "library" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkOllamaHealth({
        enabled: true,
        required: false,
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "qwen2.5-coder:7b",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      model: "qwen2.5-coder:7b",
      modelAvailable: true,
    });
  });
});
