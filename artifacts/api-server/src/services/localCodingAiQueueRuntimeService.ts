import { randomUUID } from "node:crypto";
import { aiJobsTable, db, type AiJob, type AiCodingRun } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { logAudit } from "./aiAuditService.js";
import { computePriorityScore } from "./priorityEngine.js";
import { assertApprovedAiHandoffFresh } from "./localCodingAiHandoffService.js";
import { runAiExecutionToCompletion } from "./localCodingAiExecutionGateService.js";

export const CODING_AI_EXECUTION_JOB_TYPE = "coding_ai_execution";
export const CODING_AI_EXECUTION_CAPABILITY = "coding_ai_execution";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

export interface EnqueueCodingAiExecutionOptions {
  priority?: number;
  tenantId?: string;
  requestedBy?: string;
  expectedPackageHash: string;
}

export interface CodingAiExecutionJobPayload {
  taskId: string;
  packageHash: string;
  requestedBy?: string;
}

function clampPriority(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

export function parseCodingAiExecutionJobPayload(
  value: unknown,
): CodingAiExecutionJobPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("coding_ai_execution payload must be an object");
  }

  const record = value as Record<string, unknown>;
  const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
  if (!UUID_RE.test(taskId)) {
    throw new Error("coding_ai_execution payload taskId must be a UUID");
  }

  const packageHash =
    typeof record.packageHash === "string"
      ? record.packageHash.trim().toLowerCase()
      : "";
  if (!SHA256_RE.test(packageHash)) {
    throw new Error("coding_ai_execution payload packageHash must be SHA-256");
  }

  const requestedBy =
    typeof record.requestedBy === "string" && record.requestedBy.trim()
      ? record.requestedBy.trim().slice(0, 200)
      : undefined;

  return {
    taskId,
    packageHash,
    ...(requestedBy ? { requestedBy } : {}),
  };
}

async function findExistingCodingAiExecutionJob(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  taskId: string,
): Promise<AiJob | null> {
  const [existing] = await tx
    .select()
    .from(aiJobsTable)
    .where(
      and(
        eq(aiJobsTable.jobType, CODING_AI_EXECUTION_JOB_TYPE),
        inArray(aiJobsTable.status, ["queued", "waiting", "running", "retrying"]),
        sql`${aiJobsTable.payloadJson}->>'taskId' = ${taskId}`,
      ),
    )
    .orderBy(desc(aiJobsTable.id))
    .limit(1);

  return existing ?? null;
}

export async function enqueueCodingAiExecution(
  taskId: string,
  options: EnqueueCodingAiExecutionOptions,
) {
  const payload = parseCodingAiExecutionJobPayload({
    taskId,
    packageHash: options.expectedPackageHash,
    requestedBy: options.requestedBy,
  });
  const priority = clampPriority(options.priority);
  const lockKey = `${CODING_AI_EXECUTION_JOB_TYPE}:${payload.taskId}`;

  const result = await db.transaction(async (tx) => {
    // Serialize active-job discovery + insertion for this task. This closes
    // the concurrent double-click race without introducing a global lock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
    );

    const existing = await findExistingCodingAiExecutionJob(tx, payload.taskId);
    if (existing) {
      return { job: existing, created: false };
    }

    const now = new Date();
    const score = computePriorityScore({
      basePriority: priority,
      createdAt: now,
      retryCount: 0,
    });
    const jobCode = `JOB-${randomUUID().slice(0, 8).toUpperCase()}`;
    const payloadJson: Record<string, unknown> = {
      taskId: payload.taskId,
      packageHash: payload.packageHash,
      ...(payload.requestedBy ? { requestedBy: payload.requestedBy } : {}),
      ...(options.tenantId ? { _tenantId: options.tenantId } : {}),
    };

    const [job] = await tx
      .insert(aiJobsTable)
      .values({
        jobCode,
        jobType: CODING_AI_EXECUTION_JOB_TYPE,
        requiredCapability: CODING_AI_EXECUTION_CAPABILITY,
        payloadJson,
        priority,
        priorityScore: String(score),
        maxRetry: 0,
        retryStrategy: "manual",
        status: "queued",
        retryCount: 0,
      })
      .returning();

    if (!job) {
      throw new Error("Failed to create constrained AI execution job");
    }

    return { job, created: true };
  });

  if (result.created) {
    await logAudit(
      "coding-orchestrator",
      "ai_execution_job_enqueued",
      String(result.job.id),
      "ai_job",
      "success",
      {
        taskId: payload.taskId,
        packageHash: payload.packageHash,
        jobCode: result.job.jobCode,
        maxRetry: 0,
        retryStrategy: "manual",
      },
    ).catch(() => undefined);
  }

  return result.job;
}

function terminalRunResult(
  job: AiJob,
  taskId: string,
  run: AiCodingRun,
): Record<string, unknown> {
  return {
    jobId: job.id,
    taskId,
    codingRunId: run.id,
    codingRunStatus: run.status,
    agentName: run.agentName,
    completed: run.status === "COMPLETED",
  };
}

export async function executeCodingAiExecutionJob(
  job: AiJob,
): Promise<Record<string, unknown>> {
  const payload = parseCodingAiExecutionJobPayload(job.payloadJson);

  // A delayed job may only consume the exact explicitly approved package
  // that was bound when the HTTP request enqueued it.
  const freshLease = await assertApprovedAiHandoffFresh(payload.taskId);
  if (freshLease.packageHash.toLowerCase() !== payload.packageHash) {
    throw new Error(
      "Queued constrained AI execution package no longer matches the approved handoff",
    );
  }

  const run = await runAiExecutionToCompletion(payload.taskId);

  if (run.status !== "COMPLETED") {
    throw new Error(
      `Constrained coding execution ended with status '${run.status}' for task ${payload.taskId}`,
    );
  }

  return terminalRunResult(job, payload.taskId, run);
}
