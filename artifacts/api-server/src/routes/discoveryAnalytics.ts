/**
 * discoveryAnalytics.ts — V4.2I Analytics Routes
 *
 * Public ingestion (hardened, rate-limited, anonymous-safe):
 *   POST /api/analytics/discovery/events          — single event
 *   POST /api/analytics/discovery/events/batch    — up to 25 events
 *
 * Admin reporting (adminAuth required):
 *   GET  /api/ai/admin/analytics/discovery/overview
 *   GET  /api/ai/admin/analytics/discovery/goals
 *   GET  /api/ai/admin/analytics/discovery/services
 *   GET  /api/ai/admin/analytics/discovery/collections
 *   GET  /api/ai/admin/analytics/discovery/funnel
 *   GET  /api/ai/admin/analytics/discovery/conversion
 *   GET  /api/ai/admin/analytics/discovery/errors
 *   GET  /api/ai/admin/analytics/discovery/quality
 *
 * Feature flags (admin):
 *   GET  /api/ai/admin/analytics/flags
 *   POST /api/ai/admin/analytics/flags/:key
 *   POST /api/ai/admin/analytics/flags/seed
 *   GET  /api/analytics/flags/:key              — public flag check (no secrets)
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  ingestDiscoveryEvent,
  batchIngestDiscoveryEvents,
  getDiscoveryOverview,
  getTopGoals,
  getTopServices,
  getTopCollections,
  getFunnelMetrics,
  getConversionMetrics,
  getDataQualityReport,
  FUNNELS,
} from "../services/discoveryAnalyticsService.js";
import {
  isFlagEnabled,
  getAllFlags,
  upsertFlag,
  seedDefaultFlags,
} from "../services/featureFlagService.js";
import { adminAuth } from "../middleware/adminAuth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Rate limiters for public ingestion ───────────────────────────────────────

const analyticsIngestionLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: 120,                     // 120 events/min per IP (generous for browser batching)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many analytics events. Please slow down.", code: "RATE_LIMIT_EXCEEDED" });
  },
  skip: (req) => {
    // Skip for server-to-server calls with admin key
    const key = process.env["ADMIN_API_KEY"];
    if (!key) return false;
    const provided = (req.headers["x-admin-api-key"] as string | undefined) ?? "";
    return provided === key;
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_DATE_RANGE_DAYS = 90;

function parseDateRange(query: Record<string, unknown>): {
  startDate: Date;
  endDate: Date;
  error?: string;
} {
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 30);

  const startDate = query["start_date"]
    ? new Date(String(query["start_date"]))
    : defaultStart;
  const endDate = query["end_date"] ? new Date(String(query["end_date"])) : now;

  if (isNaN(startDate.getTime())) return { startDate: defaultStart, endDate: now, error: "Invalid start_date" };
  if (isNaN(endDate.getTime())) return { startDate: defaultStart, endDate: now, error: "Invalid end_date" };
  if (endDate < startDate) return { startDate: defaultStart, endDate: now, error: "end_date must be after start_date" };

  const rangeDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    return {
      startDate: defaultStart,
      endDate: now,
      error: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`,
    };
  }

  return { startDate, endDate };
}

function resolveEnvironment(query: Record<string, unknown>): string {
  const nodeEnv = process.env["NODE_ENV"] === "production" ? "production" : "development";
  const requested = String(query["environment"] ?? nodeEnv);
  return ["production", "development"].includes(requested) ? requested : nodeEnv;
}

// ── POST /api/analytics/discovery/events ─────────────────────────────────────

router.post(
  "/analytics/discovery/events",
  analyticsIngestionLimiter,
  async (req, res): Promise<void> => {
    try {
      const result = await ingestDiscoveryEvent(req.body, req);
      if (!result.accepted && !result.duplicate) {
        res.status(422).json({ error: result.error, code: "EVENT_REJECTED" });
        return;
      }
      res.status(result.duplicate ? 200 : 201).json({
        eventId: result.eventId,
        accepted: result.accepted,
        duplicate: result.duplicate,
      });
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] ingestion error");
      // Never block the caller — analytics failure must be invisible to users
      res.status(202).json({ accepted: false, error: "Internal error", duplicate: false, eventId: "" });
    }
  },
);

// ── POST /api/analytics/discovery/events/batch ───────────────────────────────

router.post(
  "/analytics/discovery/events/batch",
  analyticsIngestionLimiter,
  async (req, res): Promise<void> => {
    try {
      const { events } = req.body as { events?: unknown };
      if (!Array.isArray(events)) {
        res.status(400).json({ error: "events must be an array", code: "INVALID_PAYLOAD" });
        return;
      }
      if (events.length === 0) {
        res.status(400).json({ error: "events array is empty", code: "INVALID_PAYLOAD" });
        return;
      }
      if (events.length > 25) {
        res.status(400).json({ error: "Batch size cannot exceed 25 events", code: "BATCH_TOO_LARGE" });
        return;
      }

      const result = await batchIngestDiscoveryEvents(events, req);
      res.status(200).json(result);
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] batch ingestion error");
      res.status(202).json({ total: 0, accepted: 0, duplicates: 0, rejected: 0, results: [] });
    }
  },
);

// ── Public feature flag check ─────────────────────────────────────────────────
// Returns only enabled/disabled — no internal configuration exposed.

router.get("/analytics/flags/:key", async (req, res): Promise<void> => {
  try {
    const { key } = req.params as { key: string };
    const sessionId = req.query["session_id"] as string | undefined;
    const enabled = await isFlagEnabled(key, { sessionId });
    res.json({ key, enabled });
  } catch (err) {
    logger.warn({ err }, "[feature-flags] public check failed");
    res.json({ key: req.params["key"], enabled: false });
  }
});

// ── Admin reporting routes (all require adminAuth) ────────────────────────────

router.get(
  "/ai/admin/analytics/discovery/overview",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);
      const tenantId = req.query["tenant_id"] as string | undefined;

      const data = await getDiscoveryOverview({ startDate, endDate, environment, tenantId });
      res.json(data);
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] overview query failed");
      res.status(500).json({ error: "Failed to fetch overview" });
    }
  },
);

router.get(
  "/ai/admin/analytics/discovery/goals",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);
      const limit = Math.min(Number(req.query["limit"] ?? 20), 100);

      const data = await getTopGoals({ startDate, endDate, environment, limit });
      res.json({ goals: data, dataFreshnessAt: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] goals query failed");
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  },
);

router.get(
  "/ai/admin/analytics/discovery/services",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);
      const limit = Math.min(Number(req.query["limit"] ?? 20), 100);

      const data = await getTopServices({ startDate, endDate, environment, limit });
      res.json({ services: data, dataFreshnessAt: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] services query failed");
      res.status(500).json({ error: "Failed to fetch services" });
    }
  },
);

router.get(
  "/ai/admin/analytics/discovery/collections",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);
      const limit = Math.min(Number(req.query["limit"] ?? 20), 100);

      const data = await getTopCollections({ startDate, endDate, environment, limit });
      res.json({ collections: data, dataFreshnessAt: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] collections query failed");
      res.status(500).json({ error: "Failed to fetch collections" });
    }
  },
);

router.get(
  "/ai/admin/analytics/discovery/funnel",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);
      const rawFunnel = String(req.query["funnel"] ?? "goal_discovery");
      const funnelName = Object.keys(FUNNELS).includes(rawFunnel)
        ? (rawFunnel as keyof typeof FUNNELS)
        : "goal_discovery";

      const data = await getFunnelMetrics({ funnelName, startDate, endDate, environment });
      res.json({
        funnel: funnelName,
        steps: data,
        dataFreshnessAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] funnel query failed");
      res.status(500).json({ error: "Failed to fetch funnel" });
    }
  },
);

router.get(
  "/ai/admin/analytics/discovery/conversion",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);

      const data = await getConversionMetrics({ startDate, endDate, environment });
      res.json({ ...data, dataFreshnessAt: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] conversion query failed");
      res.status(500).json({ error: "Failed to fetch conversion metrics" });
    }
  },
);

router.get(
  "/ai/admin/analytics/discovery/errors",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);

      // Errors are operational events tracked in the main events table
      const data = await getConversionMetrics({ startDate, endDate, environment });
      res.json({
        errorRate: data.errorRate,
        emptyResultRate: data.emptyResultRate,
        dataFreshnessAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] errors query failed");
      res.status(500).json({ error: "Failed to fetch error metrics" });
    }
  },
);

router.get(
  "/ai/admin/analytics/discovery/quality",
  adminAuth,
  async (req, res): Promise<void> => {
    try {
      const { startDate, endDate, error } = parseDateRange(req.query as Record<string, unknown>);
      if (error) { res.status(400).json({ error }); return; }
      const environment = resolveEnvironment(req.query as Record<string, unknown>);

      const data = await getDataQualityReport({ startDate, endDate, environment });
      res.json(data);
    } catch (err) {
      logger.error({ err }, "[discovery-analytics] quality query failed");
      res.status(500).json({ error: "Failed to fetch quality report" });
    }
  },
);

// ── Feature flag admin routes ─────────────────────────────────────────────────

// POST /seed must be declared BEFORE /:key to avoid route shadowing
router.post("/ai/admin/analytics/flags/seed", adminAuth, async (_req, res): Promise<void> => {
  try {
    await seedDefaultFlags();
    res.json({ message: "Default V4.2 flags seeded" });
  } catch (err) {
    logger.error({ err }, "[feature-flags] seed failed");
    res.status(500).json({ error: "Failed to seed flags" });
  }
});

router.get("/ai/admin/analytics/flags", adminAuth, async (_req, res): Promise<void> => {
  try {
    const flags = await getAllFlags();
    res.json({ flags });
  } catch (err) {
    logger.error({ err }, "[feature-flags] list failed");
    res.status(500).json({ error: "Failed to fetch flags" });
  }
});

router.post("/ai/admin/analytics/flags/:key", adminAuth, async (req, res): Promise<void> => {
  try {
    const { key } = req.params as { key: string };
    const { enabled, rolloutPercent, description } = req.body as {
      enabled?: boolean;
      rolloutPercent?: number;
      description?: string;
    };

    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }
    if (rolloutPercent !== undefined && (rolloutPercent < 0 || rolloutPercent > 100)) {
      res.status(400).json({ error: "rolloutPercent must be 0–100" });
      return;
    }

    const updatedBy = req.internalUser?.email ?? "admin-api-key";

    const flag = await upsertFlag({ flagKey: key, enabled, rolloutPercent, description, updatedBy });
    res.json(flag);
  } catch (err) {
    logger.error({ err }, "[feature-flags] upsert failed");
    res.status(500).json({ error: "Failed to update flag" });
  }
});

export default router;
