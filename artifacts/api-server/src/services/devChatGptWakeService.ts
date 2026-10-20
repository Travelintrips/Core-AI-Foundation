import { createHash } from "node:crypto";
import { dispatchExternalAgentWork } from "./externalAgentDispatchService.js";
import { deriveDevAssistantChallenge } from "./devAssistantAttestation.js";
import { getVerifiedMcpHandshakeEvidenceForConversation } from "./localCodingControlBridgeService.js";
import {
  DEV_WAKE_DELL_WORKER, isDevWakeRuntime, loadDevWakeRuntimeConfig, readDevWakeBinding,
  resolveConfiguredDevWakeTarget, type DevWakeBinding, type DevWakeTarget, type DevWakeWorker,
} from "./devChatGptWakeBindingService.js";
export type { DevWakeTarget } from "./devChatGptWakeBindingService.js";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function normalizeDevWakeAccountAlias(accountAlias: string): string {
  const normalized = accountAlias.trim().toUpperCase();
  const match = /^(GPT[0-9]{2,4})(?:\s+JOB\s*[0-9]{1,12})?$/.exec(normalized) ??
    /^\*(GPT[0-9]{2,4})(?:-JOB[0-9]{3,12})?$/.exec(normalized);
  return match?.[1] ?? normalized;
}

/** Aliases need an already verified receipt; raw confirmed wake bootstraps an exact configured pair. */
export async function resolveVerifiedDevWakeTarget(
  accountAlias: string,
  requestHost?: string,
  expectedOwnerChannel?: string,
): Promise<DevWakeTarget> {
  if (!isDevWakeRuntime(requestHost)) throw new Error("DEV_CHATGPT_DEV_HOST_REQUIRED");
  const config = await loadDevWakeRuntimeConfig(requestHost);
  if (!config.enabled) throw new Error("DEV_CHATGPT_WAKE_DISABLED");
  const alias = normalizeDevWakeAccountAlias(accountAlias);
  const binding = config.bindings.find(value => value.accountAlias === alias);
  const target: DevWakeTarget | null = alias === "GPT01" ? config.legacyTarget :
    binding ? { ownerChannel: binding.ownerChannel, targetConversationId: binding.targetConversationId,
      workerId: binding.workerId, wakeBinding: binding } : null;
  if (!target) throw new Error("DEV_CHATGPT_ALIAS_NOT_CONFIGURED");
  if (expectedOwnerChannel !== undefined && expectedOwnerChannel !== target.ownerChannel) {
    throw new Error("DEV_CHATGPT_ALIAS_OWNER_MISMATCH");
  }
  const evidence = await getVerifiedMcpHandshakeEvidenceForConversation(target.ownerChannel, {
    requestHost, publicKeyDerBase64: config.attestationPublicKeyDerB64,
  }).catch(() => null);
  if (!evidence || evidence.targetConversationId !== target.targetConversationId) {
    throw new Error("DEV_CHATGPT_ALIAS_TARGET_UNVERIFIED");
  }
  if (evidence.workerId !== target.workerId) throw new Error("DEV_CHATGPT_ALIAS_WORKER_MISMATCH");
  if (target.wakeBinding && evidence.wakeBinding?.bindingFingerprint !== target.wakeBinding.bindingFingerprint) {
    throw new Error("DEV_CHATGPT_ALIAS_BINDING_UNVERIFIED");
  }
  return target;
}

export type DevBrowserWakeInput = {
  ownerChannel: string;
  targetConversationId: string;
  eventId: string;
  watchCommandId?: string;
  jobId?: string;
  correlationId?: string;
  checkpointRevision?: number;
  expiresAt?: string;
  instruction?: string;
  jobAlias?: string | null;
  requestHost?: string;
  expectedBindingFingerprint?: string;
  expectedWorkerId?: DevWakeWorker;
};

/** Shared async preflight and send-time resolver; no independent owner/target lists. */
export async function isDevBrowserWakeAllowed(input: {
  ownerChannel: string; targetConversationId: string; requestHost?: string;
}): Promise<boolean> {
  try {
    return !!resolveConfiguredDevWakeTarget(await loadDevWakeRuntimeConfig(input.requestHost), input);
  } catch { return false; }
}

function isDuplicateCommandKey(error: unknown): boolean {
  let candidate = error;
  for (let depth = 0; depth < 4 && candidate !== null && typeof candidate === "object"; depth += 1) {
    const row = candidate as Record<string, unknown>;
    if (row["code"] === "23505" && row["constraint"] === "ai_coding_bridge_commands_external_uidx") return true;
    candidate = row["cause"];
  }
  return false;
}

