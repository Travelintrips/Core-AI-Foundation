/**
 * aiSchedulerService — Phase 6 AI Scheduler & Automation Engine
 *
 * createSchedule()       — create a new schedule, computes first nextRunAt
 * updateSchedule()       — patch schedule fields, recomputes nextRunAt if trigger changed
 * pauseSchedule()        — status -> paused
 * resumeSchedule()       — status -> active, recomputes nextRunAt
 * cancelSchedule()       — status -> cancelled
 * calculateNextRun()     — compute the next run time for a schedule
 * tick()                 — one poll cycle: find due schedules and execute them
 * executeDueSchedules()  — execute a specific schedule immediately (used by tick + run-now)
 * recordRun()            — persist a schedule_run row
 * createJobFromSchedule()— target_type = create_job
 * publishEventFromSchedule() — target_type = publish_event
 */

import { randomUUID } from "crypto";
import { eq, and, lte, desc, sql } from "drizzle-orm";
import { db, aiSchedulesTable, aiScheduleRunsTable } from "@workspace/db";
import type { AiSchedule, InsertAiSchedule } from "@workspace/db";
import { CronExpressionParser } from "cron-parser";
import { enqueue } from "./queueManagerService.js";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { logger } from "../lib/logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export const TRIGGER_TYPES = [
  "cron", "interval", "one_time", "event_followup", "deadline_reminder",
] as const;

export const SCHEDULE_STATUSES = [
  "active", "paused", "completed", "failed", "cancelled",
] as const;

export const TARGET_TYPES = [
  "create_job", "publish_event", "webhook", "audit_log",
] as const;

export const RUN_STATUSES = [
  "pending", "running", "completed", "failed", "skipped",
] as const;

export interface CreateScheduleInput {
  scheduleName: string;
  description?: string | null;
  triggerType: typeof TRIGGER_TYPES[number];
  cronExpression?: string | null;
  intervalSeconds?: number | null;
  runAt?: Date | null;
  timezone?: string;
  eventType?: string | null;
  targetType: typeof TARGET_TYPES[number];
  targetConfigJson?: Record<string, unknown>;
  payloadJson?: Record<string, unknown>;
  maxRuns?: number | null;
}

export interface SchedulerSettings {
  schedulerEnabled: boolean;
  pollIntervalMs: number;
  timezone: string;
}

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  pollIntervalMs: number;
  lastTick: string | null;
  activeSchedules: number;
  dueNow: number;
  processedToday: number;
  failedToday: number;
}

export interface TickResult {
  executed: number;
  completed: number;
  failed: number;
  skipped: number;
}

// ── Module state (runtime) ────────────────────────────────────────────────────

const _settings: SchedulerSettings = {
  schedulerEnabled: true,
  pollIntervalMs: 10_000,
  timezone: "UTC",
};

let _running = false;
let _starting = false;
let _pollTimer: NodeJS.Timeout | null = null;
let _lastTick: Date | null = null;
let _processedToday = 0;
let _failedToday = 0;
// In-process reentrancy guard: prevents an overlapping setInterval tick,
// a concurrent manual POST /scheduler/tick, and a concurrent run-now from
// executing schedule side-effects at the same time within this process.
let _ticking = false;
// Tracks the in-flight tick promise so shutdown() can await it draining.
let _tickInFlight: Promise<TickResult> | null = null;

// ── Next-run calculation ──────────────────────────────────────────────────────

