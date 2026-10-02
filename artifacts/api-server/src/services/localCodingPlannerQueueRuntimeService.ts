import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiJobsTable, db, type AiJob } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";
import { AutomatedMultiTaskPlannerError, generateAndPersistCodingMultiTaskPlan } from "./localCodingAutomatedMultiTaskPlannerService.js";

export const CODING_MULTI_TASK_PLANNER_JOB_TYPE = "coding_multi_task_planner";
export const CODING_MULTI_TASK_PLANNER_EXECUTION_BUDGET_MS = 165_000;

function taskIdFrom(job: AiJob): string {
  const value = (job.payloadJson as Record<string, unknown> | null)?.["taskId"];
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("coding_multi_task_planner payload taskId must be a UUID");
  }
  return value;
}

export async function enqueueCodingMultiTaskPlanner(taskId: string) {
  const lockKey = `${CODING_MULTI_TASK_PLANNER_JOB_TYPE}:${taskId}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const [existing] = await tx.select().from(aiJobsTable).where(and(
      eq(aiJobsTable.jobType, CODING_MULTI_TASK_PLANNER_JOB_TYPE),
      inArray(aiJobsTable.status, ["queued", "waiting", "running", "retrying"]),
      sql`${aiJobsTable.payloadJson}->>'taskId' = ${taskId}`,
    )).orderBy(desc(aiJobsTable.id)).limit(1);
    if (existing) return { job: existing, created: false };
    const [job] = await tx.insert(aiJobsTable).values({
      jobCode: `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`,
      jobType: CODING_MULTI_TASK_PLANNER_JOB_TYPE,
      requiredCapability: CODING_MULTI_TASK_PLANNER_JOB_TYPE,
      payloadJson: { taskId },
      priority: 80,
      priorityScore: "80",
      // Planner execution already has bounded provider retry + fallback.
      // A queue-level retry would restart the entire 150s planner budget and can
      // leave production canaries observing a second long-running attempt.
      maxRetry: 0,
      retryStrategy: "manual",
      status: "queued",
      retryCount: 0,
    }).returning();
    if (!job) throw new Error("Failed to enqueue coding multi-task planner");
    return { job, created: true };
  });
}

export async function executeCodingMultiTaskPlannerJob(job: AiJob): Promise<Record<string, unknown>> {
  const taskId = taskIdFrom(job);
  const startedAt = Date.now();
  const stage = "planner_execution";
  const controller = new AbortController();
  const lifecycleTimeout = setTimeout(
    () => controller.abort(),
    CODING_MULTI_TASK_PLANNER_EXECUTION_BUDGET_MS,
  );
  lifecycleTimeout.unref?.();

  await logAudit("coding-multi-task-planner", "planner_job_started", String(job.id), "ai_job", "success", {
    jobId: job.id,
    taskId,
    stage,
    timeoutBudgetMs: CODING_MULTI_TASK_PLANNER_EXECUTION_BUDGET_MS,
    retryCount: job.retryCount,
    maxRetry: job.maxRetry,
  }).catch(() => undefined);

  try {
    const result = await generateAndPersistCodingMultiTaskPlan(
      taskId,
      undefined,
      { signal: controller.signal },
    );
    await logAudit("coding-multi-task-planner", "planner_job_completed", String(job.id), "ai_job", "success", {
      jobId: job.id,
      taskId,
      stage,
      durationMs: Date.now() - startedAt,
      graphId: result.graphId,
      graphVersion: result.graphVersion,
    }).catch(() => undefined);
    return { taskId, graphId: result.graphId, graphVersion: result.graphVersion,
      graphStatus: result.graphStatus, planHash: result.planHash, nextAction: result.nextAction };
  } catch (error) {
    const errorCode =
      error instanceof AutomatedMultiTaskPlannerError
        ? error.code
        : error instanceof Error
          ? error.name
          : "UNKNOWN";
    const errorMessage =
      error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
    const errorDetails =
      error instanceof AutomatedMultiTaskPlannerError ? error.details : undefined;

    logger.error({
      jobId: job.id,
      taskId,
      stage,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
      errorDetails,
    }, "[coding-multi-task-planner] planner execution failed");

    await logAudit("coding-multi-task-planner", "planner_job_failed", String(job.id), "ai_job", "failure", {
      jobId: job.id,
      taskId,
      stage,
      durationMs: Date.now() - startedAt,
      errorCode,
      errorMessage,
      errorDetails,
      retryCount: job.retryCount,
      maxRetry: job.maxRetry,
    }).catch(() => undefined);

    throw error;
  } finally {
    clearTimeout(lifecycleTimeout);
  }
}