function matchesExistingWake(input: DevBrowserWakeInput, instruction: string, worker: DevWakeWorker, command: {
  source: string;
  commandType: string;
  instruction: string;
  metadataJson: unknown;
}, wakeBinding?: DevWakeBinding): boolean {
  const metadata = command.metadataJson !== null && typeof command.metadataJson === "object"
    ? command.metadataJson as Record<string, unknown> : undefined;
  const challenge = deriveDevAssistantChallenge({ ...input, ...(wakeBinding ? { bindingFingerprint: wakeBinding.bindingFingerprint, browserProfile: wakeBinding.browserProfile } : {}) });
  const existingBinding = readDevWakeBinding(metadata?.["wakeBinding"]);
  if (wakeBinding ? existingBinding?.bindingFingerprint !== wakeBinding.bindingFingerprint : metadata?.["wakeBinding"] !== undefined) return false;
  if (!metadata || command.source !== "ai-core" || command.commandType !== "EXTERNAL_AGENT_WORK" ||
      command.instruction !== instruction || metadata["assignedClientId"] !== worker ||
      metadata["conversationId"] !== input.ownerChannel || metadata["capability"] !== "chatgpt:wake" ||
      metadata["targetConversationId"] !== input.targetConversationId.toLowerCase() ||
      metadata["eventId"] !== input.eventId.toLowerCase() ||
      metadata["assistantAttestationChallenge"] !== challenge) return false;
  if (input.watchCommandId !== undefined) {
    if (metadata["explicitWorkerTarget"] !== true) return false;
    const association = metadata["devContinuity"];
    if (association === null || typeof association !== "object" || Array.isArray(association)) return false;
    const watch = association as Record<string, unknown>;
    if (watch["parentWatchCommandId"] !== input.watchCommandId || watch["ownerChannel"] !== input.ownerChannel ||
        watch["jobId"] !== input.jobId || watch["eventId"] !== input.eventId.toLowerCase() ||
        watch["expiresAt"] !== input.expiresAt ||
        (input.checkpointRevision !== undefined && watch["checkpointRevision"] !== input.checkpointRevision)) return false;
  }
  return true;
}

