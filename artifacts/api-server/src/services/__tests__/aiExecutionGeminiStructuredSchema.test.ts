import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAINoFallback } from "../aiExecutionService.js";
import { localCodingAiProposalV1JsonSchema } from "../localCodingAiProposalJsonSchema.js";

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: () => "gemini-test-key",
}));

afterEach(() => vi.unstubAllGlobals());

describe("Gemini native structured proposal schema", () => {
  it("sends current Gemini responseFormat schema with the APPLICATION_JSON enum", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{
            content: { parts: [{ text: '{"version":1}' }] },
          }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await executeAINoFallback({
      prompt: "Return the bounded proposal.",
      systemPrompt: "Return JSON only.",
      provider: { slug: "google" },
      model: { modelId: "gemini-3.8-flash" },
      temperature: 0,
      maxTokens: 512,
      jsonOutput: true,
      responseJsonSchema: localCodingAiProposalV1JsonSchema,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.generationConfig.responseFormat).toEqual({
      text: {
        mimeType: "APPLICATION_JSON",
        schema: localCodingAiProposalV1JsonSchema,
      },
    });
    expect(body.generationConfig).not.toHaveProperty("responseJsonSchema");
    expect(body.generationConfig).not.toHaveProperty("responseMimeType");
  });
});
