import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTaskGraphsTable,
  aiCodingTasksTable,
  aiCodingWorkstreamsTable,
  aiJobsTable,
  db,
} from "@workspace/db";

const ACTIVE_WORKSTREAM_STATUSES = ["CLAIMED", "RUNNING"] as const;
const TERMINAL_WORKSTREAM_STATUSES = [
  "REVIEW_REQUIRED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export interface MultiWorkerRecoveryResult {
  inspected: number;
  recoveredRuns: number;
  recoveredWorkstreams: number;
  recoveredTasks: number;
  recoveredJobs: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function workstreamChildLifecycleDisposition(
  workstreamStatus: string,
  resultJson: unknown,
): {
  runStatus: "COMPLETED" | "FAILED";
  taskStatus: "READY_REVIEW" | "COMPLETED" | "FAILED";
  aiFailure: boolean;
} {
  const result = record(resultJson);
  const execution = record(result?.workstreamAiExecution);
  const retryPending = execution?.autoRepairStatus === "RETRY_PENDING";
  const aiFailure =
    workstreamStatus === "REVIEW_REQUIRED" &&
    execution?.status === "FAILED" &&
    !retryPending;

  if (aiFailure) {
    return {
      runStatus: "FAILED",
      taskStatus: "FAILED",
      aiFailure: true,
    };
  }

  if (workstreamStatus === "COMPLETED") {
    return {
      runStatus: "COMPLETED",
      taskStatus: "COMPLETED",
      aiFailure: false,
    };
  }

  if (workstreamStatus === "REVIEW_REQUIRED") {
    return {
      runStatus: "COMPLETED",
      taskStatus: "READY_REVIEW",
      aiFailure: false,
    };
  }

  return {
    runStatus: "FAILED",
    taskStatus: "FAILED",
    aiFailure: false,
  };
}

export function expiredLeaseRecoveryDisposition() {
  return {
    workstreamStatus: "READY" as const,
    graphStatus: "RUNNING" as const,
    staleRunStatus: "FAILED" as const,
    staleTaskStatus: "FAILED" as const,
    clearExecutionBindings: true as const,
  };
}

async function reconcileTerminalMultiWorkerJobOrphans(
  now: Date,
): Promise<{ inspected: number; recoveredRuns: number; recoveredTasks: number }> {
  const result = await db.execute(sql`
    WITH terminal_jobs AS (
      SELECT DISTINCT ON (r.id)
        r.id AS run_id,
        r.task_id,
        j.id AS job_id,
        j.status AS job_status,
        COALESCE(
          NULLIF(j.error_message, ''),
          'Coding workstream job ended without an error message'
        ) AS job_error
      FROM ai_platform.ai_coding_runs AS r
      JOIN ai_platform.ai_coding_tasks AS t
        ON t.id = r.task_id
      JOIN ai_platform.ai_jobs AS j
        ON j.job_type = 'coding_workstream_execution'
       AND j.payload_json->>'codingRunId' = r.id::text
      WHERE r.agent_name LIKE 'Multi-Worker %'
        AND r.status = 'RUNNING'
        AND t.status = 'ANALYZING'
        AND j.status IN ('failed', 'cancelled')
        AND NOT EXISTS (
          SELECT 1
          FROM ai_platform.ai_jobs AS active
          WHERE active.job_type = 'coding_workstream_execution'
            AND active.payload_json->>'codingRunId' = r.id::text
            AND active.status IN ('queued', 'waiting', 'running', 'retrying')
        )
      ORDER BY r.id, j.id DESC
    ),
    failed_runs AS (
      UPDATE ai_platform.ai_coding_runs AS r
      SET status = 'FAILED',
          finished_at = ${now},
          error_message = LEFT(
            'Coding workstream job ' || terminal_jobs.job_id::text ||
            ' ended as ' || terminal_jobs.job_status || ': ' ||
            terminal_jobs.job_error,
            2000
          )
      FROM terminal_jobs
      WHERE r.id = terminal_jobs.run_id
        AND r.status = 'RUNNING'
      RETURNING r.task_id
    ),
    failed_tasks AS (
      UPDATE ai_platform.ai_coding_tasks AS t
      SET status = 'FAILED',
          result_summary = LEFT(
            'Coding workstream execution failed: ' || terminal_jobs.job_error,
            500
          ),
          updated_at = ${now}
      FROM terminal_jobs
      WHERE t.id = terminal_jobs.task_id
        AND t.status = 'ANALYZING'
        AND EXISTS (
          SELECT 1
          FROM failed_runs
          WHERE failed_runs.task_id = t.id
        )
      RETURNING t.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM terminal_jobs) AS inspected,
      (SELECT COUNT(*)::int FROM failed_runs) AS recovered_runs,
      (SELECT COUNT(*)::int FROM failed_tasks) AS recovered_tasks
  `);

  const row = result.rows?.[0] as
    | {
        inspected?: number | string;
        recovered_runs?: number | string;
        recovered_tasks?: number | string;
      }
    | undefined;

  return {
    inspected: Number(row?.inspected ?? 0),
    recoveredRuns: Number(row?.recovered_runs ?? 0),
    recoveredTasks: Number(row?.recovered_tasks ?? 0),
  };
}

export async function reconcileStaleMultiWorkerRuns(
  options: { taskId?: string; now?: Date } = {},
): Promise<MultiWorkerRecoveryResult> {
  const now = options.now ?? new Date();

  const baseConditions = [isNotNull(aiCodingWorkstreamsTable.childRunId)];
  if (options.taskId) {
    baseConditions.push(eq(aiCodingWorkstreamsTable.childTaskId, options.taskId));
  }

  const [terminal, expired] = await Promise.all([
    db
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(
        and(
          ...baseConditions,
          inArray(aiCodingWorkstreamsTable.status, [...TERMINAL_WORKSTREAM_STATUSES]),
        ),
      ),
    db
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(
        and(
          ...baseConditions,
          inArray(aiCodingWorkstreamsTable.status, [...ACTIVE_WORKSTREAM_STATUSES]),
          isNotNull(aiCodingWorkstreamsTable.leaseExpiresAt),
          lte(aiCodingWorkstreamsTable.leaseExpiresAt, now),
        ),
      ),
  ]);

  const candidates = new Map<string, typeof terminal[number]>();
  for (const item of terminal) candidates.set(item.id, item);
  for (const item of expired) candidates.set(item.id, item);

  const orphanRecovery = options.taskId
    ? { inspected: 0, recoveredRuns: 0, recoveredTasks: 0 }
    : await reconcileTerminalMultiWorkerJobOrphans(now);

  const result: MultiWorkerRecoveryResult = {
    inspected: candidates.size + orphanRecovery.inspected,
    recoveredRuns: orphanRecovery.recoveredRuns,
    recoveredWorkstreams: 0,
    recoveredTasks: orphanRecovery.recoveredTasks,
    recoveredJobs: 0,
  };

  for (const candidate of candidates.values()) {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(aiCodingWorkstreamsTable)
        .where(eq(aiCodingWorkstreamsTable.id, candidate.id))
        .for("update");

      if (!current?.childRunId || !current.childTaskId) return;

      const expiredLease =
        ACTIVE_WORKSTREAM_STATUSES.includes(
          current.status as (typeof ACTIVE_WORKSTREAM_STATUSES)[number],
        ) &&
        current.leaseExpiresAt != null &&
        current.leaseExpiresAt.getTime() <= now.getTime();

      const terminalState = TERMINAL_WORKSTREAM_STATUSES.includes(
        current.status as (typeof TERMINAL_WORKSTREAM_STATUSES)[number],
      );

      if (!expiredLease && !terminalState) return;

      let effectiveWorkstreamStatus = current.status;
      if (expiredLease) {
        // An expired lease is a recoverable execution loss, not a terminal
        // workstream failure. Close the stale child lifecycle, clear its
        // bindings, and put the workstream back in READY so the autonomous
        // dispatcher can create a fresh attempt.
        effectiveWorkstreamStatus = "FAILED";
        const [updatedWorkstream] = await tx
          .update(aiCodingWorkstreamsTable)
          .set({
            status: "READY",
            errorMessage: null,
            completedAt: null,
            heartbeatAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
            childTaskId: null,
            childRunId: null,
            jobId: null,
          })
          .where(
            and(
              eq(aiCodingWorkstreamsTable.id, current.id),
              inArray(aiCodingWorkstreamsTable.status, [...ACTIVE_WORKSTREAM_STATUSES]),
            ),
          )
          .returning();

        if (updatedWorkstream) {
          result.recoveredWorkstreams += 1;
          await tx
            .update(aiCodingTaskGraphsTable)
            .set({ status: "RUNNING", completedAt: null })
            .where(eq(aiCodingTaskGraphsTable.id, current.graphId));
        }

        if (current.jobId != null) {
          const [updatedJob] = await tx
            .update(aiJobsTable)
            .set({
              status: "failed",
              completedAt: now,
              errorMessage:
                "Coding workstream lease expired before execution completed; workstream requeued for a fresh attempt.",
            })
            .where(
              and(
                eq(aiJobsTable.id, current.jobId),
                inArray(aiJobsTable.status, ["queued", "waiting", "running", "retrying"]),
              ),
            )
            .returning();
          if (updatedJob) result.recoveredJobs += 1;
        }
      }

      const disposition = workstreamChildLifecycleDisposition(
        effectiveWorkstreamStatus,
        current.resultJson,
      );
      const desiredRunStatus = disposition.runStatus;
      const [updatedRun] = await tx
        .update(aiCodingRunsTable)
        .set({
          status: desiredRunStatus,
          finishedAt: now,
          ...(desiredRunStatus === "FAILED"
            ? {
                errorMessage:
                  current.errorMessage ??
                  (disposition.aiFailure
                    ? "Constrained AI execution failed; automatic repair or incident handling is required."
                    : "Multi-worker execution ended without closing its coding run."),
              }
            : {}),
        })
        .where(
          and(
            eq(aiCodingRunsTable.id, current.childRunId),
            eq(aiCodingRunsTable.status, "RUNNING"),
          ),
        )
        .returning();

      if (updatedRun) result.recoveredRuns += 1;

      const desiredTaskStatus = disposition.taskStatus;
      const [updatedTask] = await tx
        .update(aiCodingTasksTable)
        .set({
          status: desiredTaskStatus,
          ...(desiredTaskStatus === "FAILED"
            ? {
                resultSummary:
                  current.errorMessage ??
                  (disposition.aiFailure
                    ? "Constrained AI execution failed. AI Core will attempt bounded repair; unresolved failures are routed to Incident Inbox."
                    : "Multi-worker execution was recovered after its lease or lifecycle ended."),
              }
            : {}),
        })
        .where(
          and(
            eq(aiCodingTasksTable.id, current.childTaskId),
            inArray(aiCodingTasksTable.status, [
              "PENDING",
              "ANALYZING",
              "CODING",
              "TESTING",
              "COMMITTING",
              "READY_REVIEW",
            ]),
          ),
        )
        .returning();

      if (updatedTask) result.recoveredTasks += 1;
    });
  }

  return result;
}