export function calculateNextRun(schedule: {
  triggerType: string;
  cronExpression?: string | null;
  intervalSeconds?: number | null;
  runAt?: Date | null;
  timezone?: string | null;
  lastRunAt?: Date | null;
}): Date | null {
  const tz = schedule.timezone ?? "UTC";
  const from = schedule.lastRunAt ?? new Date();

  switch (schedule.triggerType) {
    case "cron": {
      if (!schedule.cronExpression) return null;
      try {
        const interval = CronExpressionParser.parse(schedule.cronExpression, {
          currentDate: from,
          tz,
        });
        return interval.next().toDate();
      } catch (err) {
        logger.error({ err, cron: schedule.cronExpression }, "[scheduler] Invalid cron expression");
        return null;
      }
    }
    case "interval": {
      if (!schedule.intervalSeconds) return null;
      return new Date(from.getTime() + schedule.intervalSeconds * 1000);
    }
    case "one_time": {
      // Only ever runs once, at runAt. After it has run, there is no next run.
      if (schedule.lastRunAt) return null;
      return schedule.runAt ?? null;
    }
    case "event_followup":
    case "deadline_reminder":
      // These are driven externally (event bus / manual create), not by tick polling
      // unless an explicit runAt/interval is also set.
      if (schedule.intervalSeconds) {
        return new Date(from.getTime() + schedule.intervalSeconds * 1000);
      }
      return schedule.runAt ?? null;
    default:
      return null;
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createSchedule(input: CreateScheduleInput): Promise<AiSchedule> {
  const scheduleCode = `SCH-${randomUUID().slice(0, 8).toUpperCase()}`;

  const nextRunAt = calculateNextRun({
    triggerType: input.triggerType,
    cronExpression: input.cronExpression,
    intervalSeconds: input.intervalSeconds,
    runAt: input.runAt,
    timezone: input.timezone,
    lastRunAt: null,
  });

  const insert: InsertAiSchedule = {
    scheduleCode,
    scheduleName: input.scheduleName,
    description: input.description ?? null,
    triggerType: input.triggerType,
    cronExpression: input.cronExpression ?? null,
    intervalSeconds: input.intervalSeconds ?? null,
    runAt: input.runAt ?? null,
    timezone: input.timezone ?? "UTC",
    eventType: input.eventType ?? null,
    targetType: input.targetType,
    targetConfigJson: input.targetConfigJson ?? {},
    payloadJson: input.payloadJson ?? {},
    status: "active",
    nextRunAt,
    maxRuns: input.maxRuns ?? null,
    runCount: 0,
  };

  const [schedule] = await db.insert(aiSchedulesTable).values(insert).returning();
  if (!schedule) throw new Error("Failed to create schedule");

  await logAudit("scheduler", "schedule_created", String(schedule.id), "ai_schedule", "success", {
    scheduleCode, triggerType: input.triggerType, targetType: input.targetType,
  });
  publishSafe({
    eventType: "schedule.created", sourceModule: "scheduler", sourceId: scheduleCode,
    payload: { scheduleId: schedule.id, scheduleCode },
  });

  return schedule;
}

export async function updateSchedule(
  id: number,
  patch: Partial<CreateScheduleInput>,
): Promise<AiSchedule> {
  const [existing] = await db.select().from(aiSchedulesTable).where(eq(aiSchedulesTable.id, id));
  if (!existing) throw new Error(`Schedule ${id} not found`);

  const merged = {
    triggerType: patch.triggerType ?? existing.triggerType,
    cronExpression: patch.cronExpression !== undefined ? patch.cronExpression : existing.cronExpression,
    intervalSeconds: patch.intervalSeconds !== undefined ? patch.intervalSeconds : existing.intervalSeconds,
    runAt: patch.runAt !== undefined ? patch.runAt : existing.runAt,
    timezone: patch.timezone ?? existing.timezone,
  };

  const triggerChanged =
    patch.triggerType !== undefined ||
    patch.cronExpression !== undefined ||
    patch.intervalSeconds !== undefined ||
    patch.runAt !== undefined;

  const nextRunAt = triggerChanged
    ? calculateNextRun({ ...merged, lastRunAt: existing.lastRunAt })
    : existing.nextRunAt;

  const updateSet: Partial<InsertAiSchedule> = {
    updatedAt: new Date(),
    nextRunAt,
  };
  if (patch.scheduleName !== undefined) updateSet.scheduleName = patch.scheduleName;
  if (patch.description !== undefined) updateSet.description = patch.description;
  if (patch.triggerType !== undefined) updateSet.triggerType = patch.triggerType;
  if (patch.cronExpression !== undefined) updateSet.cronExpression = patch.cronExpression;
  if (patch.intervalSeconds !== undefined) updateSet.intervalSeconds = patch.intervalSeconds;
  if (patch.runAt !== undefined) updateSet.runAt = patch.runAt;
  if (patch.timezone !== undefined) updateSet.timezone = patch.timezone;
  if (patch.eventType !== undefined) updateSet.eventType = patch.eventType;
  if (patch.targetType !== undefined) updateSet.targetType = patch.targetType;
  if (patch.targetConfigJson !== undefined) updateSet.targetConfigJson = patch.targetConfigJson;
  if (patch.payloadJson !== undefined) updateSet.payloadJson = patch.payloadJson;
  if (patch.maxRuns !== undefined) updateSet.maxRuns = patch.maxRuns;

  const [updated] = await db
    .update(aiSchedulesTable)
    .set(updateSet)
    .where(eq(aiSchedulesTable.id, id))
    .returning();

  if (!updated) throw new Error(`Schedule ${id} not found`);

  await logAudit("scheduler", "schedule_updated", String(id), "ai_schedule", "success", updateSet);
  publishSafe({
    eventType: "schedule.updated", sourceModule: "scheduler", sourceId: updated.scheduleCode,
    payload: { scheduleId: id },
  });

  return updated;
}

export async function pauseSchedule(id: number): Promise<AiSchedule> {
  const [updated] = await db
    .update(aiSchedulesTable)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(aiSchedulesTable.id, id))
    .returning();
  if (!updated) throw new Error(`Schedule ${id} not found`);

  await logAudit("scheduler", "schedule_paused", String(id), "ai_schedule", "success");
  publishSafe({ eventType: "schedule.paused", sourceModule: "scheduler", sourceId: updated.scheduleCode, payload: { scheduleId: id } });
  return updated;
}

export async function resumeSchedule(id: number): Promise<AiSchedule> {
  const [existing] = await db.select().from(aiSchedulesTable).where(eq(aiSchedulesTable.id, id));
  if (!existing) throw new Error(`Schedule ${id} not found`);

  const nextRunAt = calculateNextRun(existing);

  const [updated] = await db
    .update(aiSchedulesTable)
    .set({ status: "active", nextRunAt, updatedAt: new Date() })
    .where(eq(aiSchedulesTable.id, id))
    .returning();
  if (!updated) throw new Error(`Schedule ${id} not found`);

  await logAudit("scheduler", "schedule_resumed", String(id), "ai_schedule", "success");
  publishSafe({ eventType: "schedule.resumed", sourceModule: "scheduler", sourceId: updated.scheduleCode, payload: { scheduleId: id } });
  return updated;
}

export async function cancelSchedule(id: number): Promise<AiSchedule> {
  const [updated] = await db
    .update(aiSchedulesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(aiSchedulesTable.id, id))
    .returning();
  if (!updated) throw new Error(`Schedule ${id} not found`);

  await logAudit("scheduler", "schedule_cancelled", String(id), "ai_schedule", "success");
  publishSafe({ eventType: "schedule.cancelled", sourceModule: "scheduler", sourceId: updated.scheduleCode, payload: { scheduleId: id } });
  return updated;
}

// ── Run recording ─────────────────────────────────────────────────────────────

export async function recordRun(input: {
  scheduleId: number;
  runNumber: number;
  scheduledFor: Date | null;
}) {
  const [run] = await db
    .insert(aiScheduleRunsTable)
    .values({
      scheduleId: input.scheduleId,
      runNumber: input.runNumber,
      scheduledFor: input.scheduledFor,
      startedAt: new Date(),
      status: "running",
    })
    .returning();
  if (!run) throw new Error("Failed to create schedule run");
  return run;
}

async function finishRun(
  runId: number,
  status: "completed" | "failed" | "skipped",
  patch: { resultJson?: Record<string, unknown>; errorMessage?: string; createdJobId?: number | null; createdEventId?: string | null },
) {
  await db
    .update(aiScheduleRunsTable)
    .set({
      status,
      completedAt: new Date(),
      resultJson: patch.resultJson ?? null,
      errorMessage: patch.errorMessage ?? null,
      createdJobId: patch.createdJobId ?? null,
      createdEventId: patch.createdEventId ?? null,
    })
    .where(eq(aiScheduleRunsTable.id, runId));
}

// ── Targets ───────────────────────────────────────────────────────────────────

/** Coerce a JSON config value to a finite number, or fall back to `fallback` if it isn't one. */
function coerceNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce a JSON config value to a finite number, or null if absent/invalid. */
function coerceNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function createJobFromSchedule(schedule: AiSchedule): Promise<{ jobId: number }> {
  const config = (schedule.targetConfigJson ?? {}) as Record<string, unknown>;
  const jobType = (config["jobType"] as string) ?? "scheduled_task";

  const job = await enqueue({
    jobType,
    payloadJson: {
      ...(schedule.payloadJson as Record<string, unknown>),
      scheduleId: schedule.id,
      scheduleCode: schedule.scheduleCode,
    },
    priority: coerceNumber(config["priority"], 50),
    departmentId: coerceNullableNumber(config["departmentId"]),
    employeeId: coerceNullableNumber(config["employeeId"]),
    maxRetry: coerceNumber(config["maxRetry"], 3),
  });

  return { jobId: job.id };
}

export async function publishEventFromSchedule(schedule: AiSchedule): Promise<{ eventId: string }> {
  const config = (schedule.targetConfigJson ?? {}) as Record<string, unknown>;
  const eventType = (config["eventType"] as string) ?? schedule.eventType ?? "schedule.triggered";

  const event = await import("./aiEventBusService.js").then((m) =>
    m.publish({
      eventType,
      sourceModule: "scheduler",
      sourceId: schedule.scheduleCode,
      payload: {
        ...(schedule.payloadJson as Record<string, unknown>),
        scheduleId: schedule.id,
        scheduleCode: schedule.scheduleCode,
      },
    }),
  );

  return { eventId: event.eventId };
}

async function executeTarget(schedule: AiSchedule): Promise<{ createdJobId?: number | null; createdEventId?: string | null; resultJson: Record<string, unknown> }> {
  switch (schedule.targetType) {
    case "create_job": {
      const { jobId } = await createJobFromSchedule(schedule);
      return { createdJobId: jobId, resultJson: { jobId } };
    }
    case "publish_event": {
      const { eventId } = await publishEventFromSchedule(schedule);
      return { createdEventId: eventId, resultJson: { eventId } };
    }
    case "webhook": {
      // Placeholder — audit log only for now (Bagian 5).
      await logAudit("scheduler", "webhook_placeholder", schedule.scheduleCode, "ai_schedule", "success", {
        targetConfig: schedule.targetConfigJson,
      });
      return { resultJson: { note: "webhook placeholder — audit logged only" } };
    }
    case "audit_log": {
      await logAudit("scheduler", "schedule_audit_trigger", schedule.scheduleCode, "ai_schedule", "success", {
        payload: schedule.payloadJson,
      });
      return { resultJson: { note: "audit logged" } };
    }
    default:
      throw new Error(`Unknown target type: ${schedule.targetType}`);
  }
}

// ── Execution ─────────────────────────────────────────────────────────────────

/**
 * Execute a single schedule immediately (used by both tick() and run-now API).
 */
export async function executeDueSchedules(schedule: AiSchedule): Promise<"completed" | "failed" | "skipped"> {
  try {
    return await _executeDueSchedulesInner(schedule);
  } finally {
    // Defensive release: the success/failure branches below already clear
    // is_running as part of their normal completion update. This catches
    // the unexpected case — recordRun() itself throwing, or a completion
    // update failing — where neither branch runs to clear it, which would
    // otherwise leave the schedule permanently stuck as "running" and
    // unclaimable by tick() or run-now.
    await db
      .update(aiSchedulesTable)
      .set({ isRunning: false })
      .where(and(eq(aiSchedulesTable.id, schedule.id), eq(aiSchedulesTable.isRunning, true)))
      .catch((err) => logger.error({ err, scheduleId: schedule.id }, "[scheduler] Failed to release is_running guard"));
  }
}

async function _executeDueSchedulesInner(schedule: AiSchedule): Promise<"completed" | "failed" | "skipped"> {
  const runNumber = schedule.runCount + 1;
  const run = await recordRun({
    scheduleId: schedule.id,
    runNumber,
    scheduledFor: schedule.nextRunAt,
  });

  publishSafe({
    eventType: "schedule.run.started", sourceModule: "scheduler", sourceId: schedule.scheduleCode,
    payload: { scheduleId: schedule.id, runId: run.id, runNumber },
  });

  try {
    const { createdJobId, createdEventId, resultJson } = await executeTarget(schedule);

    await finishRun(run.id, "completed", { resultJson, createdJobId, createdEventId });

    const newRunCount = runNumber;
    const reachedMax = schedule.maxRuns != null && newRunCount >= schedule.maxRuns;

    const nextRunAt = reachedMax
      ? null
      : calculateNextRun({ ...schedule, lastRunAt: new Date() });

    await db
      .update(aiSchedulesTable)
      .set({
        lastRunAt: new Date(),
        nextRunAt,
        runCount: newRunCount,
        status: reachedMax ? "completed" : schedule.status,
        isRunning: false,
        updatedAt: new Date(),
      })
      .where(eq(aiSchedulesTable.id, schedule.id));

    _processedToday++;

    publishSafe({
      eventType: "schedule.run.completed", sourceModule: "scheduler", sourceId: schedule.scheduleCode,
      payload: { scheduleId: schedule.id, runId: run.id, runNumber, createdJobId, createdEventId },
    });

    if (reachedMax) {
      publishSafe({
        eventType: "schedule.completed", sourceModule: "scheduler", sourceId: schedule.scheduleCode,
        payload: { scheduleId: schedule.id, runCount: newRunCount },
      });
    }

    return "completed";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, "failed", { errorMessage: errMsg });

    _failedToday++;

    // Advance nextRunAt on failure too — otherwise a due-but-broken schedule
    // (e.g. bad cron config, downstream error) gets retried every poll cycle
    // with no backoff. Recurring triggers move to their next natural slot;
    // one-shot triggers (one_time / event_followup without interval) are
    // marked failed so they stop being picked up by tick().
    const nextRunAt = calculateNextRun({ ...schedule, lastRunAt: new Date() });
    const isOneShot = nextRunAt === null && schedule.maxRuns == null;

    await db
      .update(aiSchedulesTable)
      .set({
        lastRunAt: new Date(),
        nextRunAt,
        status: isOneShot ? "failed" : schedule.status,
        isRunning: false,
        updatedAt: new Date(),
      })
      .where(eq(aiSchedulesTable.id, schedule.id));

    await logAudit("scheduler", "schedule_run_failed", String(schedule.id), "ai_schedule", "failure", { error: errMsg });
    publishSafe({
      eventType: "schedule.run.failed", sourceModule: "scheduler", sourceId: schedule.scheduleCode,
      payload: { scheduleId: schedule.id, runId: run.id, runNumber, error: errMsg },
    });

    logger.error({ err, scheduleId: schedule.id }, "[scheduler] Schedule run failed");
    return "failed";
  }
}

