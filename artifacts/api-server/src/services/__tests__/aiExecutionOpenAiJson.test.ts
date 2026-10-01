import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAINoFallback } from "../aiExecutionService.js";

vi.mock("../aiSecretService.js", () => ({ getProviderApiKey: () => "openai-test-key" }));
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI constrained JSON output", () => {
  it.each([true, false])("enables native JSON mode only when requested: %s", async (jsonOutput) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"version":1}' } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await executeAINoFallback({
      prompt: "Return JSON.", provider: { slug: "openai" }, model: { modelId: "gpt-4o-mini" },
      maxTokens: 512, temperature: 0, jsonOutput, signal,
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    if (jsonOutput) expect(body.response_format).toEqual({ type: "json_object" });
    else expect(body).not.toHaveProperty("response_format");
    expect(request?.signal).toBe(signal);
  });
});


it("preserves the bounded policy in an o-series user message and satisfies JSON mode", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: '{"version":1}' } }],
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await executeAINoFallback({
    prompt: "Produce the bounded proposal.",
    systemPrompt: "Do not use tools or access the network.",
    provider: { slug: "openai" },
    model: { modelId: "o4-mini" },
    maxTokens: 512,
    temperature: 0,
    jsonOutput: true,
  });

  const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0]).toMatchObject({ role: "user" });
  expect(body.messages[0].content).toContain("Do not use tools or access the network.");
  expect(body.messages[0].content).toContain("Produce the bounded proposal.");
  expect(body.messages[0].content.toLowerCase()).toContain("json");
});
