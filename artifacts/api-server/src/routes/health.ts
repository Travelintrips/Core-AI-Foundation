/**
 * health.ts — Health check routes
 *
 * GET /healthz        — lightweight liveness probe (no DB call)
 * GET /healthz/full   — readiness probe: DB connectivity + table access + uptime
 *
 * WP-13: enhanced health endpoint used as deployment gate signal.
 * The /healthz/full endpoint is called by pre-deploy-check.sh before traffic
 * is switched to a new deployment. It must return HTTP 200 with
 * { status: "ok" } for the deploy gate to pass.
 */

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { checkZeroLlmHealth, readZeroLlmLocalConfig } from "../services/zeroLlmLocalService.js";
import { getAutonomousRuntimeStatus } from "../services/localCodingAutonomousRepairService.js";
import { getCodingWhatsappConfigStatus } from "../services/codingWhatsappNotificationService.js";

const router: IRouter = Router();

/** Process start time — used to compute uptime in /healthz/full */
const startedAt = Date.now();
const RELEASE_MARKER = "phase7a12-workers-killswitch-20260924";
const BUILD_COMMIT_SHA = process.env.CST_BUILD_COMMIT_SHA ?? "unknown";

const DEFAULT_READINESS_DB_TIMEOUT_MS = 2_500;
const MIN_READINESS_DB_TIMEOUT_MS = 250;
const MAX_READINESS_DB_TIMEOUT_MS = 3_500;

class ReadinessProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`database readiness probe timed out after ${timeoutMs}ms`);
    this.name = "ReadinessProbeTimeoutError";
  }
}

function getReadinessDbTimeoutMs(): number {
  const configured = Number(process.env["HEALTHZ_DB_TIMEOUT_MS"]);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_READINESS_DB_TIMEOUT_MS;
  }
  return Math.max(
    MIN_READINESS_DB_TIMEOUT_MS,
    Math.min(MAX_READINESS_DB_TIMEOUT_MS, Math.floor(configured)),
  );
}

async function withReadinessTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ReadinessProbeTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── GET /healthz — liveness (no I/O) ─────────────────────────────────────────
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.setHeader("X-CST-Release-Marker", RELEASE_MARKER);
  res.setHeader("X-CST-Commit-SHA", BUILD_COMMIT_SHA);
  res.json(data);
});

