import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../services/aiCoreMcpEventWebhookService.js", () => ({
  AI_CORE_TERMINAL_EVENT_NAME: "ai_core.task.terminal",
  McpCallbackEndpointError: class McpCallbackEndpointError extends Error {
    constructor(readonly reason: string, message: string) {
      super(message);
    }
  },
  subscribeAiCoreMcpEvent: eventMocks.subscribe,
  unsubscribeAiCoreMcpEvent: eventMocks.unsubscribe,
}));

import router from "../routes/ai-core-mcp.js";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api", router);
  return instance;
}

describe("AI Core native MCP events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_CORE_CHAT_CONNECTOR_KEY", "test-connector-key");
    eventMocks.subscribe.mockResolvedValue({
      id: "sub_test",
      refreshBefore: "2026-10-06T00:00:00.000Z",
    });
    eventMocks.unsubscribe.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function post(body: unknown) {
    return request(app())
      .post("/api/ai/core-chat/mcp")
      .set("Authorization", "Bearer test-connector-key")
      .send(body);
  }

  it("lists the terminal lifecycle event with webhook delivery", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "events/list",
      params: {},
    });

    expect(response.status).toBe(200);
    expect(response.body.result.events).toHaveLength(1);
    expect(response.body.result.events[0]).toMatchObject({
      name: "ai_core.task.terminal",
      delivery: ["webhook"],
    });
    expect(response.body.result.events[0].payloadSchema.properties.event_type.enum)
      .toEqual(["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"]);
  });

  it("creates a native webhook subscription without persisting the bearer token as identity", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 2,
      method: "events/subscribe",
      params: {
        name: "ai_core.task.terminal",
        arguments: {
          repository: "Travelintrips/Core-AI-Foundation",
          eventTypes: ["COMPLETED", "FAILED"],
        },
        delivery: {
          mode: "webhook",
          url: "https://receiver.example.test/mcp-events/callback",
          secret: "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
        cursor: null,
        ttlMs: 3600000,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({
      id: "sub_test",
      refreshBefore: "2026-10-06T00:00:00.000Z",
      cursor: null,
      truncated: false,
    });
    expect(eventMocks.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "ai_core.task.terminal",
      callbackUrl: "https://receiver.example.test/mcp-events/callback",
      arguments: {
        repository: "Travelintrips/Core-AI-Foundation",
        eventTypes: ["COMPLETED", "FAILED"],
      },
      ttlMs: 3600000,
      principalId: expect.stringMatching(/^legacy:[a-f0-9]{40}$/),
    }));
    expect(JSON.stringify(eventMocks.subscribe.mock.calls[0])).not.toContain(
      "test-connector-key",
    );
  });

  it("unsubscribes idempotently using the same event identity", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "events/unsubscribe",
      params: {
        name: "ai_core.task.terminal",
        arguments: { taskId: "52902096-a053-49fe-868b-1c6a90cf22d0" },
        delivery: {
          mode: "webhook",
          url: "https://receiver.example.test/mcp-events/callback",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toEqual({});
    expect(eventMocks.unsubscribe).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "ai_core.task.terminal",
      arguments: { taskId: "52902096-a053-49fe-868b-1c6a90cf22d0" },
      callbackUrl: "https://receiver.example.test/mcp-events/callback",
    }));
  });

  it("requires the ai_core.events authentication scope", async () => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({ jsonrpc: "2.0", id: 4, method: "events/list", params: {} });

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("ai_core.events");
  });
});