/**
 * Manually trigger a schedule to run right now, regardless of nextRunAt.
 *
 * Uses the same row-lock claim as tick(): `FOR UPDATE SKIP LOCKED` inside a
 * transaction means run-now and a concurrent tick() can never both grab the
 * same schedule row at once. If tick() already holds the lock, this call
 * finds no row to claim (SKIP LOCKED) and reports the schedule as busy
 * rather than racing to execute it a second time.
 */
export async function runNow(id: number): Promise<AiSchedule> {
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(aiSchedulesTable)
      .where(eq(aiSchedulesTable.id, id))
      .for("update", { skipLocked: true });
    const [schedule] = rows;
    // Row-locked by a concurrent tick()/run-now claim transaction right now.
    if (!schedule) return "locked" as const;
    // Only active schedules are eligible to run — paused/cancelled/completed/
    // failed schedules should never be executed by run-now.
    if (schedule.status !== "active") return "inactive" as const;
    // isRunning persists across the *entire* execution (not just this claim
    // transaction) — it's what catches a second run-now/tick fired while the
    // first execution is still in flight, after this transaction has
    // already committed and released the row lock.
    if (schedule.isRunning) return "locked" as const;

    const placeholderNextRun = new Date(Date.now() + Math.max(_settings.pollIntervalMs, 1000));
    await tx
      .update(aiSchedulesTable)
      .set({ nextRunAt: placeholderNextRun, isRunning: true, updatedAt: new Date() })
      .where(eq(aiSchedulesTable.id, id));

    return { ...schedule, isRunning: true, nextRunAt: placeholderNextRun };
  });

  if (claimed === "locked") {
    const [existing] = await db.select().from(aiSchedulesTable).where(eq(aiSchedulesTable.id, id));
    if (!existing) throw new Error(`Schedule ${id} not found`);
    throw new Error(`Schedule ${id} is currently being executed by the scheduler — try again shortly`);
  }
  if (claimed === "inactive") {
    const [existing] = await db.select().from(aiSchedulesTable).where(eq(aiSchedulesTable.id, id));
    throw new Error(`Schedule ${id} is not active (status: ${existing?.status ?? "unknown"}) — only active schedules can be run now`);
  }

  await executeDueSchedules(claimed);

  const [updated] = await db.select().from(aiSchedulesTable).where(eq(aiSchedulesTable.id, id));
  return updated!;
}

