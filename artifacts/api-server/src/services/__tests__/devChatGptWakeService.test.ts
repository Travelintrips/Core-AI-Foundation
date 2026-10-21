import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), transaction: vi.fn(), execute: vi.fn(), rows: vi.fn(), handshakeEvidence: vi.fn(), registry: vi.fn() }));
vi.mock("../externalAgentDispatchService.js", () => ({ dispatchExternalAgentWork: mocks.dispatch }));
vi.mock("../externalAgentRegistryService.js", () => ({ getExternalAgentRegistrySnapshot: mocks.registry }));
vi.mock("../localCodingControlBridgeService.js", () => ({ getVerifiedMcpHandshakeEvidenceForConversation: mocks.handshakeEvidence }));
vi.mock("@workspace/db", () => ({
  db: { transaction: mocks.transaction, execute: mocks.execute },
  aiCodingBridgeCommandsTable: { source: "source", externalCommandId: "external_command_id",
    commandType: "command_type", metadataJson: "metadata_json" },
}));
import { isDevBrowserWakeAllowed, queueDevBrowserWake, resolveVerifiedDevWakeTarget } from "../devChatGptWakeService.js";
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
  vi.stubEnv("AI_CORE_DEV_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64", "test-public-key");
  mocks.dispatch.mockResolvedValue({ clientId: worker, command: existingCommand(), created: true });
  mocks.handshakeEvidence.mockResolvedValue(null);
  mocks.registry.mockResolvedValue([
    { clientId: "openclaw-dell-chatgpt-wake-dev", eligible: true, reportedHealth: "healthy", availableSlots: 1, activeJobs: 0 },
    { clientId: "openclaw-travelintrips-dev", eligible: true, reportedHealth: "healthy", availableSlots: 1, activeJobs: 0 },
  ]);
  mocks.execute.mockResolvedValue({ rows: [] });
  vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", "");
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

  it("encodes a bounded operator instruction for the dedicated browser worker", async () => {
    const task = "cek pada dell ada berapa worker";
    const encoded = Buffer.from(task, "utf8").toString("base64url");
    const v2Instruction = `DEV_CHATGPT_WAKE_V2 conversation=${targetConversationId} event=${eventId} challenge=${challenge} task=${encoded}`;
    const command = existingCommand();
    command.instruction = v2Instruction;
    mocks.dispatch.mockResolvedValueOnce({ clientId: worker, command, created: true });
    await queueDevBrowserWake({ ...input, instruction: task, jobAlias: "JOB001" });
    expect(mocks.dispatch.mock.calls[0]![0]).toMatchObject({
      instruction: v2Instruction,
      metadata: expect.objectContaining({
        jobAlias: "JOB001",
        requestedInstructionHash: createHash("sha256").update(task).digest("hex"),
      }),
    });
  });

  it("preserves every existing GPT01 owner and resolves aliases only for the exact caller", async () => {
    const otherOwner = "ai-engine-oauth:" + "c".repeat(64);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", ownerChannel + "," + otherOwner);
    mocks.handshakeEvidence.mockImplementation(async channel => ({ ownerChannel: channel, targetConversationId, workerId: worker }));
    for (const channel of [ownerChannel, otherOwner]) {
      expect(await isDevBrowserWakeAllowed({ ownerChannel: channel, targetConversationId })).toBe(true);
      await expect(resolveVerifiedDevWakeTarget("gpt01", undefined, channel)).resolves.toEqual({
        ownerChannel: channel, targetConversationId, workerId: worker,
      });
      expect(mocks.handshakeEvidence).toHaveBeenLastCalledWith(channel, expect.any(Object));
    }
    await expect(resolveVerifiedDevWakeTarget("gpt01")).rejects.toThrow("DEV_CHATGPT_ALIAS_OWNER_REQUIRED");
    await expect(resolveVerifiedDevWakeTarget("gpt01", undefined, "ai-engine-oauth:" + "d".repeat(64)))
      .rejects.toThrow("DEV_CHATGPT_ALIAS_OWNER_MISMATCH");
    expect(mocks.handshakeEvidence).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    "GPT01 JOB005",
    "gpt01 job 5",
    "*GPT01-JOB005",
  ])("normalizes a bounded legacy/simple GPT01 alias form: %s", async alias => {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_WORKER_ID", "openclaw-dell-chatgpt-wake-dev");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", ownerChannel);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", targetConversationId);
    mocks.handshakeEvidence.mockResolvedValue({
      ownerChannel,
      targetConversationId,
      workerId: "openclaw-dell-chatgpt-wake-dev",
    });
    await expect(resolveVerifiedDevWakeTarget(alias)).resolves.toEqual({
      ownerChannel,
      targetConversationId,
      workerId: "openclaw-dell-chatgpt-wake-dev",
    });
  });

  it.each([
    "GPT02 JOB005",
    "GPT01 JOBABC",
    "GPT01 arbitrary",
  ])("still fails closed for an untrusted alias form: %s", async alias => {
    await expect(resolveVerifiedDevWakeTarget(alias)).rejects.toThrow("DEV_CHATGPT_ALIAS_NOT_CONFIGURED");
  });

  it("accepts the trusted dev-aicore host when Hostinger runtime APP_ENV is production", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_WORKER_ID", "openclaw-dell-chatgpt-wake-dev");
    mocks.handshakeEvidence.mockResolvedValue({
      ownerChannel,
      targetConversationId,
      workerId: "openclaw-dell-chatgpt-wake-dev",
    });
    await expect(resolveVerifiedDevWakeTarget("gpt01", "dev-aicore.cstlogistic.co.id")).resolves.toEqual({
      ownerChannel,
      targetConversationId,
      workerId: "openclaw-dell-chatgpt-wake-dev",
    });
    expect(await isDevBrowserWakeAllowed({
      ownerChannel,
      targetConversationId,
      requestHost: "dev-aicore.cstlogistic.co.id",
    })).toBe(true);
  });

  it("uses central non-secret CST-DEV wake config when Hostinger env keys are absent", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CHANNELS", "");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS", "");
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_WORKER_ID", "");
    vi.stubEnv("AI_CORE_DEV_CHATGPT_ALIAS_GPT01_CONVERSATION_ID", "");
    vi.stubEnv("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64", "");
    mocks.execute.mockResolvedValueOnce({ rows: [
      { key: "dev.chatgpt_wake.enabled", value: "true" },
      { key: "dev.chatgpt_wake.owner_channel", value: ownerChannel },
      { key: "dev.chatgpt_wake.gpt01_conversation_id", value: targetConversationId },
      { key: "dev.chatgpt_wake.worker_id", value: "openclaw-dell-chatgpt-wake-dev" },
      { key: "dev.chatgpt_wake.dell_attestation_public_key_der_b64", value: "test-public-key" },
    ] });
    mocks.handshakeEvidence.mockResolvedValue({
      ownerChannel,
      targetConversationId,
      workerId: "openclaw-dell-chatgpt-wake-dev",
    });
    await expect(resolveVerifiedDevWakeTarget("gpt01", "dev-aicore.cstlogistic.co.id")).resolves.toEqual({
      ownerChannel,
      targetConversationId,
      workerId: "openclaw-dell-chatgpt-wake-dev",
    });
  });

  it("does not let an arbitrary host bypass the DEV runtime boundary", async () => {
    vi.stubEnv("APP_ENV", "production");
    await expect(resolveVerifiedDevWakeTarget("gpt01", "aicore.cstlogistic.co.id"))
      .rejects.toThrow("DEV_CHATGPT_DEV_HOST_REQUIRED");
    expect(await isDevBrowserWakeAllowed({
      ownerChannel,
      targetConversationId,
      requestHost: "aicore.cstlogistic.co.id",
    })).toBe(false);
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
    expect(await isDevBrowserWakeAllowed(input)).toBe(true);
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
    expect(mocks.execute).toHaveBeenCalledTimes(2);
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


describe("new account dispatch uses the shared exact binding", () => {
  const account = { accountAlias: "GPT02", ownerChannel: "ai-engine-oauth:" + "d".repeat(64),
    targetConversationId: "22222222-2222-4222-8222-222222222222", workerId: "openclaw-dell-chatgpt-wake-dev",
    browserProfile: "travelincars-dev", enabled: true };
  const newInput = { ownerChannel: account.ownerChannel, targetConversationId: account.targetConversationId, eventId };
  function configure(enabled = true) {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", JSON.stringify({ version: 1, bindings: [{ ...account, enabled }] }));
    mocks.dispatch.mockImplementation(async request => ({ clientId: request.clientId, created: true,
      command: { id: childId, source: request.source, commandType: "EXTERNAL_AGENT_WORK", instruction: request.instruction,
        metadataJson: { ...request.metadata, assignedClientId: request.clientId } } }));
  }
  it("does not dispatch while dormant, and never cross-pairs the existing account", async () => {
    configure(false);
    expect(await isDevBrowserWakeAllowed(newInput)).toBe(false);
    await expect(queueDevBrowserWake(newInput)).rejects.toThrow("DEV_CHATGPT_WAKE_DENIED");
    configure();
    expect(await isDevBrowserWakeAllowed(newInput)).toBe(true);
    for (const wrong of [{ ...newInput, ownerChannel }, { ...input, ownerChannel: account.ownerChannel }]) {
      expect(await isDevBrowserWakeAllowed(wrong)).toBe(false);
      await expect(queueDevBrowserWake(wrong)).rejects.toThrow("DEV_CHATGPT_WAKE_DENIED");
    }
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("binds the profile into the challenge and reconciles the same event without replay", async () => {
    configure();
    const first = await queueDevBrowserWake(newInput);
    const request = mocks.dispatch.mock.calls[0]![0];
    expect(request.metadata.wakeBinding).toMatchObject({ accountAlias: "GPT02", browserProfile: "travelincars-dev",
      bindingFingerprint: "2301148ac5261d336281033efed8ea40c3f8015f1c1b4723b495f153e846d9d3" });
    expect(request.metadata.assistantAttestationChallenge).toBe("668e37e7ea50f4a3fdc13b73def177651bb3b8ca12364eeb48b41a1c8e190438");
    const command = { id: first.commandId, source: request.source, commandType: "EXTERNAL_AGENT_WORK", instruction: request.instruction,
      metadataJson: { ...request.metadata, assignedClientId: request.clientId } };
    mocks.dispatch.mockResolvedValueOnce({ clientId: account.workerId, created: false, command });
    expect(await queueDevBrowserWake(newInput)).toMatchObject({ commandId: first.commandId, created: false });
    mocks.dispatch.mockResolvedValueOnce({ clientId: account.workerId, created: false,
      command: { ...command, metadataJson: { ...command.metadataJson, wakeBinding: undefined } } });
    await expect(queueDevBrowserWake(newInput)).rejects.toThrow("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
  });
  it("routes the stable account identity through its newly registered runtime location", async () => {
    const backup = { ...account, workerId: "openclaw-travelintrips-dev", browserProfile: "gpt02-travelintrips" };
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", JSON.stringify({
      version: 1,
      bindings: [backup],
    }));
    mocks.registry.mockResolvedValue([
      { clientId: backup.workerId, eligible: true, reportedHealth: "healthy", availableSlots: 1, activeJobs: 0 },
    ]);
    mocks.dispatch.mockImplementation(async request => ({ clientId: request.clientId, created: true,
      command: { id: childId, source: request.source, commandType: "EXTERNAL_AGENT_WORK", instruction: request.instruction,
        metadataJson: { ...request.metadata, assignedClientId: request.clientId } } }));

    const target = await resolveVerifiedDevWakeTarget("GPT02", undefined, account.ownerChannel);
    expect(target).toMatchObject({
      ownerChannel: account.ownerChannel,
      targetConversationId: account.targetConversationId,
      workerId: backup.workerId,
      wakeBinding: expect.objectContaining({
        accountAlias: "GPT02",
        browserProfile: backup.browserProfile,
        bindingFingerprint: "2301148ac5261d336281033efed8ea40c3f8015f1c1b4723b495f153e846d9d3",
      }),
    });
    const queued = await queueDevBrowserWake({ ...newInput,
      expectedWorkerId: target.workerId,
      expectedBindingFingerprint: target.wakeBinding!.bindingFingerprint,
    });
    expect(queued.clientId).toBe(backup.workerId);
    expect(mocks.dispatch.mock.calls[0]![0].metadata.wakeBinding).toMatchObject({
      accountAlias: "GPT02", workerId: backup.workerId, browserProfile: backup.browserProfile,
    });
  });

  it("uses the exact account binding directly and rejects another OAuth owner without MCP evidence", async () => {
    configure();
    await queueDevBrowserWake(newInput);
    const wakeBinding = mocks.dispatch.mock.calls[0]![0].metadata.wakeBinding;
    await expect(resolveVerifiedDevWakeTarget("GPT02", undefined, account.ownerChannel)).resolves.toMatchObject({ wakeBinding });
    expect(mocks.handshakeEvidence).not.toHaveBeenCalled();
    await expect(resolveVerifiedDevWakeTarget("GPT02", undefined, ownerChannel)).rejects.toThrow("DEV_CHATGPT_ALIAS_OWNER_MISMATCH");
    await expect(queueDevBrowserWake({ ...newInput, expectedBindingFingerprint: "f".repeat(64) })).rejects.toThrow("DEV_CHATGPT_WAKE_BINDING_CHANGED");
  });
  it("uses the same central setting for preflight and queue, and lets explicit false revoke it", async () => {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "");
    mocks.execute.mockResolvedValue({ rows: [
      { key: "dev.chatgpt_wake.enabled", value: "true" },
      { key: "dev.chatgpt_wake.account_bindings", value: JSON.stringify({ version: 1, bindings: [account] }) },
    ] });
    expect(await isDevBrowserWakeAllowed(newInput)).toBe(true);
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ENABLED", "false");
    expect(await isDevBrowserWakeAllowed(newInput)).toBe(false);
    await expect(queueDevBrowserWake(newInput)).rejects.toThrow("DEV_CHATGPT_WAKE_DENIED");
  });
  it("preserves GPT01 when an additional binding is malformed or tries to redefine it", async () => {
    vi.stubEnv("AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON", JSON.stringify({ version: 1, bindings: [{ ...account, ownerChannel }] }));
    expect(await isDevBrowserWakeAllowed(input)).toBe(true);
    expect(await isDevBrowserWakeAllowed(newInput)).toBe(false);
    await queueDevBrowserWake(input);
    expect(mocks.dispatch.mock.calls[0]![0].metadata.wakeBinding).toBeUndefined();
  });
});
