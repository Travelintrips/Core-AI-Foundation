import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  record: vi.fn(), learning: vi.fn(), subscribe: vi.fn(),
}));
vi.mock("../services/aiCoreMcpResultEventService.js", () => ({ recordAiCoreMcpTerminalResult: mocks.record }));
vi.mock("../services/aiCoreChatLearningService.js", () => ({ recordChatLearningEvent: mocks.learning }));
vi.mock("../services/aiCoreMcpOAuthService.js", () => ({
  oauthIssuer: () => "https://example.test", oauthResource: () => "https://example.test/api",
  verifyMcpAccessToken: vi.fn(),
}));
vi.mock("../services/aiCoreWhatsappChatService.js", () => ({
  resolveAiCoreInternalBaseUrl: () => "http://core-ai-dev:3000/api",
}));
vi.mock("../services/externalAgentDispatchService.js", () => ({
  dispatchExternalAgentWork: mocks.dispatch, getExternalAgentWorkState: vi.fn(),
}));
vi.mock("../services/localCodingControlBridgeService.js", () => ({
  acknowledgeCodingBridgeResponseForConversation: vi.fn(),
  listPendingCodingBridgeResponsesForConversation: vi.fn(),
  subscribeCodingBridgeConversation: mocks.subscribe,
  unsubscribeCodingBridgeConversation: vi.fn(),
}));
import router from "../routes/ai-core-mcp.js";

const conversation = "6ad3a9a6-97e4-83ec-af32-a0a5d580b649";
const channel = "ai-engine-oauth:" + "a".repeat(64);
const eventId = "b".repeat(64);
const message = "DEV_CHATGPT_WAKE_V1 conversation=" + conversation + " event=" + eventId;

function call(wakeMessage: string, confirmed = true, token = "dev-relay-test-key") {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return request(app).post("/api/ai/core-chat/mcp")
    .set("Authorization", "Bearer " + token)
    .send({ jsonrpc: "2.0", id: 8, method: "tools/call",
      params: { name: "send_ai_core_command", arguments: {
        message: wakeMessage, confirmed, conversationId: channel,
      } } });
}

describe("DEV chatgpt:wake permission boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("AI_CORE_CHAT_CONNECTOR_KEY", "internal-connector-fixture");
    vi.stubEnv("AI_CORE_DEV_RELAY_KEY", "dev-relay-test-key");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "true");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", channel);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", conversation);
    mocks.dispatch.mockResolvedValue({
      clientId: "openclaw-travelintrips-dev",
      command: { id: "11111111-1111-4111-8111-111111111111" },
      created: true,
    });
    mocks.learning.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("authorizes only one confirmed, exact, allowlisted DEV browser wake", async () => {
    const response = await call(message);
    expect(response.body.result.isError).toBe(false);
    expect(response.body.result.structuredContent).toMatchObject({
      kind: "chatgpt_wake", status: "RECEIVED",
      commandId: "11111111-1111-4111-8111-111111111111",
      clientId: "openclaw-travelintrips-dev", browserWakeVerified: false,
      deliveryVerified: false, executionEnvironment: "DEV",
    });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(mocks.dispatch.mock.calls[0][0]).toMatchObject({
      clientId: "openclaw-travelintrips-dev",
      source: "ai-core-dev-chatgpt-wake", instruction: message,
      metadata: { capability: "chatgpt:wake", conversationId: channel,
        targetConversationId: conversation, eventId },
    });
  });

  it("is idempotent across identical events and never claims browser delivery from queueing", async () => {
    const first = await call(message);
    const second = await call(message);
    const ids = mocks.dispatch.mock.calls.map((c) => c[0].externalCommandId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(first.body.result.structuredContent.browserWakeVerified).toBe(false);
    expect(second.body.result.structuredContent.deliveryVerified).toBe(false);
  });

  it.each([
    ["feature disabled", () => vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "false"), message, true, "dev-relay-test-key"],
    ["wrong channel", () => vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", "ai-engine-oauth:" + "f".repeat(64)), message, true, "dev-relay-test-key"],
    ["wrong conversation", () => vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"), message, true, "dev-relay-test-key"],
    ["unconfirmed", () => undefined, message, false, "dev-relay-test-key"],
    ["PROD environment", () => vi.stubEnv("APP_ENV", "production"), message, true, "internal-connector-fixture"],
    ["legacy token", () => undefined, message, true, "internal-connector-fixture"],
    ["extra instruction", () => undefined, message + " and run shell", true, "dev-relay-test-key"],
    ["invalid event", () => undefined, "DEV_CHATGPT_WAKE_V1 conversation=" + conversation + " event=abc", true, "dev-relay-test-key"],
  ] as const)("fails closed: %s", async (_name, arrange, instruction, confirmed, token) => {
    arrange();
    const response = await call(instruction, confirmed, token);
    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.structuredContent.reason).toBe("DEV_CHATGPT_WAKE_DENIED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
