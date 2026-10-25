import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Recover the internal Inbox projection, not worker execution or external sends.
 * The bridge response is the durable outbox. Its transaction commits with the
 * command terminal state. Inbox has a UNIQUE response_id: concurrent replay,
 * a crash after insertion, and a lost insert response cannot duplicate a card.
 * No source row or ACK is deleted/changed. WA/GitHub/browser delivery is excluded.
 */
export type RecoverableBridgeResponse = {
  responseId: string;
  commandId: string;
  taskId: string | null;
  kind: "COMPLETED" | "FAILED" | "BLOCKER";
  message: string;
  checkpoint: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export function bridgeInboxRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["APP_ENV"] === "development" && env["NODE_ENV"] !== "production" &&
    env["AI_DEV_BACKGROUND_RUNTIME_ENABLED"] !== "false" &&
    env["AI_DEV_BRIDGE_INBOX_RECOVERY_ENABLED"] === "true";
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** PostgreSQL errors may be wrapped by Drizzle. Never log SQL or credentials. */
export function inboxRecoveryAccessBlocked(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 5 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    const value = object(current);
    if (["42501", "28P01", "28000"].includes(String(value["code"]))) return true;
    current = value["cause"];
  }
  return false;
}

async function loadMissing(limit: number): Promise<RecoverableBridgeResponse[]> {
  // Runtime recovery only uses existing tables; never creates schema or grants.
  const result = await db.execute(sql`
    SELECT response.id, response.command_id, response.task_id, response.kind,
           response.message, response.checkpoint_json, response.metadata_json
    FROM ai_platform.ai_coding_bridge_responses AS response
    WHERE response.kind IN ('COMPLETED', 'FAILED', 'BLOCKER')
      AND NOT EXISTS (
        SELECT 1 FROM ai_platform.ai_core_chat_inbox_messages AS inbox
        WHERE inbox.response_id = response.id
      )
    ORDER BY response.created_at ASC, response.id ASC
    LIMIT ${limit}::integer
  `);
  return result.rows.map((row) => ({
    responseId: String(row["id"]), commandId: String(row["command_id"]),
    taskId: row["task_id"] ? String(row["task_id"]) : null,
    kind: row["kind"] as RecoverableBridgeResponse["kind"],
    message: String(row["message"]), checkpoint: object(row["checkpoint_json"]),
    metadata: object(row["metadata_json"]),
  }));
}

async function project(row: RecoverableBridgeResponse): Promise<void> {
  const { classifyAiCoreInboxEvent } = await import("./aiCoreChatInboxService.js");
  const eventType = classifyAiCoreInboxEvent(row);
  if (!eventType) throw new Error("INBOX_EVENT_NOT_TERMINAL");
  const title = eventType === "FAILED" ? "Task gagal" : eventType === "BLOCKED"
    ? "Task membutuhkan perhatian" : eventType === "MERGED" ? "Perubahan sudah di-merge"
    : eventType === "DEPLOYED" ? "Deployment selesai" : eventType === "BILLING_ALERT"
    ? "Billing provider membutuhkan perhatian" : "Task selesai";
  await db.execute(sql`
    INSERT INTO ai_platform.ai_core_chat_inbox_messages
      (response_id, command_id, task_id, event_type, title, message)
    VALUES (${row.responseId}::uuid, ${row.commandId}::uuid, ${row.taskId}::uuid,
      ${eventType}::text, ${title}::text, ${row.message.trim()}::text)
    ON CONFLICT (response_id) DO NOTHING
  `);
}

