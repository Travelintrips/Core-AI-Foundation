
import { eq, sql } from "drizzle-orm";
import { aiWorkersTable, db, type AiWorker } from "@workspace/db";
import {
  DEFAULT_LEASE_TTL_MS,
  registerWorker,
  releaseLease,
  renewLease,
  MAX_ACTIVE_JOBS_PER_WORKER,
} from "./workerClusterService.js";
import { logAudit } from "./aiAuditService.js";
import {
  REMOTE_OLLAMA_CAPABILITY,
  REMOTE_OLLAMA_RUNTIME_KIND,
} from "./remoteOllamaWorkerService.js";

export const OLLAMA_WORKER_PROVIDER = "ollama";
export const OLLAMA_WORKER_RUNTIME_KIND = "ollama_worker";
export const OLLAMA_INFERENCE_CAPABILITY = "ollama_inference";
export const OLLAMA_CODING_CAPABILITY = "coding_ai_execution";
export const OLLAMA_POWERSHELL_CAPABILITY = "coding_powershell_execution";

const DEFAULT_MODEL = "qwen2.5-coder:7b";
const OLLAMA_RESERVATION_STALE_MS = 360_000;
const RELEASE_RETRY_DELAYS_MS = [0, 150, 500] as const;

export interface RegisterOllamaWorkerInput {
  workerName: string;
  nodeId: string;
  endpointUrl: string;
  modelId?: string;
  clusterId?: string;
  region?: string;
  version?: string;
  maxConcurrentJobs?: number;
  leaseOwner?: string;
  leaseTtlMs?: number;
  powershellExecution?: boolean;
}

export interface OllamaWorkerAvailability {
  id: number;
  workerName: string;
  modelId: string;
  endpointUrl: string;
  availableSlots: number;
}

export interface OllamaWorkerReservation extends OllamaWorkerAvailability {
  reservedAt: string;
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isPrivateIpv6(host: string): boolean {
  const value = host.toLowerCase();
  return (
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:")
  );
}

function explicitAllowedHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env["OLLAMA_WORKER_ALLOWED_HOSTS"] ?? "")
      .split(",")
      .map(normalizeHost)
      .filter(Boolean),
  );
}

export function normalizeOllamaWorkerEndpoint(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Ollama worker endpoint must be a valid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Ollama worker endpoint must use http or https.");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "Ollama worker endpoint must not contain credentials, query, or fragment.",
    );
  }

  const host = normalizeHost(parsed.hostname);
  const explicitlyAllowed = explicitAllowedHosts(env).has(host);
  const privateHost =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateIpv4(host) ||
    isPrivateIpv6(host);

  if (!privateHost && !explicitlyAllowed) {
    throw new Error(
      "Ollama worker endpoint must be private/loopback or explicitly listed in OLLAMA_WORKER_ALLOWED_HOSTS.",
    );
  }

  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/") pathname = "/v1";
  if (pathname !== "/v1") {
    throw new Error(
      "Ollama worker endpoint must target the OpenAI-compatible /v1 base path.",
    );
  }

  parsed.pathname = pathname;
  return parsed.toString().replace(/\/$/, "");
}

function clampConcurrency(_value: number | undefined): number {
  return MAX_ACTIVE_JOBS_PER_WORKER;
}

export async function registerOllamaWorker(
  input: RegisterOllamaWorkerInput,
): Promise<AiWorker> {
  const modelId = (input.modelId || DEFAULT_MODEL).trim();
  if (!modelId || modelId.length > 300 || /[\r\n\0]/.test(modelId)) {
    throw new Error("Ollama worker modelId is invalid.");
  }

  const endpointUrl = normalizeOllamaWorkerEndpoint(input.endpointUrl);
  const worker = await registerWorker({
    workerName: input.workerName.trim(),
    workerType: "coding_worker",
    clusterId: input.clusterId ?? "ollama",
    nodeId: input.nodeId.trim(),
    region: input.region ?? "local",
    version: input.version ?? "1.0.0",
    capabilities: [
      OLLAMA_INFERENCE_CAPABILITY,
      OLLAMA_CODING_CAPABILITY,
      ...(input.powershellExecution ? [OLLAMA_POWERSHELL_CAPABILITY] : []),
    ],
    maxConcurrentJobs: clampConcurrency(input.maxConcurrentJobs),
    leaseOwner: input.leaseOwner ?? "ollama:" + input.nodeId.trim(),
    leaseTtlMs: input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
    providerSlug: OLLAMA_WORKER_PROVIDER,
    modelId,
    endpointUrl,
    runtimeKind: OLLAMA_WORKER_RUNTIME_KIND,
  });

  await logAudit(
    "ollama-worker",
    "ollama_worker_registered",
    String(worker.id),
    "ai_worker",
    "success",
    {
      workerName: worker.workerName,
      modelId,
      endpointUrl,
      maxConcurrentJobs: worker.maxConcurrentJobs,
      powershellExecution: input.powershellExecution === true,
    },
  ).catch(() => undefined);

  return worker;
}

