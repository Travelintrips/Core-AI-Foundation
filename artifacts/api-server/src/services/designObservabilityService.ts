/**
 * designObservabilityService.ts — Team 35 Design Observability & Operations
 *
 * Provides real metrics, health status, and rule-based incident detection for
 * the Universal Design Platform. Reads existing tables — no second source of truth.
 *
 * Contract types are exported here and consumed by routes and tests.
 */

import { sql, and, gte, lte, eq } from "drizzle-orm";
import {
  db,
  aiJobsTable,
  aiWorkersTable,
  aiExecutionLogsTable,
  aiCostRecordsTable,
  aiAuditLogsTable,
  aiEventsTable,
  creativeRenderSessionsTable,
  designRenderZipExportsTable,
} from "@workspace/db";

// ── Contract Types ────────────────────────────────────────────────────────────

export type DesignHealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";

export interface DesignOperationMetric {
  name: string;
  value: number | null;
  unit: string;
  windowHours: number;
  recordedAt: string;
}

export interface DesignOperationEvent {
  id: string;
  eventType: string;
  actor: string | null;
  resourceType: string | null;
  resourceId: string | null;
  summary: string;
  correlationId: string | null;
  occurredAt: string;
}

export interface DesignWorkflowHealth {
  workflowId: string;
  name: string;
  status: DesignHealthStatus;
  successRate: number | null;
  avgLatencyMs: number | null;
  recentFailures: number;
  lastSeenAt: string | null;
}

export interface DesignStageHealth {
  stageName: string;
  status: DesignHealthStatus;
  avgDurationMs: number | null;
  failureCount: number;
  windowHours: number;
}

export interface DesignPluginHealth {
  pluginId: string;
  pluginName: string;
  status: DesignHealthStatus;
  lastError: string | null;
  lastCheckedAt: string;
}

export interface DesignRendererHealth {
  rendererId: string;
  rendererType: string;
  status: DesignHealthStatus;
  successRate: number | null;
  failureCount: number;
  avgDurationMs: number | null;
  windowHours: number;
}

export interface DesignProviderHealth {
  providerName: string;
  status: DesignHealthStatus;
  successRate: number | null;
  failureCount: number;
  avgLatencyMs: number | null;
  recentErrors: string[];
  windowHours: number;
}

export interface DesignIncident {
  id: string;
  ruleKey: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  detectedAt: string;
  affectedResource: string | null;
  suppressed: boolean;
}

export interface DesignOperationalAlert {
  alertId: string;
  level: "error" | "warning" | "info";
  message: string;
  source: string;
  triggeredAt: string;
}

export interface DesignOperationHealth {
  overallStatus: DesignHealthStatus;
  computedAt: string;
  windowHours: number;
  workflows: DesignWorkflowHealth[];
  stages: DesignStageHealth[];
  renderers: DesignRendererHealth[];
  providers: DesignProviderHealth[];
  plugins: DesignPluginHealth[];
  incidents: DesignIncident[];
  alerts: DesignOperationalAlert[];
}

