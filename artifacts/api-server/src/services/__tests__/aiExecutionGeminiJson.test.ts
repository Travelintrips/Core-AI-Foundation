import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAINoFallback, type ExecutionInput } from "../aiExecutionService.js";

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: () => "gemini-test-key",
}));

const input: ExecutionInput = {
  prompt: "Return the requested JSON object.",
  systemPrompt: "Produce a constrained coding proposal.",
  provider: { slug: "google" },
  model: { modelId: "gemini-3.8-flash" },
  maxTokens: 512,
  temperature: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe("native Gemini JSON output", () => {
  it("requests JSON and concatenates only final text parts", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [
        { thought: true, text: "The draft is {not final JSON}." },
        { text: '{"value":' },
        { inlineData: { mimeType: "image/png", data: "unused" } },
        { thought: false, text: "2}" },
      ] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAINoFallback({ ...input, jsonOutput: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body.generationConfig).toEqual({
      maxOutputTokens: 512,
      temperature: 0,
      responseMimeType: "application/json",
    });
    expect(body.systemInstruction.parts).toEqual([{ text: input.systemPrompt }]);
    expect(result).toMatchObject({ content: '{"value":2}', promptTokens: 10, completionTokens: 5, tokensUsed: 15 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps normal chat as text and excludes thought summaries", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [
        { thought: true, text: "A thought summary." },
        { text: "Hello " },
        { text: "world." },
      ] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeAINoFallback(input);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body.generationConfig).not.toHaveProperty("responseMimeType");
    expect(result.content).toBe("Hello world.");
  });

  it.each([
    { candidates: [{ content: { parts: [{ thought: true, text: "No final answer." }] }, finishReason: "MAX_TOKENS" }] },
    { candidates: [{ finishReason: "SAFETY" }] },
    { candidates: [] },
  ])("rejects native JSON responses without final text", async (response) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    ));

    await expect(executeAINoFallback({ ...input, jsonOutput: true }))
      .rejects.toThrow("Gemini returned no final JSON response");
  });
});
