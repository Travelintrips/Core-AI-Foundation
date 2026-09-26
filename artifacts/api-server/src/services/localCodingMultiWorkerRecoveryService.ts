import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
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

function runTerminalStatus(workstreamStatus: string): "COMPLETED" | "FAILED" {
  return workstreamStatus === "REVIEW_REQUIRED" || workstreamStatus === "COMPLETED"
    ? "COMPLETED"
    : "FAILED";
}

function taskTerminalStatus(workstreamStatus: string): "READY_REVIEW" | "FAILED" {
  return workstreamStatus === "REVIEW_REQUIRED" || workstreamStatus === "COMPLETED"
    ? "READY_REVIEW"
    : "FAILED";
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

  const result: MultiWorkerRecoveryResult = {
    inspected: candidates.size,
    recoveredRuns: 0,
    recoveredWorkstreams: 0,
    recoveredTasks: 0,
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
        effectiveWorkstreamStatus = "FAILED";
        const [updatedWorkstream] = await tx
          .update(aiCodingWorkstreamsTable)
          .set({
            status: "FAILED",
            errorMessage:
              "Multi-worker lease expired before the child execution completed; stale execution recovered.",
            completedAt: now,
            heartbeatAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
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
            .set({ status: "FAILED", completedAt: now })
            .where(eq(aiCodingTaskGraphsTable.id, current.graphId));
        }

        if (current.jobId != null) {
          const [updatedJob] = await tx
            .update(aiJobsTable)
            .set({
              status: "failed",
              completedAt: now,
              errorMessage:
                "Coding workstream lease expired before execution completed.",
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

      const desiredRunStatus = runTerminalStatus(effectiveWorkstreamStatus);
      const [updatedRun] = await tx
        .update(aiCodingRunsTable)
        .set({
          status: desiredRunStatus,
          finishedAt: now,
          ...(desiredRunStatus === "FAILED"
            ? {
                errorMessage:
                  current.errorMessage ??
                  "Multi-worker execution ended without closing its coding run.",
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

      const desiredTaskStatus = taskTerminalStatus(effectiveWorkstreamStatus);
      const [updatedTask] = await tx
        .update(aiCodingTasksTable)
        .set({
          status: desiredTaskStatus,
          ...(desiredTaskStatus === "FAILED"
            ? {
                resultSummary:
                  current.errorMessage ??
                  "Multi-worker execution was recovered after its lease or lifecycle ended.",
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
            ]),
          ),
        )
        .returning();

      if (updatedTask) result.recoveredTasks += 1;
    });
  }

  return result;
}
