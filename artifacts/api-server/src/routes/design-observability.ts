/**
 * design-observability.ts — Team 35 Design Observability & Operations Routes
 *
 * GET  /ai/design-observability/health    — full health snapshot
 * GET  /ai/design-observability/metrics   — flat metric list
 * GET  /ai/design-observability/incidents — rule-based incident list
 * GET  /ai/design-observability/events    — recent audit events (paginated)
 * GET  /ai/design-observability/summary   — combined health + metrics (single fetch for UI)
 *
 * Security:
 *   - All routes require x-admin-api-key
 *   - Stack traces redacted for non-platform actors
 *   - No raw prompt or API key is ever returned
 *   - Correlation IDs are safe to display
 *   - Access is audit-logged
 */

import { Router, type Request, type Response } from "express";
import {
  getDesignOperationHealth,
  getDesignMetrics,
  getDesignEvents,
  detectIncidents,
} from "../services/designObservabilityService.js";
import { logAudit } from "../services/aiAuditService.js";
import { logger } from "../lib/logger.js";

const router = Router();

/** Parse windowHours query param (default 24h, max 168h = 7 days). */
function parseWindow(raw: unknown, defaultHours = 24): number {
  const n = Number(raw ?? defaultHours);
  if (isNaN(n) || n < 1) return defaultHours;
  return Math.min(n, 168);
}

/** Parse pagination params. */
function parsePagination(req: Request): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(1, Number(req.query.limit ?? 50)), 200),
    offset: Math.max(0, Number(req.query.offset ?? 0)),
  };
}

/** Audit-log access to observability data (access is observable). */
async function auditAccess(req: Request, endpoint: string): Promise<void> {
  const actorId =
    (req.headers["x-actor-id"] as string | undefined) ??
    (req.headers["x-admin-api-key"] ? "admin" : "unknown");
  try {
    await logAudit(actorId, "design_observability_access", endpoint, "design_observability", "success", {});
  } catch {
    // Audit failure must not break the response
  }
}

// ── GET /ai/design-observability/health ───────────────────────────────────────

router.get("/ai/design-observability/health", async (req: Request, res: Response): Promise<void> => {
  const windowHours = parseWindow(req.query.windowHours);
  try {
    await auditAccess(req, "health");
    const health = await getDesignOperationHealth(windowHours);
    res.json(health);
  } catch (err) {
    logger.error({ err }, "[design-observability] health failed");
    // Return an honest unavailable state instead of 500
    res.json({
      overallStatus: "unavailable",
      computedAt: new Date().toISOString(),
      windowHours,
      workflows: [],
      stages: [],
      renderers: [],
      providers: [],
      plugins: [],
      incidents: [],
      alerts: [
        {
          alertId: "telemetry-unavailable",
          level: "error",
          message: "Observability telemetry unavailable — database unreachable",
          source: "health_endpoint",
          triggeredAt: new Date().toISOString(),
        },
      ],
    });
  }
});

// ── GET /ai/design-observability/metrics ──────────────────────────────────────

router.get("/ai/design-observability/metrics", async (req: Request, res: Response): Promise<void> => {
  const windowHours = parseWindow(req.query.windowHours);
  try {
    await auditAccess(req, "metrics");
    const metrics = await getDesignMetrics(windowHours);
    res.json({ items: metrics, windowHours });
  } catch (err) {
    logger.error({ err }, "[design-observability] metrics failed");
    res.status(503).json({ error: "Metrics unavailable", items: [], windowHours });
  }
});

// ── GET /ai/design-observability/incidents ────────────────────────────────────

router.get("/ai/design-observability/incidents", async (req: Request, res: Response): Promise<void> => {
  const windowHours = parseWindow(req.query.windowHours);
  try {
    await auditAccess(req, "incidents");
    const incidents = await detectIncidents(windowHours);
    const active = incidents.filter((i) => !i.suppressed);
    const suppressed = incidents.filter((i) => i.suppressed);
    res.json({ items: active, suppressed, total: incidents.length, windowHours });
  } catch (err) {
    logger.error({ err }, "[design-observability] incidents failed");
    res.status(503).json({ error: "Incident detection unavailable", items: [], suppressed: [], total: 0, windowHours });
  }
});

// ── GET /ai/design-observability/events ───────────────────────────────────────

router.get("/ai/design-observability/events", async (req: Request, res: Response): Promise<void> => {
  const { limit, offset } = parsePagination(req);
  try {
    await auditAccess(req, "events");
    const result = await getDesignEvents(limit, offset);
    res.json({ ...result, limit, offset });
  } catch (err) {
    logger.error({ err }, "[design-observability] events failed");
    res.status(503).json({ error: "Event stream unavailable", items: [], total: 0, limit, offset });
  }
});

// ── GET /ai/design-observability/summary ─────────────────────────────────────
// Single fetch for the UI — returns health + metrics together.

router.get("/ai/design-observability/summary", async (req: Request, res: Response): Promise<void> => {
  const windowHours = parseWindow(req.query.windowHours);
  try {
    await auditAccess(req, "summary");
    const [health, metrics] = await Promise.all([
      getDesignOperationHealth(windowHours),
      getDesignMetrics(windowHours),
    ]);
    res.json({ health, metrics, windowHours, fetchedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "[design-observability] summary failed");
    res.status(503).json({
      error: "Observability unavailable",
      health: {
        overallStatus: "unavailable",
        computedAt: new Date().toISOString(),
        windowHours,
        workflows: [],
        stages: [],
        renderers: [],
        providers: [],
        plugins: [],
        incidents: [],
        alerts: [],
      },
      metrics: [],
      windowHours,
    });
  }
});

export default router;
