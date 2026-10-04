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
    expect(response.headers["x-mcp-server-version"]).toBe("1.3.2");
    expect(response.body.result.serverInfo).toEqual({
      name: "ai-core-direct-command",
      version: "1.3.2",
    });
    expect(response.body.result.capabilities).toEqual({
      tools: { listChanged: true },
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

  it("continues to expose AI Core tools", async () => {
    const response = await request(app())
      .post("/api/ai/core-chat/mcp")
      .send({ jsonrpc: "2.0", id: 3, method: "tools/list" });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["x-mcp-server-version"]).toBe("1.3.2");
    const toolNames = response.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
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
      expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["ai_core.progress"] }]);
    }
  });
});


it("exposes the same live tool registry on the fresh v2 endpoint", async () => {
  const response = await request(app())
    .post("/api/ai/core-chat/mcp-v2")
    .send({ jsonrpc: "2.0", id: 4, method: "tools/list" });

  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["x-mcp-server-version"]).toBe("1.3.2");
  expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
    expect.arrayContaining([
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
