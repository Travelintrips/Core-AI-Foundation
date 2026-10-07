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

export interface DetachedMultiWorkerRecoveryResult {
  recoveredTasks: number;
}

export async function reconcileDetachedCompletedMultiWorkerTasks(
  options: { taskId?: string } = {},
): Promise<DetachedMultiWorkerRecoveryResult> {
  const scopedTaskId = options.taskId ?? null;
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT t.id
      FROM ai_platform.ai_coding_tasks AS t
      WHERE t.task_number LIKE 'MW-%'
        AND t.status IN ('ANALYZING', 'READY_REVIEW')
        AND (${scopedTaskId}::uuid IS NULL OR t.id = ${scopedTaskId}::uuid)
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_workstreams AS w
          WHERE w.child_task_id = t.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_runs AS active_run
          WHERE active_run.task_id = t.id
            AND active_run.status = 'RUNNING'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_jobs AS active_job
          WHERE active_job.status IN ('queued', 'waiting', 'retrying', 'running')
            AND (
              active_job.payload_json->>'codingTaskId' = t.id::text
              OR active_job.payload_json->>'childTaskId' = t.id::text
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_critical_approvals AS approval
          WHERE approval.task_id = t.id
            AND approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_autonomous_tasks AS autonomous
          WHERE autonomous.task_id = t.id
            AND (
              autonomous.last_action = 'MANUAL_STOP'
              OR (
                autonomous.enabled = TRUE
                AND autonomous.status IN (
                  'ACTIVE',
                  'WAITING',
                  'APPROVAL_REQUIRED',
                  'BLOCKED',
                  'FAILED'
                )
              )
            )
        )
        AND (
          SELECT latest_run.status
          FROM ai_platform.ai_coding_runs AS latest_run
          WHERE latest_run.task_id = t.id
          ORDER BY latest_run.created_at DESC
          LIMIT 1
        ) = 'COMPLETED'
    ),
    updated AS (
      UPDATE ai_platform.ai_coding_tasks AS task
      SET status = 'COMPLETED',
          result_summary = COALESCE(
            task.result_summary,
            'Detached Multi-Worker shard completed; stale lifecycle state reconciled automatically.'
          ),
          updated_at = NOW()
      FROM candidates
      WHERE task.id = candidates.id
        AND task.status IN ('ANALYZING', 'READY_REVIEW')
      RETURNING task.id
    )
    SELECT COUNT(*)::int AS recovered_tasks
    FROM updated
  `);

  const row = result.rows?.[0] as { recovered_tasks?: number | string } | undefined;
  return {
    recoveredTasks: Number(row?.recovered_tasks ?? 0),
  };
}

export interface OrphanedParentLifecycleRecoveryResult {
  releasedReservations: number;
  recoveredTasks: number;
}

export async function reconcileOrphanedParentTaskLifecycle(
  options: { taskId?: string } = {},
): Promise<OrphanedParentLifecycleRecoveryResult> {
  const scopedTaskId = options.taskId ?? null;

  const released = await db.execute(sql`
    WITH orphan_reservations AS (
      SELECT reservation.reservation_id
      FROM ai_platform.ai_coding_active_file_reservations AS reservation
      JOIN ai_platform.ai_coding_tasks AS task
        ON task.id::text = reservation.task_id
      WHERE task.task_number NOT LIKE 'MW-%'
        AND (${scopedTaskId}::uuid IS NULL OR task.id = ${scopedTaskId}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM ai_platform.ai_coding_runs AS run
          WHERE run.task_id = task.id AND run.status = 'RUNNING'
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_platform.ai_jobs AS job
          WHERE job.status IN ('queued', 'waiting', 'retrying', 'running')
            AND (
              job.payload_json->>'codingTaskId' = task.id::text
              OR job.payload_json->>'childTaskId' = task.id::text
              OR EXISTS (
                SELECT 1
                FROM ai_platform.ai_coding_workstreams AS workstream
                JOIN ai_platform.ai_coding_task_graphs AS graph ON graph.id = workstream.graph_id
                WHERE graph.task_id = task.id
                  AND workstream.id::text = job.payload_json->>'workstreamId'
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_task_graphs AS graph
          JOIN ai_platform.ai_coding_workstreams AS workstream ON workstream.graph_id = graph.id
          WHERE graph.task_id = task.id
            AND graph.status IN ('PREPARED', 'APPROVED', 'RUNNING')
            AND workstream.status IN ('PENDING', 'READY', 'CLAIMED', 'RUNNING', 'REVIEW_REQUIRED')
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_platform.ai_coding_critical_approvals AS approval
          WHERE approval.task_id = task.id
            AND approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')
        )
    ), deleted AS (
      DELETE FROM ai_platform.ai_coding_active_file_reservations AS reservation
      USING orphan_reservations
      WHERE reservation.reservation_id = orphan_reservations.reservation_id
      RETURNING reservation.reservation_id
    )
    SELECT COUNT(*)::int AS released_reservations FROM deleted
  `);

  const reconciled = await db.execute(sql`
    WITH latest_run AS (
      SELECT DISTINCT ON (run.task_id)
        run.task_id,
        run.status AS run_status
      FROM ai_platform.ai_coding_runs AS run
      ORDER BY run.task_id, run.created_at DESC
    ), candidates AS (
      SELECT
        task.id,
        CASE
          WHEN autonomous.status = 'COMPLETED'
            OR task.commit_sha IS NOT NULL
            OR task.pull_request_url IS NOT NULL
          THEN 'COMPLETED'
          ELSE 'FAILED'
        END AS terminal_status
      FROM ai_platform.ai_coding_tasks AS task
      LEFT JOIN latest_run ON latest_run.task_id = task.id
      LEFT JOIN ai_platform.ai_coding_autonomous_tasks AS autonomous
        ON autonomous.task_id = task.id
       AND autonomous.enabled = TRUE
      WHERE task.task_number NOT LIKE 'MW-%'
        AND task.status IN ('ANALYZING', 'READY_REVIEW', 'BLOCKED')
        AND (${scopedTaskId}::uuid IS NULL OR task.id = ${scopedTaskId}::uuid)
        AND latest_run.run_status IN ('COMPLETED', 'FAILED')
        AND NOT EXISTS (
          SELECT 1 FROM ai_platform.ai_coding_runs AS run
          WHERE run.task_id = task.id AND run.status = 'RUNNING'
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_platform.ai_jobs AS job
          WHERE job.status IN ('queued', 'waiting', 'retrying', 'running')
            AND (
              job.payload_json->>'codingTaskId' = task.id::text
              OR job.payload_json->>'childTaskId' = task.id::text
              OR EXISTS (
                SELECT 1
                FROM ai_platform.ai_coding_workstreams AS workstream
                JOIN ai_platform.ai_coding_task_graphs AS graph ON graph.id = workstream.graph_id
                WHERE graph.task_id = task.id
                  AND workstream.id::text = job.payload_json->>'workstreamId'
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_task_graphs AS graph
          JOIN ai_platform.ai_coding_workstreams AS workstream ON workstream.graph_id = graph.id
          WHERE graph.task_id = task.id
            AND graph.status IN ('PREPARED', 'APPROVED', 'RUNNING')
            AND workstream.status IN ('PENDING', 'READY', 'CLAIMED', 'RUNNING', 'REVIEW_REQUIRED')
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_platform.ai_coding_critical_approvals AS approval
          WHERE approval.task_id = task.id
            AND approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_platform.ai_coding_active_file_reservations AS reservation
          WHERE reservation.task_id = task.id::text
        )
    ), disabled_autonomous AS (
      UPDATE ai_platform.ai_coding_autonomous_tasks AS autonomous
      SET enabled = FALSE,
          status = 'DISABLED',
          last_action = 'STALE_LIFECYCLE_RECONCILED',
          updated_at = NOW()
      FROM candidates
      WHERE autonomous.task_id = candidates.id
        AND autonomous.enabled = TRUE
      RETURNING autonomous.task_id
    ), updated AS (
      UPDATE ai_platform.ai_coding_tasks AS task
      SET status = candidates.terminal_status,
          updated_at = NOW()
      FROM candidates
      WHERE task.id = candidates.id
      RETURNING task.id
    )
    SELECT COUNT(*)::int AS recovered_tasks FROM updated
  `);

  const releasedRow = released.rows?.[0] as { released_reservations?: number | string } | undefined;
  const recoveredRow = reconciled.rows?.[0] as { recovered_tasks?: number | string } | undefined;
  return {
    releasedReservations: Number(releasedRow?.released_reservations ?? 0),
    recoveredTasks: Number(recoveredRow?.recovered_tasks ?? 0),
  };
}

export async function reconcileStaleCodingRuns(
  options: { taskId?: string; now?: Date } = {},
): Promise<CodingRunRecoveryResult> {
  const now = options.now ?? new Date();
  const orphanRecovery = await reconcileOrphanedParentTaskLifecycle({
    taskId: options.taskId,
  });
  const detachedRecovery = await reconcileDetachedCompletedMultiWorkerTasks({
    taskId: options.taskId,
  });
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
    recoveredTasks: orphanRecovery.recoveredTasks + detachedRecovery.recoveredTasks,
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
            // A stale execution is a technical blocker, never a human-review
            // request. Persist BLOCKED so storage and presentation agree.
            status: "BLOCKED",
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
