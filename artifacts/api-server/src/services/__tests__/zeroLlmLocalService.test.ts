import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkZeroLlmHealth,
  isLoopbackZeroLlmBaseUrl,
  readZeroLlmLocalConfig,
} from "../zeroLlmLocalService.js";

describe("ZeroLLM local provider configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts only unauthenticated loopback HTTP endpoints", () => {
    expect(isLoopbackZeroLlmBaseUrl("http://127.0.0.1:8765/v1")).toBe(true);
    expect(isLoopbackZeroLlmBaseUrl("http://localhost:8765/v1")).toBe(true);
    expect(isLoopbackZeroLlmBaseUrl("https://127.0.0.1:8765/v1")).toBe(false);
    expect(isLoopbackZeroLlmBaseUrl("http://example.com:8765/v1")).toBe(false);
    expect(isLoopbackZeroLlmBaseUrl("http://user:pass@127.0.0.1:8765/v1")).toBe(false);
  });

  it("treats explicit coding provider selection as enabled and required", () => {
    expect(
      readZeroLlmLocalConfig({
        AI_CODING_PROVIDER: "zerollm",
        ZEROLLM_BASE_URL: "http://127.0.0.1:8765/v1",
        ZEROLLM_MODEL: "Qwen/Qwen3.5-4B",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      enabled: true,
      required: true,
      baseUrl: "http://127.0.0.1:8765/v1",
      model: "Qwen/Qwen3.5-4B",
    });
  });

  it("fails closed for a non-loopback base URL", () => {
    expect(() =>
      readZeroLlmLocalConfig({
        ZEROLLM_ENABLED: "true",
        ZEROLLM_BASE_URL: "http://10.0.0.25:8765/v1",
      } as NodeJS.ProcessEnv),
    ).toThrow(/loopback-only/);
  });

  it("health checks the sidecar without exposing a public endpoint", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe("http://127.0.0.1:8765/healthz");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkZeroLlmHealth({
        enabled: true,
        required: true,
        baseUrl: "http://127.0.0.1:8765/v1",
        model: "Qwen/Qwen3.5-4B",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      model: "Qwen/Qwen3.5-4B",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