export async function heartbeatOllamaWorker(
  workerId: number,
  heartbeatToken: string,
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
): Promise<AiWorker | null> {
  return renewLease(workerId, heartbeatToken, leaseTtlMs);
}

export async function shutdownOllamaWorker(
  workerId: number,
  heartbeatToken: string,
): Promise<void> {
  await releaseLease(workerId, heartbeatToken);
}

export async function recoverOllamaWorkerCapacityOnRuntimeStart(
  workerName: string,
): Promise<number> {
  const normalizedWorkerName = workerName.trim();
  if (!normalizedWorkerName) return 0;

  const raw = await db.execute(sql`
    UPDATE ai_platform.ai_workers
    SET
      running_jobs = 0,
      status = CASE
        WHEN status IN ('online', 'idle', 'busy') THEN 'idle'
        ELSE status
      END,
      updated_at = NOW()
    WHERE worker_name = ${normalizedWorkerName}
      AND provider_slug = ${OLLAMA_WORKER_PROVIDER}
      AND runtime_kind = ${OLLAMA_WORKER_RUNTIME_KIND}
      AND running_jobs > 0
    RETURNING id
  `);

  const recovered =
    (raw as unknown as { rows?: Array<{ id?: unknown }> }).rows?.length ?? 0;

  if (recovered > 0) {
    await logAudit(
      "ollama-worker",
      "ollama_worker_capacity_recovered_on_runtime_start",
      normalizedWorkerName,
      "ai_worker",
      "success",
      { recoveredWorkers: recovered },
    ).catch(() => undefined);
  }

  return recovered;
}

function availabilityFromRow(
  row: Record<string, unknown>,
): OllamaWorkerAvailability | null {
  const id = Number(row["id"]);
  const workerName =
    typeof row["worker_name"] === "string" ? row["worker_name"] : "";
  const modelId = typeof row["model_id"] === "string" ? row["model_id"] : "";
  const endpointUrl =
    typeof row["endpoint_url"] === "string" ? row["endpoint_url"] : "";
  const runningJobs = Number(row["running_jobs"] ?? 0);

  if (!Number.isInteger(id) || id <= 0 || !workerName || !modelId || !endpointUrl) {
    return null;
  }

  return {
    id,
    workerName,
    modelId,
    endpointUrl,
    availableSlots: Math.max(0, MAX_ACTIVE_JOBS_PER_WORKER - runningJobs),
  };
}

export async function getAvailableOllamaCodingSlots(): Promise<number> {
  const raw = await db.execute(sql`
    SELECT COALESCE(
      SUM(GREATEST(${MAX_ACTIVE_JOBS_PER_WORKER} - running_jobs, 0)),
      0
    ) AS available_slots
    FROM ai_platform.ai_workers
    WHERE provider_slug = ${OLLAMA_WORKER_PROVIDER}
      AND status IN ('online', 'idle', 'busy')
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > NOW()
      AND (
        (
          runtime_kind = ${OLLAMA_WORKER_RUNTIME_KIND}
          AND endpoint_url IS NOT NULL
          AND capabilities @> ${JSON.stringify([
            OLLAMA_INFERENCE_CAPABILITY,
            OLLAMA_CODING_CAPABILITY,
          ])}::jsonb
        )
        OR
        (
          runtime_kind = ${REMOTE_OLLAMA_RUNTIME_KIND}
          AND endpoint_url IS NULL
          AND capabilities @> ${JSON.stringify([
            REMOTE_OLLAMA_CAPABILITY,
          ])}::jsonb
        )
      )
  `);

  const value =
    (raw as unknown as { rows?: Array<{ available_slots?: unknown }> })
      .rows?.[0]?.available_slots;
  const slots = Number(value ?? 0);

  return Number.isFinite(slots) && slots > 0
    ? Math.floor(slots)
    : 0;
}

