import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  subscribe: vi.fn(),
  list: vi.fn(),
  ack: vi.fn(),
  unsubscribe: vi.fn(),
  learning: vi.fn(),
}));
vi.mock("../services/aiCoreMcpResultEventService.js", () => ({ recordAiCoreMcpTerminalResult: mocks.record }));
vi.mock("../services/aiCoreChatLearningService.js", () => ({ recordChatLearningEvent: mocks.learning }));
vi.mock("../services/aiCoreMcpOAuthService.js", () => ({
  oauthIssuer: () => "https://example.test", oauthResource: () => "https://example.test/api", verifyMcpAccessToken: vi.fn(),
}));
vi.mock("../services/aiCoreWhatsappChatService.js", () => ({ resolveAiCoreInternalBaseUrl: () => "http://localhost:8080/api" }));
vi.mock("../services/localCodingControlBridgeService.js", () => ({
  acknowledgeCodingBridgeResponseForConversation: mocks.ack,
  listPendingCodingBridgeResponsesForConversation: mocks.list,
  subscribeCodingBridgeConversation: mocks.subscribe,
  unsubscribeCodingBridgeConversation: mocks.unsubscribe,
}));
import router from "../routes/ai-core-mcp.js";

describe("MCP command two-way routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_CORE_CHAT_CONNECTOR_KEY", "test-connector-key");
    mocks.record.mockResolvedValue(undefined);
    mocks.learning.mockResolvedValue(undefined);
    mocks.subscribe.mockResolvedValue({
      clientId: "chatgpt:conversation-a",
      leaseExpiresAt: new Date("2026-10-07T16:00:00.000Z"),
    });
    mocks.list.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: "answer", reply: "OK" }), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  function callTool(name: string, args: Record<string, unknown>) {
    const app = express(); app.use(express.json()); app.use("/api", router);
    return request(app).post("/api/ai/core-chat/mcp").set("Authorization", "Bearer test-connector-key")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  }
  function send(message: string, confirmed = true) {
    return callTool("send_ai_core_command", { message, conversationId: "conversation-a", confirmed });
  }
  it("routes read-only queries through ask mode and strips an execution-looking prefix", async () => {
    const response = await callTool("query_ai_core", {
      message: "@cek status worker",
      conversationId: "conversation-a",
      repository: "Travelintrips/Core-AI-Foundation",
    });
    expect(response.body.result.isError).toBeFalsy();
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mode: "ask",
      source: "text",
      message: "cek status worker",
      conversationId: "conversation-a",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("provides a correlatable server handshake receipt without claiming ChatGPT session or event ACK", async () => {
    const response = await callTool("handshake_ai_core", {});
    const body = response.body.result.structuredContent;
    expect(response.body.result.isError).toBeFalsy();
    expect(body.authenticated).toBe(true);
    expect(body.handshakeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.handshakeAck).toEqual({
      received: true, handshakeId: body.handshakeId, source: "ai_core_mcp_server",
    });
    expect(body.chatSessionId).toBeNull();
    expect(body.chatSessionIdVerified).toBe(false);
    expect(body.conversationAckVerified).toBe(false);
  });

  it("answers MCP discovery from the live tool registry without falling through to chat or database routing", async () => {
    const response = await callTool("query_ai_core", {
      message: "cek discovery MCP AI Core yang aktif saat ini. Sebutkan jumlah tool dan nama semua tool yang terhubung",
      conversationId: "conversation-a",
    });

    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({
      kind: "answer",
      route: "MCP_DISCOVERY",
      toolCount: 10,
      source: "LIVE_MCP_TOOL_REGISTRY",
      tools: [
        "query_ai_core",
        "send_ai_core_command",
        "get_ai_core_task_progress",
        "get_external_agent_command_progress",
        "subscribe_ai_core_events",
        "read_ai_core_events",
        "ack_ai_core_event",
        "unsubscribe_ai_core_events",
        "handshake_ai_core",
        "get_profile",
      ],
      events: ["ai_core.task.terminal"],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not report a verified conversation from an unverified subscription", async () => {
    const response = await callTool("subscribe_ai_core_events", { conversationId: "conversation-a" });
    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({
      subscribed: true,
      conversationId: "conversation-a",
      chatSessionIdVerified: false,
      conversationAckVerified: false,
      bindingStatus: "UNVERIFIED_CLIENT_SUPPLIED_CONVERSATION_ID",
    });
  });

  it("does not silently create a subscription when reading events", async () => {
    mocks.list.mockResolvedValueOnce([]);
    const response = await callTool("read_ai_core_events", { conversationId: "conversation-a" });
    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({
      conversationId: "conversation-a",
      events: [],
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation-a",
    }));
  });

  it("refuses event ACK without a matching conversation and passes scoped IDs to storage", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const missing = await callTool("ack_ai_core_event", { responseId: id });
    expect(missing.body.result.isError).toBe(true);
    expect(mocks.ack).not.toHaveBeenCalled();

    mocks.ack.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const mismatch = await callTool("ack_ai_core_event", {
      responseId: id, conversationId: "other-conversation",
    });
    expect(mismatch.body.result.structuredContent.acknowledged).toBe(false);
    const acknowledged = await callTool("ack_ai_core_event", {
      responseId: id, conversationId: "conversation-a",
    });
    expect(acknowledged.body.result.structuredContent.acknowledged).toBe(true);
    expect(mocks.ack).toHaveBeenLastCalledWith({
      responseId: id, conversationId: "conversation-a",
    });
  });

  it("auto-confirms safe # PC actions and forwards them to the OpenClaw route", async () => {
    const response = await send("# ketik cek", false);
    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({ reply: "OK" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mode: "auto",
      message: "@ # ketik cek",
    });
    expect(mocks.learning).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        kind: "direct_openclaw_pc_command",
        status: "auto_confirmed_safe_pc_action",
      }),
    }));
  });

  it("keeps sensitive # PC actions behind the confirmation gate", async () => {
    const response = await send("# hapus file Downloads/data.csv", false);
    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({
      kind: "intent_confirmation",
      route: "INTENT_CONFIRMATION",
      requiresConfirmation: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before coding via MCP", async () => {
    const response = await send("Perbaiki kode login dan update repository", false);
    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({
      kind: "intent_confirmation",
      route: "INTENT_CONFIRMATION",
      requiresConfirmation: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a confirmed coding instruction into the authenticated command lane", async () => {
    const response = await send("Perbaiki kode login dan update repository", true);
    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).not.toMatchObject({
      route: "POLICY_DENIED",
    });
    expect(response.body.result.structuredContent).toMatchObject({kind: "answer"});
  });

  it("returns an intent summary without executing until explicitly confirmed", async () => {
    const response = await send("Deploy aplikasi", false);
    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({
      kind: "intent_confirmation",
      route: "INTENT_CONFIRMATION",
      requiresConfirmation: true,
      understoodIntent: "Deploy aplikasi",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.learning).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ status: "awaiting_confirmation" }),
    }));
  });

  it("accepts confirmed plain commands, auto-subscribes terminal events, and persists the user instruction", async () => {
    const response = await send("Uji koneksi MCP");
    expect(response.body.result.isError).toBeFalsy();

    expect(mocks.subscribe).toHaveBeenCalledWith({
      conversationId: "conversation-a",
      eventTypes: ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"],
      leaseSeconds: 86_400,
    });
    expect(mocks.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0]!,
    );

    const init = vi.mocked(fetch).mock.calls[0][1];
    const forwardedBody = JSON.parse(String(init?.body));
    expect(forwardedBody).toMatchObject({
      mode: "auto",
      message: "@ Uji koneksi MCP",
      conversationId: "conversation-a",
    });
    expect(forwardedBody).not.toHaveProperty("confirmed");

    expect(response.body.result.structuredContent).toMatchObject({
      kind: "answer",
      reply: "OK",
      eventSubscription: {
        subscribed: true,
        conversationId: "conversation-a",
        eventTypes: ["COMPLETED", "FAILED", "BLOCKED", "MERGED", "DEPLOYED"],
        clientId: "chatgpt:conversation-a",
      },
    });

    expect(mocks.record).toHaveBeenCalledWith({
      conversationId: "conversation-a",
      instruction: "Uji koneksi MCP",
      payload: expect.objectContaining({
        kind: "answer",
        reply: "OK",
        eventSubscription: expect.objectContaining({
          subscribed: true,
          conversationId: "conversation-a",
        }),
      }),
    });
  });
  it("keeps a leading @ backward compatible without duplicating the gate", async () => {
    const response = await send("@ Uji koneksi MCP");
    expect(response.body.result.isError).toBeFalsy();
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mode: "auto",
      message: "@ Uji koneksi MCP",
    });
  });
  it("keeps command execution available when automatic subscription cannot be created", async () => {
    mocks.subscribe.mockRejectedValueOnce(new Error("presence database unavailable"));

    const response = await send("ping");

    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent).toMatchObject({
      reply: "OK",
      eventSubscription: {
        subscribed: false,
        conversationId: "conversation-a",
        error: "presence database unavailable",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reads events without renewing or creating a subscription", async () => {
    const response = await callTool("read_ai_core_events", {
      conversationId: "conversation-a",
      limit: 25,
    });

    expect(response.body.result.isError).toBeFalsy();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledWith({
      conversationId: "conversation-a",
      limit: 25,
    });
  });

  it("returns autonomous blocker responses as BLOCKED lifecycle events", async () => {
    mocks.list.mockResolvedValueOnce([
      {
        id: "response-1",
        commandId: "command-1",
        taskId: "task-1",
        kind: "BLOCKER",
        message: "Active file reservation conflict detected.",
        checkpoint: { source: "autonomous-repair-loop" },
        metadata: {},
        createdAt: new Date("2026-10-06T16:00:00.000Z"),
      },
    ]);

    const response = await callTool("read_ai_core_events", {
      conversationId: "conversation-a",
      limit: 25,
    });

    expect(response.body.result.isError).toBeFalsy();
    expect(response.body.result.structuredContent.events).toEqual([
      expect.objectContaining({
        kind: "BLOCKER",
        eventType: "BLOCKED",
        message: "Active file reservation conflict detected.",
      }),
    ]);
  });

  it("preserves a completed reply if event persistence fails", async () => {
    mocks.record.mockRejectedValue(new Error("database unavailable"));
    const response = await send("ping");
    expect(response.body.result.structuredContent).toMatchObject({ reply: "OK", eventDeliveryError: expect.any(String) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("isolates OAuth event subscriptions and reads to a server-derived user/client channel", async () => {
    const { verifyMcpAccessToken } = await import("../services/aiCoreMcpOAuthService.js");
    vi.mocked(verifyMcpAccessToken).mockResolvedValue({
      user: { id: "user-1" }, scopes: new Set(["ai_core.events"]), clientId: "chatgpt-client-1",
    } as never);
    const invoke = (name: string, args: Record<string, unknown>) => {
      const app = express(); app.use(express.json()); app.use("/api", router);
      return request(app).post("/api/ai/core-chat/mcp").set("Authorization", "Bearer oauth-unit-token")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    };
    const subscribed = await invoke("subscribe_ai_core_events", { conversationId: "client-injected" });
    const channel = subscribed.body.result.structuredContent.conversationId;
    expect(channel).toMatch(/^ai-engine-oauth:[a-f0-9]{64}$/);
    expect(channel).not.toBe("client-injected");
    expect(subscribed.body.result.structuredContent.bindingStatus).toBe("OAUTH_PRINCIPAL_CLIENT_CHANNEL");
    expect(subscribed.body.result.structuredContent.chatSessionIdVerified).toBe(false);
    expect(mocks.subscribe).toHaveBeenCalledWith(expect.objectContaining({ conversationId: channel }));
    // OAuth command auto-subscription and job forwarding must use the SAME server channel.
    vi.mocked(verifyMcpAccessToken).mockResolvedValue({
      user: { id: "user-1" }, scopes: new Set(["ai_core.events", "ai_core.command"]), clientId: "chatgpt-client-1",
    } as never);
    await invoke("send_ai_core_command", { conversationId: "arbitrary-input", message: "Uji koneksi MCP", confirmed: true });
    expect(mocks.subscribe).toHaveBeenCalledWith(expect.objectContaining({ conversationId: channel }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({ conversationId: channel });
    await invoke("read_ai_core_events", { conversationId: "other-user-channel" });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ conversationId: channel }));
    const responseId = "11111111-1111-4111-8111-111111111111";
    await invoke("ack_ai_core_event", { conversationId: "other-user-channel", responseId });
    expect(mocks.ack).toHaveBeenCalledWith({ conversationId: channel, responseId });
    vi.mocked(verifyMcpAccessToken).mockResolvedValue({
      user: { id: "user-2" }, scopes: new Set(["ai_core.events"]), clientId: "chatgpt-client-1",
    } as never);
    const other = await invoke("subscribe_ai_core_events", { conversationId: "client-injected" });
    expect(other.body.result.structuredContent.conversationId).not.toBe(channel);
    mocks.list.mockClear();
    mocks.ack.mockClear();
    await invoke("read_ai_core_events", { conversationId: channel });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: other.body.result.structuredContent.conversationId,
    }));
    expect(mocks.list).not.toHaveBeenCalledWith(expect.objectContaining({ conversationId: channel }));
    await invoke("ack_ai_core_event", { conversationId: channel, responseId });
    expect(mocks.ack).toHaveBeenCalledWith({
      conversationId: other.body.result.structuredContent.conversationId, responseId,
    });
    expect(mocks.ack).not.toHaveBeenCalledWith({ conversationId: channel, responseId });
  });

});
