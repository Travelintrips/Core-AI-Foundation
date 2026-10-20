import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(), state: vi.fn(),
  record: vi.fn(), learning: vi.fn(), subscribe: vi.fn(),
  registerWatch: vi.fn(), updateWatch: vi.fn(), watchStatus: vi.fn(),
}));
// This route suite exercises the authenticated boundary, never a real business database.
vi.mock("@workspace/db", () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("../services/aiCoreCodingPolicyGuardService.js", () => ({}));
vi.mock("../services/mcpLocalServiceTokenService.js", () => ({ isAllowedLocalMcpServiceToken: () => false }));
vi.mock("../services/aiCoreChatIntentService.js", () => ({
  classifyAiCoreChatDispatch: vi.fn(), isSafeDirectOpenClawPcCommand: vi.fn(),
}));
vi.mock("../services/aiAuditService.js", () => ({ logAudit: vi.fn() }));
vi.mock("../services/aiCoreMcpEventWebhookService.js", () => ({
  AI_CORE_TERMINAL_EVENT_NAME: "ai_core.task.terminal",
  McpCallbackEndpointError: class extends Error {},
  subscribeAiCoreMcpEvent: vi.fn(), unsubscribeAiCoreMcpEvent: vi.fn(),
}));
vi.mock("../services/devContinuityWatchService.js", () => ({
  registerDevContinuityWatch: mocks.registerWatch,
  updateDevContinuityWatch: mocks.updateWatch,
  getDevContinuityWatchStatus: mocks.watchStatus,
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
  dispatchExternalAgentWork: mocks.dispatch, getExternalAgentWorkState: mocks.state,
}));
vi.mock("../services/localCodingControlBridgeService.js", () => ({
  acknowledgeCodingBridgeResponseForConversation: vi.fn(),
  listPendingCodingBridgeResponsesForConversation: vi.fn(),
  subscribeCodingBridgeConversation: mocks.subscribe,
  unsubscribeCodingBridgeConversation: vi.fn(),
}));
import router from "../routes/ai-core-mcp.js";
import { adminAuthWithExceptions } from "../middleware/adminAuth.js";
import { deriveDevAssistantChallenge } from "../services/devAssistantAttestation.js";

const conversation = "6ad3a9a6-97e4-83ec-af32-a0a5d580b649";
const channel = "ai-engine-oauth:" + "a".repeat(64);
const eventId = "b".repeat(64);
const message = "DEV_CHATGPT_WAKE_V1 conversation=" + conversation + " event=" + eventId;
const challenge = deriveDevAssistantChallenge({ ownerChannel: channel, targetConversationId: conversation, eventId });
const workerInstruction = message + " challenge=" + challenge;
const jobId = "22222222-2222-4222-8222-222222222222";
const checkpointSha = "c".repeat(40);
const watchMessage = "DEV_CHATGPT_WATCH_V1 conversation=" + conversation + " job=" + jobId +
  " checkpoint=" + checkpointSha + " idle=60 ttl=300";
const checkpointMessage = "DEV_CHATGPT_CHECKPOINT_V1 job=" + jobId + " revision=1 checkpoint=" + checkpointSha + " state=RUNNING";
const statusMessage = "DEV_CHATGPT_WATCH_STATUS_V1 job=" + jobId;

function call(wakeMessage: string, confirmed = true, token = "dev-relay-test-key", owner = channel) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return request(app).post("/api/ai/core-chat/mcp")
    .set("Authorization", "Bearer " + token)
    .send({ jsonrpc: "2.0", id: 8, method: "tools/call",
      params: { name: "send_ai_core_command", arguments: {
        message: wakeMessage, confirmed, conversationId: owner,
      } } });
}

