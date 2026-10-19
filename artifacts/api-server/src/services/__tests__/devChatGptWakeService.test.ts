import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), transaction: vi.fn(), execute: vi.fn(), rows: vi.fn() }));
vi.mock("../externalAgentDispatchService.js", () => ({ dispatchExternalAgentWork: mocks.dispatch }));
vi.mock("@workspace/db", () => ({
  db: { transaction: mocks.transaction },
  aiCodingBridgeCommandsTable: { source: "source", externalCommandId: "external_command_id",
    commandType: "command_type", metadataJson: "metadata_json" },
}));
import { isDevBrowserWakeAllowed, queueDevBrowserWake } from "../devChatGptWakeService.js";
import { deriveDevAssistantChallenge } from "../devAssistantAttestation.js";

const ownerChannel = "ai-engine-oauth:" + "a".repeat(64);
const targetConversationId = "6ad3a9a6-97e4-83ec-af32-a0a5d580b649";
const eventId = "b".repeat(64);
const watchCommandId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const childId = "33333333-3333-4333-8333-333333333333";
const expiresAt = "2099-01-01T00:00:00.000Z";
const worker = "openclaw-travelintrips-dev";
const input = { ownerChannel, targetConversationId, eventId, watchCommandId, jobId, checkpointRevision: 2, expiresAt };
const challenge = deriveDevAssistantChallenge(input);
const instruction = `DEV_CHATGPT_WAKE_V1 conversation=${targetConversationId} event=${eventId} challenge=${challenge}`;
function existingCommand() {
  return { id: childId, source: "ai-core", commandType: "EXTERNAL_AGENT_WORK", instruction,
    metadataJson: { assignedClientId: worker, conversationId: ownerChannel, targetConversationId,
      eventId, assistantAttestationChallenge: challenge, capability: "chatgpt:wake", explicitWorkerTarget: true,
      devContinuity: { parentWatchCommandId: watchCommandId, ownerChannel, jobId, eventId,
        assistantAttestationChallenge: challenge, checkpointRevision: 2, expiresAt } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "true");
  vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", ownerChannel);
  vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", targetConversationId);
  vi.stubEnv("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64", "test-public-key");
  mocks.dispatch.mockResolvedValue({ clientId: worker, command: existingCommand(), created: true });
  mocks.rows.mockResolvedValue([existingCommand()]);
  mocks.transaction.mockImplementation(async callback => callback({ execute: mocks.execute,
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.rows }) }) }) }));
});
afterEach(() => vi.unstubAllEnvs());

