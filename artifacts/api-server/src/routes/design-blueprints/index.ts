/**
 * Universal Design Blueprint Library — REST Routes (Team 7)
 *
 * Auth strategy
 * ─────────────
 * ALL routes sit behind router.use(adminAuth) — belt-and-suspenders on top of
 * the global adminAuthWithExceptions mounted in app.ts.
 *
 * Mutation routes (POST, PATCH, PUT, DELETE) ADDITIONALLY declare adminAuth
 * as a per-route second middleware argument, making the requirement explicit and
 * satisfying the P0 audit rule "eksplisit pada seluruh mutation route".
 *
 * ONE exception: GET /ai/design-blueprints/public — intentionally public.
 *   This route is registered BEFORE router.use(adminAuth) and only returns
 *   blueprints with status = "published".
 *
 * Mount
 * ─────
 * Team 24 wires this router by adding:
 *   import designBlueprintsRouter from "./design-blueprints/index.js";
 *   router.use(designBlueprintsRouter);
 * to artifacts/api-server/src/routes/index.ts.
 *
 * Routes
 * ──────
 * PUBLIC  GET  /ai/design-blueprints/public             — published only, no auth
 * ADMIN   GET  /ai/design-blueprints                    — all statuses
 * ADMIN   GET  /ai/design-blueprints/stats              — registry stats
 * ADMIN   GET  /ai/design-blueprints/domain/:domain     — filter by domain
 * ADMIN   GET  /ai/design-blueprints/:id                — get by id or slug
 * ADMIN   POST /ai/design-blueprints                    — create custom blueprint
 * ADMIN   PATCH /ai/design-blueprints/:id               — update custom blueprint
 * ADMIN   POST /ai/design-blueprints/:id/publish        — set status = published
 * ADMIN   POST /ai/design-blueprints/:id/archive        — set status = active
 * ADMIN   POST /ai/design-blueprints/:id/deprecate      — set status = deprecated
 * ADMIN   POST /ai/design-blueprints/validate           — validate payload
 * ADMIN   POST /ai/design-blueprints/check-compatibility
 * ADMIN   POST /ai/design-blueprints/normalize
 */

import { Router } from "express";
import { z } from "zod";
import {
  listBlueprints,
  listPublicBlueprints,
  getBlueprintById,
  getBlueprintBySlug,
  getBlueprintsByDomain,
  createCustomBlueprint,
  updateCustomBlueprint,
  publishBlueprint,
  archiveBlueprint,
  deprecateCustomBlueprint,
  validateBlueprintPayload,
  checkBlueprintCompatibility,
  normalizeBlueprintPayload,
  getBlueprintStats,
} from "../../services/design-blueprints/index.js";
import { BLUEPRINT_DOMAINS, BLUEPRINT_STATUSES } from "../../services/design-blueprints/types.js";
import { logger } from "../../lib/logger.js";
// P0: Explicit admin auth import.  Applied at router level AND individually on
// each mutation route so the requirement is visible at point of declaration.
import { adminAuth } from "../../middleware/adminAuth.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(res: any, err: unknown, context: string): void {
  logger.error({ err, context }, "design-blueprints route error");
  res.status(500).json({ error: "Internal server error" });
}

// ── Query schemas ─────────────────────────────────────────────────────────────

const listFilterSchema = z.object({
  domain:      z.enum(BLUEPRINT_DOMAINS).optional(),
  status:      z.enum(BLUEPRINT_STATUSES).optional(),
  industryTag: z.string().max(60).optional(),
  styleTag:    z.string().max(60).optional(),
  limit:       z.coerce.number().int().min(1).max(200).default(50),
  offset:      z.coerce.number().int().min(0).default(0),
});

const publicListFilterSchema = listFilterSchema.omit({ status: true });