export interface DesignObservabilityAdapter {
  getHealth(windowHours: number): Promise<DesignOperationHealth>;
  getMetrics(windowHours: number): Promise<DesignOperationMetric[]>;
  getEvents(limit: number, offset: number): Promise<{ items: DesignOperationEvent[]; total: number }>;
  getIncidents(windowHours: number): Promise<DesignIncident[]>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function windowStart(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/** Compute p50/p95 from a sorted numeric array (ascending). */
export function percentile(sorted: number[], pct: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[idx] ?? null;
}

/** Classify health based on success rate. */
function rateToHealth(successRate: number | null, total: number): DesignHealthStatus {
  if (total === 0) return "unknown";
  if (successRate === null) return "unknown";
  if (successRate >= 0.95) return "healthy";
  if (successRate >= 0.75) return "degraded";
  return "unavailable";
}

/** Deduplicate incidents by ruleKey + affectedResource (suppress duplicates). */
export function deduplicateIncidents(incidents: DesignIncident[]): DesignIncident[] {
  const seen = new Set<string>();
  return incidents.map((i) => {
    const key = `${i.ruleKey}:${i.affectedResource ?? ""}`;
    if (seen.has(key)) return { ...i, suppressed: true };
    seen.add(key);
    return i;
  });
}

// ── Core service functions ────────────────────────────────────────────────────

/**
 * Aggregated job metrics over a rolling window.
 * Queries aiJobsTable — never mocked, honest null when unavailable.
 */
export async function getJobMetrics(windowHours: number): Promise<{
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  retriedJobs: number;
  queueDepth: number;
  stuckCount: number;
  successRate: number | null;
  failureRate: number | null;
  retryRate: number | null;
  cancellationRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  avgCostPerRun: number | null;
  artifactGenerationCount: number;
}> {
  const since = windowStart(windowHours);
  const stuckSince = windowStart(0.5); // stuck = running > 30 min

  const [statusRows, durationRows, costRow, stuckRow, artifactRow] = await Promise.all([
    // Status counts in window
    db
      .select({
        status: aiJobsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(aiJobsTable)
      .where(gte(aiJobsTable.createdAt, since))
      .groupBy(aiJobsTable.status),

    // Duration for completed jobs (for p50/p95)
    db
      .select({ dur: aiJobsTable.actualDuration })
      .from(aiJobsTable)
      .where(
        and(
          eq(aiJobsTable.status, "completed"),
          gte(aiJobsTable.createdAt, since),
          sql`actual_duration IS NOT NULL`,
        ),
      )
      .orderBy(aiJobsTable.actualDuration),

    // Avg cost for completed jobs
    db
      .select({
        avgCost: sql<number | null>`avg(actual_cost::float)`,
      })
      .from(aiJobsTable)
      .where(
        and(
          eq(aiJobsTable.status, "completed"),
          gte(aiJobsTable.createdAt, since),
          sql`actual_cost IS NOT NULL`,
        ),
      ),

    // Stuck jobs: running longer than 30 minutes
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiJobsTable)
      .where(
        and(
          eq(aiJobsTable.status, "running"),
          lte(aiJobsTable.startedAt, stuckSince),
        ),
      ),

    // Artifact generation (image_generation job type)
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiJobsTable)
      .where(
        and(
          eq(aiJobsTable.jobType, "image_generation"),
          eq(aiJobsTable.status, "completed"),
          gte(aiJobsTable.createdAt, since),
        ),
      ),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));
  const completed = byStatus["completed"] ?? 0;
  const failed = byStatus["failed"] ?? 0;
  const cancelled = byStatus["cancelled"] ?? 0;
  const retrying = byStatus["retrying"] ?? 0;
  const queued = (byStatus["queued"] ?? 0) + (byStatus["waiting"] ?? 0);
  const totalJobs = Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0);

  // p50/p95 from sorted durations
  const durations = durationRows.map((r) => r.dur ?? 0).filter((d) => d > 0);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);

  return {
    totalJobs,
    completedJobs: completed,
    failedJobs: failed,
    cancelledJobs: cancelled,
    retriedJobs: retrying,
    queueDepth: queued,
    stuckCount: stuckRow[0]?.count ?? 0,
    successRate: totalJobs > 0 ? completed / totalJobs : null,
    failureRate: totalJobs > 0 ? failed / totalJobs : null,
    retryRate: totalJobs > 0 ? retrying / totalJobs : null,
    cancellationRate: totalJobs > 0 ? cancelled / totalJobs : null,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    avgCostPerRun: costRow[0]?.avgCost != null ? Number(costRow[0].avgCost) : null,
    artifactGenerationCount: artifactRow[0]?.count ?? 0,
  };
}

/**
 * Provider health from aiExecutionLogsTable.
 * Honest unknown when no logs exist.
 */
