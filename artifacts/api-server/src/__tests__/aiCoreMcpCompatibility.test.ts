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
    expect(response.body.result.capabilities).toEqual({
      tools: { listChanged: false },
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
    expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        "send_ai_core_command",
        "get_ai_core_task_progress",
        "get_profile",
      ]),
    );
  });
});
