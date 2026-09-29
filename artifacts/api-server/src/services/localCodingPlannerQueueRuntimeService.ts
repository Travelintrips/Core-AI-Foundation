import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiJobsTable, db, type AiJob } from "@workspace/db";
import { generateAndPersistCodingMultiTaskPlan } from "./localCodingAutomatedMultiTaskPlannerService.js";

export const CODING_MULTI_TASK_PLANNER_JOB_TYPE = "coding_multi_task_planner";

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
  const result = await generateAndPersistCodingMultiTaskPlan(taskId);
  return { taskId, graphId: result.graphId, graphVersion: result.graphVersion,
    graphStatus: result.graphStatus, planHash: result.planHash, nextAction: result.nextAction };
}
