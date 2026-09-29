import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockGetProviderApiKey } = vi.hoisted(() => ({
  mockGetProviderApiKey: vi.fn(),
}));

vi.mock("../../services/aiSecretService.js", () => ({
  getProviderApiKey: mockGetProviderApiKey,
}));

vi.mock("../../middleware/agentServiceAuth.js", () => ({
  requireAgentServiceScope:
    () =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function buildApp() {
  const { default: router } = await import("../agent-runtime.js");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("agent runtime provider fallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetProviderApiKey.mockReset();
    mockGetProviderApiKey.mockImplementation((slug: string) =>
      ["openai", "gemini", "mistral", "anthropic"].includes(slug)
        ? "key-" + slug
        : null,
    );

    delete process.env["AI_AGENT_RUNTIME_OPENAI_MODEL"];
    delete process.env["AI_AGENT_RUNTIME_GEMINI_MODEL"];
    delete process.env["AI_AGENT_RUNTIME_MISTRAL_MODEL"];
    delete process.env["AI_AGENT_RUNTIME_ANTHROPIC_MODEL"];
  });

  it("reports Anthropic as a configured fallback", async () => {
    const app = await buildApp();
    const res = await request(app).get("/ai/agent-runtime/health");

    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-opus-4-8",
        }),
      ]),
    );
  });

  it("falls back to Anthropic when earlier providers are rate limited", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: "AICORE_SMOKE_OK" },
              },
            ],
            usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const app = await buildApp();
    const res = await request(app)
      .post("/ai/agent-runtime/v1/chat/completions")
      .send({
        model: "ai-core-agent",
        messages: [{ role: "user", content: "Reply exactly AICORE_SMOKE_OK" }],
        stream: false,
      });

    expect(res.status).toBe(200);
    expect(res.headers["x-ai-core-provider"]).toBe("anthropic");
    expect(res.headers["x-ai-core-model"]).toBe("claude-opus-4-8");
    expect(res.body.choices[0].message.content).toBe("AICORE_SMOKE_OK");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [url, init] = fetchMock.mock.calls[3]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      authorization: "Bearer key-anthropic",
      "content-type": "application/json",
    });

    const body = JSON.parse(String(init?.body)) as { model: string };
    expect(body.model).toBe("claude-opus-4-8");
  });
});
