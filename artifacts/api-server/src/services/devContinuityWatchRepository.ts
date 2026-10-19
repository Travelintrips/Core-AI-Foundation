import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  DEV_CONTINUITY_WORKER, DEV_DELL_CONTINUITY_WORKER, isDevContinuityWakeWorker, devContinuityResultFromCommittedCommand,
  type DevContinuityWakeResult,
} from "./devContinuityWakeEvents.js";
import { devAssistantPublicKeyForWorker, verifyDevAssistantAttestation } from "./devAssistantAttestation.js";

export const DEV_CONTINUITY_WATCH_TYPE = "DEV_CONTINUITY_WATCH";
export const DEV_CONTINUITY_MAX_ACTIVE = 32;
export const DEV_CONTINUITY_MAX_WAKES = 3;
export const DEV_CONTINUITY_CLAIM_LEASE_MS = 60_000;
export type DevContinuityState = "RUNNING" | "WAITING_CI" | "WAITING_APPROVAL" |
  "COMPLETED" | "CANCELLED" | "FIRING" | "WAKE_QUEUED" | "WAKE_CONFIRMED" | "BLOCKED" | "EXPIRED";
export interface DevContinuityDescriptor {
  version: 1;
  active: boolean;
  jobId: string;
  checkpointSha: string;
  revision: number;
  state: DevContinuityState;
  lastProgressAt: string;
  deadlineAt: string;
  expiresAt: string;
  idleSeconds: number;
  wakeCount: number;
  claimToken: string | null;
  claimLeaseUntil: string | null;
  wakeEventId: string | null;
  wakeCommandId: string | null;
  triggeredAt: string | null;
  evidence: Record<string, unknown>;
}
export interface DevContinuityWatch extends DevContinuityDescriptor {
  commandId: string;
  ownerChannel: string;
  targetConversationId: string;
}
export interface RegisterDevContinuityWatchInput {
  ownerChannel: string;
  targetConversationId: string;
  jobId: string;
  checkpointSha: string;
  idleSeconds: number;
  ttlSeconds: number;
}
export interface UpdateDevContinuityWatchInput {
  ownerChannel: string;
  jobId: string;
  expectedRevision: number;
  state?: "RUNNING" | "WAITING_CI" | "WAITING_APPROVAL" | "COMPLETED" | "CANCELLED";
  checkpointSha?: string;
}
export interface RecordDevContinuityQueuedInput {
  ownerChannel: string;
  jobId: string;
  claimToken: string;
  eventId: string;
  wakeCommandId: string;
}
export type DevContinuityNow = number | Date;
export interface DevContinuityTransaction {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}
export type DevContinuityTransactionRunner = <T>(operation: (tx: DevContinuityTransaction) => Promise<T>) => Promise<T>;
const terminalStates = new Set<DevContinuityState>(["COMPLETED", "CANCELLED", "BLOCKED", "EXPIRED"]);
const allStates = new Set<DevContinuityState>(["RUNNING", "WAITING_CI", "WAITING_APPROVAL", "COMPLETED", "CANCELLED", "FIRING", "WAKE_QUEUED", "WAKE_CONFIRMED", "BLOCKED", "EXPIRED"]);
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export class DevContinuityWatchError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "DevContinuityWatchError"; }
}
function fail(code: string, message: string): never { throw new DevContinuityWatchError(code, message); }
function nowMs(now: DevContinuityNow): number {
  const value = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(value)) fail("INVALID_TIME", "Invalid continuity timestamp");
  return value;
}
function requireOwner(owner: string, jobId?: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,199}$/.test(owner)) fail("INVALID_OWNER", "Invalid continuity owner channel");
  if (jobId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(jobId)) fail("INVALID_JOB", "Invalid continuity job identifier");
}
function requireDev(): void {
  if (process.env["APP_ENV"]?.trim().toLowerCase() !== "development" ||
      process.env["NODE_ENV"]?.trim().toLowerCase() === "production") {
    fail("DEV_ONLY", "Continuity watches require the isolated DEV runtime");
  }
}
export function devContinuityWatchExternalId(owner: string, jobId: string): string {
  return "dev-continuity-watch:" + createHash("sha256").update(owner + "|" + jobId).digest("hex");
}
export function devContinuityWakeEventId(owner: string, jobId: string, revision: number): string {
  return createHash("sha256").update(owner + "|" + jobId + "|" + revision).digest("hex");
}
function descriptor(watch: DevContinuityWatch): DevContinuityDescriptor {
  const { commandId: _id, ownerChannel: _owner, targetConversationId: _target, ...value } = watch;
  return value;
}
function decode(row: unknown): DevContinuityWatch {
  if (!record(row) || typeof row["id"] !== "string" || !record(row["metadata_json"])) fail("INVALID_RECORD", "Malformed continuity watch record");
  const metadata = row["metadata_json"];
  const value = metadata["devContinuity"];
  if (!record(value) || value["version"] !== 1 || typeof value["active"] !== "boolean" ||
      typeof value["jobId"] !== "string" || typeof value["checkpointSha"] !== "string" || !sha.test(value["checkpointSha"]) ||
      !Number.isSafeInteger(value["revision"]) || Number(value["revision"]) < 1 ||
      typeof value["state"] !== "string" || !allStates.has(value["state"] as DevContinuityState) ||
      !Number.isSafeInteger(value["wakeCount"]) || Number(value["wakeCount"]) < 0 || Number(value["wakeCount"]) > DEV_CONTINUITY_MAX_WAKES ||
      !Number.isSafeInteger(value["idleSeconds"]) || Number(value["idleSeconds"]) < 60 ||
      typeof metadata["conversationId"] !== "string" || typeof metadata["targetConversationId"] !== "string" ||
      !uuid.test(metadata["targetConversationId"]) || metadata["explicitWorkerTarget"] !== true ||
      metadata["assignedClientId"] !== DEV_CONTINUITY_WORKER || !record(value["evidence"])) {
    fail("INVALID_RECORD", "Malformed continuity watch descriptor");
  }
  for (const key of ["lastProgressAt", "deadlineAt", "expiresAt"] as const) {
    if (typeof value[key] !== "string" || !Number.isFinite(Date.parse(value[key]))) fail("INVALID_RECORD", "Malformed continuity watch deadline");
  }
  requireOwner(metadata["conversationId"], value["jobId"]);
  return { ...(value as unknown as DevContinuityDescriptor), commandId: row["id"],
    ownerChannel: metadata["conversationId"], targetConversationId: metadata["targetConversationId"] };
}

