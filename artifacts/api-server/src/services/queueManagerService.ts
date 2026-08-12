/**
 * Queue Manager Service — Phase 5 Job Queue
 *
 * enqueue()       — create & register a new job in the queue
 * dequeue()       — return highest-priority queued job (no claim)
 * peek()          — look at top N jobs without mutating
 * pauseQueue()    — move queued → waiting for matching jobs
 * resumeQueue()   — move waiting → queued for matching jobs
 * cancelQueue()   — cancel all queued/waiting matching jobs
 * reprioritize()  — update a job's base priority and recompute score
 */

import { eq, and, or, inArray, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, aiJobsTable, aiExecutionPlansTable, aiDepartmentsTable } from "@workspace/db";
import type { InsertAiJob } from "@workspace/db";
import { computePriorityScore } from "./priorityEngine.js";
import { logAudit } from "./aiAuditService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnqueueJobInput {
  jobType: string;
  payloadJson?: Record<string, unknown>;
  /** Canonical worker capability persisted on ai_jobs.required_capability. */
  requiredCapability?: string;
  priority?: number;
  executionPlanId?: number | null;
  departmentId?: number | null;
  employeeId?: number | null;
  scheduledAt?: Date | null;
  maxRetry?: number;
  retryStrategy?: "immediate" | "exponential" | "manual";
  estimatedCost?: number | null;
  estimatedDuration?: number | null;
  managerOverride?: number | null;
  /**
   * WP-06 — server-resolved tenant that owns this job. Stamped into
   * payloadJson as `_tenantId` so workers can reconstruct context without
   * a DB round-trip. Must be a server-validated value, never taken from
   * unverified client input.
   */
  tenantId?: string;
}

export interface QueueFilter {
  departmentId?: number;
  jobType?: string;
  status?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveFactors(input: EnqueueJobInput) {
  let execPlanPriority: string | undefined;
  let deptPriority: number | undefined;

  if (input.executionPlanId) {
    const [plan] = await db
      .select({ priority: aiExecutionPlansTable.priority })
      .from(aiExecutionPlansTable)
      .where(eq(aiExecutionPlansTable.id, input.executionPlanId));
    execPlanPriority = plan?.priority ?? undefined;
  }

  if (input.departmentId) {
    const [dept] = await db
      .select({ priority: sql<number>`COALESCE(priority, 50)::int` })
      .from(aiDepartmentsTable)
      .where(eq(aiDepartmentsTable.id, input.departmentId));
    deptPriority = dept ? Number(dept.priority) : undefined;
  }

  return { execPlanPriority, deptPriority };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function enqueue(input: EnqueueJobInput) {
  const { execPlanPriority, deptPriority } = await resolveFactors(input);

  const now = new Date();
  const score = computePriorityScore({
    basePriority:          input.priority ?? 50,
    executionPlanPriority: execPlanPriority,
    departmentPriority:    deptPriority,
    createdAt:             now,
    scheduledAt:           input.scheduledAt,
    retryCount:            0,
    managerOverride:       input.managerOverride,
  });

  const jobCode = `JOB-${randomUUID().slice(0, 8).toUpperCase()}`;

  // WP-06 — Stamp server-resolved tenantId into payloadJson so workers can
  // reconstruct RequestContext without a DB round-trip. The reserved key
  // `_tenantId` is never read from client input — it is always written here.
  const payloadJson: Record<string, unknown> = {
    ...(input.payloadJson ?? {}),
    ...(input.tenantId ? { _tenantId: input.tenantId } : {}),
  };

  const insert: InsertAiJob = {
    jobCode,
    jobType:           input.jobType,
    requiredCapability: input.requiredCapability ?? null,
    payloadJson,
    priority:          input.priority ?? 50,
    priorityScore:     String(score),
    executionPlanId:   input.executionPlanId ?? null,
    departmentId:      input.departmentId ?? null,
    employeeId:        input.employeeId ?? null,
    scheduledAt:       input.scheduledAt ?? null,
    maxRetry:          input.maxRetry ?? 3,
    retryStrategy:     input.retryStrategy ?? "exponential",
    estimatedCost:     input.estimatedCost != null ? String(input.estimatedCost) : null,
    estimatedDuration: input.estimatedDuration ?? null,
    managerOverride:   input.managerOverride ?? null,
    status:            "queued",
    retryCount:        0,
  };

  const [job] = await db.insert(aiJobsTable).values(insert).returning();

  await logAudit(
    "job-engine",
    "job_enqueued",
    String(job.id),
    "ai_job",
    "success",
    { jobCode, jobType: input.jobType, score },
  );

  return job;
}

export async function dequeue() {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(
      and(
        eq(aiJobsTable.status, "queued"),
        or(
          sql`${aiJobsTable.scheduledAt} IS NULL`,
          sql`${aiJobsTable.scheduledAt} <= NOW()`,
        ),
      ),
    )
    .orderBy(desc(aiJobsTable.priorityScore), aiJobsTable.createdAt)
    .limit(1);

  return job ?? null;
}

export async function peek(n = 10) {
  return db
    .select()
    .from(aiJobsTable)
    .where(
      and(
        inArray(aiJobsTable.status, ["queued", "waiting"]),
        or(
          sql`${aiJobsTable.scheduledAt} IS NULL`,
          sql`${aiJobsTable.scheduledAt} <= NOW()`,
        ),
      ),
    )
    .orderBy(desc(aiJobsTable.priorityScore), aiJobsTable.createdAt)
    .limit(n);
}

export async function pauseQueue(filter?: QueueFilter) {
  const conditions = [eq(aiJobsTable.status, "queued")];
  if (filter?.departmentId) conditions.push(eq(aiJobsTable.departmentId, filter.departmentId));
  if (filter?.jobType) conditions.push(eq(aiJobsTable.jobType, filter.jobType));

  const result = await db
    .update(aiJobsTable)
    .set({ status: "waiting", updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: aiJobsTable.id });

  await logAudit("job-engine", "queue_paused", "system", "ai_job", "success", {
    count: result.length,
    filter,
  });

  return result.length;
}

export async function resumeQueue(filter?: QueueFilter) {
  const conditions = [eq(aiJobsTable.status, "waiting")];
  if (filter?.departmentId) conditions.push(eq(aiJobsTable.departmentId, filter.departmentId));
  if (filter?.jobType) conditions.push(eq(aiJobsTable.jobType, filter.jobType));

  const result = await db
    .update(aiJobsTable)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: aiJobsTable.id });

