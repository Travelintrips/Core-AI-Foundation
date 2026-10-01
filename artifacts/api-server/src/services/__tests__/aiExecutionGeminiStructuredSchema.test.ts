import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAINoFallback, type ExecutionInput } from "../aiExecutionService.js";
import { localCodingAiProposalV1JsonSchema } from "../localCodingAiProposalJsonSchema.js";

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: () => "gemini-test-key",
}));

afterEach(() => vi.unstubAllGlobals());

function structuredInput(signal?: AbortSignal): ExecutionInput {
  return {
    prompt: "Return the bounded proposal.",
    systemPrompt: "Return JSON only.",
    provider: { slug: "google" },
    model: { modelId: "gemini-3.8-flash" },
    temperature: 0,
    maxTokens: 512,
    jsonOutput: true,
    responseJsonSchema: localCodingAiProposalV1JsonSchema,
    signal,
  };
}

function successResponse(): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"version":1}' }] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
  }), { status: 200 });
}

describe("Gemini native structured proposal schema", () => {
  it("uses the current generateContent responseFormat with the complete proposal schema", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_, request) => {
      const config = JSON.parse(String(request?.body)).generationConfig;
      return config.responseFormat?.text?.schema
        ? successResponse()
        : new Response("Legacy structured fields rejected", { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAINoFallback(structuredInput());

    expect(result).toMatchObject({ content: '{"version":1}', tokensUsed: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.generationConfig.responseFormat.text.mimeType).toBe("application/json");
    expect(body.generationConfig.responseFormat.text.schema)
      .toEqual(localCodingAiProposalV1JsonSchema);
    const operationItems =
      body.generationConfig.responseFormat.text.schema.properties.proposal
        .properties.operations.items;
    expect(operationItems.anyOf).toHaveLength(5);
    expect(operationItems).not.toHaveProperty("oneOf");
    expect(body.generationConfig).not.toHaveProperty("responseMimeType");
    expect(body.generationConfig).not.toHaveProperty("responseJsonSchema");
  });

  it("retries an older endpoint once with the same schema, bounds and cancellation signal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Unknown field responseFormat", { status: 400 }))
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeAINoFallback(structuredInput(signal)))
      .resolves.toMatchObject({ content: '{"version":1}' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1];
    const retryRequest = fetchMock.mock.calls[1]?.[1];
    const firstBody = JSON.parse(String(firstRequest?.body));
    const retryBody = JSON.parse(String(retryRequest?.body));
    expect(retryBody).toEqual({
      ...firstBody,
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: localCodingAiProposalV1JsonSchema,
      },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
    expect(firstRequest?.signal).toBe(signal);
    expect(retryRequest?.signal).toBe(signal);
  });

  it("stops after one legacy retry when both schema formats are rejected", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Current schema rejected", { status: 400 }))
      .mockResolvedValueOnce(new Response("Legacy schema rejected", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeAINoFallback(structuredInput()))
      .rejects.toThrow("Gemini API request failed (HTTP 400): Legacy schema rejected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429, 500])("does not retry HTTP %s as schema incompatibility", async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("Request failed", { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeAINoFallback(structuredInput())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
