import { createHash } from "node:crypto";
import { dispatchExternalAgentWork } from "./externalAgentDispatchService.js";
import { deriveDevAssistantChallenge } from "./devAssistantAttestation.js";
import { getVerifiedMcpHandshakeEvidenceForConversation } from "./localCodingControlBridgeService.js";

const DEFAULT_WORKER = "openclaw-travelintrips-dev" as const;
const DELL_WORKER = "openclaw-dell-chatgpt-wake-dev" as const;
type DevWakeWorker = typeof DEFAULT_WORKER | typeof DELL_WORKER;

export type DevWakeTarget = {
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
};

function isTrustedDevRequestHost(requestHost?: string): boolean {
  const host = requestHost?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  return host === "dev-aicore.cstlogistic.co.id" || host === "dev.cstlogistic.co.id";
}

function isDevWakeRuntime(requestHost?: string): boolean {
  return process.env["APP_ENV"] === "development" || isTrustedDevRequestHost(requestHost);
}

export async function resolveVerifiedDevWakeTarget(
  accountAlias: string,
  requestHost?: string,
): Promise<DevWakeTarget> {
  if (accountAlias.toUpperCase() !== "GPT01") {
    throw new Error("DEV_CHATGPT_ALIAS_NOT_CONFIGURED");
  }
  if (!isDevWakeRuntime(requestHost)) {
    throw new Error("DEV_CHATGPT_DEV_HOST_REQUIRED");
  }
  if (process.env["AI_CORE_DEV_BROWSER_WAKE_ENABLED"] !== "true") {
    throw new Error("DEV_CHATGPT_WAKE_DISABLED");
  }
  const configuredTarget = process.env["AI_CORE_DEV_CHATGPT_ALIAS_GPT01_CONVERSATION_ID"]?.trim().toLowerCase();
  const allowedChats = [...new Set((process.env["AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS"] ?? "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean))];
  const targetConversationId = configuredTarget || (allowedChats.length === 1 ? allowedChats[0] : "");
  if (!targetConversationId || !UUID.test(targetConversationId) || !allowedChats.includes(targetConversationId)) {
    throw new Error("DEV_CHATGPT_ALIAS_TARGET_UNVERIFIED");
  }
  const channels = [...new Set((process.env["AI_CORE_DEV_BROWSER_WAKE_CHANNELS"] ?? "")
    .split(",").map(value => value.trim()).filter(value => /^ai-engine-oauth:[a-f0-9]{64}$/.test(value)))];
  const verified = [];
  for (const ownerChannel of channels) {
    const evidence = await getVerifiedMcpHandshakeEvidenceForConversation(ownerChannel).catch(() => null);
    if (evidence?.targetConversationId.toLowerCase() === targetConversationId) verified.push(evidence);
  }
  if (verified.length !== 1) throw new Error("DEV_CHATGPT_ALIAS_OWNER_AMBIGUOUS");
  const workerId = resolveWakeWorker();
  if (verified[0]!.workerId !== workerId) throw new Error("DEV_CHATGPT_ALIAS_WORKER_MISMATCH");
  return { ownerChannel: verified[0]!.ownerChannel, targetConversationId, workerId };
}

function resolveWakeWorker(): DevWakeWorker {
  const configured = process.env["AI_CORE_DEV_BROWSER_WAKE_WORKER_ID"]?.trim();
  if (!configured || configured === DEFAULT_WORKER) return DEFAULT_WORKER;
  if (configured === DELL_WORKER) return DELL_WORKER;
  throw new Error("DEV_CHATGPT_WAKE_WORKER_INVALID");
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

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
};

/** The owner fence is not proof of ChatGPT session ownership; the worker checks the exact tab. */
export function isDevBrowserWakeAllowed(input: {
  ownerChannel: string;
  targetConversationId: string;
}): boolean {
  const allowedChannels = new Set((process.env["AI_CORE_DEV_BROWSER_WAKE_CHANNELS"] ?? "")
    .split(",").map(value => value.trim()).filter(Boolean));
  const allowedChats = new Set((process.env["AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS"] ?? "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  return isDevWakeRuntime(input.requestHost) &&
    process.env["AI_CORE_DEV_BROWSER_WAKE_ENABLED"] === "true" &&
    typeof input.ownerChannel === "string" &&
    /^ai-engine-oauth:[a-f0-9]{64}$/.test(input.ownerChannel) &&
    allowedChannels.has(input.ownerChannel) &&
    typeof input.targetConversationId === "string" && input.targetConversationId.length === 36 &&
    UUID.test(input.targetConversationId) && allowedChats.has(input.targetConversationId.toLowerCase());
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
}): boolean {
  const metadata = command.metadataJson !== null && typeof command.metadataJson === "object"
    ? command.metadataJson as Record<string, unknown> : undefined;
  const challenge = deriveDevAssistantChallenge(input);
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
async function reconcileDuplicateWake(input: DevBrowserWakeInput, externalCommandId: string, instruction: string, worker: DevWakeWorker) {
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
    if (!existing || !matchesExistingWake(input, instruction, worker, existing)) {
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
  const worker = resolveWakeWorker();
  if (worker === DELL_WORKER && (process.env["APP_ENV"] !== "development" ||
      !process.env["AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64"])) {
    throw new Error("DEV_CHATGPT_WAKE_DELL_ATTESTATION_NOT_CONFIGURED");
  }
  if (!isDevBrowserWakeAllowed(input) || typeof input.eventId !== "string" ||
      input.eventId.length !== 64 || !/^[a-f0-9]{64}$/i.test(input.eventId)) {
    throw new Error("DEV_CHATGPT_WAKE_DENIED");
  }
  if ((input.watchCommandId !== undefined && (typeof input.watchCommandId !== "string" || input.watchCommandId.length !== 36 || !UUID.test(input.watchCommandId))) ||
      (input.jobId !== undefined && (typeof input.jobId !== "string" || input.jobId.length !== 36 || !UUID.test(input.jobId))) ||
      (input.correlationId !== undefined && (typeof input.correlationId !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.correlationId))) ||
      ((input.watchCommandId === undefined) !== (input.jobId === undefined)) ||
      ((input.watchCommandId === undefined) !== (input.expiresAt === undefined)) ||
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
  const challenge = deriveDevAssistantChallenge({ ...input, targetConversationId, eventId });
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
    if (!queued.created && !matchesExistingWake(input, instruction, worker, queued.command)) {
      throw new Error("DEV_CHATGPT_WAKE_RECONCILIATION_UNVERIFIED");
    }
    return { commandId: queued.command.id, clientId: queued.clientId, created: queued.created };
  } catch (error) {
    if (!isDuplicateCommandKey(error)) throw error;
    return reconcileDuplicateWake(input, externalCommandId, instruction, worker);
  }
}