  await logAudit("job-engine", "queue_resumed", "system", "ai_job", "success", {
    count: result.length,
    filter,
  });

  return result.length;
}

export async function cancelQueue(filter?: QueueFilter) {
  const statuses = ["queued", "waiting"];
  const conditions = [inArray(aiJobsTable.status, statuses)];
  if (filter?.departmentId) conditions.push(eq(aiJobsTable.departmentId, filter.departmentId));
  if (filter?.jobType) conditions.push(eq(aiJobsTable.jobType, filter.jobType));

  const result = await db
    .update(aiJobsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: aiJobsTable.id });

  await logAudit("job-engine", "queue_cancelled", "system", "ai_job", "success", {
    count: result.length,
    filter,
  });

  return result.length;
}

export async function reprioritize(
  jobId: number,
  newPriority: number,
  managerOverride?: number | null,
) {
  const [existing] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, jobId));

  if (!existing) throw new Error(`Job ${jobId} not found`);

  const { execPlanPriority, deptPriority } = await resolveFactors({
    jobType: existing.jobType,
    priority: newPriority,
    executionPlanId: existing.executionPlanId,
    departmentId: existing.departmentId,
    scheduledAt: existing.scheduledAt,
    managerOverride: managerOverride ?? existing.managerOverride,
  });

  const score = computePriorityScore({
    basePriority:          newPriority,
    executionPlanPriority: execPlanPriority,
    departmentPriority:    deptPriority,
    createdAt:             existing.createdAt,
    scheduledAt:           existing.scheduledAt,
    retryCount:            existing.retryCount,
    managerOverride:       managerOverride ?? existing.managerOverride,
  });

  const [updated] = await db
    .update(aiJobsTable)
    .set({
      priority:       newPriority,
      priorityScore:  String(score),
      managerOverride: managerOverride !== undefined ? managerOverride : existing.managerOverride,
      updatedAt:      new Date(),
    })
    .where(eq(aiJobsTable.id, jobId))
    .returning();

  await logAudit("job-engine", "job_reprioritized", String(jobId), "ai_job", "success", {
    oldPriority: existing.priority,
    newPriority,
    newScore: score,
  });

  return updated;
}
