/**
 * Universal Design Blueprint Library — REST Routes (Team 7)
 *
 * IMPORTANT: These routes do NOT include /api (that's the app.ts mount prefix).
 * Team 24 mounts this router by adding:
 *   import designBlueprintsRouter from "./design-blueprints/index.js";
 *   router.use(designBlueprintsRouter);
 * to artifacts/api-server/src/routes/index.ts.
 *
 * Do NOT import zod/v4 — use plain zod via local schemas.
 *
 * Routes:
 *   GET  /ai/design-blueprints              — list (filter by domain/status/tag)
 *   GET  /ai/design-blueprints/stats        — registry stats
 *   GET  /ai/design-blueprints/domain/:domain — list by domain
 *   GET  /ai/design-blueprints/:id          — get by id or slug
 *   POST /ai/design-blueprints              — create custom blueprint
 *   PATCH /ai/design-blueprints/:id         — update custom blueprint
 *   POST /ai/design-blueprints/:id/deprecate — deprecate custom blueprint
 *   POST /ai/design-blueprints/validate     — validate a blueprint payload
 *   POST /ai/design-blueprints/check-compatibility — check component/version compat
 *   POST /ai/design-blueprints/normalize    — normalize a blueprint payload
 */

import { Router } from "express";
import { z } from "zod";
import {
  listBlueprints,
  getBlueprintById,
  getBlueprintBySlug,
  getBlueprintsByDomain,
  createCustomBlueprint,
  updateCustomBlueprint,
  deprecateCustomBlueprint,
  validateBlueprintPayload,
  checkBlueprintCompatibility,
  normalizeBlueprintPayload,
  getBlueprintStats,
} from "../../services/design-blueprints/index.js";
import { BLUEPRINT_DOMAINS, BLUEPRINT_STATUSES } from "../../services/design-blueprints/types.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(res: any, err: unknown, context: string) {
  logger.error({ err, context }, "design-blueprints route error");
  res.status(500).json({ error: "Internal server error" });
}

// ── List filter schema ────────────────────────────────────────────────────────

const listFilterSchema = z.object({
  domain:      z.enum(BLUEPRINT_DOMAINS).optional(),
  status:      z.enum(BLUEPRINT_STATUSES).optional(),
  industryTag: z.string().max(60).optional(),
  styleTag:    z.string().max(60).optional(),
  limit:       z.coerce.number().int().min(1).max(200).default(50),
  offset:      z.coerce.number().int().min(0).default(0),
});

// ── Compatibility request schema ──────────────────────────────────────────────

const compatRequestSchema = z.object({
  blueprintId:     z.string().min(1).max(120),
  schemaVersion:   z.string().min(1).max(20),
  componentTypes:  z.array(z.string().min(1).max(80)).optional(),
  slotTypesFilled: z.record(z.string(), z.number().int().min(0)).optional(),
});

// ── GET /ai/design-blueprints/stats ──────────────────────────────────────────
// NOTE: static routes must be declared before parameterised routes

router.get("/ai/design-blueprints/stats", (_req, res) => {
  try {
    res.json(getBlueprintStats());
  } catch (err) {
    handleError(res, err, "GET /ai/design-blueprints/stats");
  }
});

// ── GET /ai/design-blueprints ─────────────────────────────────────────────────

router.get("/ai/design-blueprints", (req, res) => {
  try {
    const parsed = listFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
    }
    const blueprints = listBlueprints(parsed.data);
    res.json({ blueprints, total: blueprints.length });
  } catch (err) {
    handleError(res, err, "GET /ai/design-blueprints");
  }
});

// ── GET /ai/design-blueprints/domain/:domain ─────────────────────────────────

