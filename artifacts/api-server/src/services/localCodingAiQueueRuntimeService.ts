import { aiJobsTable, db, type AiJob, type AiCodingRun } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { enqueue } from "./queueManagerService.js";
import { runAiExecutionToCompletion } from "./localCodingAiExecutionGateService.js";

export const CODING_AI_EXECUTION_JOB_TYPE = "coding_ai_execution";
export const CODING_AI_EXECUTION_CAPABILITY = "coding_ai_execution";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EnqueueCodingAiExecutionOptions {
  priority?: number;
  tenantId?: string;
  requestedBy?: string;
}

export interface CodingAiExecutionJobPayload {
  taskId: string;
  requestedBy?: string;
}

export interface CodingAiExecutionJobStatus {
  id: number;
  jobCode: string;
  status: string;
  jobType: string;
  requiredCapability: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

function toJobStatus(job: AiJob): CodingAiExecutionJobStatus {
  return {
    id: job.id,
    jobCode: job.jobCode,
    status: job.status,
    jobType: job.jobType,
    requiredCapability: job.requiredCapability ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage ?? null,
  };
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

  const requestedBy =
    typeof record.requestedBy === "string" && record.requestedBy.trim()
      ? record.requestedBy.trim().slice(0, 200)
      : undefined;

  return {
    taskId,
    ...(requestedBy ? { requestedBy } : {}),
  };
}

export async function getLatestCodingAiExecutionJob(
  taskId: string,
): Promise<CodingAiExecutionJobStatus | null> {
  const payload = parseCodingAiExecutionJobPayload({ taskId });
  const [latest] = await db
    .select()
    .from(aiJobsTable)
    .where(
      and(
        eq(aiJobsTable.jobType, CODING_AI_EXECUTION_JOB_TYPE),
        sql`${aiJobsTable.payloadJson}->>'taskId' = ${payload.taskId}`,
      ),
    )
    .orderBy(desc(aiJobsTable.id))
    .limit(1);

  return latest ? toJobStatus(latest) : null;
}

async function findExistingCodingAiExecutionJob(
  taskId: string,
): Promise<AiJob | null> {
  const [existing] = await db
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
  options: EnqueueCodingAiExecutionOptions = {},
) {
  const payload = parseCodingAiExecutionJobPayload({
    taskId,
    requestedBy: options.requestedBy,
  });

  const existing = await findExistingCodingAiExecutionJob(payload.taskId);
  if (existing) return existing;

  return enqueue({
    jobType: CODING_AI_EXECUTION_JOB_TYPE,
    requiredCapability: CODING_AI_EXECUTION_CAPABILITY,
    payloadJson: {
      taskId: payload.taskId,
      ...(payload.requestedBy ? { requestedBy: payload.requestedBy } : {}),
    },
    priority: clampPriority(options.priority),
    tenantId: options.tenantId,
    // Model privilege is one-shot. Generic queue retry must never invoke a
    // second model call automatically after a consumed handoff.
    maxRetry: 0,
    retryStrategy: "manual",
  });
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
  const run = await runAiExecutionToCompletion(payload.taskId);

  if (run.status !== "COMPLETED") {
    throw new Error(
      `Constrained coding execution ended with status '${run.status}' for task ${payload.taskId}`,
    );
  }

  return terminalRunResult(job, payload.taskId, run);
}