export async function getProviderHealth(windowHours: number): Promise<DesignProviderHealth[]> {
  const since = windowStart(windowHours);

  const rows = await db
    .select({
      providerName: aiExecutionLogsTable.providerName,
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where status = 'failed' or status = 'timeout')::int`,
      avgLatencyMs: sql<number | null>`avg(latency_ms)`,
    })
    .from(aiExecutionLogsTable)
    .where(and(gte(aiExecutionLogsTable.createdAt, since), sql`provider_name IS NOT NULL`))
    .groupBy(aiExecutionLogsTable.providerName);

  if (!rows.length) return [];

  // Recent error messages per provider (redacted — no stack traces)
  const errorRows = await db
    .select({
      providerName: aiExecutionLogsTable.providerName,
      errorMessage: aiExecutionLogsTable.errorMessage,
    })
    .from(aiExecutionLogsTable)
    .where(
      and(
        gte(aiExecutionLogsTable.createdAt, since),
        sql`status IN ('failed', 'timeout')`,
        sql`error_message IS NOT NULL`,
        sql`provider_name IS NOT NULL`,
      ),
    )
    .orderBy(sql`created_at DESC`)
    .limit(50);

  const errorsByProvider: Record<string, string[]> = {};
  for (const r of errorRows) {
    const p = r.providerName ?? "unknown";
    if (!errorsByProvider[p]) errorsByProvider[p] = [];
    // Redact: strip anything after newline (stack trace) and truncate
    const safeMsg = (r.errorMessage ?? "").split("\n")[0]?.substring(0, 200) ?? "";
    if (safeMsg && !errorsByProvider[p]!.includes(safeMsg)) {
      errorsByProvider[p]!.push(safeMsg);
    }
  }

  return rows.map((r) => {
    const total = r.total ?? 0;
    const failed = r.failed ?? 0;
    const successRate = total > 0 ? (total - failed) / total : null;
    return {
      providerName: r.providerName ?? "unknown",
      status: rateToHealth(successRate, total),
      successRate,
      failureCount: failed,
      avgLatencyMs: r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : null,
      recentErrors: (errorsByProvider[r.providerName ?? ""] ?? []).slice(0, 5),
      windowHours,
    };
  });
}

/**
 * Renderer health from creative_render_sessions table.
 * Groups by session_status to determine success/failure patterns.
 */
export async function getRendererHealth(windowHours: number): Promise<DesignRendererHealth[]> {
  const since = windowStart(windowHours);

  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where session_status = 'failed')::int`,
      completed: sql<number>`count(*) filter (where session_status = 'completed')::int`,
    })
    .from(creativeRenderSessionsTable)
    .where(gte(creativeRenderSessionsTable.createdAt, since));

  const row = rows[0];
  if (!row || (row.total ?? 0) === 0) {
    return [
      {
        rendererId: "creative-renderer",
        rendererType: "creative_ai",
        status: "unknown",
        successRate: null,
        failureCount: 0,
        avgDurationMs: null,
        windowHours,
      },
    ];
  }

  const total = row.total ?? 0;
  const failed = row.failed ?? 0;
  const completed = row.completed ?? 0;
  const successRate = total > 0 ? completed / total : null;

  return [
    {
      rendererId: "creative-renderer",
      rendererType: "creative_ai",
      status: rateToHealth(successRate, total),
      successRate,
      failureCount: failed,
      avgDurationMs: null, // not stored as a single column — would need join
      windowHours,
    },
  ];
}

/**
 * Worker health from aiWorkersTable.
 * Derives per-type workflow health from job stats.
 */
export async function getWorkflowHealth(windowHours: number): Promise<DesignWorkflowHealth[]> {
  const since = windowStart(windowHours);

  const rows = await db
    .select({
      jobType: aiJobsTable.jobType,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgDur: sql<number | null>`avg(actual_duration) filter (where status = 'completed' and actual_duration is not null)`,
      lastSeen: sql<string | null>`max(updated_at)::text`,
    })
    .from(aiJobsTable)
    .where(gte(aiJobsTable.createdAt, since))
    .groupBy(aiJobsTable.jobType)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  return rows.map((r) => {
    const total = r.total ?? 0;
    const completed = r.completed ?? 0;
    const failed = r.failed ?? 0;
    const successRate = total > 0 ? completed / total : null;
    return {
      workflowId: `job-type:${r.jobType}`,
      name: r.jobType ?? "unknown",
      status: rateToHealth(successRate, total),
      successRate,
      avgLatencyMs: r.avgDur != null ? Math.round(Number(r.avgDur)) : null,
      recentFailures: failed,
      lastSeenAt: r.lastSeen ?? null,
    };
  });
}

/**
 * Stage health — derived from job type patterns in the job engine.
 * Reflects pipeline stage performance across image_generation, qc_review, etc.
 */
