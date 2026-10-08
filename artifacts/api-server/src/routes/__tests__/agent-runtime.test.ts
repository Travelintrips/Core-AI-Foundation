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

  it("strips OpenClaw tools for marked CHAT work even on the legacy model alias", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl-marked-chat",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "OPENCLAW_OPENAI_API_E2E_OK" },
            },
          ],
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
        messages: [
          {
            role: "system",
            content: [
              {
                type: "text",
                text: "You are OpenClaw.",
                cache_control: { type: "ephemeral" },
              },
            ],
            providerOptions: { openai: { cache: true } },
          },
          {
            role: "tool",
            content: "stale tool result",
            tool_call_id: "call_123",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "[AI_CORE_CHAT_NO_TOOLS]\nReply exactly OPENCLAW_OPENAI_API_E2E_OK",
                cache_control: { type: "ephemeral" },
              },
            ],
            name: "operator",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "shell",
              description: "Run a bounded shell command",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        tool_choice: "auto",
        parallel_tool_calls: true,
        reasoning_effort: "high",
        metadata: { source: "openclaw" },
        store: true,
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
      tools?: unknown;
      tool_choice?: unknown;
      parallel_tool_calls?: unknown;
    };
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toEqual([
      {
        role: "system",
        content: [{ type: "text", text: "You are OpenClaw." }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Reply exactly OPENCLAW_OPENAI_API_E2E_OK" }],
      },
    ]);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("parallel_tool_calls");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("metadata");
    expect(body).not.toHaveProperty("store");
    expect(body.stream).toBe(false);
  });

  it("accepts the tool-free OpenClaw chat model alias", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl-chat-alias",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "OPENCLAW_OPENAI_API_E2E_OK" },
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
        model: "ai-core-agent-chat",
        messages: [{ role: "user", content: "Reply exactly OPENCLAW_OPENAI_API_E2E_OK" }],
        stream: false,
      });

    expect(res.status).toBe(200);
    expect(res.headers["x-ai-core-provider"]).toBe("openai");
    expect(res.body.choices[0].message.content).toBe("OPENCLAW_OPENAI_API_E2E_OK");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as { model: string };
    expect(body.model).toBe("gpt-4o");
  });

  it("returns bounded sanitized upstream rejection details", async () => {
    mockGetProviderApiKey.mockImplementation((slug: string) =>
      slug === "openai" ? "key-openai" : null,
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: "Unsupported value: 'text'. Supported values are: 'input_text'.",
            type: "invalid_request_error",
            param: "messages[1].content[0].type",
            code: "unsupported_value",
            secret: "must-not-leak",
          },
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const app = await buildApp();
    const res = await request(app)
      .post("/ai/agent-runtime/v1/chat/completions")
      .send({
        model: "ai-core-agent-chat",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Reply exactly OK" }],
          },
        ],
        stream: false,
      });

    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.body.error.upstream).toEqual({
      provider: "openai",
      model: "gpt-4o",
      type: "invalid_request_error",
      code: "unsupported_value",
      param: "messages[1].content[0].type",
      message: "Unsupported value: 'text'. Supported values are: 'input_text'.",
    });
    expect(JSON.stringify(res.body)).not.toContain("must-not-leak");
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
