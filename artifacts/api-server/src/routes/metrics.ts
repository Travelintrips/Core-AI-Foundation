/**
 * metrics.ts — Operational metrics endpoint (WP-13 Observability)
 *
 * GET /ai/metrics — returns JSON metrics (admin-key protected)
 *
 * Covers:
 *   • Process metrics (uptime, memory, CPU)
 *   • Request counters (global, per-status-class)
 *   • Pool stats (db connection pool)
 *   • Simple text/plain Prometheus-compatible format via ?format=prometheus
 *
 * This module also exports the request counter middleware so app.ts can
 * mount it globally before the router.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";

const router = Router();

// ── In-memory counters ────────────────────────────────────────────────────────
// These reset on process restart. For persistent metrics, use the observability
// service tables (ai_execution_logs, ai_cost_records) which survive restarts.

interface RequestCounters {
  total: number;
  "2xx": number;
  "3xx": number;
  "4xx": number;
  "5xx": number;
  errors: number;
}

const counters: RequestCounters = {
  total: 0,
  "2xx": 0,
  "3xx": 0,
  "4xx": 0,
  "5xx": 0,
  errors: 0,
};

const startedAt = Date.now();

/**
 * Express middleware that increments request counters.
 * Mount in app.ts BEFORE the router: app.use(requestCounterMiddleware)
 */
export function requestCounterMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    counters.total++;
    const sc = res.statusCode;
    if (sc >= 200 && sc < 300) counters["2xx"]++;
    else if (sc >= 300 && sc < 400) counters["3xx"]++;
    else if (sc >= 400 && sc < 500) counters["4xx"]++;
    else if (sc >= 500) { counters["5xx"]++; counters.errors++; }
  });
  next();
}

// ── GET /ai/metrics ───────────────────────────────────────────────────────────
router.get("/ai/metrics", async (req: Request, res: Response) => {
  const format = String(req.query.format ?? "json");

  const uptimeMs = Date.now() - startedAt;
  const mem = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  // DB pool stats
  const poolStats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };

  const metrics = {
    process: {
      uptimeMs,
      uptimeHuman: formatUptime(uptimeMs),
      pid: process.pid,
      nodeVersion: process.version,
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        externalMb: Math.round(mem.external / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      cpu: {
        userMs: Math.round(cpuUsage.user / 1000),
        systemMs: Math.round(cpuUsage.system / 1000),
      },
    },
    requests: { ...counters },
    errorRate: counters.total > 0
      ? Number(((counters["5xx"] / counters.total) * 100).toFixed(2))
      : 0,
    db: {
      pool: poolStats,
    },
    collectedAt: new Date().toISOString(),
  };

  if (format === "prometheus") {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(toPrometheus(metrics));
    return;
  }

  res.json(metrics);
});

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPrometheus(m: any): string {
  const lines: string[] = [
    `# HELP ai_platform_uptime_seconds Process uptime in seconds`,
    `# TYPE ai_platform_uptime_seconds gauge`,
    `ai_platform_uptime_seconds ${Math.floor(m.process.uptimeMs / 1000)}`,
    ``,
    `# HELP ai_platform_heap_used_bytes Heap memory used`,
    `# TYPE ai_platform_heap_used_bytes gauge`,
    `ai_platform_heap_used_bytes ${m.process.memory.heapUsedMb * 1024 * 1024}`,
    ``,
    `# HELP ai_platform_requests_total Total HTTP requests`,
    `# TYPE ai_platform_requests_total counter`,
    `ai_platform_requests_total{status="2xx"} ${m.requests["2xx"]}`,
    `ai_platform_requests_total{status="3xx"} ${m.requests["3xx"]}`,
    `ai_platform_requests_total{status="4xx"} ${m.requests["4xx"]}`,
    `ai_platform_requests_total{status="5xx"} ${m.requests["5xx"]}`,
    ``,
    `# HELP ai_platform_error_rate_percent 5xx error rate as percentage`,
    `# TYPE ai_platform_error_rate_percent gauge`,
    `ai_platform_error_rate_percent ${m.errorRate}`,
    ``,
    `# HELP ai_platform_db_pool_total DB pool total connections`,
    `# TYPE ai_platform_db_pool_total gauge`,
    `ai_platform_db_pool_total ${m.db.pool.total}`,
    `ai_platform_db_pool_idle ${m.db.pool.idle}`,
    `ai_platform_db_pool_waiting ${m.db.pool.waiting}`,
  ];
  return lines.join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

export default router;