export async function getStageHealth(windowHours: number): Promise<DesignStageHealth[]> {
  const knownStages = [
    "brief_parsing",
    "image_generation",
    "qc_review",
    "export",
    "llm_inference",
    "creative_brief",
  ];

  const since = windowStart(windowHours);
  const results: DesignStageHealth[] = [];

  const rows = await db
    .select({
      jobType: aiJobsTable.jobType,
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      avgDur: sql<number | null>`avg(actual_duration) filter (where status = 'completed' and actual_duration is not null)`,
    })
    .from(aiJobsTable)
    .where(
      and(
        gte(aiJobsTable.createdAt, since),
        sql`job_type = ANY(ARRAY[${sql.raw(knownStages.map((s) => `'${s}'`).join(","))}])`,
      ),
    )
    .groupBy(aiJobsTable.jobType);

  const rowMap = Object.fromEntries(rows.map((r) => [r.jobType, r]));

  for (const stage of knownStages) {
    const r = rowMap[stage];
    if (!r) {
      results.push({
        stageName: stage,
        status: "unknown",
        avgDurationMs: null,
        failureCount: 0,
        windowHours,
      });
      continue;
    }
    const total = r.total ?? 0;
    const failed = r.failed ?? 0;
    const successRate = total > 0 ? (total - failed) / total : null;
    results.push({
      stageName: stage,
      status: rateToHealth(successRate, total),
      avgDurationMs: r.avgDur != null ? Math.round(Number(r.avgDur)) : null,
      failureCount: failed,
      windowHours,
    });
  }

  return results;
}

/**
 * Plugin health — workers are the "plugins" in this context.
 * Workers that haven't sent a heartbeat in 5 minutes are degraded.
 */
export async function getPluginHealth(): Promise<DesignPluginHealth[]> {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  const now = new Date().toISOString();

  const workers = await db
    .select({
      id: aiWorkersTable.id,
      workerName: aiWorkersTable.workerName,
      workerType: aiWorkersTable.workerType,
      status: aiWorkersTable.status,
      lastHeartbeat: aiWorkersTable.lastHeartbeat,
    })
    .from(aiWorkersTable)
    .orderBy(aiWorkersTable.workerName);

  if (!workers.length) {
    return [
      {
        pluginId: "worker-pool",
        pluginName: "Worker Pool",
        status: "unavailable",
        lastError: "No workers registered",
        lastCheckedAt: now,
      },
    ];
  }

  return workers.map((w) => {
    const isStale = w.lastHeartbeat < staleThreshold;
    const isOffline = w.status === "offline";
    let status: DesignHealthStatus = "healthy";
    if (isOffline) status = "unavailable";
    else if (isStale) status = "degraded";

    return {
      pluginId: `worker:${w.id}`,
      pluginName: `${w.workerName} (${w.workerType ?? "unknown"})`,
      status,
      lastError: isStale && !isOffline ? "Heartbeat stale (>5 min)" : null,
      lastCheckedAt: now,
    };
  });
}

/**
 * Rule-based incident detection. No auto-remediation.
 * Returns deterministic incidents based on current metrics.
 */
