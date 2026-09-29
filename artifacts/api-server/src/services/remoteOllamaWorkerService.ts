import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { aiJobsTable, aiWorkersTable, db, type AiJob, type AiWorker } from "@workspace/db";
import { registerWorker, renewLease, DEFAULT_LEASE_TTL_MS } from "./workerClusterService.js";
import { completeJob, retryJob, JobOwnershipLostError } from "./jobWorkerService.js";

export const REMOTE_OLLAMA_RUNTIME_KIND = "ollama_remote_pull";
export const REMOTE_OLLAMA_JOB_TYPE = "ollama_model_invocation";
export const REMOTE_OLLAMA_POWERSHELL_JOB_TYPE = "ollama_powershell_execution";
export const REMOTE_OLLAMA_CAPABILITY = "ollama_inference";
export const REMOTE_OLLAMA_POWERSHELL_CAPABILITY = "coding_powershell_execution";
const PROVIDER = "ollama";
const MAX_RESULT_CHARS = 256_000;
// Model invocations are bounded to 50s in the remote worker. Give completion
// bookkeeping a small grace window, then recover capacity so abandoned work
// cannot pin Economy slots indefinitely.
export const REMOTE_OLLAMA_STALE_RUNNING_MS = 70_000;

// Remote model calls are demand-driven. A failed invocation releases its slot
// and a later caller creates a fresh job instead of an automatic retry
// immediately reclaiming scarce GPU capacity.
export const REMOTE_OLLAMA_MAX_RETRY = 0;