// ── Runtime polling ────────────────────────────────────────────────────────────

export function getSettings(): SchedulerSettings {
  return { ..._settings };
}

export function updateSettings(patch: Partial<SchedulerSettings>): SchedulerSettings {
  const intervalChanged = patch.pollIntervalMs !== undefined && patch.pollIntervalMs !== _settings.pollIntervalMs;
  Object.assign(_settings, patch);

  if (_running && intervalChanged) {
    _clearTimer();
    _startTimer();
  }
  return { ..._settings };
}

export async function getStatus(): Promise<SchedulerStatus> {
  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiSchedulesTable)
    .where(eq(aiSchedulesTable.status, "active"));

  const [dueRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiSchedulesTable)
    .where(
      and(
        eq(aiSchedulesTable.status, "active"),
        lte(aiSchedulesTable.nextRunAt, new Date()),
      ),
    );

  return {
    enabled: _settings.schedulerEnabled,
    running: _running,
    pollIntervalMs: _settings.pollIntervalMs,
    lastTick: _lastTick?.toISOString() ?? null,
    activeSchedules: activeRow?.count ?? 0,
    dueNow: dueRow?.count ?? 0,
    processedToday: _processedToday,
    failedToday: _failedToday,
  };
}

export async function start(): Promise<void> {
  if (_running || _starting) {
    logger.warn("[scheduler] Already running or starting — ignoring start()");
    return;
  }
  _starting = true;
  _running = true;
  _starting = false;
  _startTimer();

  logger.info({ pollIntervalMs: _settings.pollIntervalMs }, "[scheduler] Started");
  await logAudit("scheduler", "scheduler_started", "scheduler", "system", "success", { settings: _settings });
  publishSafe({ eventType: "scheduler.started", sourceModule: "scheduler", sourceId: "scheduler", payload: { pid: process.pid } });
}

