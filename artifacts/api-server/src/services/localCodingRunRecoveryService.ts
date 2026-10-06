import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { aiCodingRunsTable, aiCodingTasksTable, db } from "@workspace/db";
import { reportCodingTaskTerminalTransition } from "./codingTaskTerminalReportingService.js";

const TERMINAL_TASK_STATUSES = new Set(["PR_CREATED", "READY_REVIEW", "COMPLETED", "FAILED"]);
const ACTIVE_TASK_STATUSES = new Set(["PENDING", "ANALYZING", "CODING", "TESTING", "COMMITTING"]);

const DEFAULT_TERMINAL_STALE_MS = 15 * 60_000;
const DEFAULT_ACTIVE_STALE_MS = 90 * 60_000;
const DEFAULT_TEST_TASK_RETENTION_HOURS = 6;
const TEST_TASK_TERMINAL_STATUSES = ["FAILED", "READY_REVIEW", "COMPLETED"] as const;

function boundedMinutes(value: string | undefined, fallbackMinutes: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMinutes;
  return Math.max(5, Math.min(parsed, 24 * 60));
}

export function codingRunRecoveryThresholds() {
  return {
    terminalMs:
      boundedMinutes(process.env["AI_CODING_TERMINAL_RUN_STALE_MINUTES"], 15) * 60_000,
    activeMs:
      boundedMinutes(process.env["AI_CODING_ACTIVE_RUN_STALE_MINUTES"], 90) * 60_000,
  };
}

export function isRecoverableStaleCodingRun(input: {
  taskStatus: string;
  runStatus: string;
  startedAt: Date | null;
  now: Date;
  terminalStaleMs?: number;
  activeStaleMs?: number;
}): boolean {
  if (input.runStatus !== "RUNNING" || !input.startedAt) return false;
  const thresholds = codingRunRecoveryThresholds();
  const ageMs = input.now.getTime() - input.startedAt.getTime();
  const terminalStaleMs = input.terminalStaleMs ?? thresholds.terminalMs;
  const activeStaleMs = input.activeStaleMs ?? thresholds.activeMs;

  if (TERMINAL_TASK_STATUSES.has(input.taskStatus)) {
    return ageMs >= terminalStaleMs;
  }
  if (ACTIVE_TASK_STATUSES.has(input.taskStatus)) {
    return ageMs >= activeStaleMs;
  }
  return false;
}

export interface CodingRunRecoveryResult {
  inspected: number;
  recoveredRuns: number;
  recoveredTasks: number;
}

