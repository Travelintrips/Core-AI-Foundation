import express from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../services/aiCoreMcpOAuthService.js", () => ({
  oauthIssuer: () => "https://aiengine.cstlogistic.co.id", verifyMcpAccessToken: vi.fn(),
}));
import { verifyMcpAccessToken } from "../../services/aiCoreMcpOAuthService.js";
import { createDevOnlyMcpGateway, devOnlyRelayConfiguration } from "../devOnlyMcpGateway.js";
const url = "https://dev.cstlogistic.co.id/api/ai/core-chat/mcp";
const env = { AI_CORE_MCP_TARGET_ENV: "DEV", AI_CORE_DEV_RELAY_URL: url, AI_CORE_DEV_RELAY_KEY: "fixture-".repeat(8), AI_CORE_INTERNAL_BASE_URL: "http://ai-core-prod-api:3000" };
const identity = {
  clientId: "fixture-client", user: { id: 42, email: "fixture@example.test" },
  scopes: new Set(["ai_core.progress", "ai_core.command", "ai_core.events", "profile"]),
} as unknown as Awaited<ReturnType<typeof verifyMcpAccessToken>>;
const upstream = (structuredContent: Record<string, unknown> = { found: true }, isError = false) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: "upstream", result: { structuredContent, isError } }), { status: 200 });
function fixture(config = env) {
  const request = vi.fn<typeof fetch>().mockResolvedValue(upstream());
  const fallback = vi.fn();
  const app = express(); app.use(express.json());
  app.use("/api", createDevOnlyMcpGateway({ env: config, fetch: request }));
  app.use((_req, res) => { fallback(); res.json({ discovery: true }); });
  const call = (name: string, args: Record<string, unknown> = {}, auth = true) => {
    const req = supertest(app).post("/api/ai/core-chat/mcp");
    if (auth) req.set("Authorization", "Bearer fixture-access-token");
    return req.send({ jsonrpc: "2.0", id: 17, method: "tools/call", params: { name, arguments: args } });
  };
  return { app, request, fallback, call };
}
beforeEach(() => { vi.mocked(verifyMcpAccessToken).mockReset(); vi.mocked(verifyMcpAccessToken).mockResolvedValue(identity); });