export async function stop(): Promise<void> {
  if (!_running) return;
  _running = false;
  _clearTimer();

  // Let any in-flight tick (and the schedule executions it kicked off)
  // finish before we report "stopped" — otherwise a run started just before
  // stop() can be cut off mid-way with no record of completion.
  if (_tickInFlight) {
    await _tickInFlight.catch((err) => logger.error({ err }, "[scheduler] Error draining in-flight tick during stop()"));
  }

  logger.info("[scheduler] Stopped");
  await logAudit("scheduler", "scheduler_stopped", "scheduler", "system", "success", {});
  publishSafe({ eventType: "scheduler.stopped", sourceModule: "scheduler", sourceId: "scheduler", payload: {} });
}

/**
 * One poll cycle: atomically claim due schedules (DB-level `FOR UPDATE SKIP
 * LOCKED` + a provisional nextRunAt bump) so overlapping ticks — whether from
 * the setInterval poller, a manual POST /scheduler/tick, or (in a
 * multi-instance deployment) another process — can never execute the same
 * schedule twice. An in-process mutex additionally short-circuits overlap
 * within this process without even hitting the DB.
 */
export async function tick(): Promise<TickResult> {
  if (_ticking) {
    logger.warn("[scheduler] tick() already in progress — skipping overlapping tick");
    return { executed: 0, completed: 0, failed: 0, skipped: 0 };
  }
  _ticking = true;
  const runPromise = _tickInner();
  _tickInFlight = runPromise;
  try {
    return await runPromise;
  } finally {
    _ticking = false;
    _tickInFlight = null;
  }
}

