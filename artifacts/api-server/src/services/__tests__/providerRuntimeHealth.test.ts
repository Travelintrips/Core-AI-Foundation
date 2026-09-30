import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pingProvider } from "../providerHealthService.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider runtime health", () => {
  it("keeps the normal Google /models health check cheap while healthy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ models: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pingProvider(
      "google",
      "https://generativelanguage.googleapis.com/v1beta",
      "test-key",
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/models?key=");
  });

  it("requires a real Google generateContent probe while recovering", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          models: [
            {
              name: "models/gemini-test",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        status: 403,
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pingProvider(
      "google",
      "https://generativelanguage.googleapis.com/v1beta",
      "test-key",
      { verifyGeneration: true },
    );

    expect(result).toMatchObject({
      ok: false,
      httpStatus: 403,
    });
    expect(result.error).toContain("real generation request");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/models/gemini-test:generateContent?key=",
    );
  });

  it("uses a real generation probe to verify OpenAI quota recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 429 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await pingProvider(
      "openai",
      "https://api.openai.com/v1",
      "test-key",
      { verifyGeneration: true, modelId: "gpt-4o" },
    );

    expect(result).toMatchObject({
      ok: false,
      httpStatus: 429,
    });
    expect(result.error).toContain("real generation request");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/chat/completions",
    );
  });

  it("wires runtime failures into routing and preflights before privilege consumption", () => {
    const aiExecution = readFileSync(
      new URL("../aiExecutionService.ts", import.meta.url),
      "utf8",
    );
    const modelService = readFileSync(
      new URL("../aiModelService.ts", import.meta.url),
      "utf8",
    );
    const gate = readFileSync(
      new URL("../localCodingAiExecutionGateService.ts", import.meta.url),
      "utf8",
    );

    expect(aiExecution).toContain("recordProviderRuntimeFailure");
    expect(modelService).toContain("aiProviderHealthLogsTable");
    expect(modelService).toContain("invalidateActiveModelCache()");
    expect(gate).toContain("resolvePreflightedCodingModel");

    const executeReserved = gate.indexOf("async function executeReserved");
    const preflight = gate.indexOf(
      "await resolvePreflightedCodingModel",
      executeReserved,
    );
    const consume = gate.indexOf("await consumePrivilege", executeReserved);
    expect(preflight).toBeGreaterThan(executeReserved);
    expect(consume).toBeGreaterThan(preflight);
  });
});
