import os from "node:os";
import { Router } from "express";
import { desc, sql } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  aiIncidentsTable,
  aiWorkersTable,
  db,
} from "@workspace/db";
import { executeAdminWhatsappDeviceStatusQuery } from "../services/aiCoreAdminDbQueryService.js";
import { getExternalAgentRegistrySnapshot } from "../services/externalAgentRegistryService.js";
import { executeAiCoreInfrastructureOperation } from "../services/aiCoreInfrastructureControlService.js";
import { codingDashboardTaskPresentationStatus } from "../services/codingTaskPresentationService.js";

const router = Router();
const REFRESH_MS = 5_000;
const EXTERNAL_CACHE_MS = 30_000;

type Probe = { ok: boolean; latencyMs: number | null; detail?: string; data?: unknown };
let externalCache: { expiresAt: number; hostinger: Probe; github: Probe } | null = null;
let waCache: { expiresAt: number; rows: Array<Record<string, unknown>>; error: string | null } | null = null;

function elapsedMs(started: number): number {
  return Math.max(0, Date.now() - started);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function stageProgress(status: string): number {
  const progress: Record<string, number> = {
    PENDING: 5,
    ANALYZING: 20,
    CODING: 55,
    TESTING: 75,
    COMMITTING: 86,
    PR_CREATED: 92,
    READY_REVIEW: 96,
    COMPLETED: 100,
    FAILED: 100,
    BLOCKED: 100,
    QUEUED: 5,
    WAITING_FOR_WORKER: 5,
    WAITING_FOR_CAPACITY: 5,
  };
  return progress[status.toUpperCase()] ?? 0;
}

function healthyWorker(worker: {
  status: string;
  lastHeartbeat: Date;
  leaseExpiresAt: Date | null;
}): boolean {
  const status = worker.status.toLowerCase();
  if (["offline", "stale", "maintenance", "unavailable"].includes(status)) return false;
  const now = Date.now();
  const heartbeatFresh = now - worker.lastHeartbeat.getTime() <= 120_000;
  const leaseHealthy = !worker.leaseExpiresAt || worker.leaseExpiresAt.getTime() > now;
  return heartbeatFresh && leaseHealthy;
}

function waState(value: unknown): "ONLINE" | "OFFLINE" | "QR_REQUIRED" | "RECONNECT" | "UNKNOWN" {
  const status = asText(value).trim().toLowerCase().replace(/[ -]+/g, "_");
  if (/(qr_required|qr|scan)/.test(status)) return "QR_REQUIRED";
  if (/(reconnect|connecting|sync)/.test(status)) return "RECONNECT";
  if (/(online|connected|active|ready)/.test(status)) return "ONLINE";
  if (/(offline|disconnected|banned|disabled|expired)/.test(status)) return "OFFLINE";
  return "UNKNOWN";
}

async function whatsappDevices(): Promise<{ rows: Array<Record<string, unknown>>; error: string | null }> {
  if (waCache && waCache.expiresAt > Date.now()) return waCache;
  try {
    const result = await executeAdminWhatsappDeviceStatusQuery();
    const rows = (result.rows ?? []).map((row) => row as Record<string, unknown>);
    waCache = { expiresAt: Date.now() + 10_000, rows, error: null };
  } catch (error) {
    waCache = {
      expiresAt: Date.now() + 10_000,
      rows: [],
      error: error instanceof Error ? error.message : "WhatsApp device status unavailable",
    };
  }
  return waCache;
}

async function probeGithub(): Promise<Probe> {
  const token = (process.env["AI_CODING_GITHUB_TOKEN"] ?? process.env["GITHUB_TOKEN"] ?? "").trim();
  const repository = (process.env["AI_CODING_DEFAULT_REPOSITORY"] ?? "Travelintrips/Core-AI-Foundation").trim();
  const start = Date.now();
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AI-Core-AICoding-Dashboard",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    return {
      ok: response.ok,
      latencyMs: elapsedMs(start),
      detail: response.ok ? "Repository API reachable" : `GitHub HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: elapsedMs(start),
      detail: error instanceof Error ? error.message : "GitHub probe failed",
    };
  }
}

async function probeHostinger(): Promise<Probe> {
  const start = Date.now();
  try {
    const result = await executeAiCoreInfrastructureOperation({
      operation: "HOSTINGER_VPS_STATUS",
      requestedBy: "aicoding-dashboard",
    });
    return { ok: true, latencyMs: elapsedMs(start), detail: result.reply, data: result.data };
  } catch (error) {
    return {
      ok: false,
      latencyMs: elapsedMs(start),
      detail: error instanceof Error ? error.message : "Hostinger probe failed",
    };
  }
}

async function externalProbes(): Promise<{ hostinger: Probe; github: Probe }> {
  if (externalCache && externalCache.expiresAt > Date.now()) {
    return { hostinger: externalCache.hostinger, github: externalCache.github };
  }
  const [hostinger, github] = await Promise.all([probeHostinger(), probeGithub()]);
  externalCache = { expiresAt: Date.now() + EXTERNAL_CACHE_MS, hostinger, github };
  return { hostinger, github };
}

function findPercent(data: unknown, matcher: RegExp): number | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): number | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (matcher.test(key)) {
        const numeric =
          typeof raw === "number" ? raw :
          typeof raw === "string" && /^\d+(?:\.\d+)?%?$/.test(raw.trim())
            ? Number.parseFloat(raw)
            : NaN;
        if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) return Math.round(numeric * 10) / 10;
      }
      const nested = visit(raw);
      if (nested != null) return nested;
    }
    return null;
  };
  return visit(data);
}

router.get("/ai/aicoding/overview", async (_req, res): Promise<void> => {
  const generatedAt = new Date();
  const [
    taskRows,
    runRows,
    workerRows,
    incidentRows,
    wa,
    agents,
    probes,
    databaseProbe,
    presentationRows,
  ] = await Promise.all([
    db.select().from(aiCodingTasksTable).orderBy(desc(aiCodingTasksTable.updatedAt)).limit(50),
    db.select().from(aiCodingRunsTable).orderBy(desc(aiCodingRunsTable.startedAt)).limit(150),
    db.select().from(aiWorkersTable).orderBy(aiWorkersTable.workerName),
    db.select().from(aiIncidentsTable).orderBy(desc(aiIncidentsTable.lastSeenAt)).limit(20),
    whatsappDevices(),
    getExternalAgentRegistrySnapshot().catch(() => []),
    externalProbes(),
    db.execute(sql`SELECT now() AS checked_at`).then(() => true).catch(() => false),
    db.execute(sql`
      WITH recent_tasks AS (
        SELECT id
        FROM ai_platform.ai_coding_tasks
        ORDER BY updated_at DESC
        LIMIT 50
      )
      SELECT
        t.id AS task_id,
        a.status AS autonomous_status,
        EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_runs AS active_run
          WHERE active_run.task_id = t.id
            AND active_run.status = 'RUNNING'
        ) AS has_active_run,
        EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_critical_approvals AS approval
          WHERE approval.task_id = t.id
            AND approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')
        ) AS has_pending_critical_approval
      FROM recent_tasks rt
      JOIN ai_platform.ai_coding_tasks t ON t.id = rt.id
      LEFT JOIN ai_platform.ai_coding_autonomous_tasks a
        ON a.task_id = t.id
       AND a.enabled = TRUE
    `).catch(() => ({ rows: [] })),
  ]);

  const latestRunByTask = new Map<string, typeof runRows[number]>();
  for (const run of runRows) if (!latestRunByTask.has(run.taskId)) latestRunByTask.set(run.taskId, run);

  const presentationByTask = new Map(
    (presentationRows.rows ?? []).map((row) => {
      const item = row as {
        task_id?: string;
        autonomous_status?: string | null;
        has_active_run?: boolean;
        has_pending_critical_approval?: boolean;
      };
      return [
        item.task_id ?? "",
        {
          autonomousStatus: item.autonomous_status ?? null,
          hasActiveRun: item.has_active_run === true,
          hasPendingCriticalApproval: item.has_pending_critical_approval === true,
        },
      ] as const;
    }),
  );

  const tasks = taskRows.map((task) => {
    const run = latestRunByTask.get(task.id);
    const presentation = presentationByTask.get(task.id);
    const effectiveStatus = codingDashboardTaskPresentationStatus({
      taskNumber: task.taskNumber,
      taskStatus: task.status,
      latestRunStatus: run?.status ?? null,
      autonomousStatus: presentation?.autonomousStatus,
      hasActiveRun: presentation?.hasActiveRun ?? run?.status === "RUNNING",
      hasPendingCriticalApproval:
        presentation?.hasPendingCriticalApproval ?? false,
    });

    return {
      id: task.id,
      taskNumber: task.taskNumber,
      projectName: task.projectName,
      repository: task.repository,
      branch: task.branch,
      instruction: task.instruction,
      status: effectiveStatus,
      persistedStatus: task.status,
      priority: task.priority,
      progress: stageProgress(effectiveStatus),
      progressBasis: "effective_lifecycle_stage",
      worker: run?.agentName ?? null,
      runStatus: run?.status ?? null,
      startedAt: run?.startedAt ?? null,
      finishedAt: run?.finishedAt ?? null,
      updatedAt: task.updatedAt,
    };
  });

  const liveCodingStatuses = new Set(["ANALYZING", "CODING", "TESTING", "COMMITTING", "PR_CREATED"]);
  const waitingStatuses = new Set(["PENDING", "QUEUED", "WAITING_FOR_WORKER", "WAITING_FOR_CAPACITY"]);
  const healthyWorkers = workerRows.filter(healthyWorker);
  const busyWorkers = healthyWorkers.filter((worker) => worker.runningJobs > 0 || worker.status.toLowerCase() === "busy");

  const devices = wa.rows.map((row) => ({
    deviceId: asText(row["device_id"] ?? row["device_name"] ?? row["phone_number"]) || "unknown",
    name: asText(row["device_name"]) || null,
    phoneNumber: asText(row["phone_number"]) || null,
    rawStatus: asText(row["status"]) || "unknown",
    status: waState(row["status"]),
    lastSeen: row["last_seen"] ?? null,
  }));
  const deviceCounts = devices.reduce<Record<string, number>>((acc, device) => {
    acc[device.status] = (acc[device.status] ?? 0) + 1;
    return acc;
  }, {});

  const agentBySource = new Map(agents.map((agent) => [agent.source, agent]));
  const ollamaWorkers = workerRows.filter((worker) =>
    /ollama/i.test([worker.workerName, worker.providerSlug, worker.runtimeKind, worker.modelId].filter(Boolean).join(" ")),
  );
  const healthyOllama = ollamaWorkers.filter(healthyWorker);

  const services = [
    {
      name: "AI Core",
      status: "ACTIVE",
      health: 100,
      responseTimeMs: 0,
      detail: "Dashboard API aktif",
    },
    {
      name: "API Server",
      status: "ACTIVE",
      health: 100,
      responseTimeMs: 0,
      detail: `Node ${process.version} · uptime ${Math.round(process.uptime() / 60)}m`,
    },
    {
      name: "Supabase",
      status: databaseProbe ? "ACTIVE" : "DOWN",
      health: databaseProbe ? 100 : 0,
      responseTimeMs: null,
      detail: databaseProbe ? "Database query aktif" : "Database tidak dapat di-query",
    },
    {
      name: "Ollama",
      status: healthyOllama.length > 0 ? "ACTIVE" : ollamaWorkers.length > 0 ? "DEGRADED" : "UNAVAILABLE",
      health: ollamaWorkers.length ? Math.round((healthyOllama.length / ollamaWorkers.length) * 100) : null,
      responseTimeMs: null,
      detail: `${healthyOllama.length}/${ollamaWorkers.length} worker lease sehat`,
    },
    ...(["openclaw", "n8n"] as const).map((source) => {
      const agent = agentBySource.get(source);
      return {
        name: source === "openclaw" ? "OpenClaw" : "n8n",
        status: agent?.presenceState === "ACTIVE" ? (agent.reportedHealth === "healthy" ? "ACTIVE" : "DEGRADED") : "UNAVAILABLE",
        health: agent?.presenceState === "ACTIVE" && agent.reportedHealth === "healthy" ? 100 : agent?.presenceState === "ACTIVE" ? 60 : 0,
        responseTimeMs: null,
        detail: agent ? `${agent.presenceState} · ${agent.reportedHealth}` : "Agent belum terdaftar",
      };
    }),
    {
      name: "Hostinger",
      status: probes.hostinger.ok ? "ACTIVE" : "UNAVAILABLE",
      health: probes.hostinger.ok ? 100 : 0,
      responseTimeMs: probes.hostinger.latencyMs,
      detail: probes.hostinger.detail ?? null,
    },
    {
      name: "GitHub",
      status: probes.github.ok ? "ACTIVE" : "UNAVAILABLE",
      health: probes.github.ok ? 100 : 0,
      responseTimeMs: probes.github.latencyMs,
      detail: probes.github.detail ?? null,
    },
  ];

  const cpuCount = Math.max(1, os.cpus().length);
  const localCpu = Math.max(0, Math.min(100, Math.round((os.loadavg()[0] / cpuCount) * 1000) / 10));
  const localMemory = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 1000) / 10;
  const resources = [
    {
      name: "AI Core Server",
      status: "ONLINE",
      cpuPct: localCpu,
      memoryPct: localMemory,
      storagePct: null,
      detail: `${cpuCount} CPU · uptime ${Math.round(os.uptime() / 3600)}h`,
    },
    {
      name: "Hostinger",
      status: probes.hostinger.ok ? "ONLINE" : "UNAVAILABLE",
      cpuPct: findPercent(probes.hostinger.data, /cpu.*(?:usage|percent)|(?:usage|percent).*cpu/i),
      memoryPct: findPercent(probes.hostinger.data, /(?:ram|memory).*(?:usage|percent)|(?:usage|percent).*(?:ram|memory)/i),
      storagePct: findPercent(probes.hostinger.data, /(?:disk|storage).*(?:usage|percent)|(?:usage|percent).*(?:disk|storage)/i),
      detail: probes.hostinger.detail ?? null,
    },
    {
      name: "Supabase",
      status: databaseProbe ? "ONLINE" : "UNAVAILABLE",
      cpuPct: null,
      memoryPct: null,
      storagePct: null,
      detail: databaseProbe ? "Database connected" : "Database unavailable",
    },
    {
      name: "GitHub",
      status: probes.github.ok ? "ONLINE" : "UNAVAILABLE",
      cpuPct: null,
      memoryPct: null,
      storagePct: null,
      detail: probes.github.detail ?? null,
    },
    {
      name: "Worker Pool",
      status: healthyWorkers.length > 0 ? "ONLINE" : "UNAVAILABLE",
      cpuPct: null,
      memoryPct: null,
      storagePct: null,
      detail: `${healthyWorkers.length}/${workerRows.length} worker sehat · ${busyWorkers.length} sibuk`,
    },
  ];

  const openIncidents = incidentRows.filter((incident) => incident.status !== "RESOLVED");
  const overallChecks = [
    databaseProbe,
    probes.hostinger.ok,
    probes.github.ok,
    services.find((service) => service.name === "Ollama")?.status === "ACTIVE",
    wa.error == null && (devices.length === 0 || (deviceCounts["ONLINE"] ?? 0) > 0),
  ];
  const overallHealth = Math.round((overallChecks.filter(Boolean).length / overallChecks.length) * 100);

  res.json({
    generatedAt: generatedAt.toISOString(),
    refreshMs: REFRESH_MS,
    kpis: {
      totalServices: services.length,
      activeServices: services.filter((service) => service.status === "ACTIVE").length,
      codingRunning: tasks.filter((task) => liveCodingStatuses.has(task.status)).length,
      waiting: tasks.filter((task) => waitingStatuses.has(task.status)).length,
      workerActive: healthyWorkers.length,
      workerTotal: workerRows.length,
      waOnline: deviceCounts["ONLINE"] ?? 0,
      waTotal: devices.length,
      criticalAlerts: openIncidents.filter((incident) => /critical|kritis|high/i.test(incident.severity)).length,
      overallHealth,
    },
    infrastructure: { services, resources },
    coding: { tasks },
    workers: workerRows.map((worker) => ({
      id: worker.id,
      name: worker.workerName,
      type: worker.workerType,
      status: worker.status,
      healthy: healthyWorker(worker),
      runningJobs: worker.runningJobs,
      capacity: worker.maxConcurrentJobs,
      averageLatencyMs: worker.averageLatency == null ? null : Number(worker.averageLatency),
      provider: worker.providerSlug,
      model: worker.modelId,
      lastHeartbeat: worker.lastHeartbeat,
      leaseExpiresAt: worker.leaseExpiresAt,
    })),
    whatsapp: {
      devices,
      error: wa.error,
      summary: {
        online: deviceCounts["ONLINE"] ?? 0,
        offline: deviceCounts["OFFLINE"] ?? 0,
        qrRequired: deviceCounts["QR_REQUIRED"] ?? 0,
        reconnect: deviceCounts["RECONNECT"] ?? 0,
        unknown: deviceCounts["UNKNOWN"] ?? 0,
      },
    },
    incidents: incidentRows.map((incident) => ({
      id: incident.id,
      source: incident.source,
      severity: incident.severity,
      status: incident.status,
      title: incident.title,
      summary: incident.summary,
      lastSeenAt: incident.lastSeenAt,
    })),
  });
});

export default router;