async function _tickInner(): Promise<TickResult> {
  _lastTick = new Date();
  const result: TickResult = { executed: 0, completed: 0, failed: 0, skipped: 0 };

  try {
    // Claim due schedules atomically: lock the candidate rows, then push
    // their nextRunAt out by a placeholder window (the poll interval) before
    // releasing the lock. This reserves them against any other claimant —
    // including another process on a different DB connection — for the
    // duration of the claim. executeDueSchedules() overwrites nextRunAt with
    // the real calculated value once it actually runs the schedule.
    const claimed = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(aiSchedulesTable)
        .where(
          and(
            eq(aiSchedulesTable.status, "active"),
            eq(aiSchedulesTable.isRunning, false),
            lte(aiSchedulesTable.nextRunAt, new Date()),
          ),
        )
        .orderBy(aiSchedulesTable.nextRunAt)
        .limit(25)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return [];

      const placeholderNextRun = new Date(Date.now() + Math.max(_settings.pollIntervalMs, 1000));
      for (const row of rows) {
        await tx
          .update(aiSchedulesTable)
          .set({ nextRunAt: placeholderNextRun, isRunning: true, updatedAt: new Date() })
          .where(eq(aiSchedulesTable.id, row.id));
      }
      // isRunning is now persisted true on each row — return the claimed
      // rows with that flag set so downstream code (and any future re-read)
      // reflects the claim, even though the in-memory `rows` snapshot
      // predates the update.
      return rows.map((row) => ({ ...row, isRunning: true, nextRunAt: placeholderNextRun }));
    });

    for (const schedule of claimed) {
      result.executed++;
      const outcome = await executeDueSchedules(schedule);
      if (outcome === "completed") result.completed++;
      else if (outcome === "failed") result.failed++;
      else result.skipped++;
    }
  } catch (err) {
    logger.error({ err }, "[scheduler] Uncaught error in tick()");
  }

  return result;
}