const compatRequestSchema = z.object({
  blueprintId:     z.string().min(1).max(120),
  schemaVersion:   z.string().min(1).max(20),
  componentTypes:  z.array(z.string().min(1).max(80)).optional(),
  slotTypesFilled: z.record(z.string(), z.number().int().min(0)).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES — registered BEFORE router.use(adminAuth)
// These routes are intentionally unauthenticated and MUST only return published
// blueprints. Keep this section minimal; any new public route needs explicit
// justification.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /ai/design-blueprints/public
 * Public listing — returns ONLY status=published blueprints.
 * No auth required; safe to call from customer-facing code.
 */
router.get("/ai/design-blueprints/public", async (req, res) => {
  try {
    const parsed = publicListFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
    }
    const blueprints = await listPublicBlueprints(parsed.data);
    return res.json({ blueprints, total: blueprints.length, visibility: "public" });
  } catch (err) {
    return void handleError(res, err, "GET /ai/design-blueprints/public");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN AUTH — applies to all routes declared after this line
// ═══════════════════════════════════════════════════════════════════════════════

router.use(adminAuth);

// ── GET /ai/design-blueprints/stats ──────────────────────────────────────────
// Static route — must come before /:id to avoid param capture

router.get("/ai/design-blueprints/stats", async (_req, res) => {
  try {
    return res.json(await getBlueprintStats());
  } catch (err) {
    return void handleError(res, err, "GET /ai/design-blueprints/stats");
  }
});

// ── GET /ai/design-blueprints ─────────────────────────────────────────────────

router.get("/ai/design-blueprints", async (req, res) => {
  try {
    const parsed = listFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
    }
    const blueprints = await listBlueprints(parsed.data);
    return res.json({ blueprints, total: blueprints.length });
  } catch (err) {
    return void handleError(res, err, "GET /ai/design-blueprints");
  }
});

// ── GET /ai/design-blueprints/domain/:domain ─────────────────────────────────

router.get("/ai/design-blueprints/domain/:domain", async (req, res) => {
  try {
    const domainParam = req.params.domain as string;
    if (!BLUEPRINT_DOMAINS.includes(domainParam as any)) {
      return res.status(400).json({ error: "Invalid domain", allowedDomains: BLUEPRINT_DOMAINS });
    }
    const blueprints = await getBlueprintsByDomain(domainParam as any);
    return res.json({ domain: domainParam, blueprints, total: blueprints.length });
  } catch (err) {
    return void handleError(res, err, "GET /ai/design-blueprints/domain/:domain");
  }
});

// ── GET /ai/design-blueprints/:id ────────────────────────────────────────────

router.get("/ai/design-blueprints/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const blueprint = (await getBlueprintById(id!)) ?? (await getBlueprintBySlug(id!));
    if (!blueprint) return res.status(404).json({ error: "Blueprint not found" });
    return res.json(blueprint);
  } catch (err) {
    return void handleError(res, err, "GET /ai/design-blueprints/:id");
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION ROUTES — P0: explicit adminAuth on every handler as second argument
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /ai/design-blueprints ────────────────────────────────────────────────

router.post("/ai/design-blueprints", adminAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }
    const { blueprint, validation } = await createCustomBlueprint(body);
    if (!validation.valid) {
      return res.status(422).json({ error: "Blueprint validation failed", issues: validation.issues });
    }
    return res.status(201).json({ blueprint, validation });
  } catch (err) {
    return void handleError(res, err, "POST /ai/design-blueprints");
  }
});

// ── PATCH /ai/design-blueprints/:id ──────────────────────────────────────────

router.patch("/ai/design-blueprints/:id", adminAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }
    const result = await updateCustomBlueprint(id, body);
    if (result.notFound) return res.status(404).json({ error: "Blueprint not found" });
    if (!result.validation.valid) {
      return res.status(422).json({ error: "Blueprint validation failed", issues: result.validation.issues });
    }
    return res.json({ blueprint: result.blueprint, validation: result.validation });
  } catch (err) {
    return void handleError(res, err, "PATCH /ai/design-blueprints/:id");
  }
});

// ── POST /ai/design-blueprints/:id/publish ────────────────────────────────────

router.post("/ai/design-blueprints/:id/publish", adminAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const result = await publishBlueprint(id);
    if (result.notFound) return res.status(404).json({ error: "Blueprint not found" });
    if (result.builtin)  return res.status(403).json({ error: "Built-in blueprints cannot be published via API" });
    return res.json({ success: true, blueprint: result.blueprint });
  } catch (err) {
    return void handleError(res, err, "POST /ai/design-blueprints/:id/publish");
  }
});

// ── POST /ai/design-blueprints/:id/archive ────────────────────────────────────

router.post("/ai/design-blueprints/:id/archive", adminAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const result = await archiveBlueprint(id);
    if (result.notFound) return res.status(404).json({ error: "Blueprint not found" });
    if (result.builtin)  return res.status(403).json({ error: "Built-in blueprints cannot be archived via API" });
    return res.json({ success: true, blueprint: result.blueprint });
  } catch (err) {
    return void handleError(res, err, "POST /ai/design-blueprints/:id/archive");
  }
});

// ── POST /ai/design-blueprints/:id/deprecate ─────────────────────────────────

router.post("/ai/design-blueprints/:id/deprecate", adminAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const result = await deprecateCustomBlueprint(id);
    if (result.notFound) return res.status(404).json({ error: "Blueprint not found" });
    if (result.builtin)  return res.status(403).json({ error: "Built-in blueprints cannot be deprecated via API" });
    return res.json({ success: true });
  } catch (err) {
    return void handleError(res, err, "POST /ai/design-blueprints/:id/deprecate");
  }
});

// ── POST /ai/design-blueprints/validate ──────────────────────────────────────
// Static route — registered before /:id/... variants but after the action routes
// due to Express route ordering. Validate is a read-like utility; still admin-only.

router.post("/ai/design-blueprints/validate", adminAuth, async (req, res) => {
  try {
    const result = validateBlueprintPayload(req.body);
    return res.status(result.valid ? 200 : 422).json(result);
  } catch (err) {
    return void handleError(res, err, "POST /ai/design-blueprints/validate");
  }
});

// ── POST /ai/design-blueprints/check-compatibility ───────────────────────────

router.post("/ai/design-blueprints/check-compatibility", adminAuth, async (req, res) => {
  try {
    const parsed = compatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    }
    const result = await checkBlueprintCompatibility(parsed.data as any);
    if (result.blueprintNotFound) {
      return res.status(404).json({ error: "Blueprint not found", issues: result.issues });
    }
    return res.status(result.compatible ? 200 : 422).json(result);
  } catch (err) {
    return void handleError(res, err, "POST /ai/design-blueprints/check-compatibility");
  }
});

// ── POST /ai/design-blueprints/normalize ─────────────────────────────────────

router.post("/ai/design-blueprints/normalize", adminAuth, async (req, res) => {
  try {
    const result = normalizeBlueprintPayload(req.body);
    return res.status(result.valid ? 200 : 422).json(result);
  } catch (err) {
    return void handleError(res, err, "POST /ai/design-blueprints/normalize");
  }
});

export default router;