/** Passive records: this repository never dispatches, notifies a worker or starts GCP. */
export class DevContinuityWatchRepository {
  constructor(private readonly transaction: DevContinuityTransactionRunner = operation => db.transaction(tx => operation(tx))) {}

  private withOwner<T>(owner: string, operation: (tx: DevContinuityTransaction) => Promise<T>): Promise<T> {
    requireDev(); requireOwner(owner);
    return this.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.ai_core_mcp_channel', ${owner}, true)`);
      return operation(tx);
    });
  }

  private async select(tx: DevContinuityTransaction, owner: string, jobId: string, lock = false): Promise<DevContinuityWatch | null> {
    const result = await tx.execute(sql`
      SELECT id, metadata_json FROM ai_platform.ai_coding_bridge_commands
      WHERE source = 'ai-core' AND command_type = 'DEV_CONTINUITY_WATCH'
        AND external_command_id = ${devContinuityWatchExternalId(owner, jobId)}::text
        AND metadata_json ->> 'conversationId' = ${owner}::text
        AND metadata_json ->> 'assignedClientId' = ${DEV_CONTINUITY_WORKER}::text
        AND metadata_json #>> '{devContinuity,jobId}' = ${jobId}::text
      ${lock ? sql`FOR UPDATE` : sql``}
    `);
    return result.rows[0] ? decode(result.rows[0]) : null;
  }

  private async save(tx: DevContinuityTransaction, prior: DevContinuityWatch, next: DevContinuityWatch, now: number): Promise<DevContinuityWatch> {
    const status = next.state === "COMPLETED" ? "COMPLETED" : next.state === "CANCELLED" ? "CANCELLED" :
      terminalStates.has(next.state) ? "FAILED" : "RECEIVED";
    const result = await tx.execute(sql`
      UPDATE ai_platform.ai_coding_bridge_commands
      SET metadata_json = jsonb_set(metadata_json, '{devContinuity}', ${JSON.stringify(descriptor(next))}::jsonb),
          status = ${status}::text, updated_at = ${new Date(now).toISOString()}::timestamptz
      WHERE id = ${prior.commandId}::uuid AND source = 'ai-core' AND command_type = 'DEV_CONTINUITY_WATCH'
        AND metadata_json ->> 'conversationId' = ${prior.ownerChannel}::text
        AND metadata_json ->> 'assignedClientId' = ${DEV_CONTINUITY_WORKER}::text
        AND metadata_json #>> '{devContinuity,jobId}' = ${prior.jobId}::text
        AND metadata_json #>> '{devContinuity,revision}' = ${String(prior.revision)}::text
      RETURNING id, metadata_json
    `);
    if (!result.rows[0]) fail("REVISION_CONFLICT", "Continuity watch changed concurrently");
    return decode(result.rows[0]);
  }

  async register(input: RegisterDevContinuityWatchInput, now: DevContinuityNow = Date.now()): Promise<DevContinuityWatch> {
    requireOwner(input.ownerChannel, input.jobId);
    if (!uuid.test(input.targetConversationId) || !sha.test(input.checkpointSha) ||
        !Number.isSafeInteger(input.idleSeconds) || input.idleSeconds < 60 || input.idleSeconds > 3600 ||
        !Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 86400 || input.ttlSeconds <= input.idleSeconds) {
      fail("INVALID_WATCH", "Invalid continuity target, checkpoint or bounded deadline");
    }
    const at = nowMs(now);
    return this.withOwner(input.ownerChannel, async tx => {
      // Serializes cap checking and registration for one owner across processes.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"dev-continuity:" + input.ownerChannel}::text, 0))`);
      const existing = await this.select(tx, input.ownerChannel, input.jobId, true);
      if (existing) {
        if (existing.targetConversationId !== input.targetConversationId.toLowerCase()) fail("TARGET_IMMUTABLE", "Existing watch belongs to another target conversation");
        return existing; // A retry never resets progress, expiry, revision or wake budget.
      }
      const count = await tx.execute(sql`
        SELECT COUNT(*)::integer AS active_count FROM ai_platform.ai_coding_bridge_commands
        WHERE source = 'ai-core' AND command_type = 'DEV_CONTINUITY_WATCH'
          AND metadata_json ->> 'conversationId' = ${input.ownerChannel}::text
          AND metadata_json ->> 'assignedClientId' = ${DEV_CONTINUITY_WORKER}::text
          AND metadata_json #>> '{devContinuity,active}' = 'true'
          AND (metadata_json #>> '{devContinuity,expiresAt}')::timestamptz > ${new Date(at).toISOString()}::timestamptz
      `);
      if (Number((count.rows[0] as Record<string, unknown> | undefined)?.["active_count"] ?? 0) >= DEV_CONTINUITY_MAX_ACTIVE) fail("WATCH_LIMIT", "Owner already has 32 active continuity watches");
      const value: DevContinuityDescriptor = { version: 1, active: true, jobId: input.jobId,
        checkpointSha: input.checkpointSha.toLowerCase(), revision: 1, state: "RUNNING",
        lastProgressAt: new Date(at).toISOString(), deadlineAt: new Date(at + input.idleSeconds * 1000).toISOString(),
        expiresAt: new Date(at + input.ttlSeconds * 1000).toISOString(), idleSeconds: input.idleSeconds, wakeCount: 0,
        claimToken: null, claimLeaseUntil: null, wakeEventId: null, wakeCommandId: null, triggeredAt: null, evidence: {} };
      const metadata = { conversationId: input.ownerChannel, targetConversationId: input.targetConversationId.toLowerCase(),
        assignedClientId: DEV_CONTINUITY_WORKER, explicitWorkerTarget: true, devContinuity: value };
      const inserted = await tx.execute(sql`
        INSERT INTO ai_platform.ai_coding_bridge_commands
          (external_command_id, source, command_type, instruction, authority_json, metadata_json, status, received_at, created_at, updated_at)
        VALUES (${devContinuityWatchExternalId(input.ownerChannel, input.jobId)}, 'ai-core', 'DEV_CONTINUITY_WATCH',
          'Passive DEV continuity deadline; never worker-executable.',
          ${JSON.stringify({ environment: "DEV", passive: true, allowedActions: ["chatgpt:wake"] })}::jsonb,
          ${JSON.stringify(metadata)}::jsonb, 'RECEIVED', ${new Date(at).toISOString()}::timestamptz,
          ${new Date(at).toISOString()}::timestamptz, ${new Date(at).toISOString()}::timestamptz)
        ON CONFLICT (source, external_command_id) DO NOTHING RETURNING id, metadata_json
      `);
      if (inserted.rows[0]) return decode(inserted.rows[0]);
      const raced = await this.select(tx, input.ownerChannel, input.jobId, true);
      if (!raced) fail("REGISTRATION_CONFLICT", "Continuity watch registration was not durably visible");
      return raced;
    });
  }

  async get(ownerChannel: string, jobId: string): Promise<DevContinuityWatch | null> {
    requireOwner(ownerChannel, jobId);
    return this.withOwner(ownerChannel, tx => this.select(tx, ownerChannel, jobId));
  }

  async update(input: UpdateDevContinuityWatchInput, now: DevContinuityNow = Date.now()): Promise<DevContinuityWatch> {
    requireOwner(input.ownerChannel, input.jobId);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
        (input.checkpointSha !== undefined && !sha.test(input.checkpointSha)) ||
        (input.state !== undefined && !["RUNNING", "WAITING_CI", "WAITING_APPROVAL", "COMPLETED", "CANCELLED"].includes(input.state))) fail("INVALID_UPDATE", "Invalid continuity progress update");
    const at = nowMs(now);
    return this.withOwner(input.ownerChannel, async tx => {
      const current = await this.select(tx, input.ownerChannel, input.jobId, true);
      if (!current) fail("WATCH_NOT_FOUND", "Continuity watch not found for this owner");
      if (current.revision !== input.expectedRevision) fail("REVISION_CONFLICT", "Continuity watch revision changed");
      if (terminalStates.has(current.state)) fail("TERMINAL_WATCH", "Terminal continuity watch cannot be reopened");
      if (current.state === "FIRING" || current.state === "WAKE_QUEUED") fail("WAKE_IN_FLIGHT", "Wake dispatch is already in flight; reconcile its result before progress updates");
      if (at < Date.parse(current.lastProgressAt)) fail("INVALID_TIME", "Continuity progress cannot move backwards");
      if (at >= Date.parse(current.expiresAt)) return this.save(tx, current, { ...current, state: "EXPIRED", active: false,
        evidence: { ...current.evidence, failureReason: "WATCH_TTL_EXPIRED" } }, at);
      const state = input.state ?? "RUNNING";
      const closing = state === "COMPLETED" || state === "CANCELLED";
      return this.save(tx, current, { ...current, revision: current.revision + 1, state,
        active: !terminalStates.has(state), checkpointSha: input.checkpointSha?.toLowerCase() ?? current.checkpointSha,
        lastProgressAt: new Date(at).toISOString(), deadlineAt: new Date(Math.min(at + current.idleSeconds * 1000, Date.parse(current.expiresAt))).toISOString(),
        claimToken: null, claimLeaseUntil: null,
        wakeEventId: closing ? current.wakeEventId : null,
        wakeCommandId: closing ? current.wakeCommandId : null,
        triggeredAt: closing ? current.triggeredAt : null,
        evidence: { ...(closing ? current.evidence : {}), progressRecordedAt: new Date(at).toISOString() } }, at);
    });
  }

  async claim(ownerChannel: string, jobId: string, expectedRevision: number, now: DevContinuityNow = Date.now()): Promise<DevContinuityWatch | null> {
    requireOwner(ownerChannel, jobId);
    const at = nowMs(now);
    return this.withOwner(ownerChannel, async tx => {
      const current = await this.select(tx, ownerChannel, jobId, true);
      if (!current || current.revision !== expectedRevision || !current.active || terminalStates.has(current.state)) return null;
      if (at >= Date.parse(current.expiresAt)) return this.save(tx, current, { ...current, state: "EXPIRED", active: false,
        evidence: { ...current.evidence, failureReason: "WATCH_TTL_EXPIRED" } }, at);
      const reclaim = current.state === "FIRING" && current.claimLeaseUntil !== null && Date.parse(current.claimLeaseUntil) <= at;
      if (!reclaim && (current.state !== "RUNNING" || Date.parse(current.deadlineAt) > at)) return null;
      if (!reclaim && current.wakeCount >= DEV_CONTINUITY_MAX_WAKES) {
        return this.save(tx, current, { ...current, state: "BLOCKED", active: false,
          evidence: { failureReason: "WAKE_BUDGET_EXHAUSTED", detectedAt: new Date(at).toISOString(), trigger: "PROGRESS_DEADLINE_EXPIRED" } }, at);
      }
      const eventId = devContinuityWakeEventId(ownerChannel, jobId, current.revision);
      if (reclaim && current.wakeEventId !== eventId) fail("INVALID_RECORD", "Persisted wake event does not match this revision");
      return this.save(tx, current, { ...current, state: "FIRING", claimToken: randomUUID(),
        claimLeaseUntil: new Date(Math.min(at + DEV_CONTINUITY_CLAIM_LEASE_MS, Date.parse(current.expiresAt))).toISOString(),
        wakeCount: current.wakeCount + (reclaim ? 0 : 1), wakeEventId: eventId,
        triggeredAt: current.triggeredAt ?? new Date(at).toISOString(),
        evidence: reclaim ? current.evidence : { detectedAt: new Date(at).toISOString(), trigger: "PROGRESS_DEADLINE_EXPIRED",
          checkpointRevision: current.revision, checkpointSha: current.checkpointSha } }, at);
    });
  }

  async recordQueued(input: RecordDevContinuityQueuedInput, now: DevContinuityNow = Date.now()): Promise<DevContinuityWatch> {
    requireOwner(input.ownerChannel, input.jobId);
    if (!uuid.test(input.wakeCommandId) || !uuid.test(input.claimToken) || !digest.test(input.eventId)) fail("INVALID_QUEUE_RECEIPT", "Invalid continuity dispatch receipt");
    const at = nowMs(now);
    return this.withOwner(input.ownerChannel, async tx => {
      const current = await this.select(tx, input.ownerChannel, input.jobId, true);
      if (!current || current.wakeEventId !== input.eventId) fail("CLAIM_CONFLICT", "Continuity dispatch event no longer matches the watch");
      if ((current.state === "WAKE_CONFIRMED" || current.state === "BLOCKED" || current.state === "WAKE_QUEUED") && current.wakeCommandId === input.wakeCommandId) return current;
      if (current.state !== "FIRING" || current.claimToken !== input.claimToken) fail("CLAIM_CONFLICT", "Continuity dispatch lease was superseded");
      return this.save(tx, current, { ...current, state: "WAKE_QUEUED", wakeCommandId: input.wakeCommandId,
        claimToken: null, claimLeaseUntil: null }, at);
    });
  }

  private resultState(current: DevContinuityWatch, result: DevContinuityWakeResult, at: number): DevContinuityWatch | null {
    if (current.commandId !== result.parentWatchCommandId || current.ownerChannel !== result.ownerChannel ||
        current.jobId !== result.jobId || current.wakeEventId !== result.eventId || !isDevContinuityWakeWorker(result.workerId) ||
        (current.wakeCommandId !== null && current.wakeCommandId !== result.childCommandId) ||
        !["FIRING", "WAKE_QUEUED"].includes(current.state)) return null;
    const details = result.details;
    const confirmed = result.status === "COMPLETED" && details["browserConfirmed"] === true &&
      details["chatgptSubmitted"] === true && details["browserPairingVerified"] === true && details["exitCode"] === 0 &&
      details["eventId"] === current.wakeEventId && details["conversationId"] === current.targetConversationId &&
      typeof details["evidenceFingerprint"] === "string" && digest.test(details["evidenceFingerprint"]);
    const callbackReceivedAt = new Date(at).toISOString();
    const attestation = confirmed ? verifyDevAssistantAttestation({
      details,
      expected: {
        ownerChannel: current.ownerChannel,
        targetConversationId: current.targetConversationId,
        eventId: current.wakeEventId!,
        watchCommandId: current.commandId,
        jobId: current.jobId,
        checkpointRevision: current.revision,
        workerId: result.workerId,
      },
      notBefore: current.triggeredAt ?? String(current.evidence["detectedAt"] ?? current.lastProgressAt),
      receivedAt: callbackReceivedAt,
      publicKeyDerBase64: devAssistantPublicKeyForWorker(result.workerId),
    }) : { verified: false as const, reason: "BROWSER_DELIVERY_UNVERIFIED" };
    const evidence: Record<string, unknown> = { ...current.evidence, childCommandId: result.childCommandId, eventId: result.eventId,
      workerId: result.workerId, callbackReceivedAt, workerStatus: result.status,
      browserConfirmed: details["browserConfirmed"] === true, chatgptSubmitted: details["chatgptSubmitted"] === true,
      browserPairingVerified: details["browserPairingVerified"] === true,
      verifiedAssistantReply: attestation.verified,
      assistantAttestationStatus: attestation.verified ? "VERIFIED" : attestation.reason,
      ...(attestation.verified ? { assistantAttestation: attestation.evidence } : {}),
      resultCode: confirmed && attestation.verified ? "DELIVERY_CONFIRMED" : "UNKNOWN_UNVERIFIED" };
    if (!confirmed) evidence["failureReason"] = result.status === "FAILED" ? "WORKER_REPORTED_FAILURE" : "BROWSER_EVIDENCE_INCOMPLETE";
    if (typeof details["evidenceFingerprint"] === "string" && digest.test(details["evidenceFingerprint"])) evidence["evidenceFingerprint"] = details["evidenceFingerprint"];
    return { ...current, state: confirmed && attestation.verified ? "WAKE_CONFIRMED" : "BLOCKED", active: confirmed && attestation.verified,
      wakeCommandId: result.childCommandId, claimToken: null, claimLeaseUntil: null, evidence };
  }

  async recordResult(input: DevContinuityWakeResult, now: DevContinuityNow = Date.now()): Promise<DevContinuityWatch | null> {
    requireOwner(input.ownerChannel, input.jobId);
    const at = nowMs(now);
    return this.withOwner(input.ownerChannel, async tx => {
      const current = await this.select(tx, input.ownerChannel, input.jobId, true);
      if (!current) return null;
      const next = this.resultState(current, input, at);
      return next ? this.save(tx, current, next, at) : null;
    });
  }

  private async reconcileCurrent(tx: DevContinuityTransaction, watch: DevContinuityWatch, at: number): Promise<DevContinuityWatch> {
    let current = watch;
    if (["FIRING", "WAKE_QUEUED"].includes(current.state) && current.wakeEventId) {
      const persisted = await tx.execute(sql`
        SELECT child.id, child.source, child.command_type, child.metadata_json, child.status, response.metadata_json AS result_details
        FROM ai_platform.ai_coding_bridge_commands child
        JOIN ai_platform.ai_coding_bridge_responses response ON response.command_id = child.id AND response.kind = child.status
        WHERE child.source = 'ai-core' AND child.command_type = 'EXTERNAL_AGENT_WORK'
          AND child.metadata_json ->> 'conversationId' = ${current.ownerChannel}::text
          AND child.metadata_json ->> 'assignedClientId' IN (${DEV_CONTINUITY_WORKER}::text, ${DEV_DELL_CONTINUITY_WORKER}::text)
          AND child.metadata_json ->> 'completedBy' = child.metadata_json ->> 'assignedClientId'
          AND child.metadata_json #>> '{devContinuity,parentWatchCommandId}' = ${current.commandId}::text
          AND child.metadata_json #>> '{devContinuity,jobId}' = ${current.jobId}::text
          AND child.metadata_json #>> '{devContinuity,eventId}' = ${current.wakeEventId}::text
          AND child.status IN ('COMPLETED', 'FAILED')
        ORDER BY response.created_at DESC LIMIT 1
      `);
      const child = persisted.rows[0];
      if (record(child) && (child["status"] === "COMPLETED" || child["status"] === "FAILED") && record(child["result_details"])) {
        const event = devContinuityResultFromCommittedCommand({ id: child["id"], source: child["source"], commandType: child["command_type"],
          metadata: child["metadata_json"], authenticatedWorkerId: record(child["metadata_json"]) && typeof child["metadata_json"]["completedBy"] === "string" ? child["metadata_json"]["completedBy"] : "", status: child["status"], details: child["result_details"] });
        const next = event ? this.resultState(current, event, at) : null;
        if (next) current = await this.save(tx, current, next, at);
      }
    }
    if (current.active && at >= Date.parse(current.expiresAt)) current = await this.save(tx, current, { ...current, state: "EXPIRED", active: false,
      evidence: { ...current.evidence, failureReason: "WATCH_TTL_EXPIRED" } }, at);
    return current;
  }

  /** Reconciles an already-persisted callback; never starts a new execution. */
  async reconcile(ownerChannel: string, jobId: string, now: DevContinuityNow = Date.now()): Promise<DevContinuityWatch | null> {
    requireOwner(ownerChannel, jobId);
    const at = nowMs(now);
    return this.withOwner(ownerChannel, async tx => {
      const watch = await this.select(tx, ownerChannel, jobId, true);
      return watch ? this.reconcileCurrent(tx, watch, at) : null;
    });
  }

  async restore(ownerChannel: string, now: DevContinuityNow = Date.now(), limit = DEV_CONTINUITY_MAX_ACTIVE): Promise<DevContinuityWatch[]> {
    requireOwner(ownerChannel);
    const at = nowMs(now);
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(DEV_CONTINUITY_MAX_ACTIVE, Math.floor(limit))) : DEV_CONTINUITY_MAX_ACTIVE;
    return this.withOwner(ownerChannel, async tx => {
      const rows = await tx.execute(sql`
        SELECT id, metadata_json FROM ai_platform.ai_coding_bridge_commands
        WHERE source = 'ai-core' AND command_type = 'DEV_CONTINUITY_WATCH'
          AND metadata_json ->> 'conversationId' = ${ownerChannel}::text
          AND metadata_json ->> 'assignedClientId' = ${DEV_CONTINUITY_WORKER}::text
          AND metadata_json #>> '{devContinuity,active}' = 'true'
        ORDER BY ((metadata_json #>> '{devContinuity,expiresAt}')::timestamptz <= ${new Date(at).toISOString()}::timestamptz) ASC,
          (metadata_json #>> '{devContinuity,deadlineAt}')::timestamptz ASC
        LIMIT ${bounded} FOR UPDATE
      `);
      const watches: DevContinuityWatch[] = [];
      for (const row of rows.rows) {
        watches.push(await this.reconcileCurrent(tx, decode(row), at));
      }
      return watches;
    });
  }
}

export const devContinuityWatchRepository = new DevContinuityWatchRepository();
