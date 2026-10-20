import { DevContinuityWatchRuntime, type ContinuityCheckpoint, type ContinuityRegistration } from "./devContinuityWatchRuntime.js";
import { devContinuityWatchRepository, DevContinuityWatchError, type DevContinuityWatch } from "./devContinuityWatchRepository.js";
import { isDevBrowserWakeAllowed, queueDevBrowserWake } from "./devChatGptWakeService.js";
import { allowedDevWakeOwners } from "./devChatGptWakeBindingService.js";
import { subscribeDevContinuityWakeResults } from "./devContinuityWakeEvents.js";

const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/i;

export function isDevContinuityEnabled(): boolean {
  return process.env["APP_ENV"] === "development" &&
    process.env["NODE_ENV"] !== "production" &&
    process.env["AI_CORE_DEV_CONTINUITY_ENABLED"] === "true";
}

const runtime = new DevContinuityWatchRuntime({
  repository: devContinuityWatchRepository,
  enabled: isDevContinuityEnabled,
  allowed: isDevBrowserWakeAllowed,
  owners: allowedDevWakeOwners,
  queue: queueDevBrowserWake,
  subscribe: subscribeDevContinuityWakeResults,
  onError: (code, error) => {
    // Avoid logging owner IDs, credentials, SQL parameters or browser content.
    console.warn("[dev-continuity]", code,
      error instanceof DevContinuityWatchError ? error.code : "RECONCILE_DURABLE_STATE");
  },
});

function validateOwnerJob(ownerChannel: string, jobId: string): void {
  if (!OWNER.test(ownerChannel) || !UUID.test(jobId)) throw new Error("DEV_CONTINUITY_INVALID");
}

async function safeOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof DevContinuityWatchError && /^[A-Z_]+$/.test(error.code)) {
      throw new Error("DEV_CONTINUITY_" + error.code);
    }
    throw error;
  }
}

function status(watch: DevContinuityWatch): Record<string, unknown> {
  const evidence = watch.evidence;
  return {
    protocol: "dev-chatgpt-continuity/v1", executionEnvironment: "DEV",
    jobId: watch.jobId, watchCommandId: watch.commandId,
    targetConversationId: watch.targetConversationId,
    revision: watch.revision, checkpointSha: watch.checkpointSha, state: watch.state,
    lastProgressAt: watch.lastProgressAt, deadlineAt: watch.deadlineAt, expiresAt: watch.expiresAt,
    wakeCount: watch.wakeCount, maxWakes: 3,
    trigger: evidence["trigger"] ?? null, detectedAt: evidence["detectedAt"] ?? watch.triggeredAt,
    wakeEventId: watch.wakeEventId, wakeCommandId: watch.wakeCommandId,
    browserDelivered: watch.state === "WAKE_CONFIRMED" || evidence["resultCode"] === "DELIVERY_CONFIRMED",
    verifiedAssistantReply: evidence["resultCode"] === "DELIVERY_CONFIRMED" && evidence["verifiedAssistantReply"] === true,
    workCompleted: watch.state === "COMPLETED",
    evidence,
    note: "A missed progress checkpoint triggers a bounded wake. The worker verifies the paired browser, idle response and empty composer before sending. Browser delivery does not itself complete the tracked work.",
  };
}

export async function registerDevContinuityWatch(input: ContinuityRegistration): Promise<Record<string, unknown>> {
  validateOwnerJob(input.ownerChannel, input.jobId);
  if (!UUID.test(input.targetConversationId) || !SHA.test(input.checkpointSha) ||
      !Number.isSafeInteger(input.idleSeconds) || input.idleSeconds < 60 || input.idleSeconds > 3600 ||
      !Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= input.idleSeconds || input.ttlSeconds > 86400) {
    throw new Error("DEV_CONTINUITY_INVALID");
  }
  return safeOperation(async () => status(await runtime.register(input)));
}

export async function updateDevContinuityWatch(input: ContinuityCheckpoint): Promise<Record<string, unknown>> {
  validateOwnerJob(input.ownerChannel, input.jobId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
      !SHA.test(input.checkpointSha) ||
      !["RUNNING", "WAITING_CI", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"].includes(input.state)) {
    throw new Error("DEV_CONTINUITY_INVALID");
  }
  return safeOperation(async () => status(await runtime.update(input)));
}

export async function getDevContinuityWatchStatus(input: { ownerChannel: string; jobId: string }): Promise<Record<string, unknown>> {
  validateOwnerJob(input.ownerChannel, input.jobId);
  return safeOperation(async () => {
    const watch = await runtime.get(input.ownerChannel, input.jobId);
    if (!watch) throw new Error("DEV_CONTINUITY_NOT_FOUND");
    return status(watch);
  });
}

export async function startDevContinuityWatchRuntime(): Promise<void> {
  await runtime.start();
}

export function stopDevContinuityWatchRuntime(): void { runtime.stop(); }