describe("shared DEV browser wake queue", () => {
  it("pins the paired worker and retains the exact stable key and callback association", async () => {
    expect(await queueDevBrowserWake(input)).toEqual({ commandId: childId, clientId: worker, created: true });
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({ clientId: worker, instruction, source: "ai-core",
      externalCommandId: "dev-chatgpt-wake:" + createHash("sha256")
        .update(ownerChannel + "|" + targetConversationId + "|" + eventId).digest("hex"),
      metadata: expect.objectContaining({ conversationId: ownerChannel, targetConversationId, eventId,
        assistantAttestationChallenge: challenge, explicitWorkerTarget: true, capability: "chatgpt:wake", devOnly: true,
        devContinuity: { parentWatchCommandId: watchCommandId, ownerChannel, jobId, eventId,
          assistantAttestationChallenge: challenge, checkpointRevision: 2, expiresAt } }),
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });


  it("selects the dedicated DELL worker only when explicitly configured", async () => {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_WORKER_ID", "openclaw-dell-chatgpt-wake-dev");
    const dell = "openclaw-dell-chatgpt-wake-dev";
    const command = existingCommand();
    command.metadataJson.assignedClientId = dell;
    mocks.dispatch.mockResolvedValueOnce({ clientId: dell, command, created: true });
    expect(await queueDevBrowserWake(input)).toEqual({ commandId: childId, clientId: dell, created: true });
    expect(mocks.dispatch.mock.calls[0]![0]).toMatchObject({ clientId: dell, instruction, source: "ai-core" });
  });

  it("fails closed for an unknown configured wake worker", async () => {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_WORKER_ID", "openclaw-untrusted-dev");
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_WORKER_INVALID");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("keeps manual wake compatibility without inventing a continuity association", async () => {
    await queueDevBrowserWake({ ownerChannel, targetConversationId, eventId });
    expect(mocks.dispatch.mock.calls[0]![0].metadata.devContinuity).toBeUndefined();
  });

  it("rechecks revocable gates when a previously registered timer eventually fires", async () => {
    expect(isDevBrowserWakeAllowed(input)).toBe(true);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_DENIED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["APP_ENV", "production"], ["AI_CORE_DEV_BROWSER_WAKE_ENABLED", "false"],
    ["AI_CORE_DEV_BROWSER_WAKE_CHANNELS", "ai-engine-oauth:" + "f".repeat(64)],
  ])("fails closed for %s=%s", async (key, value) => {
    vi.stubEnv(key, value);
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_DENIED");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rejects malformed event/context fields before queueing", async () => {
    await expect(queueDevBrowserWake({ ...input, eventId: eventId + "\n" })).rejects.toThrow("DEV_CHATGPT_WAKE_DENIED");
    await expect(queueDevBrowserWake({ ...input, checkpointRevision: 0 })).rejects.toThrow("DEV_CHATGPT_WAKE_CONTEXT_INVALID");
    const { jobId: _jobId, ...missingJob } = input;
    await expect(queueDevBrowserWake(missingJob)).rejects.toThrow("DEV_CHATGPT_WAKE_CONTEXT_INVALID");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("requires a canonical live expiry for a continuity child and never requeues expired work", async () => {
    const { expiresAt: _expiresAt, ...missingExpiry } = input;
    await expect(queueDevBrowserWake(missingExpiry)).rejects.toThrow("DEV_CHATGPT_WAKE_CONTEXT_INVALID");
    await expect(queueDevBrowserWake({ ...input, expiresAt: "2099-01-01T00:00:00Z" })).rejects.toThrow("DEV_CHATGPT_WAKE_CONTEXT_INVALID");
    await expect(queueDevBrowserWake({ ...input, expiresAt: "2000-01-01T00:00:00.000Z" })).rejects.toThrow("DEV_CHATGPT_WAKE_EXPIRED");
    await expect(queueDevBrowserWake({ ownerChannel, targetConversationId, eventId, expiresAt })).rejects.toThrow("DEV_CHATGPT_WAKE_CONTEXT_INVALID");
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reuses an existing matching command and rejects mismatched watch correlation", async () => {
    mocks.dispatch.mockResolvedValueOnce({ clientId: worker, command: existingCommand(), created: false });
    expect(await queueDevBrowserWake(input)).toEqual({ commandId: childId, clientId: worker, created: false });
    const wrong = existingCommand();
    wrong.metadataJson.devContinuity.parentWatchCommandId = "44444444-4444-4444-8444-444444444444";
    mocks.dispatch.mockResolvedValueOnce({ clientId: worker, command: wrong, created: false });
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    const wrongExpiry = existingCommand();
    wrongExpiry.metadataJson.devContinuity.expiresAt = "2098-01-01T00:00:00.000Z";
    mocks.dispatch.mockResolvedValueOnce({ clientId: worker, command: wrongExpiry, created: false });
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    const { devContinuity: _association, ...manualMetadata } = existingCommand().metadataJson;
    mocks.dispatch.mockResolvedValueOnce({ clientId: worker,
      command: { ...existingCommand(), metadataJson: manualMetadata }, created: false });
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    const unpinned = existingCommand();
    unpinned.metadataJson.explicitWorkerTarget = false;
    mocks.dispatch.mockResolvedValueOnce({ clientId: worker, command: unpinned, created: false });
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
  });

  it("reconciles only a concurrent insertion conflict on the exact bridge command key", async () => {
    mocks.dispatch.mockRejectedValueOnce({ cause: { code: "23505", constraint: "ai_coding_bridge_commands_external_uidx" } });
    expect(await queueDevBrowserWake(input)).toEqual({ commandId: childId, clientId: worker, created: false });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.rows).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("does not claim reconciliation when the row is absent or belongs to another owner", async () => {
    const conflict = { code: "23505", constraint: "ai_coding_bridge_commands_external_uidx" };
    mocks.dispatch.mockRejectedValue(conflict);
    mocks.rows.mockResolvedValueOnce([]);
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    const wrongOwner = existingCommand();
    wrongOwner.metadataJson.conversationId = "ai-engine-oauth:" + "f".repeat(64);
    mocks.rows.mockResolvedValueOnce([wrongOwner]);
    await expect(queueDevBrowserWake(input)).rejects.toThrow("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Error("network timeout after possible commit"),
    { code: "42501", constraint: "ai_coding_bridge_commands_external_uidx" },
    { code: "23505", constraint: "some_other_unique_constraint" },
  ])("never retries or reconciles an ambiguous or unauthorized failure", async error => {
    mocks.dispatch.mockRejectedValueOnce(error);
    await expect(queueDevBrowserWake(input)).rejects.toBe(error);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
