import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import aiCoreMcpRouter from "../routes/ai-core-mcp.js";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api", aiCoreMcpRouter);
  return instance;
}

describe("AI Core MCP discovery compatibility", () => {
  it("advertises tools, resources, and prompts discovery capabilities", async () => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["x-mcp-server-version"]).toBe("1.6.1");
    expect(response.body.result.serverInfo).toEqual({
      name: "ai-core-direct-command",
      version: "1.6.1",
    });
    expect(response.body.result.protocolVersion).toBe("2025-06-18");
    expect(response.body.result.capabilities).toEqual({
      tools: { listChanged: true },
      events: {},
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    });
  });

  it.each([
    ["resources/list", { resources: [] }],
    ["resources/templates/list", { resourceTemplates: [] }],
    ["prompts/list", { prompts: [] }],
  ])("returns an empty successful result for %s", async (method, expected) => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({ jsonrpc: "2.0", id: 2, method });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: expected,
    });
  });

  it("advertises MCP 2.0 native event support through server/discover", async () => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({ jsonrpc: "2.0", id: 30, method: "server/discover", params: {} });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28", "2025-06-18", "2025-03-26"],
      capabilities: { tools: {}, events: {} },
      serverInfo: {
        name: "ai-core-direct-command",
        version: "1.6.1",
      },
    });
  });

  it("negotiates MCP 2.0 when requested", async () => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({
        jsonrpc: "2.0",
        id: 31,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "test", version: "2" },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.result.protocolVersion).toBe("2026-07-28");
    expect(response.body.result.capabilities.events).toEqual({});
  });

  it("defaults unknown or missing protocol versions to the ChatGPT-compatible version", async () => {
    for (const params of [
      { capabilities: {}, clientInfo: { name: "legacy-host", version: "1" } },
      { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "legacy-host", version: "1" } },
    ]) {
      const response = await request(app())
        .post("/api/ai/core-chat/mcp")
        .send({ jsonrpc: "2.0", id: 32, method: "initialize", params });

      expect(response.status).toBe(200);
      expect(response.body.result.protocolVersion).toBe("2025-06-18");
    }
  });

  it("requires ai_core.events for fallback lifecycle tool calls", async () => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({
        jsonrpc: "2.0",
        id: 33,
        method: "tools/call",
        params: {
          name: "subscribe_ai_core_events",
          arguments: { conversationId: "conversation-a" },
        },
      });

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("ai_core.events");
  });

  it("continues to expose AI Core tools", async () => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({ jsonrpc: "2.0", id: 3, method: "tools/list" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["x-mcp-server-version"]).toBe("1.6.1");
    const toolNames = response.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "query_ai_core",
        "send_ai_core_command",
        "get_ai_core_task_progress",
        "subscribe_ai_core_events",
        "read_ai_core_events",
        "ack_ai_core_event",
        "unsubscribe_ai_core_events",
        "get_profile",
      ]),
    );
    for (const name of [
      "subscribe_ai_core_events",
      "read_ai_core_events",
      "ack_ai_core_event",
      "unsubscribe_ai_core_events",
    ]) {
      const tool = response.body.result.tools.find((item: { name: string }) => item.name === name);
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["ai_core.events"] }]);
    }
    const queryTool = response.body.result.tools.find((item: { name: string }) => item.name === "query_ai_core");
    expect(queryTool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["ai_core.progress"] }]);
    expect(queryTool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const subscribeTool = response.body.result.tools.find((item: { name: string }) => item.name === "subscribe_ai_core_events");
    expect(subscribeTool.inputSchema.properties.eventTypes.items.enum).toContain("BLOCKED");
    expect(subscribeTool.inputSchema.properties.leaseSeconds).toMatchObject({
      minimum: 30,
      maximum: 604800,
      default: 86400,
    });
  });
});


it("exposes the same live tool registry on the fresh v2 endpoint", async () => {
  const response = await request(app())
    .post("/api/ai/core-chat/mcp-v2")
    .send({ jsonrpc: "2.0", id: 4, method: "tools/list" });

  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["x-mcp-server-version"]).toBe("1.6.1");
  expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
    expect.arrayContaining([
      "query_ai_core",
      "send_ai_core_command",
      "get_ai_core_task_progress",
      "subscribe_ai_core_events",
      "read_ai_core_events",
      "ack_ai_core_event",
      "unsubscribe_ai_core_events",
      "get_profile",
    ]),
  );
});