export async function detectIncidents(windowHours: number): Promise<DesignIncident[]> {
  const since = windowStart(windowHours);
  const stuckSince = windowStart(0.5);
  const now = new Date().toISOString();
  const incidents: DesignIncident[] = [];

  const [jobStats, workerStats, providerStats, costStats, shortWindowJobs] = await Promise.all([
    // Overall job stats
    db
      .select({
        status: aiJobsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(aiJobsTable)
      .where(gte(aiJobsTable.createdAt, since))
      .groupBy(aiJobsTable.status),

    // Worker counts
    db
      .select({
        status: aiWorkersTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(aiWorkersTable)
      .groupBy(aiWorkersTable.status),

    // Provider failure rates (last 1h for spikes)
    db
      .select({
        providerName: aiExecutionLogsTable.providerName,
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where status = 'failed' or status = 'timeout')::int`,
      })
      .from(aiExecutionLogsTable)
      .where(and(gte(aiExecutionLogsTable.createdAt, windowStart(1)), sql`provider_name IS NOT NULL`))
      .groupBy(aiExecutionLogsTable.providerName),

    // Cost anomaly: avg cost in window vs. avg cost in prior window
    db
      .select({
        avgCost: sql<number | null>`avg(estimated_cost_usd::float)`,
      })
      .from(aiCostRecordsTable)
      .where(gte(aiCostRecordsTable.createdAt, since)),

    // Short window (1h) job counts for queue growth detection
    db
      .select({
        status: aiJobsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(aiJobsTable)
      .where(gte(aiJobsTable.createdAt, windowStart(1)))
      .groupBy(aiJobsTable.status),
  ]);

  const byStatus = Object.fromEntries(jobStats.map((r) => [r.status, r.count]));
  const byWorkerStatus = Object.fromEntries(workerStats.map((r) => [r.status, r.count]));

  // ── Rule: Stuck jobs ─────────────────────────────────────────────────────────
  const [stuckRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
      ids: sql<string>`string_agg(id::text, ',' order by started_at)`,
    })
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.status, "running"), lte(aiJobsTable.startedAt, stuckSince)));

  const stuckCount = stuckRow?.count ?? 0;
  if (stuckCount > 0) {
    incidents.push({
      id: `stuck-jobs-${now}`,
      ruleKey: "job_stuck",
      severity: stuckCount >= 5 ? "critical" : stuckCount >= 2 ? "high" : "medium",
      title: `${stuckCount} stuck job${stuckCount > 1 ? "s" : ""} detected`,
      description: `${stuckCount} job${stuckCount > 1 ? "s" : ""} ha${stuckCount > 1 ? "ve" : "s"} been in running state for more than 30 minutes.`,
      detectedAt: now,
      affectedResource: "job-engine",
      suppressed: false,
    });
  }

  // ── Rule: Missing worker ──────────────────────────────────────────────────────
  const activeWorkers =
    (byWorkerStatus["online"] ?? 0) +
    (byWorkerStatus["idle"] ?? 0) +
    (byWorkerStatus["busy"] ?? 0);
  if (activeWorkers === 0) {
    incidents.push({
      id: `missing-workers-${now}`,
      ruleKey: "missing_worker",
      severity: "critical",
      title: "No active workers registered",
      description: "The worker cluster has no online, idle, or busy workers. Jobs will not be processed.",
      detectedAt: now,
      affectedResource: "worker-cluster",
      suppressed: false,
    });
  }

  // ── Rule: Repeated provider failure ──────────────────────────────────────────
  for (const r of providerStats) {
    if (!r.providerName) continue;
    const total = r.total ?? 0;
    const failed = r.failed ?? 0;
    if (total >= 5 && failed / total > 0.1) {
      const rate = ((failed / total) * 100).toFixed(1);
      incidents.push({
        id: `provider-failure-${r.providerName}-${now}`,
        ruleKey: "provider_failure_spike",
        severity: failed / total > 0.3 ? "critical" : "high",
        title: `Provider failure spike: ${r.providerName}`,
        description: `${r.providerName} has a ${rate}% failure rate in the last hour (${failed}/${total} calls failed).`,
        detectedAt: now,
        affectedResource: `provider:${r.providerName}`,
        suppressed: false,
      });
    }
  }

  // ── Rule: Queue growth ────────────────────────────────────────────────────────
  const shortByStatus = Object.fromEntries(shortWindowJobs.map((r) => [r.status, r.count]));
  const currentQueueDepth = (shortByStatus["queued"] ?? 0) + (shortByStatus["waiting"] ?? 0);
  if (currentQueueDepth > 50) {
    incidents.push({
      id: `queue-growth-${now}`,
      ruleKey: "queue_growth",
      severity: currentQueueDepth > 200 ? "critical" : currentQueueDepth > 100 ? "high" : "medium",
      title: `Queue depth elevated: ${currentQueueDepth} jobs`,
      description: `${currentQueueDepth} jobs are currently queued or waiting in the last hour. This may indicate dispatcher or worker issues.`,
      detectedAt: now,
      affectedResource: "job-queue",
      suppressed: false,
    });
  }

  // ── Rule: Renderer failure spike ─────────────────────────────────────────────
  const rendererFailed = byStatus["failed"] ?? 0;
  const rendererTotal = Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0);
  if (rendererTotal >= 10 && rendererFailed / rendererTotal > 0.2) {
    const rate = ((rendererFailed / rendererTotal) * 100).toFixed(1);
    incidents.push({
      id: `renderer-failure-${now}`,
      ruleKey: "renderer_failure_spike",
      severity: rendererFailed / rendererTotal > 0.4 ? "critical" : "high",
      title: `Renderer failure spike: ${rate}% failure rate`,
      description: `${rendererFailed} of ${rendererTotal} jobs in the window have failed. Check AI provider availability and job payloads.`,
      detectedAt: now,
      affectedResource: "renderer",
      suppressed: false,
    });
  }

  // ── Rule: Cost anomaly ────────────────────────────────────────────────────────
  if (costStats[0]?.avgCost != null) {
    const avgCost = Number(costStats[0].avgCost);
    const ANOMALY_THRESHOLD_USD = 1.0; // flag if avg cost per call > $1
    if (avgCost > ANOMALY_THRESHOLD_USD) {
      incidents.push({
        id: `cost-anomaly-${now}`,
        ruleKey: "cost_anomaly",
        severity: avgCost > 5.0 ? "critical" : "high",
        title: `Cost anomaly: avg $${avgCost.toFixed(4)} per AI call`,
        description: `Average cost per AI call in the window is $${avgCost.toFixed(4)}, which exceeds the $${ANOMALY_THRESHOLD_USD.toFixed(2)} threshold.`,
        detectedAt: now,
        affectedResource: "cost-system",
        suppressed: false,
      });
    }
  }

  // ── Rule: Timeout spike ───────────────────────────────────────────────────────
  // Detect when timeout rate in last 1h exceeds 5% of all execution calls
  const [timeoutRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      timeouts: sql<number>`count(*) filter (where status = 'timeout')::int`,
    })
    .from(aiExecutionLogsTable)
    .where(gte(aiExecutionLogsTable.createdAt, windowStart(1)));

  const totalExec = timeoutRow?.total ?? 0;
  const totalTimeouts = timeoutRow?.timeouts ?? 0;
  if (totalExec >= 10 && totalTimeouts / totalExec > 0.05) {
    const rate = ((totalTimeouts / totalExec) * 100).toFixed(1);
    incidents.push({
      id: `timeout-spike-${now}`,
      ruleKey: "timeout_spike",
      severity: totalTimeouts / totalExec > 0.2 ? "critical" : "high",
      title: `Timeout spike: ${rate}% of AI calls timed out`,
      description: `${totalTimeouts} of ${totalExec} execution calls in the last hour returned a timeout status (${rate}%). Check AI provider latency or network stability.`,
      detectedAt: now,
      affectedResource: "ai-execution",
      suppressed: false,
    });
  }

  // ── Rule: Plugin load failure (stale/error workers) ──────────────────────────
  // Workers that are stale (last heartbeat > 2 min ago) AND currently assigned to a job
  const [pluginFailRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiWorkersTable)
    .where(
      and(
        sql`status = 'stale'`,
        sql`current_job IS NOT NULL`,
      ),
    );

  const pluginFailCount = pluginFailRow?.count ?? 0;
  if (pluginFailCount > 0) {
    incidents.push({
      id: `plugin-load-failure-${now}`,
      ruleKey: "plugin_load_failure",
      severity: pluginFailCount >= 3 ? "critical" : "high",
      title: `Plugin load failure: ${pluginFailCount} stale worker${pluginFailCount > 1 ? "s" : ""} holding jobs`,
      description: `${pluginFailCount} worker${pluginFailCount > 1 ? "s" : ""} ${pluginFailCount > 1 ? "are" : "is"} stale (no heartbeat) but still assigned to active jobs. Jobs may be orphaned.`,
      detectedAt: now,
      affectedResource: "worker-cluster",
      suppressed: false,
    });
  }

  // ── Rule: Event stream lag ────────────────────────────────────────────────────
  // Events that are pending/failed to publish for > 5 minutes indicate stream lag
  const eventLagSince = new Date(Date.now() - 5 * 60 * 1000);
  const [eventLagRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiEventsTable)
    .where(
      and(
        sql`status IN ('pending', 'processing')`,
        lte(aiEventsTable.createdAt, eventLagSince),
      ),
    );

  const lagCount = eventLagRow?.count ?? 0;
  if (lagCount > 0) {
    incidents.push({
      id: `event-stream-lag-${now}`,
      ruleKey: "event_stream_lag",
      severity: lagCount > 50 ? "critical" : lagCount > 10 ? "high" : "medium",
      title: `Event stream lag: ${lagCount} event${lagCount > 1 ? "s" : ""} unprocessed >5 min`,
      description: `${lagCount} event${lagCount > 1 ? "s" : ""} ${lagCount > 1 ? "are" : "is"} still in pending or processing state after more than 5 minutes. The event bus may be backlogged or consumers offline.`,
      detectedAt: now,
      affectedResource: "event-bus",
      suppressed: false,
    });
  }

  // ── Rule: Invalid output spike ────────────────────────────────────────────────
  // QC-failed jobs spike: >15% of qc_review jobs failing in last 1h
  const [invalidRow] = await db
    .select({
      total: sql<number>`count(*) filter (where job_type = 'qc_review')::int`,
      invalid: sql<number>`count(*) filter (where job_type = 'qc_review' and status = 'failed')::int`,
    })
    .from(aiJobsTable)
    .where(gte(aiJobsTable.createdAt, windowStart(1)));

  const qcTotalShort = invalidRow?.total ?? 0;
  const qcInvalid = invalidRow?.invalid ?? 0;
  if (qcTotalShort >= 5 && qcInvalid / qcTotalShort > 0.15) {
    const rate = ((qcInvalid / qcTotalShort) * 100).toFixed(1);
    incidents.push({
      id: `invalid-output-spike-${now}`,
      ruleKey: "invalid_output_spike",
      severity: qcInvalid / qcTotalShort > 0.4 ? "critical" : "high",
      title: `Invalid output spike: ${rate}% QC failure rate`,
      description: `${qcInvalid} of ${qcTotalShort} QC review jobs failed in the last hour (${rate}%). AI output quality may have degraded — check prompt templates and provider responses.`,
      detectedAt: now,
      affectedResource: "qc-system",
      suppressed: false,
    });
  }

  return deduplicateIncidents(incidents);
}

/**
 * Get recent design operation events from the audit log.
 * Redacts sensitive fields — no raw prompt, no API key.
 */
export async function getDesignEvents(
  limit: number,
  offset: number,
): Promise<{ items: DesignOperationEvent[]; total: number }> {
  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: aiAuditLogsTable.id,
        action: aiAuditLogsTable.action,
        actorId: aiAuditLogsTable.actorId,
        actorType: aiAuditLogsTable.actorType,
        resourceType: aiAuditLogsTable.resourceType,
        resourceId: aiAuditLogsTable.resourceId,
        correlationId: aiAuditLogsTable.correlationId,
        createdAt: aiAuditLogsTable.createdAt,
      })
      .from(aiAuditLogsTable)
      .orderBy(sql`created_at desc`)
      .limit(Math.min(limit, 200))
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(aiAuditLogsTable),
  ]);

  return {
    items: rows.map((r) => ({
      id: String(r.id),
      eventType: r.action ?? "unknown",
      actor: r.actorType === "system" ? "system" : (r.actorId ?? null),
      resourceType: r.resourceType ?? null,
      resourceId: r.resourceId ?? null,
      summary: `${r.actorType ?? "system"} performed ${r.action ?? "action"} on ${r.resourceType ?? "resource"} ${r.resourceId ?? ""}`.trim(),
      correlationId: r.correlationId ?? null,
      occurredAt: iso(r.createdAt) ?? new Date().toISOString(),
    })),
    total: countRow?.count ?? 0,
  };
}

/**
 * Compute flat metric list for the given window.
 */
export async function getDesignMetrics(windowHours: number): Promise<DesignOperationMetric[]> {
  const now = new Date().toISOString();
  const jobM = await getJobMetrics(windowHours);

  const metrics: DesignOperationMetric[] = [
    { name: "throughput", value: jobM.completedJobs, unit: "jobs", windowHours, recordedAt: now },
    { name: "queue_depth", value: jobM.queueDepth, unit: "jobs", windowHours, recordedAt: now },
    { name: "success_rate", value: jobM.successRate != null ? Math.round(jobM.successRate * 10000) / 100 : null, unit: "%", windowHours, recordedAt: now },
    { name: "failure_rate", value: jobM.failureRate != null ? Math.round(jobM.failureRate * 10000) / 100 : null, unit: "%", windowHours, recordedAt: now },
    { name: "retry_rate", value: jobM.retryRate != null ? Math.round(jobM.retryRate * 10000) / 100 : null, unit: "%", windowHours, recordedAt: now },
    { name: "cancellation_rate", value: jobM.cancellationRate != null ? Math.round(jobM.cancellationRate * 10000) / 100 : null, unit: "%", windowHours, recordedAt: now },
    { name: "p50_latency", value: jobM.p50LatencyMs, unit: "ms", windowHours, recordedAt: now },
    { name: "p95_latency", value: jobM.p95LatencyMs, unit: "ms", windowHours, recordedAt: now },
    { name: "avg_cost_per_run", value: jobM.avgCostPerRun != null ? Math.round(jobM.avgCostPerRun * 1_000_000) / 1_000_000 : null, unit: "USD", windowHours, recordedAt: now },
    { name: "artifact_generation_count", value: jobM.artifactGenerationCount, unit: "artifacts", windowHours, recordedAt: now },
    { name: "stuck_job_count", value: jobM.stuckCount, unit: "jobs", windowHours, recordedAt: now },
  ];

  // QC blocking rate: jobs of type qc_review that fail / all completed creative jobs
  const [qcRow] = await db
    .select({
      total: sql<number>`count(*) filter (where job_type = 'qc_review')::int`,
      blocking: sql<number>`count(*) filter (where job_type = 'qc_review' and status = 'failed')::int`,
    })
    .from(aiJobsTable)
    .where(gte(aiJobsTable.createdAt, windowStart(windowHours)));

  const qcTotal = qcRow?.total ?? 0;
  const qcBlocking = qcRow?.blocking ?? 0;
  metrics.push({
    name: "qc_blocking_rate",
    value: qcTotal > 0 ? Math.round((qcBlocking / qcTotal) * 10000) / 100 : null,
    unit: "%",
    windowHours,
    recordedAt: now,
  });

  // Export success rate: design_render_zip_exports in window
  const [exportRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    })
    .from(designRenderZipExportsTable)
    .where(gte(designRenderZipExportsTable.createdAt, windowStart(windowHours)));

  const expTotal = exportRow?.total ?? 0;
  const expCompleted = exportRow?.completed ?? 0;
  metrics.push({
    name: "export_success_rate",
    value: expTotal > 0 ? Math.round((expCompleted / expTotal) * 10000) / 100 : null,
    unit: "%",
    windowHours,
    recordedAt: now,
  });

  // Review turnaround: avg time (ms) from render session creation → concept_selected
  // Approximated via creative_render_sessions: sessions that reached concept_selected in window
  const [turnRow] = await db
    .select({
      avgTurnaroundMs: sql<number | null>`
        avg(
          extract(epoch from (updated_at - created_at)) * 1000
        ) filter (
          where session_status = 'concept_selected'
        )
      `,
    })
    .from(creativeRenderSessionsTable)
    .where(gte(creativeRenderSessionsTable.createdAt, windowStart(windowHours)));

  metrics.push({
    name: "review_turnaround",
    value:
      turnRow?.avgTurnaroundMs != null
        ? Math.round(Number(turnRow.avgTurnaroundMs))
        : null,
    unit: "ms",
    windowHours,
    recordedAt: now,
  });

  return metrics;
}

/**
 * Compute full health snapshot. This is the adapter's main entry point.
 * Overall status = worst status across all subsystems.
 * unknown is not treated as healthy.
 */
export async function getDesignOperationHealth(windowHours: number): Promise<DesignOperationHealth> {
  const now = new Date().toISOString();

  const [workflows, stages, renderers, providers, plugins, incidents] = await Promise.all([
    getWorkflowHealth(windowHours),
    getStageHealth(windowHours),
    getRendererHealth(windowHours),
    getProviderHealth(windowHours),
    getPluginHealth(),
    detectIncidents(windowHours),
  ]);

  // Severity ranking: unavailable > degraded > unknown > healthy
  const rank: Record<DesignHealthStatus, number> = {
    unavailable: 3,
    degraded: 2,
    unknown: 1,
    healthy: 0,
  };

  const allStatuses: DesignHealthStatus[] = [
    ...workflows.map((w) => w.status),
    ...renderers.map((r) => r.status),
    ...providers.map((p) => p.status),
    ...plugins.map((p) => p.status),
  ];

  const hasCriticalIncident = incidents.some((i) => i.severity === "critical" && !i.suppressed);

  let overallStatus: DesignHealthStatus = allStatuses.length === 0 ? "unknown" : "healthy";
  for (const s of allStatuses) {
    if (rank[s] > rank[overallStatus]) overallStatus = s;
  }
  if (hasCriticalIncident && rank[overallStatus] < rank["degraded"]) {
    overallStatus = "degraded";
  }

  // Operational alerts from active incidents
  const alerts: DesignOperationalAlert[] = incidents
    .filter((i) => !i.suppressed)
    .map((i) => ({
      alertId: i.id,
      level: i.severity === "critical" || i.severity === "high" ? "error" as const : "warning" as const,
      message: i.title,
      source: i.ruleKey,
      triggeredAt: i.detectedAt,
    }));

  return {
    overallStatus,
    computedAt: now,
    windowHours,
    workflows,
    stages,
    renderers,
    providers,
    plugins,
    incidents,
    alerts,
  };
}

/** DesignObservabilityAdapter — canonical interface for DI or testing */
export const designObservabilityAdapter: DesignObservabilityAdapter = {
  getHealth: getDesignOperationHealth,
  getMetrics: getDesignMetrics,
  getEvents: getDesignEvents,
  getIncidents: detectIncidents,
};