export interface RemoteOllamaInvocationPayload {
  requestId: string;
  modelId: string;
  input: string;
  responseFormat: Record<string, unknown>;
  maxOutputTokens: number;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertRemoteOllamaEnrollmentSecret(provided: string | undefined): void {
  const expected = (process.env["OLLAMA_REMOTE_ENROLLMENT_SECRET"] ?? "").trim();
  if (!expected || expected.length < 24) throw new Error("REMOTE_OLLAMA_NOT_CONFIGURED");
  if (!provided || !safeEqual(provided.trim(), expected)) throw new Error("REMOTE_OLLAMA_UNAUTHORIZED");
}

export async function registerRemoteOllamaWorker(input: {
  workerName: string;
  nodeId: string;
  modelId: string;
  maxConcurrentJobs?: number;
  region?: string;
  version?: string;
}): Promise<AiWorker> {
  // Re-enrollment must be idempotent. A second copy of the same outbound
  // agent can overlap briefly during restart/reconnect; rotating the shared
  // heartbeat token on every registration makes both copies invalidate each
  // other forever. Reuse the existing credential for the exact same remote
  // worker identity and only create/rotate when no reusable identity exists.
  const [existing] = await db.select().from(aiWorkersTable).where(eq(aiWorkersTable.workerName, input.workerName));
  if (existing) {
    const sameIdentity =
      existing.providerSlug === PROVIDER &&
      existing.runtimeKind === REMOTE_OLLAMA_RUNTIME_KIND &&
      existing.nodeId === input.nodeId &&
      existing.modelId === input.modelId;

    if (!sameIdentity) throw new Error("REMOTE_OLLAMA_IDENTITY_CONFLICT");

    if (existing.heartbeatToken) {
      const renewed = await renewLease(existing.id, existing.heartbeatToken, DEFAULT_LEASE_TTL_MS);
      if (renewed) {
        const [reactivated] = await db.update(aiWorkersTable).set({
          status: existing.runningJobs > 0 ? "busy" : "online",
          region: input.region ?? "remote",
          version: input.version ?? "1.0.0",
          capabilities: [REMOTE_OLLAMA_CAPABILITY, REMOTE_OLLAMA_POWERSHELL_CAPABILITY],
          maxConcurrentJobs: Math.max(2, Math.min(8, input.maxConcurrentJobs ?? 2)),
          leaseOwner: "ollama-remote:" + input.nodeId,
          updatedAt: new Date(),
        }).where(eq(aiWorkersTable.id, existing.id)).returning();
        if (reactivated) return reactivated;
      }
    }
  }

  return registerWorker({
    workerName: input.workerName,
    workerType: "coding_worker",
    clusterId: "ollama",
    nodeId: input.nodeId,
    region: input.region ?? "remote",
    version: input.version ?? "1.0.0",
    capabilities: [REMOTE_OLLAMA_CAPABILITY, REMOTE_OLLAMA_POWERSHELL_CAPABILITY],
    maxConcurrentJobs: Math.max(2, Math.min(8, input.maxConcurrentJobs ?? 2)),
    leaseOwner: "ollama-remote:" + input.nodeId,
    leaseTtlMs: DEFAULT_LEASE_TTL_MS,
    providerSlug: PROVIDER,
    modelId: input.modelId,
    endpointUrl: null,
    runtimeKind: REMOTE_OLLAMA_RUNTIME_KIND,
  });
}

export async function authenticateRemoteOllamaWorker(
  workerId: number,
  token: string | undefined,
): Promise<AiWorker | null> {
  if (!token) return null;
  const [worker] = await db.select().from(aiWorkersTable).where(eq(aiWorkersTable.id, workerId));
  if (
    !worker ||
    worker.providerSlug !== PROVIDER ||
    worker.runtimeKind !== REMOTE_OLLAMA_RUNTIME_KIND ||
    !worker.heartbeatToken ||
    !safeEqual(token.trim(), worker.heartbeatToken) ||
    worker.status === "offline" ||
    worker.status === "stale"
  ) return null;
  return worker;
}

export async function heartbeatRemoteOllamaWorker(workerId: number, token: string): Promise<AiWorker | null> {
  return renewLease(workerId, token, DEFAULT_LEASE_TTL_MS);
}

export async function recoverStaleRemoteOllamaCapacity(
  modelId: string,
  staleAfterMs = REMOTE_OLLAMA_STALE_RUNNING_MS,
): Promise<number> {
  const boundedStaleMs = Math.max(60_000, Math.min(10 * 60_000, Math.floor(staleAfterMs)));

  return db.transaction(async (tx) => {
    const raw = await tx.execute(sql`
      SELECT
        id,
        NULLIF(payload_json->>'_claimedByWorkerId', '')::int AS worker_id
      FROM ai_platform.ai_jobs
      WHERE job_type = ${REMOTE_OLLAMA_JOB_TYPE}
        AND status = 'running'
        AND payload_json->>'modelId' = ${modelId}
        AND started_at IS NOT NULL
        AND started_at < NOW() - (${boundedStaleMs} * INTERVAL '1 millisecond')
      FOR UPDATE SKIP LOCKED
    `);

    const rows =
      (raw as unknown as { rows?: Array<{ id?: unknown; worker_id?: unknown }> }).rows ?? [];
    let recovered = 0;

    for (const row of rows) {
      const jobId = Number(row.id);
      const workerId = Number(row.worker_id);
      if (!Number.isInteger(jobId) || jobId <= 0) continue;

      const [updated] = await tx
        .update(aiJobsTable)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: "Remote Ollama invocation exceeded the bounded runtime and was recovered.",
          payloadJson: sql`COALESCE(payload_json, '{}'::jsonb) - '_claimedByWorkerId'`,
          updatedAt: new Date(),
        })
        .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.status, "running")))
        .returning({ id: aiJobsTable.id });

      if (!updated) continue;
      recovered += 1;

      if (Number.isInteger(workerId) && workerId > 0) {
        await tx
          .update(aiWorkersTable)
          .set({
            runningJobs: sql`GREATEST(running_jobs - 1, 0)`,
            currentJob: sql`CASE WHEN current_job = ${jobId} THEN NULL ELSE current_job END`,
            status: sql`CASE WHEN GREATEST(running_jobs - 1, 0) = 0 THEN 'idle' ELSE 'busy' END`,
            updatedAt: new Date(),
          })
          .where(eq(aiWorkersTable.id, workerId));
      }
    }

    return recovered;
  });
}

export async function hasRemoteOllamaWorker(modelId: string): Promise<boolean> {
  await recoverStaleRemoteOllamaCapacity(modelId).catch(() => 0);

  const [row] = await db.select({ id: aiWorkersTable.id }).from(aiWorkersTable).where(
    and(
      eq(aiWorkersTable.providerSlug, PROVIDER),
      eq(aiWorkersTable.runtimeKind, REMOTE_OLLAMA_RUNTIME_KIND),
      eq(aiWorkersTable.modelId, modelId),
      inArray(aiWorkersTable.status, ["online", "idle", "busy"]),
      sql`${aiWorkersTable.leaseExpiresAt} IS NOT NULL AND ${aiWorkersTable.leaseExpiresAt} > NOW()`,
    ),
  ).limit(1);
  return Boolean(row);
}