describe("DEV chatgpt:wake permission boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("AI_CORE_CHAT_CONNECTOR_KEY", "internal-connector-fixture");
    vi.stubEnv("AI_CORE_DEV_RELAY_KEY", "dev-relay-test-key");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "true");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", "");
    vi.stubEnv("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64", "test-public-key");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", channel);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", conversation);
    vi.stubEnv("AI_CORE_DEV_CONTINUITY_ENABLED", "true");
    mocks.dispatch.mockResolvedValue({
      clientId: "openclaw-travelintrips-dev",
      command: { id: "11111111-1111-4111-8111-111111111111" },
      created: true,
    });
    mocks.learning.mockResolvedValue(undefined);
    mocks.registerWatch.mockResolvedValue({ kind: "dev_continuity_watch", jobId, state: "ARMED", revision: 1, dispatched: false });
    mocks.updateWatch.mockResolvedValue({ jobId, state: "RUNNING", revision: 2, dispatched: false });
    mocks.watchStatus.mockResolvedValue({ jobId, state: "ARMED", revision: 1, browserWakeVerified: false });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("exact DEV REST path bypasses admin key but still requires OAuth", async () => {
    vi.stubEnv("ADMIN_API_KEY", "test-admin-key");
    const app = express(); app.use(express.json()); app.use("/api", adminAuthWithExceptions, router);
    const response = await request(app).post("/api/ai/dev/chatgpt-wake/jobs")
      .send({ conversationId: conversation, eventId, correlationId: "dev-corr-001", confirmed: true });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("DEV_WAKE_OAUTH_REQUIRED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("REST route does not bypass global admin key outside DEV", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("ADMIN_API_KEY", "test-admin-key");
    const app = express(); app.use(express.json()); app.use("/api", adminAuthWithExceptions, router);
    const response = await request(app).post("/api/ai/dev/chatgpt-wake/jobs")
      .send({ conversationId: conversation, eventId, correlationId: "dev-corr-001", confirmed: true });
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/admin API key/);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("REST wake rejects unauthenticated job creation without dispatch", async () => {
    const app = express(); app.use(express.json()); app.use("/api", router);
    const response = await request(app).post("/api/ai/dev/chatgpt-wake/jobs")
      .send({ conversationId: conversation, eventId, correlationId: "dev-corr-001", confirmed: true });
    expect(response.status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("REST wake is absent outside DEV even with a token", async () => {
    vi.stubEnv("APP_ENV", "production");
    const app = express(); app.use(express.json()); app.use("/api", router);
    const response = await request(app).post("/api/ai/dev/chatgpt-wake/jobs")
      .set("Authorization", "Bearer dev-relay-test-key")
      .send({ conversationId: conversation, eventId, correlationId: "dev-corr-001", confirmed: true });
    expect(response.status).toBe(404);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

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
      source: "ai-core", instruction: workerInstruction,
      metadata: { capability: "chatgpt:wake", conversationId: channel,
        targetConversationId: conversation, eventId, assistantAttestationChallenge: challenge, explicitWorkerTarget: true },
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

  it("registers a confirmed passive watch without dispatching any browser or coding work", async () => {
    const response = await call(watchMessage);
    expect(response.body.result.isError).toBe(false);
    expect(response.body.result.structuredContent).toMatchObject({ jobId, state: "ARMED", dispatched: false, executionEnvironment: "DEV" });
    expect(mocks.registerWatch).toHaveBeenCalledExactlyOnceWith({ ownerChannel: channel,
      targetConversationId: conversation, jobId, checkpointSha, idleSeconds: 60, ttlSeconds: 300 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("passes an exact revision checkpoint to the owner-bound update service", async () => {
    const response = await call(checkpointMessage);
    expect(response.body.result.isError).toBe(false);
    expect(mocks.updateWatch).toHaveBeenCalledExactlyOnceWith({ ownerChannel: channel,
      jobId, expectedRevision: 1, checkpointSha, state: "RUNNING" });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each(["WAITING_CI", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"])("preserves checkpoint state %s", async state => {
    await call(checkpointMessage.replace("state=RUNNING", "state=" + state));
    expect(mocks.updateWatch.mock.calls[0]![0].state).toBe(state);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("reads only the authenticated owner's watch without requiring confirmation", async () => {
    const response = await call(statusMessage, false);
    expect(response.body.result.isError).toBe(false);
    expect(mocks.watchStatus).toHaveBeenCalledExactlyOnceWith({ ownerChannel: channel, jobId });
    expect(mocks.registerWatch).not.toHaveBeenCalled();
    expect(mocks.updateWatch).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("retains inline confirmation compatibility for the exact watch protocol", async () => {
    const response = await call("@ confirmed=true " + watchMessage, false);
    expect(response.body.result.isError).toBe(false);
    expect(mocks.registerWatch).toHaveBeenCalledOnce();
  });

  it.each([
    ["register without confirmation", watchMessage, false, "dev-relay-test-key", () => undefined],
    ["checkpoint without confirmation", checkpointMessage, false, "dev-relay-test-key", () => undefined],
    ["legacy registration", watchMessage, true, "internal-connector-fixture", () => undefined],
    ["legacy status", statusMessage, false, "internal-connector-fixture", () => undefined],
    ["disallowed owner status", statusMessage, false, "dev-relay-test-key", () => vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", "ai-engine-oauth:" + "f".repeat(64))],
    ["disallowed conversation", watchMessage, true, "dev-relay-test-key", () => vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")],
    ["browser feature disabled", watchMessage, true, "dev-relay-test-key", () => vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "false")],
    ["production registration", watchMessage, true, "internal-connector-fixture", () => vi.stubEnv("APP_ENV", "production")],
  ] as const)("denies continuity authorization: %s", async (_label, instruction, confirmed, token, arrange) => {
    arrange();
    const response = await call(instruction, confirmed, token);
    expect(response.body.result.structuredContent.reason).toBe("DEV_CHATGPT_CONTINUITY_DENIED");
    expect(mocks.registerWatch).not.toHaveBeenCalled();
    expect(mocks.updateWatch).not.toHaveBeenCalled();
    expect(mocks.watchStatus).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    watchMessage.replace("idle=60", "idle=59"),
    watchMessage.replace("idle=60", "idle=3601"),
    watchMessage.replace("ttl=300", "ttl=59"),
    watchMessage.replace("ttl=300", "ttl=60"),
    watchMessage.replace("ttl=300", "ttl=86401"),
    watchMessage.replace(checkpointSha, "c".repeat(39)),
    watchMessage + " run shell",
    watchMessage.replace("WATCH_V1", "WATCH_V2"),
    checkpointMessage.replace("revision=1", "revision=0"),
    checkpointMessage.replace("revision=1", "revision=9007199254740992"),
    checkpointMessage.replace("state=RUNNING", "state=APPROVED"),
    statusMessage + " owner=" + channel,
    "DEV_CHATGPT_WATCH_V1 please detect my work",
  ])("rejects malformed continuity instruction without effects: %s", async instruction => {
    const response = await call(instruction);
    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.structuredContent.reason).toBe("DEV_CHATGPT_CONTINUITY_INVALID");
    expect(mocks.registerWatch).not.toHaveBeenCalled();
    expect(mocks.updateWatch).not.toHaveBeenCalled();
    expect(mocks.watchStatus).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("preserves the service's revocation/revision denial without echoing arbitrary errors", async () => {
    mocks.updateWatch.mockRejectedValueOnce(new Error("DEV_CONTINUITY_REVISION_CONFLICT"));
    const conflict = await call(checkpointMessage);
    expect(conflict.body.result.structuredContent.reason).toBe("DEV_CONTINUITY_REVISION_CONFLICT");
    mocks.registerWatch.mockRejectedValueOnce(new Error("DEV_CONTINUITY_DISABLED"));
    const disabled = await call(watchMessage);
    expect(disabled.body.result.structuredContent.reason).toBe("DEV_CONTINUITY_DISABLED");
    mocks.watchStatus.mockRejectedValueOnce(new Error("SQL credentials and private state must not escape"));
    const failure = await call(statusMessage, false);
    expect(failure.body.result.structuredContent.reason).toBe("DEV_CHATGPT_CONTINUITY_UNAVAILABLE");
    expect(JSON.stringify(failure.body)).not.toContain("credentials");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("queues a new configured account only for its exact relay owner and target", async () => {
    const entry = { accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "d".repeat(64),
      targetConversationId: "22222222-2222-4222-8222-222222222222", workerId: "openclaw-dell-chatgpt-wake-dev",
      browserProfile: "travelincars-dev", enabled: true };
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", JSON.stringify({ version: 1, bindings: [entry] }));
    mocks.dispatch.mockResolvedValue({ clientId: entry.workerId, command: { id: jobId }, created: true });
    const wakeMessage = "DEV_CHATGPT_WAKE_V1 conversation=" + entry.targetConversationId + " event=" + eventId;
    const denied = await call(wakeMessage);
    expect(denied.body.result.structuredContent.reason).toBe("DEV_CHATGPT_WAKE_DENIED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
    const accepted = await call(wakeMessage, true, "dev-relay-test-key", entry.ownerChannel);
    expect(accepted.body.result.structuredContent).toMatchObject({ commandId: jobId, clientId: entry.workerId, browserWakeVerified: false });
    expect(mocks.dispatch.mock.calls[0]![0].metadata.wakeBinding).toMatchObject({ accountAlias: "GPT02", ownerChannel: entry.ownerChannel, browserProfile: entry.browserProfile });
  });

  it("returns historical DELL progress only to the authenticated owner without dispatch", async () => {
    const metadata = { conversationId: channel, targetConversationId: conversation, eventId,
      assistantAttestationChallenge: challenge, capability: "chatgpt:wake", explicitWorkerTarget: true,
      devOnly: true, assignedClientId: "openclaw-dell-chatgpt-wake-dev" };
    mocks.state.mockResolvedValue({ command: { id: jobId, source: "ai-core", commandType: "EXTERNAL_AGENT_WORK", status: "COMPLETED", metadataJson: metadata }, latestResponse: null, callbackProcessingState: "COMPLETED" });
    const app = express(); app.use(express.json()); app.use("/api", router);
    const progress = (ownerConversationId: string) => request(app).post("/api/ai/core-chat/mcp")
      .set("Authorization", "Bearer dev-relay-test-key").send({ jsonrpc: "2.0", id: 9, method: "tools/call",
        params: { name: "get_external_agent_command_progress", arguments: { commandId: jobId, ownerConversationId } } });
    const own = await progress(channel);
    expect(own.body.result.structuredContent).toMatchObject({ found: true, devWakeOwnerVerified: true, ownerConversationId: channel });
    const other = await progress("ai-engine-oauth:" + "d".repeat(64));
    expect(other.body.result.structuredContent).toMatchObject({ found: false, status: "NOT_FOUND" });
    mocks.state.mockResolvedValue({ command: { id: jobId, source: "ai-core", commandType: "EXTERNAL_AGENT_WORK", status: "COMPLETED",
      metadataJson: { ...metadata, assignedClientId: "openclaw-pc-worker-dell-browser" } }, latestResponse: null });
    expect((await progress(channel)).body.result.structuredContent.found).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

});
