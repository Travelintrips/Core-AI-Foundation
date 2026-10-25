/**
 * Optional, event-driven AI Core -> AI Task ledger mirror.
 *
 * No AI Task operation may dispatch a worker or decide coding ownership:
 * the existing AI Core orchestrator and its database remain authoritative
 * until a separate, verified cutover. This service only registers tasks.
 */
import { logger } from "../lib/logger.js";

const DEFAULT_AI_TASK_URL = "https://ai-task.cstlogistic.co.id";
const REQUEST_TIMEOUT_MS = 3_000;

export interface AiTaskLedgerJobInput {
  externalId: string;
  title: string;
  sessionId?: string | null;
  timeline?: {
    jobId?: string;
    commandId?: string;
    correlationId?: string;
    workerId?: string;
    sopSnapshot?: { version: string; title: string; steps: string[] };
  };
}

export interface AiTaskLedgerResult {
  synced: boolean;
  id?: string;
  created?: boolean;
  observedStatus?: string;
  /** True only after the AI Task receiver reports a terminal persisted state. */
  acknowledged?: boolean;
  reason?: "disabled" | "unconfigured" | "invalid_input" | "remote_error" | "network_error";
}

export function ledgerBridgeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env["AI_TASK_LEDGER_SYNC_ENABLED"] === "true";
}

export function validateLedgerJob(input: AiTaskLedgerJobInput): boolean {
  return typeof input.externalId === "string" &&
    input.externalId.trim().length > 0 &&
    input.externalId.length <= 128 &&
    typeof input.title === "string" &&
    input.title.trim().length > 0 &&
    input.title.length <= 300 &&
    (input.sessionId == null ||
      (typeof input.sessionId === "string" &&
        input.sessionId.trim().length > 0 &&
        input.sessionId.length <= 180));
}

export function ledgerRequestUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env["AI_TASK_LEDGER_URL"]?.trim() || DEFAULT_AI_TASK_URL;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    // Never make authenticated requests to arbitrary URLs or embed tokens in
    // query parameters. Explicit local allowlist is limited to test-only mode.
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      return null;
    }
    if (url.protocol === "https:" &&
        (host === "ai-task.cstlogistic.co.id" ||
         (env["NODE_ENV"] !== "production" && host === "dev-ai-task.cstlogistic.co.id"))) {
      return url.origin + "/api/bridge/jobs";
    }
  } catch {
    // Invalid configuration must fail closed without impacting AI Core work.
  }
  return null;
}

export async function registerAiTaskLedgerJob(
  input: AiTaskLedgerJobInput,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<AiTaskLedgerResult> {
  if (!ledgerBridgeEnabled(env)) return { synced: false, reason: "disabled" };
  if (!validateLedgerJob(input)) return { synced: false, reason: "invalid_input" };
  const token = env["AI_TASK_BRIDGE_TOKEN"]?.trim();
  const url = ledgerRequestUrl(env);
  if (!url || !token || token.length < 32) {
    return { synced: false, reason: "unconfigured" };
  }

  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        source: "AI_CORE",
        externalId: input.externalId,
        // Replaying an event must produce exactly the same job ID.
        idempotencyKey: input.externalId,
        title: input.title,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.timeline ? { metadata: input.timeline } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200 && response.status !== 201) {
      return { synced: false, reason: "remote_error" };
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return { synced: false, reason: "remote_error" };
    const data = payload as Record<string, unknown>;
    const task = data["task"];
    if (data["accepted"] !== true || !task || typeof task !== "object") {
      return { synced: false, reason: "remote_error" };
    }
    const result = task as Record<string, unknown>;
    if (result["source"] !== "AI_CORE" || result["external_id"] !== input.externalId ||
        typeof result["id"] !== "string") {
      return { synced: false, reason: "remote_error" };
    }
    return {
      synced: true,
      id: result["id"],
      created: data["created"] === true,
      observedStatus: typeof result["status"] === "string" ? result["status"] : undefined,
    };
  } catch {
    // Sanitized error output: never log tokens, URLs containing credentials,
    // instruction text, or raw remote response bodies.
    return { synced: false, reason: "network_error" };
  }
}

export async function mirrorAiTaskLedgerJob(
  input: AiTaskLedgerJobInput,
): Promise<void> {
  if (!ledgerBridgeEnabled()) return;
  const result = await registerAiTaskLedgerJob(input);
  if (!result.synced) {
    logger.warn({
      externalId: input.externalId,
      reason: result.reason,
    }, "[ai-task-ledger] passive registration unsuccessful");
  }
}

/**
 * Observe a status transition after the authoritative AI Core DB write commits.
 * AI Task only mirrors source events; it never dispatches a coding worker.
 * Completion needs a separate, source-database-verified receiver ACK.
 */
export async function mirrorAiTaskLedgerSourceState(input: AiTaskLedgerJobInput & {
  status: string;
  version?: Date | string | null;
}): Promise<AiTaskLedgerResult> {
  if (!ledgerBridgeEnabled()) return { synced: false, reason: "disabled" };
  const registered = await registerAiTaskLedgerJob(input);
  if (!registered.synced || !registered.id ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(registered.id)) return registered;
  // An idempotent registry replay also provides the receiver's persisted status.
  // COMPLETED is only reachable through the independent source-verified ACK.
  if ((input.status === "COMPLETED" || input.status === "FAILED") &&
      registered.observedStatus === input.status) {
    return { ...registered, acknowledged: true };
  }
  const token = process.env["AI_TASK_BRIDGE_TOKEN"]?.trim();
  const url = ledgerRequestUrl();
  if (!token || !url) return { synced: false, reason: "unconfigured" };
  const eventId = `ai-core:${input.externalId}:${input.status}:${input.version instanceof Date
    ? input.version.getTime() : input.version ?? "initial"}`;
  if (eventId.length > 180 || input.status.length > 40) {
    return { synced: false, reason: "invalid_input" };
  }
  try {
    const response = await fetch(`${url}/${registered.id}/source-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ eventId, status: input.status, ...(input.timeline ? { metadata: input.timeline } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200 && response.status !== 202) {
      return { synced: false, reason: "remote_error" };
    }
    const body = await response.json() as Record<string, unknown>;
    if (body["accepted"] !== true) return { synced: false, reason: "remote_error" };
    const observedStatus = typeof body["status"] === "string" ? body["status"] : undefined;
    return {
      synced: true,
      id: registered.id,
      created: registered.created,
      observedStatus,
      acknowledged: (input.status === "COMPLETED" || input.status === "FAILED") &&
        observedStatus === input.status,
    };
  } catch {
    return { synced: false, reason: "network_error" };
  }
}

/** Nonblocking, bounded source status notification. */
export async function notifyAiTaskLedgerSourceState(input: AiTaskLedgerJobInput & {
  status: string;
  version?: Date | string | null;
}): Promise<void> {
  if (!ledgerBridgeEnabled()) return;
  const result = await mirrorAiTaskLedgerSourceState(input);
  if (!result.synced) logger.warn(
    { externalId: input.externalId, reason: result.reason, status: input.status },
    "[ai-task-ledger] source status was not mirrored",
  );
}