/** Reconcile only the known uniqueness race. Never retry an ambiguous network or authorization error. */
async function reconcileDuplicateWake(input: DevBrowserWakeInput, externalCommandId: string, instruction: string, worker: DevWakeWorker, wakeBinding?: DevWakeBinding) {
  const { db, aiCodingBridgeCommandsTable } = await import("@workspace/db");
  const { and, eq, sql } = await import("drizzle-orm");
  return db.transaction(async transaction => {
    await transaction.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${input.ownerChannel}::text, true)`);
    const [existing] = await transaction.select().from(aiCodingBridgeCommandsTable).where(and(
      eq(aiCodingBridgeCommandsTable.source, "ai-core"),
      eq(aiCodingBridgeCommandsTable.externalCommandId, externalCommandId),
      eq(aiCodingBridgeCommandsTable.commandType, "EXTERNAL_AGENT_WORK"),
      sql`${aiCodingBridgeCommandsTable.metadataJson} ->> 'conversationId' = ${input.ownerChannel}::text`,
      sql`${aiCodingBridgeCommandsTable.metadataJson} ->> 'assignedClientId' = ${worker}::text`,
    )).limit(1);
    if (!existing || !matchesExistingWake(input, instruction, worker, existing, wakeBinding)) {
      throw new Error("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    }
    return { commandId: existing.id, clientId: worker, created: false };
  });
}

/** Called only after authenticated registration/confirmation; revalidate revocable DEV gates at send time. */
export async function queueDevBrowserWake(input: DevBrowserWakeInput): Promise<{
  commandId: string;
  clientId: string;
  created: boolean;
}> {
  const config = await loadDevWakeRuntimeConfig(input.requestHost);
  const target = resolveConfiguredDevWakeTarget(config, input);
  if (!target || typeof input.eventId !== "string" ||
      input.eventId.length !== 64 || !/^[a-f0-9]{64}$/i.test(input.eventId)) {
    throw new Error("DEV_CHATGPT_WAKE_DENIED");
  }
  const worker = target.workerId;
  const wakeBinding = target.wakeBinding;
  if ((input.expectedWorkerId !== undefined && input.expectedWorkerId !== worker) ||
      (input.expectedBindingFingerprint !== undefined && input.expectedBindingFingerprint !== wakeBinding?.bindingFingerprint)) {
    throw new Error("DEV_CHATGPT_WAKE_BINDING_CHANGED");
  }
  if (worker === DEV_WAKE_DELL_WORKER && !config.attestationPublicKeyDerB64) {
    throw new Error("DEV_CHATGPT_WAKE_DELL_ATTESTATION_NOT_CONFIGURED");
  }
  if ((input.watchCommandId !== undefined && (typeof input.watchCommandId !== "string" || input.watchCommandId.length !== 36 || !UUID.test(input.watchCommandId))) ||
      (input.jobId !== undefined && (typeof input.jobId !== "string" || input.jobId.length !== 36 || !UUID.test(input.jobId))) ||
      (input.correlationId !== undefined && (typeof input.correlationId !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.correlationId))) ||
      ((input.watchCommandId === undefined) !== (input.jobId === undefined)) ||
      ((input.watchCommandId === undefined) !== (input.expiresAt === undefined)) ||
      ((input.watchCommandId === undefined) !== (input.checkpointRevision === undefined)) ||
      (input.checkpointRevision !== undefined && (!Number.isSafeInteger(input.checkpointRevision) || input.checkpointRevision < 1))) {
    throw new Error("DEV_CHATGPT_WAKE_CONTEXT_INVALID");
  }
  if (input.expiresAt !== undefined) {
    const expiry = typeof input.expiresAt === "string" ? Date.parse(input.expiresAt) : Number.NaN;
    if (typeof input.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt) ||
        !Number.isFinite(expiry) || new Date(expiry).toISOString() !== input.expiresAt) {
      throw new Error("DEV_CHATGPT_WAKE_CONTEXT_INVALID");
    }
    // Never redispatch an expired watch, even if an earlier attempt has an uncertain outcome.
    // Its existing command can still be inspected through the status path.
    if (expiry <= Date.now()) throw new Error("DEV_CHATGPT_WAKE_EXPIRED");
  }
  const targetConversationId = input.targetConversationId.toLowerCase();
  const eventId = input.eventId.toLowerCase();
  const challenge = deriveDevAssistantChallenge({ ...input, targetConversationId, eventId,
    ...(wakeBinding ? { bindingFingerprint: wakeBinding.bindingFingerprint, browserProfile: wakeBinding.browserProfile } : {}),
  });
  const userInstruction = input.instruction?.trim() ?? "";
  if (userInstruction && (userInstruction.length > 2000 || /[\u0000-\u001f\u007f]/.test(userInstruction))) {
    throw new Error("DEV_CHATGPT_WAKE_INSTRUCTION_INVALID");
  }
  const encodedInstruction = userInstruction
    ? Buffer.from(userInstruction, "utf8").toString("base64url")
    : "";
  const instruction = userInstruction
    ? "DEV_CHATGPT_WAKE_V2 conversation=" + targetConversationId + " event=" + eventId +
      " challenge=" + challenge + " task=" + encodedInstruction
    : "DEV_CHATGPT_WAKE_V1 conversation=" + targetConversationId + " event=" + eventId + " challenge=" + challenge;
  const externalCommandId = "dev-chatgpt-wake:" + createHash("sha256")
    .update(input.ownerChannel + "|" + targetConversationId + "|" + eventId).digest("hex");
  const metadata: Record<string, unknown> = {
    conversationId: input.ownerChannel, targetConversationId, eventId, assistantAttestationChallenge: challenge,
    capability: "chatgpt:wake", explicitWorkerTarget: true,
    ...(wakeBinding ? { wakeBinding } : {}),
    browserPairing: "worker_must_verify_authenticated_exact_tab",
    source: "authorized-dev-browser-wake", devOnly: true,
    ...(input.watchCommandId !== undefined ? { watchCommandId: input.watchCommandId } : {}),
    ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.checkpointRevision !== undefined ? { checkpointRevision: input.checkpointRevision } : {}),
    ...(userInstruction ? { requestedInstructionHash: createHash("sha256").update(userInstruction).digest("hex") } : {}),
    ...(input.jobAlias ? { jobAlias: input.jobAlias } : {}),
    ...(input.watchCommandId !== undefined && input.jobId !== undefined ? {
      devContinuity: {
        parentWatchCommandId: input.watchCommandId, ownerChannel: input.ownerChannel,
        jobId: input.jobId, eventId, assistantAttestationChallenge: challenge, expiresAt: input.expiresAt,
        ...(input.checkpointRevision !== undefined ? { checkpointRevision: input.checkpointRevision } : {}),
      },
    } : {}),
  };
  try {
    const queued = await dispatchExternalAgentWork({ clientId: worker, instruction,
      source: "ai-core", externalCommandId, metadata });
    if (queued.clientId !== worker) throw new Error("DEV_CHATGPT_WAKE_WORKER_MISMATCH");
    if (!queued.created && !matchesExistingWake(input, instruction, worker, queued.command, wakeBinding)) {
      throw new Error("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    }
    return { commandId: queued.command.id, clientId: queued.clientId, created: queued.created };
  } catch (error) {
    if (!isDuplicateCommandKey(error)) throw error;
    return reconcileDuplicateWake(input, externalCommandId, instruction, worker, wakeBinding);
  }
}