router.get("/ai/design-blueprints/domain/:domain", (req, res) => {
  try {
    const domainParam = req.params.domain as string;
    if (!BLUEPRINT_DOMAINS.includes(domainParam as any)) {
      return res.status(400).json({
        error: "Invalid domain",
        allowedDomains: BLUEPRINT_DOMAINS,
      });
    }
    const blueprints = getBlueprintsByDomain(domainParam as any);
    res.json({ domain: domainParam, blueprints, total: blueprints.length });
  } catch (err) {
    handleError(res, err, "GET /ai/design-blueprints/domain/:domain");
  }
});

// ── GET /ai/design-blueprints/:id ────────────────────────────────────────────

router.get("/ai/design-blueprints/:id", (req, res) => {
  try {
    const { id } = req.params;
    // Support lookup by id OR slug
    const blueprint = getBlueprintById(id!) ?? getBlueprintBySlug(id!);
    if (!blueprint) {
      return res.status(404).json({ error: "Blueprint not found" });
    }
    res.json(blueprint);
  } catch (err) {
    handleError(res, err, "GET /ai/design-blueprints/:id");
  }
});

// ── POST /ai/design-blueprints ────────────────────────────────────────────────

router.post("/ai/design-blueprints", (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }
    const { blueprint, validation } = createCustomBlueprint(body);
    if (!validation.valid) {
      return res.status(422).json({
        error: "Blueprint validation failed",
        issues: validation.issues,
      });
    }
    res.status(201).json({ blueprint, validation });
  } catch (err) {
    handleError(res, err, "POST /ai/design-blueprints");
  }
});

// ── PATCH /ai/design-blueprints/:id ──────────────────────────────────────────

router.patch("/ai/design-blueprints/:id", (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }
    const result = updateCustomBlueprint(id!, body);
    if (result.notFound) return res.status(404).json({ error: "Blueprint not found" });
    if (!result.validation.valid) {
      return res.status(422).json({
        error: "Blueprint validation failed",
        issues: result.validation.issues,
      });
    }
    res.json({ blueprint: result.blueprint, validation: result.validation });
  } catch (err) {
    handleError(res, err, "PATCH /ai/design-blueprints/:id");
  }
});

// ── POST /ai/design-blueprints/:id/deprecate ─────────────────────────────────

router.post("/ai/design-blueprints/:id/deprecate", (req, res) => {
  try {
    const { id } = req.params;
    const result = deprecateCustomBlueprint(id!);
    if (result.notFound) return res.status(404).json({ error: "Blueprint not found" });
    if (result.builtin) return res.status(403).json({ error: "Built-in blueprints cannot be deprecated via API" });
    res.json({ success: true });
  } catch (err) {
    handleError(res, err, "POST /ai/design-blueprints/:id/deprecate");
  }
});

// ── POST /ai/design-blueprints/validate ──────────────────────────────────────

router.post("/ai/design-blueprints/validate", (req, res) => {
  try {
    const result = validateBlueprintPayload(req.body);
    const status = result.valid ? 200 : 422;
    res.status(status).json(result);
  } catch (err) {
    handleError(res, err, "POST /ai/design-blueprints/validate");
  }
});

// ── POST /ai/design-blueprints/check-compatibility ───────────────────────────

router.post("/ai/design-blueprints/check-compatibility", (req, res) => {
  try {
    const parsed = compatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    }
    const result = checkBlueprintCompatibility(parsed.data as any);
    if (result.blueprintNotFound) {
      return res.status(404).json({ error: "Blueprint not found", issues: result.issues });
    }
    res.status(result.compatible ? 200 : 422).json(result);
  } catch (err) {
    handleError(res, err, "POST /ai/design-blueprints/check-compatibility");
  }
});

// ── POST /ai/design-blueprints/normalize ─────────────────────────────────────

router.post("/ai/design-blueprints/normalize", (req, res) => {
  try {
    const result = normalizeBlueprintPayload(req.body);
    res.status(result.valid ? 200 : 422).json(result);
  } catch (err) {
    handleError(res, err, "POST /ai/design-blueprints/normalize");
  }
});

export default router;