describe("exclusive DEV MCP gateway and existing scoped relay", () => {
  it.each(["send_ai_core_command", "get_external_agent_command_progress", "subscribe_ai_core_events",
    "read_ai_core_events", "ack_ai_core_event", "unsubscribe_ai_core_events"])("%s only reaches DEV", async (name) => {
    const f = fixture(); const result = await f.call(name, { message: "fixture", confirmed: true });
    expect(result.status).toBe(200); expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request.mock.calls[0]![0]).toBe(url);
    expect(f.request.mock.calls[0]![1]?.redirect).toBe("error");
    expect(result.body.result.structuredContent.executionEnvironment).toBe("DEV");
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it.each(["query_ai_core", "get_ai_core_task_progress"])("%s is explicitly unavailable, never serviced by PROD", async (name) => {
    const f = fixture(); const result = await f.call(name, { taskId: "prod-task-fixture" });
    expect(result.body.result.isError).toBe(true);
    expect(result.body.result.structuredContent.reason).toBe("DEV_RELAY_SCOPE_UNSUPPORTED");
    expect(f.request).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
  it("uses a consistent server-derived OAuth channel", async () => {
    const f = fixture();
    for (const name of ["send_ai_core_command", "subscribe_ai_core_events", "read_ai_core_events", "ack_ai_core_event"]) {
      await f.call(name, { conversationId: "another-user-channel", message: "fixture", confirmed: true });
    }
    const args = f.request.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).params.arguments);
    expect(new Set(args.map((item) => item.conversationId)).size).toBe(1);
    expect(args[0].conversationId).toMatch(/^ai-engine-oauth:[0-9a-f]{64}$/);
    expect(args[0].conversationId).not.toBe("another-user-channel"); expect(args[0].branch).toBe("develop");
  });
  it("fences progress lookup to the authenticated user's channel", async () => {
    const f = fixture(); await f.call("get_external_agent_command_progress", { commandId: "fixture", ownerConversationId: "forged" });
    const args = JSON.parse(String(f.request.mock.calls[0]![1]?.body)).params.arguments;
    expect(args.ownerConversationId).toMatch(/^ai-engine-oauth:[0-9a-f]{64}$/);
    expect(args.ownerConversationId).not.toBe("forged");
  });
  it("handshake uses an authorized read probe, never the relay-denied handshake method", async () => {
    const f = fixture(); f.request.mockResolvedValue(upstream({ events: [], conversationId: "fixture" }));
    const result = await f.call("handshake_ai_core");
    const request = JSON.parse(String(f.request.mock.calls[0]![1]?.body));
    expect(request.params.name).toBe("read_ai_core_events"); expect(request.params.arguments.limit).toBe(1);
    expect(result.body.result.structuredContent).toMatchObject({ authenticated: true, aiEngineSessionVerified: true,
      backendProbeVerified: true, backendProbe: "authorized_private_inbox_read", chatSessionId: null,
      chatSessionIdVerified: false, conversationAckVerified: false, browserWakeVerified: false,
      handshakeAck: { received: true, source: "dev_only_mcp_gateway" } });
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it("does not read events for a progress-only OAuth caller", async () => {
    vi.mocked(verifyMcpAccessToken).mockResolvedValue({ ...identity, scopes: new Set(["ai_core.progress"]) });
    const f = fixture(); const result = await f.call("handshake_ai_core");
    expect(result.body.result.structuredContent.backendProbeVerified).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated callers before relay", async () => {
    const f = fixture(); expect((await f.call("send_ai_core_command", {}, false)).status).toBe(401);
    expect(f.request).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
  it("retains per-tool OAuth scope checks", async () => {
    vi.mocked(verifyMcpAccessToken).mockResolvedValue({ ...identity, scopes: new Set(["profile"]) });
    const f = fixture(); expect((await f.call("send_ai_core_command")).status).toBe(401);
    expect(f.request).not.toHaveBeenCalled();
  });
  it("returns profile without business dispatch", async () => {
    const f = fixture(); const result = await f.call("get_profile");
    expect(result.body.result.structuredContent.email).toBe("fixture@example.test");
    expect(f.request).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
  it.each(["https://aicore.cstlogistic.co.id/api/ai/core-chat/mcp", "http://ai-core-prod-api:3000/api/ai/core-chat/mcp",
    "https://dev.cstlogistic.co.id:8443/api/ai/core-chat/mcp", "https://dev.cstlogistic.co.id/api/ai/core-chat/mcp?target=prod"])("rejects unsafe relay URL %s", async (badUrl) => {
    const f = fixture({ ...env, AI_CORE_DEV_RELAY_URL: badUrl });
    expect((await f.call("send_ai_core_command")).status).toBe(503);
    expect(f.request).not.toHaveBeenCalled(); expect(f.fallback).not.toHaveBeenCalled();
  });
  it("fails closed on absent credentials or a non-DEV target", () => {
    expect(() => devOnlyRelayConfiguration({ ...env, AI_CORE_DEV_RELAY_KEY: "" })).toThrow();
    expect(() => devOnlyRelayConfiguration({ ...env, AI_CORE_MCP_TARGET_ENV: "PROD" })).toThrow();
  });
  it("never retries execution or falls back when DEV is unavailable", async () => {
    const f = fixture(); f.request.mockRejectedValue(new Error("timeout"));
    const result = await f.call("send_ai_core_command");
    expect(result.status).toBe(503);
    expect(result.body.result.structuredContent.dispatchState).toBe("unknown_reconcile_before_retry");
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.fallback).not.toHaveBeenCalled();
  });
  it("does not infer completion from an HTTP response or downgrade a relay denial", async () => {
    const f = fixture(); f.request.mockResolvedValue(upstream({ blocked: true, reason: "SCOPED_DEV_RELAY_DENIED" }, true));
    expect((await f.call("send_ai_core_command")).body.result.isError).toBe(true);
    expect(f.fallback).not.toHaveBeenCalled();
  });
  it("does not allow unknown methods or tools into the original router", async () => {
    const f = fixture(); expect((await f.call("unknown_tool")).body.result.isError).toBe(true);
    const result = await supertest(f.app).post("/api/ai/core-chat/mcp").send({ jsonrpc: "2.0", id: 1, method: "events/subscribe" });
    expect(result.body.result.isError).toBe(true); expect(f.fallback).not.toHaveBeenCalled();
  });
  it("allows only inert discovery into the original registry", async () => {
    const f = fixture();
    await supertest(f.app).post("/api/ai/core-chat/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(f.fallback).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled();
  });
  it("protects the mcp-v2 alias", async () => {
    const f = fixture(); const result = await supertest(f.app).post("/api/ai/core-chat/mcp-v2")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_ai_core_command" } });
    expect(result.status).toBe(401); expect(f.fallback).not.toHaveBeenCalled();
  });
});