async function exists(responseId: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT id FROM ai_platform.ai_core_chat_inbox_messages
    WHERE response_id = ${responseId}::uuid LIMIT 1
  `);
  return result.rows.length === 1;
}

type RecoveryResult = {
  scanned: number; recovered: number; failed: number; retained: boolean;
};
type Timer = ReturnType<typeof setTimeout>;
export type InboxRecoveryDependencies = {
  enabled?: () => boolean;
  load?: (limit: number) => Promise<RecoverableBridgeResponse[]>;
  project?: (row: RecoverableBridgeResponse) => Promise<void>;
  exists?: (responseId: string) => Promise<boolean>;
  schedule?: (callback: () => void, delayMs: number) => Timer;
  cancel?: (timer: Timer) => void;
  report?: (event: { code: string } & Record<string, unknown>) => void;
};

/** Event/startup driven; a timer exists only for backlog or failed delivery. */
export function createCodingBridgeInboxRecovery(deps: InboxRecoveryDependencies = {}) {
  const enabled = deps.enabled ?? bridgeInboxRecoveryEnabled;
  const load = deps.load ?? loadMissing;
  const deliver = deps.project ?? project;
  const verify = deps.exists ?? exists;
  const schedule = deps.schedule ?? ((callback, ms) => {
    const timer = setTimeout(callback, ms); timer.unref(); return timer;
  });
  const cancel = deps.cancel ?? clearTimeout;
  const report = deps.report ?? ((event) => logger.info(event, "[bridge-inbox-recovery]"));
  const batchSize = 8;
  const retryBudget = 8;
  let started = false;
  let running = false;
  let permissionBlocked = false;
  let wakeDuringRun = false;
  let timer: Timer | null = null;
  let consecutiveFailures = 0;
  let last: RecoveryResult = { scanned: 0, recovered: 0, failed: 0, retained: false };

  function arm(delayMs: number): void {
    if (!started || !enabled() || permissionBlocked || timer !== null) return;
    timer = schedule(() => { timer = null; void drain(); }, delayMs);
  }

  async function drain(): Promise<RecoveryResult> {
    if (!started || !enabled() || permissionBlocked || running) return last;
    if (timer !== null) cancel(timer);
    timer = null;
    running = true;
    wakeDuringRun = false;
    let scanned = 0, recovered = 0, failed = 0;
    try {
      const rows = await load(batchSize);
      scanned = rows.length;
      for (const row of rows) {
        try {
          await deliver(row);
          if (!await verify(row.responseId)) throw new Error("INBOX_RECEIPT_MISSING");
          recovered += 1;
        } catch (error) {
          failed += 1;
          if (inboxRecoveryAccessBlocked(error)) { permissionBlocked = true; break; }
        }
      }
    } catch (error) {
      failed += 1;
      permissionBlocked = inboxRecoveryAccessBlocked(error);
    } finally {
      running = false;
    }
    last = { scanned, recovered, failed, retained: failed > 0 };
    if (permissionBlocked) {
      report({ code: "INBOX_RECOVERY_ACCESS_BLOCKED", ...last });
    } else if (failed > 0) {
      consecutiveFailures += 1;
      const exhausted = consecutiveFailures >= retryBudget;
      report({ code: exhausted ? "INBOX_RECOVERY_RETAINED" : "INBOX_RECOVERY_RETRY", ...last,
        attempt: consecutiveFailures });
      // Source stays durable. Only an explicit wake or process restart resets
      // this process-local retry budget; no completion/ACK is inferred.
      if (!exhausted) arm(Math.min(120_000, 2_000 * 2 ** (consecutiveFailures - 1)));
    } else {
      consecutiveFailures = 0;
      if (recovered > 0) report({ code: "INBOX_PROJECTION_VERIFIED", ...last });
      if (scanned === batchSize || wakeDuringRun) arm(0);
    }
    return last;
  }

  function wake(): void {
    if (!started || !enabled() || permissionBlocked) return;
    if (running) { wakeDuringRun = true; return; }
    // Notifications cannot defeat a retry deadline.
    if (timer !== null) return;
    consecutiveFailures = 0;
    arm(0);
  }
  function start(): void {
    if (started || !enabled()) return;
    started = true;
    permissionBlocked = false;
    consecutiveFailures = 0;
    wake();
  }
  function stop(): void {
    started = false;
    if (timer !== null) cancel(timer);
    timer = null;
  }
  return { start, stop, wake, drain,
    status: () => ({ started, running, permissionBlocked, scheduled: timer !== null, consecutiveFailures, ...last }) };
}

const runtime = createCodingBridgeInboxRecovery();
export function startCodingBridgeInboxRecovery(): void { runtime.start(); }
export function stopCodingBridgeInboxRecovery(): void { runtime.stop(); }
export function wakeCodingBridgeInboxRecovery(): void { runtime.wake(); }
export function codingBridgeInboxRecoveryStatus() { return runtime.status(); }
