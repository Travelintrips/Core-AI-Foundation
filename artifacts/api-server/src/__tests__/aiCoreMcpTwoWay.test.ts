import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../services/aiCoreMcpResultEventService.js", () => ({ recordAiCoreMcpTerminalResult: mocks.record }));
vi.mock("../services/aiCoreMcpOAuthService.js", () => ({
  oauthIssuer: () => "https://example.test", oauthResource: () => "https://example.test/api", verifyMcpAccessToken: vi.fn(),
}));
vi.mock("../services/aiCoreWhatsappChatService.js", () => ({ resolveAiCoreInternalBaseUrl: () => "http://localhost:8080/api" }));
vi.mock("../services/localCodingControlBridgeService.js", () => ({
  acknowledgeCodingBridgeResponse: vi.fn(), listPendingCodingBridgeResponsesForConversation: vi.fn(),
  subscribeCodingBridgeConversation: vi.fn(), unsubscribeCodingBridgeConversation: vi.fn(),
}));
import router from "../routes/ai-core-mcp.js";

describe("MCP command two-way routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_CORE_CHAT_CONNECTOR_KEY", "test-connector-key");
    mocks.record.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: "answer", reply: "OK" }), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  function send(message: string) {
    const app = express(); app.use(express.json()); app.use("/api", router);
    return request(app).post("/api/ai/core-chat/mcp").set("Authorization", "Bearer test-connector-key")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_ai_core_command", arguments: { message, conversationId: "conversation-a" } } });
  }
  it("uses automatic dispatch and persists the reply in its conversation", async () => {
    const response = await send("@ Uji koneksi MCP");
    expect(response.body.result.isError).toBeFalsy();
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ mode: "auto", message: "@ Uji koneksi MCP", conversationId: "conversation-a" });
    expect(mocks.record).toHaveBeenCalledWith({ conversationId: "conversation-a", instruction: "@ Uji koneksi MCP", payload: { kind: "answer", reply: "OK" } });
  });
  it("preserves the execution prefix gate", async () => {
    const response = await send("Uji koneksi MCP");
    expect(response.body.result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves a completed reply if event persistence fails", async () => {
    mocks.record.mockRejectedValue(new Error("database unavailable"));
    const response = await send("@ ping");
    expect(response.body.result.structuredContent).toMatchObject({ reply: "OK", eventDeliveryError: expect.any(String) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