function _startTimer(): void {
  _pollTimer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, "[scheduler] Unhandled tick error"));
  }, _settings.pollIntervalMs);
}

function _clearTimer(): void {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

export async function shutdown(): Promise<void> {
  _running = false;
  _clearTimer();

  // Drain any in-flight tick before the process exits (SIGTERM/SIGINT) so an
  // active schedule execution isn't cut off mid-run.
  if (_tickInFlight) {
    await _tickInFlight.catch((err) => logger.error({ err }, "[scheduler] Error draining in-flight tick during shutdown()"));
  }

  logger.info("[scheduler] Shutdown complete");
}

// ── Event follow-up ────────────────────────────────────────────────────────────

/**
 * Create an event-followup schedule that fires once, `delaySeconds` after now.
 * Intended to be invoked from an event handler (e.g. eventHandlerRegistry) when
 * a triggering event (like creative.client.approved) occurs.
 */
export async function scheduleEventFollowup(input: {
  followupEventType: string;
  followupJobType?: string;
  delaySeconds: number;
  payload?: Record<string, unknown>;
  sourceEventType?: string;
}): Promise<AiSchedule> {
  const runAt = new Date(Date.now() + input.delaySeconds * 1000);

  return createSchedule({
    scheduleName: `Follow-up: ${input.followupEventType}`,
    description: input.sourceEventType ? `Auto-created follow-up for ${input.sourceEventType}` : "Auto-created follow-up",
    triggerType: "event_followup",
    runAt,
    targetType: input.followupJobType ? "create_job" : "publish_event",
    targetConfigJson: input.followupJobType
      ? { jobType: input.followupJobType }
      : { eventType: input.followupEventType },
    payloadJson: input.payload ?? {},
    maxRuns: 1,
  });
}

// ── Query helpers ──────────────────────────────────────────────────────────────

export interface ListSchedulesFilter {
  status?: string;
  triggerType?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

export async function listSchedules(filter: ListSchedulesFilter) {
  const { status, triggerType, targetType, limit = 50, offset = 0 } = filter;

  const conditions = [];
  if (status) conditions.push(eq(aiSchedulesTable.status, status));
  if (triggerType) conditions.push(eq(aiSchedulesTable.triggerType, triggerType));
  if (targetType) conditions.push(eq(aiSchedulesTable.targetType, targetType));

  const where = conditions.length ? and(...conditions) : undefined;

  const [items, [{ total }]] = await Promise.all([
    db.select().from(aiSchedulesTable).where(where).orderBy(desc(aiSchedulesTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(aiSchedulesTable).where(where),
  ]);

  return { items, total, limit, offset };
}

export interface ListScheduleRunsFilter {
  scheduleId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listScheduleRuns(filter: ListScheduleRunsFilter) {
  const { scheduleId, status, limit = 50, offset = 0 } = filter;

  const conditions = [];
  if (scheduleId) conditions.push(eq(aiScheduleRunsTable.scheduleId, scheduleId));
  if (status) conditions.push(eq(aiScheduleRunsTable.status, status));

  const where = conditions.length ? and(...conditions) : undefined;

  const [items, [{ total }]] = await Promise.all([
    db.select().from(aiScheduleRunsTable).where(where).orderBy(desc(aiScheduleRunsTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(aiScheduleRunsTable).where(where),
  ]);

  return { items, total, limit, offset };
}

export async function getSchedule(id: number): Promise<AiSchedule | null> {
  const [schedule] = await db.select().from(aiSchedulesTable).where(eq(aiSchedulesTable.id, id));
  return schedule ?? null;
}
