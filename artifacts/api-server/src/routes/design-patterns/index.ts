/**
 * routes/design-patterns/index.ts — Team 09: Pattern Library API
 *
 * Mount point: /design-patterns  (Team 24 wires this to the main router)
 *
 * All write endpoints (POST/PATCH/DELETE) require admin auth.
 * GET endpoints are public within the platform (no auth needed — read-only registry).
 *
 * SHARED FILE LOCK compliance:
 *   ✗ This file does NOT modify routes/index.ts
 *   ✗ This file does NOT modify app.ts
 *   ✓ Team 24 mounts this router via Integration Manifest
 */

import { Router } from "express";
import { z } from "zod/v4";
import { adminAuth } from "../../middleware/adminAuth.js";
import {
  createPattern,
  getPattern,
  listPatterns,
  updatePattern,
  archivePattern,
  createVariant,
  listVariants,
  addCompat,
  listCompat,
  CreatePatternSchema,
  UpdatePatternSchema,
  CreateVariantSchema,
  AddCompatSchema,
  LicensingError,
  PatternNotFoundError,
  PATTERN_DOMAINS,
  PATTERN_CATEGORIES,
  REPEAT_BEHAVIORS,
  SCALE_VALUES,
} from "../../services/design-patterns/patternService.js";
import {
  searchPatterns,
  checkCompatibility,
  PatternSearchQuerySchema,
} from "../../services/design-patterns/patternSearchService.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(err: unknown, res: import("express").Response): void {
  if (err instanceof LicensingError) {
    res.status(422).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof PatternNotFoundError) {
    res.status(404).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Validation failed", issues: err.issues });
    return;
  }
  if (err instanceof Error && err.message.includes("unique")) {
    res.status(409).json({ error: "A pattern with this slug already exists.", code: "SLUG_CONFLICT" });
    return;
  }
  console.error("[design-patterns]", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── Meta endpoints ────────────────────────────────────────────────────────────

/** GET /design-patterns/meta — allowed enum values */
router.get("/meta", (_req, res) => {
  res.json({
    domains:         PATTERN_DOMAINS,
    categories:      PATTERN_CATEGORIES,
    repeat_behaviors: REPEAT_BEHAVIORS,
    scales:          SCALE_VALUES,
    source_types:    ["original", "licensed", "public-domain", "creative-commons"],
    statuses:        ["active", "draft", "archived"],
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * GET /design-patterns/search
 * Query params: q, domain, category, style, repeat_behavior, scale,
 *               colorizable, source_type, context, tags, status,
 *               limit, offset, sort, order
 */
router.get("/search", async (req, res) => {
  try {
    const query = PatternSearchQuerySchema.parse(req.query);
    const result = await searchPatterns(query);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Compatibility check ───────────────────────────────────────────────────────

/**
 * GET /design-patterns/:id/compat/check?context=web
 */
router.get("/:id/compat/check", async (req, res) => {
  try {
    const id      = parseInt(String(req.params["id"] ?? ""), 10);
    const context = z.string().min(1).max(80).parse(req.query["context"]);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const result = await checkCompatibility(id, context);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// ── CRUD: Patterns ────────────────────────────────────────────────────────────

/** GET /design-patterns — list with optional filters */
router.get("/", async (req, res) => {
  try {
    const schema = z.object({
      domain:   z.string().optional(),
      category: z.string().optional(),
      status:   z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(100).default(50),
      offset:   z.coerce.number().int().min(0).default(0),
    });
    const opts = schema.parse(req.query);
    const result = await listPatterns(opts);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

/** POST /design-patterns — create pattern (admin only) */
router.post("/", adminAuth, async (req, res) => {
  try {
    const input = CreatePatternSchema.parse(req.body);
    const createdBy = (req.internalUser as { email?: string } | undefined)?.email;
    const pattern = await createPattern(input, createdBy);
    res.status(201).json(pattern);
  } catch (err) {
    handleError(err, res);
  }
});

/** GET /design-patterns/:id — get by id or slug */
router.get("/:id", async (req, res) => {
  try {
    const idOrSlug = String(req.params["id"] ?? "");
    const pattern = await getPattern(idOrSlug);
    res.json(pattern);
  } catch (err) {
    handleError(err, res);
  }
});

/** PATCH /design-patterns/:id — update pattern (admin only) */
router.patch("/:id", adminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const input = UpdatePatternSchema.parse(req.body);
    const pattern = await updatePattern(id, input);
    res.json(pattern);
  } catch (err) {
    handleError(err, res);
  }
});

/** DELETE /design-patterns/:id — archive pattern (admin only) */
router.delete("/:id", adminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    await archivePattern(id);
    res.json({ success: true, message: "Pattern archived." });
  } catch (err) {
    handleError(err, res);
  }
});

// ── Variants ──────────────────────────────────────────────────────────────────

/** GET /design-patterns/:id/variants */
router.get("/:id/variants", async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const variants = await listVariants(id);
    res.json({ variants });
  } catch (err) {
    handleError(err, res);
  }
});

/** POST /design-patterns/:id/variants — add variant (admin only) */
router.post("/:id/variants", adminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const input = CreateVariantSchema.parse(req.body);
    const variant = await createVariant(id, input);
    res.status(201).json(variant);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Compatibility records ─────────────────────────────────────────────────────

/** GET /design-patterns/:id/compat */
router.get("/:id/compat", async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const records = await listCompat(id);
    res.json({ compat: records });
  } catch (err) {
    handleError(err, res);
  }
});

/** POST /design-patterns/:id/compat — add compat record (admin only) */
router.post("/:id/compat", adminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const input = AddCompatSchema.parse(req.body);
    const record = await addCompat(id, input);
    res.status(201).json(record);
  } catch (err) {
    handleError(err, res);
  }
});

export default router;
