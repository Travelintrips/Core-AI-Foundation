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

const router: IRouter = Router();

/** Process start time — used to compute uptime in /healthz/full */
const startedAt = Date.now();

// ── GET /healthz — liveness (no I/O) ─────────────────────────────────────────
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// ── GET /healthz/full — readiness (DB + service checks) ──────────────────────
router.get("/healthz/full", async (_req, res) => {
  const checks: Record<string, { status: "ok" | "fail"; latencyMs?: number; detail?: string }> = {};
  let overallStatus: "ok" | "degraded" | "fail" = "ok";

  // ── 1. DB connectivity ─────────────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      checks["db"] = { status: "ok", latencyMs: Date.now() - dbStart };
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    checks["db"] = {
      status: "fail",
      latencyMs: Date.now() - dbStart,
      detail: err instanceof Error ? err.message : "connection failed",
    };
    overallStatus = "fail";
  }

  // ── 2. Schema access — verify search_path is correct ──────────────────────
  if (checks["db"]?.status === "ok") {
    const schemaStart = Date.now();
    try {
      const client = await pool.connect();
      try {
        const result = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM ai_platform.ai_audit_logs LIMIT 0",
        );
        void result; // we just need it not to throw
        checks["schema"] = { status: "ok", latencyMs: Date.now() - schemaStart };
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      checks["schema"] = {
        status: "fail",
        latencyMs: Date.now() - schemaStart,
        detail: err instanceof Error ? err.message : "schema unreachable",
      };
      if (overallStatus === "ok") overallStatus = "degraded";
    }
  } else {
    checks["schema"] = { status: "fail", detail: "skipped — db check failed" };
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

  // ── 4. Process metrics ────────────────────────────────────────────────────
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