export async function enqueueRemoteOllamaInvocation(
  payload: RemoteOllamaInvocationPayload,
): Promise<AiJob> {
  const now = new Date();
  const [job] = await db.insert(aiJobsTable).values({
    jobCode: "OLLAMA-" + randomUUID().slice(0, 8).toUpperCase(),
    jobType: REMOTE_OLLAMA_JOB_TYPE,
    requiredCapability: REMOTE_OLLAMA_CAPABILITY,
    payloadJson: payload,
    priority: 70,
    priorityScore: "70",
    status: "queued",
    retryCount: 0,
    maxRetry: REMOTE_OLLAMA_MAX_RETRY,
    retryStrategy: "immediate",
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!job) throw new Error("Failed to enqueue remote Ollama invocation");
  return job;
}

export async function claimRemoteOllamaInvocation(workerId: number): Promise<AiJob | null> {
  const [candidate] = await db.select().from(aiWorkersTable).where(eq(aiWorkersTable.id, workerId));
  if (candidate?.modelId) {
    await recoverStaleRemoteOllamaCapacity(candidate.modelId).catch(() => 0);
  }

  const [worker] = await db.select().from(aiWorkersTable).where(eq(aiWorkersTable.id, workerId));
  if (
    !worker ||
    worker.providerSlug !== PROVIDER ||
    worker.runtimeKind !== REMOTE_OLLAMA_RUNTIME_KIND ||
    worker.status === "offline" ||
    worker.status === "stale" ||
    !worker.leaseExpiresAt ||
    worker.leaseExpiresAt < new Date() ||
    worker.runningJobs >= worker.maxConcurrentJobs
  ) return null;

  return db.transaction(async (tx) => {
    const raw = await tx.execute(sql`
      SELECT * FROM ai_platform.ai_jobs
      WHERE job_type IN (${REMOTE_OLLAMA_JOB_TYPE}, ${REMOTE_OLLAMA_POWERSHELL_JOB_TYPE})
        AND required_capability IN (${REMOTE_OLLAMA_CAPABILITY}, ${REMOTE_OLLAMA_POWERSHELL_CAPABILITY})
        AND (
          (status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= NOW()))
          OR (status = 'retrying' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
        )
        AND (
          (job_type = ${REMOTE_OLLAMA_JOB_TYPE} AND payload_json->>'modelId' = ${worker.modelId ?? ""})
          OR job_type = ${REMOTE_OLLAMA_POWERSHELL_JOB_TYPE}
        )
      ORDER BY priority_score DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    const row = (raw as unknown as { rows?: Record<string, unknown>[] }).rows?.[0];
    if (!row) return null;
    const job = row as unknown as AiJob;
    // Capacity admission must be atomic with the job claim. Pending jobs do
    // not consume a slot; only a worker that still has room may transition a
    // queued job to running. This also protects against overlapping claim
    // requests during worker reconnect/restart.
    const [capacity] = await tx
      .update(aiWorkersTable)
      .set({
        status: "busy",
        currentJob: job.id,
        runningJobs: sql`running_jobs + 1`,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiWorkersTable.id, workerId),
          eq(aiWorkersTable.providerSlug, PROVIDER),
          eq(aiWorkersTable.runtimeKind, REMOTE_OLLAMA_RUNTIME_KIND),
          inArray(aiWorkersTable.status, ["online", "idle", "busy"]),
          sql`${aiWorkersTable.leaseExpiresAt} IS NOT NULL AND ${aiWorkersTable.leaseExpiresAt} > NOW()`,
          sql`${aiWorkersTable.runningJobs} < ${aiWorkersTable.maxConcurrentJobs}`,
        ),
      )
      .returning({ id: aiWorkersTable.id });

    if (!capacity) return null;

    const [claimed] = await tx.update(aiJobsTable).set({
      status: "running",
      startedAt: new Date(),
      payloadJson: sql`jsonb_set(COALESCE(payload_json, '{}'::jsonb), '{_claimedByWorkerId}', to_jsonb(${workerId}::int), true)`,
      updatedAt: new Date(),
    }).where(and(eq(aiJobsTable.id, job.id), inArray(aiJobsTable.status, ["queued", "retrying"]))).returning();

    if (!claimed) {
      // The selected row is locked by this transaction, so this is defensive.
      // Throwing rolls back the slot reservation rather than leaking capacity.
      throw new Error("REMOTE_OLLAMA_CLAIM_RACE");
    }

    return claimed;
  });
}

export async function completeRemoteOllamaInvocation(
  workerId: number,
  jobId: number,
  result: Record<string, unknown>,
): Promise<AiJob> {
  const chars = JSON.stringify(result).length;
  if (chars > MAX_RESULT_CHARS) throw new Error("REMOTE_OLLAMA_RESULT_TOO_LARGE");
  return completeJob(jobId, workerId, result);
}

export async function retryRemoteOllamaInvocation(
  workerId: number,
  jobId: number,
  errorMessage: string,
): Promise<AiJob> {
  return retryJob(jobId, workerId, errorMessage.slice(0, 2_000));
}

async function cancelRemoteOllamaInvocation(jobId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(aiJobsTable)
      .where(eq(aiJobsTable.id, jobId));

    if (
      !job ||
      !["queued", "waiting", "retrying", "running"].includes(job.status)
    ) {
      return;
    }

    const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
    const claimedWorkerId = Number(payload["_claimedByWorkerId"]);

    const [cancelled] = await tx
      .update(aiJobsTable)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        errorMessage: "Remote Ollama invocation cancelled because the caller deadline expired.",
        payloadJson: sql`COALESCE(payload_json, '{}'::jsonb) - '_claimedByWorkerId'`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiJobsTable.id, jobId),
          inArray(aiJobsTable.status, ["queued", "waiting", "retrying", "running"]),
        ),
      )
      .returning({ id: aiJobsTable.id });

    if (
      cancelled &&
      job.status === "running" &&
      Number.isInteger(claimedWorkerId) &&
      claimedWorkerId > 0
    ) {
      await tx
        .update(aiWorkersTable)
        .set({
          runningJobs: sql`GREATEST(running_jobs - 1, 0)`,
          currentJob: sql`CASE WHEN current_job = ${jobId} THEN NULL ELSE current_job END`,
          status: sql`CASE WHEN GREATEST(running_jobs - 1, 0) = 0 THEN 'idle' ELSE 'busy' END`,
          updatedAt: new Date(),
        })
        .where(eq(aiWorkersTable.id, claimedWorkerId));
    }
  });
}

export async function waitForRemoteOllamaInvocation(
  jobId: number,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  while (!signal.aborted) {
    const [job] = await db.select().from(aiJobsTable).where(eq(aiJobsTable.id, jobId));
    if (!job) throw new Error("Remote Ollama invocation disappeared");
    if (job.status === "completed") return (job.resultJson ?? {}) as Record<string, unknown>;
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.errorMessage || "Remote Ollama invocation failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // The model adapter's bounded timeout previously abandoned the queue row.
  // Repeated Economy retries could therefore occupy every remote worker slot
  // even though their HTTP callers had already returned NO_LLM. Cancel the
  // orphaned row and release only its claimed slot, preserving concurrent jobs.
  await cancelRemoteOllamaInvocation(jobId).catch(() => undefined);
  throw new Error("Remote Ollama invocation cancelled");
}

export async function enqueueRemotePowerShellSelfTest(workerId: number): Promise<AiJob> {
  const [worker] = await db.select().from(aiWorkersTable).where(eq(aiWorkersTable.id, workerId));
  if (
    !worker ||
    worker.providerSlug !== PROVIDER ||
    worker.runtimeKind !== REMOTE_OLLAMA_RUNTIME_KIND
  ) {
    throw new Error("REMOTE_OLLAMA_SELF_TEST_WORKER_INVALID");
  }

  return enqueueRemotePowerShellExecution({
    commands: ["git rev-parse HEAD", "pnpm --version"],
    requestedBy: `worker-self-test:${workerId}`,
    modelId: worker.modelId ?? "qwen2.5-coder:7b",
    reason: "Verify production queue to registered Windows worker trusted PowerShell execution.",
  });
}

export async function enqueueRemotePowerShellExecution(input: {
  commands: string[];
  requestedBy: string;
  modelId: string;
  reason: string;
}): Promise<AiJob> {
  const now = new Date();
  const [job] = await db.insert(aiJobsTable).values({
    jobCode: "PS-" + randomUUID().slice(0, 8).toUpperCase(),
    jobType: REMOTE_OLLAMA_POWERSHELL_JOB_TYPE,
    requiredCapability: REMOTE_OLLAMA_POWERSHELL_CAPABILITY,
    payloadJson: {
      commands: input.commands,
      requestedBy: input.requestedBy,
      modelId: input.modelId,
      reason: input.reason,
    },
    priority: 85,
    priorityScore: "85",
    status: "queued",
    retryCount: 0,
    maxRetry: 0,
    retryStrategy: "immediate",
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!job) throw new Error("Failed to enqueue remote PowerShell execution");
  return job;
}

export async function waitForRemotePowerShellExecution(
  jobId: number,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  return waitForRemoteOllamaInvocation(jobId, signal);
}

export { JobOwnershipLostError };