export async function reconcileStaleCodingRuns(
  options: { taskId?: string; now?: Date } = {},
): Promise<CodingRunRecoveryResult> {
  const now = options.now ?? new Date();
  const rows = await db
    .select({
      runId: aiCodingRunsTable.id,
      runStatus: aiCodingRunsTable.status,
      runStartedAt: aiCodingRunsTable.startedAt,
      runAgentName: aiCodingRunsTable.agentName,
      taskId: aiCodingTasksTable.id,
      taskStatus: aiCodingTasksTable.status,
    })
    .from(aiCodingRunsTable)
    .innerJoin(aiCodingTasksTable, eq(aiCodingTasksTable.id, aiCodingRunsTable.taskId))
    .where(
      options.taskId
        ? and(eq(aiCodingRunsTable.status, "RUNNING"), eq(aiCodingTasksTable.id, options.taskId))
        : eq(aiCodingRunsTable.status, "RUNNING"),
    );

  const candidates = rows.filter((row) =>
    isRecoverableStaleCodingRun({
      taskStatus: row.taskStatus,
      runStatus: row.runStatus,
      startedAt: row.runStartedAt,
      now,
    }),
  );

  const result: CodingRunRecoveryResult = {
    inspected: rows.length,
    recoveredRuns: 0,
    recoveredTasks: 0,
  };

  for (const candidate of candidates) {
    const recoveredTaskEvent = await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(aiCodingRunsTable)
        .where(eq(aiCodingRunsTable.id, candidate.runId))
        .for("update");
      if (!run || run.status !== "RUNNING" || !run.startedAt) return null;

      const [task] = await tx
        .select()
        .from(aiCodingTasksTable)
        .where(eq(aiCodingTasksTable.id, candidate.taskId))
        .for("update");
      if (!task) return null;

      if (!isRecoverableStaleCodingRun({
        taskStatus: task.status,
        runStatus: run.status,
        startedAt: run.startedAt,
        now,
      })) return null;

      const ageMinutes = Math.max(1, Math.floor((now.getTime() - run.startedAt.getTime()) / 60_000));
      const recoveryMessage =
        `Recovered stale ${run.agentName} coding run after ${ageMinutes} minutes without completion.`;

      const [updatedRun] = await tx
        .update(aiCodingRunsTable)
        .set({
          status: "FAILED",
          finishedAt: now,
          errorMessage: run.errorMessage ?? recoveryMessage,
        })
        .where(and(eq(aiCodingRunsTable.id, run.id), eq(aiCodingRunsTable.status, "RUNNING")))
        .returning({ id: aiCodingRunsTable.id });
      if (updatedRun) result.recoveredRuns += 1;

      if (ACTIVE_TASK_STATUSES.has(task.status)) {
        const [updatedTask] = await tx
          .update(aiCodingTasksTable)
          .set({
            // Stale child execution is recoverable. READY_REVIEW is the
            // persisted technical-intervention state; presentation maps it to
            // BLOCKED when no critical approval exists.
            status: "READY_REVIEW",
            resultSummary: task.resultSummary ?? recoveryMessage,
          })
          .where(eq(aiCodingTasksTable.id, task.id))
          .returning({ id: aiCodingTasksTable.id });
        if (updatedTask) {
          result.recoveredTasks += 1;
          await tx.execute(sql`
            UPDATE ai_platform.ai_coding_autonomous_tasks
            SET status = 'BLOCKED',
                last_action = 'RECOVERABLE_OPERATIONAL_FAILURE',
                last_error = ${recoveryMessage},
                completed_at = NULL,
                updated_at = ${now}
            WHERE task_id = ${task.id}::uuid
              AND enabled = TRUE
          `);
          return { taskId: task.id, message: recoveryMessage };
        }
      }

      return null;
    });

    if (recoveredTaskEvent) {
      await reportCodingTaskTerminalTransition({
        taskId: recoveredTaskEvent.taskId,
        status: "BLOCKED",
        message: recoveredTaskEvent.message,
        source: "coding-run-stale-recovery",
      }).catch(() => undefined);
    }
  }

  return result;
}

export interface CodingTestTaskRetentionResult {
  inspected: number;
  purgedTasks: number;
}

function testTaskRetentionMs(): number {
  const parsed = Number(process.env["AI_CODING_TEST_TASK_RETENTION_HOURS"]);
  const hours = Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.min(parsed, 7 * 24))
    : DEFAULT_TEST_TASK_RETENTION_HOURS;
  return hours * 60 * 60_000;
}

function isDisposableCodingTestTask(projectName: string): boolean {
  return projectName === "Control Plane E2E Canary" ||
    projectName.startsWith("Control Plane E2E Canary / ") ||
    projectName.startsWith("GitHub Trigger temporal-e2e-smoke-");
}

export async function purgeExpiredCodingTestTasks(
  options: { now?: Date } = {},
): Promise<CodingTestTaskRetentionResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - testTaskRetentionMs());
  const rows = await db
    .select({
      id: aiCodingTasksTable.id,
      projectName: aiCodingTasksTable.projectName,
      status: aiCodingTasksTable.status,
      createdAt: aiCodingTasksTable.createdAt,
    })
    .from(aiCodingTasksTable)
    .where(
      and(
        inArray(aiCodingTasksTable.status, [...TEST_TASK_TERMINAL_STATUSES]),
        lt(aiCodingTasksTable.createdAt, cutoff),
      ),
    );

  const candidates = rows.filter((row) => isDisposableCodingTestTask(row.projectName));
  const result: CodingTestTaskRetentionResult = { inspected: candidates.length, purgedTasks: 0 };

  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const [activeRun] = await tx
        .select({ id: aiCodingRunsTable.id })
        .from(aiCodingRunsTable)
        .where(and(eq(aiCodingRunsTable.taskId, candidate.id), eq(aiCodingRunsTable.status, "RUNNING")))
        .limit(1);
      if (activeRun) return;

      const [deleted] = await tx
        .delete(aiCodingTasksTable)
        .where(eq(aiCodingTasksTable.id, candidate.id))
        .returning({ id: aiCodingTasksTable.id });
      if (deleted) result.purgedTasks += 1;
    });
  }

  return result;
}