// ── GET /healthz/full — readiness (DB + service checks) ──────────────────────
router.get("/healthz/full", async (_req, res) => {
  const checks: Record<string, { status: "ok" | "fail"; latencyMs?: number; detail?: string }> = {};
  let overallStatus: "ok" | "degraded" | "fail" = "ok";

  // ── 1–2. DB connectivity + schema access (single bounded probe) ─────────────
  // Hostinger may terminate upstream requests at roughly five seconds. Keep the
  // readiness DB probe below that ceiling and avoid two serial pool acquisitions.
  // A timeout is reported as degraded (HTTP 200) so the deployment gate receives
  // structured diagnostics instead of a hosting-layer HTML 503. Explicit DB
  // connection/query errors still fail readiness with HTTP 503.
  const dbStart = Date.now();
  const dbTimeoutMs = getReadinessDbTimeoutMs();
  try {
    const result = await withReadinessTimeout(
      pool.query<{ schema_ok: boolean }>(
        "SELECT to_regclass('ai_platform.ai_audit_logs') IS NOT NULL AS schema_ok",
      ),
      dbTimeoutMs,
    );
    const latencyMs = Date.now() - dbStart;
    checks["db"] = { status: "ok", latencyMs };

    if (result.rows[0]?.schema_ok) {
      checks["schema"] = { status: "ok", latencyMs };
    } else {
      checks["schema"] = {
        status: "fail",
        latencyMs,
        detail: "ai_platform.ai_audit_logs is not accessible",
      };
      overallStatus = "degraded";
    }
  } catch (err: unknown) {
    const latencyMs = Date.now() - dbStart;
    const timedOut = err instanceof ReadinessProbeTimeoutError;
    checks["db"] = {
      status: "fail",
      latencyMs,
      detail: err instanceof Error ? err.message : "connection failed",
    };
    checks["schema"] = {
      status: "fail",
      detail: timedOut ? "skipped — db probe timed out" : "skipped — db check failed",
    };
    overallStatus = timedOut ? "degraded" : "fail";
  }

  // ── 3. Environment variable presence ──────────────────────────────────────
  const requiredEnvVars = ["SESSION_SECRET", "ADMIN_API_KEY"];
  const missingEnv = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingEnv.length > 0) {
    checks["env"] = {
      status: process.env["NODE_ENV"] === "production" ? "fail" : "ok",
      detail:
        process.env["NODE_ENV"] === "production"
          ? `Missing required env vars: ${missingEnv.join(", ")}`
          : `Missing env vars (non-blocking in dev): ${missingEnv.join(", ")}`,
    };
    if (process.env["NODE_ENV"] === "production" && overallStatus === "ok") {
      overallStatus = "fail";
    }
  } else {
    checks["env"] = { status: "ok" };
  }

  // ── 4. Optional local ZeroLLM readiness ───────────────────────────────────
  try {
    const zeroLlm = readZeroLlmLocalConfig();
    if (!zeroLlm.enabled) {
      checks["zerollm"] = { status: "ok", detail: "disabled" };
    } else {
      const localHealth = await checkZeroLlmHealth(zeroLlm);
      if (localHealth.status === "ok") {
        checks["zerollm"] = {
          status: "ok",
          latencyMs: localHealth.latencyMs,
          detail: "model=" + localHealth.model + "; loopback-only",
        };
      } else {
        checks["zerollm"] = {
          status: "fail",
          latencyMs: localHealth.latencyMs,
          detail: localHealth.detail ?? "local provider unavailable",
        };
        overallStatus = zeroLlm.required ? "fail" : overallStatus === "ok" ? "degraded" : overallStatus;
      }
    }
  } catch (error) {
    checks["zerollm"] = {
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
    if (
      process.env["ZEROLLM_REQUIRED"] === "true" ||
      process.env["AI_CODING_PROVIDER"]?.toLowerCase() === "zerollm"
    ) {
      overallStatus = "fail";
    } else if (overallStatus === "ok") {
      overallStatus = "degraded";
    }
  }

  // ── 5. Autonomous Coding readiness ────────────────────────────────────────
  const autonomous = getAutonomousRuntimeStatus();
  const whatsapp = getCodingWhatsappConfigStatus();
  const autonomousDependencies = {
    githubConfigured: Boolean(process.env["AI_CODING_GITHUB_TOKEN"]?.trim()),
    whatsapp,
    incomingSecretConfigured: Boolean(process.env["AI_CODING_WA_INCOMING_SECRET"]?.trim()),
    allowedSendersConfigured: Boolean(process.env["AI_CODING_WA_ALLOWED_SENDERS"]?.trim()),
  };
  const autonomousDependenciesReady =
    autonomousDependencies.githubConfigured &&
    autonomousDependencies.whatsapp.baseUrl &&
    autonomousDependencies.whatsapp.apiKey &&
    autonomousDependencies.whatsapp.to &&
    autonomousDependencies.incomingSecretConfigured &&
    autonomousDependencies.allowedSendersConfigured;

  if (!autonomous.configured) {
    checks["coding-autonomous"] = { status: "ok", detail: "disabled" };
  } else if (!autonomous.running) {
    checks["coding-autonomous"] = {
      status: "fail",
      detail: "configured but runtime timer is not running",
    };
    overallStatus = "fail";
  } else if (!autonomousDependenciesReady) {
    checks["coding-autonomous"] = {
      status: "fail",
      detail: "runtime active but one or more GitHub/WhatsApp approval dependencies are not configured",
    };
    overallStatus = "fail";
  } else {
    checks["coding-autonomous"] = {
      status: "ok",
      detail: `running; poll=${autonomous.pollIntervalMs}ms; maxTasksPerTick=${autonomous.maxTasksPerTick}`,
    };
  }

  // ── 6. Process metrics ────────────────────────────────────────────────────
  const uptimeMs = Date.now() - startedAt;
  const memUsage = process.memoryUsage();

  const payload = {
    status: overallStatus,
    version: process.env["npm_package_version"] ?? "unknown",
    uptime: {
      ms: uptimeMs,
      human: formatUptime(uptimeMs),
    },
    memory: {
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
    },
    checks,
    timestamp: new Date().toISOString(),
  };

  // HTTP status mirrors readiness: 200 = ok/degraded, 503 = fail
  res.setHeader("X-CST-Release-Marker", RELEASE_MARKER);
  res.setHeader("X-CST-Commit-SHA", BUILD_COMMIT_SHA);
  res.status(overallStatus === "fail" ? 503 : 200).json(payload);
});

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default router;