export async function getOllamaWorkerAvailability(
  modelId: string,
): Promise<OllamaWorkerAvailability | null> {
  const raw = await db.execute(sql`
    SELECT
      id,
      worker_name,
      model_id,
      endpoint_url,
      max_concurrent_jobs,
      running_jobs
    FROM ai_platform.ai_workers
    WHERE provider_slug = ${OLLAMA_WORKER_PROVIDER}
      AND runtime_kind = ${OLLAMA_WORKER_RUNTIME_KIND}
      AND model_id = ${modelId}
      AND endpoint_url IS NOT NULL
      AND status IN ('online', 'idle', 'busy')
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > NOW()
      AND running_jobs < ${MAX_ACTIVE_JOBS_PER_WORKER}
      AND capabilities @> ${JSON.stringify([OLLAMA_INFERENCE_CAPABILITY])}::jsonb
    ORDER BY
      (running_jobs::numeric / GREATEST(max_concurrent_jobs, 1)) ASC,
      average_latency ASC NULLS LAST,
      id ASC
    LIMIT 1
  `);

  const row =
    (raw as unknown as { rows?: Record<string, unknown>[] }).rows?.[0];

  return row ? availabilityFromRow(row) : null;
}

async function attemptReserveOllamaWorker(
  modelId: string,
): Promise<OllamaWorkerReservation | null> {
  return db.transaction(async (tx) => {
    const raw = await tx.execute(sql`
      SELECT
        id,
        worker_name,
        model_id,
        endpoint_url,
        max_concurrent_jobs,
        running_jobs
      FROM ai_platform.ai_workers
      WHERE provider_slug = ${OLLAMA_WORKER_PROVIDER}
        AND runtime_kind = ${OLLAMA_WORKER_RUNTIME_KIND}
        AND model_id = ${modelId}
        AND endpoint_url IS NOT NULL
        AND status IN ('online', 'idle', 'busy')
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at > NOW()
        AND running_jobs < ${MAX_ACTIVE_JOBS_PER_WORKER}
        AND capabilities @> ${JSON.stringify([OLLAMA_INFERENCE_CAPABILITY])}::jsonb
      ORDER BY
        (running_jobs::numeric / GREATEST(max_concurrent_jobs, 1)) ASC,
        average_latency ASC NULLS LAST,
        id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const row =
      (raw as unknown as { rows?: Record<string, unknown>[] }).rows?.[0];
    const available = row ? availabilityFromRow(row) : null;
    if (!available) return null;

    await tx
      .update(aiWorkersTable)
      .set({
        runningJobs: sql`running_jobs + 1`,
        status: "busy",
        updatedAt: new Date(),
      })
      .where(eq(aiWorkersTable.id, available.id));

    return {
      ...available,
      availableSlots: Math.max(0, available.availableSlots - 1),
      reservedAt: new Date().toISOString(),
    };
  });
}

export async function recoverStaleOllamaReservations(
  modelId: string,
  staleAfterMs = OLLAMA_RESERVATION_STALE_MS,
): Promise<number> {
  const boundedStaleMs = Math.max(300_000, Math.min(3_600_000, Math.floor(staleAfterMs)));
  const raw = await db.execute(sql`
    UPDATE ai_platform.ai_workers
    SET
      running_jobs = 0,
      status = 'idle',
      updated_at = NOW()
    WHERE provider_slug = ${OLLAMA_WORKER_PROVIDER}
      AND runtime_kind = ${OLLAMA_WORKER_RUNTIME_KIND}
      AND model_id = ${modelId}
      AND running_jobs > 0
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > NOW()
      AND updated_at < NOW() - (${boundedStaleMs} * INTERVAL '1 millisecond')
    RETURNING id
  `);

  return (raw as unknown as { rows?: Array<{ id?: unknown }> }).rows?.length ?? 0;
}

export async function reserveOllamaWorker(
  modelId: string,
): Promise<OllamaWorkerReservation | null> {
  const first = await attemptReserveOllamaWorker(modelId);
  if (first) return first;

  const recovered = await recoverStaleOllamaReservations(modelId).catch(() => 0);
  if (recovered <= 0) return null;

  return attemptReserveOllamaWorker(modelId);
}

export async function releaseOllamaWorkerReservation(
  workerId: number,
  outcome: "success" | "failure",
  latencyMs: number,
): Promise<void> {
  const boundedLatency = Math.max(
    0,
    Math.min(86_400_000, Math.floor(latencyMs)),
  );

  let lastError: unknown;
  for (const delayMs of RELEASE_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      await db.execute(sql`
        UPDATE ai_platform.ai_workers
        SET
          running_jobs = GREATEST(running_jobs - 1, 0),
          status = CASE
            WHEN GREATEST(running_jobs - 1, 0) = 0 THEN 'idle'
            ELSE 'busy'
          END,
          completed_today =
            completed_today + ${outcome === "success" ? 1 : 0},
          failed_today =
            failed_today + ${outcome === "failure" ? 1 : 0},
          average_latency = CASE
            WHEN average_latency IS NULL THEN ${boundedLatency}
            ELSE ROUND((average_latency::numeric + ${boundedLatency}) / 2, 2)
          END,
          updated_at = NOW()
        WHERE id = ${workerId}
      `);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to release Ollama worker reservation after retries");
}
