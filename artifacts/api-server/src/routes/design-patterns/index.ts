/**
 * routes/design-patterns/index.ts — Team 09: Pattern Library API
 *
 * Mount point: /design-patterns  (Team 24 wires this to the main router)
 *
 * AUTH MODEL:
 *   All mutation routes (POST / PATCH / DELETE) → explicit adminAuth middleware.
 *   Public GET routes → return only published/approved, license-safe patterns.
 *   Admin GET (via x-admin-key) → future extension; not in scope for Team 09.
 *
 * LOCKED FILE COMPLIANCE:
 *   ✗ Does NOT modify routes/index.ts
 *   ✗ Does NOT modify app.ts
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
  PatternNotFoundError,
  DuplicateSlugError,
  PATTERN_DOMAINS,
  PATTERN_CATEGORIES,
  REPEAT_BEHAVIORS,
  SCALE_VALUES,
  MAX_PATTERN_LIMIT,
  isPublicStatus,
} from "../../services/design-patterns/patternService.js";
import {
  LicensingError,
} from "../../services/design-patterns/patternAdapter.js";
import {
  searchPatterns,
  checkCompatibility,
  PatternSearchQuerySchema,
} from "../../services/design-patterns/patternSearchService.js";

const router = Router();

// ── Error handler ─────────────────────────────────────────────────────────────

function handleError(err: unknown, res: import("express").Response): void {
  if (err instanceof LicensingError) {
    res.status(422).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof PatternNotFoundError) {
    res.status(404).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof DuplicateSlugError) {
    res.status(409).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Validation failed", issues: err.issues });
    return;
  }
  // Catch-all for DB unique violations not wrapped by service layer
  if (err instanceof Error && err.message.toLowerCase().includes("unique")) {
    res.status(409).json({ error: "A pattern with this slug already exists.", code: "SLUG_CONFLICT" });
    return;
  }
  console.error("[design-patterns]", err);
  res.status(500).json({ error: "Internal server error" });
}

// ── Meta endpoints (public) ───────────────────────────────────────────────────

/** GET /design-patterns/meta — allowed enum values */
router.get("/meta", (_req, res) => {
  res.json({
    domains:          PATTERN_DOMAINS,
    categories:       PATTERN_CATEGORIES,
    repeat_behaviors: REPEAT_BEHAVIORS,
    scales:           SCALE_VALUES,
    source_types:     ["original", "licensed", "public-domain", "creative-commons"],
    statuses:         ["draft", "active", "published", "approved", "archived"],
    public_statuses:  ["published", "approved"],
    max_limit:        MAX_PATTERN_LIMIT,
  });
});

// ── Search (public — locked to published/approved + license-safe) ─────────────

/**
 * GET /design-patterns/search
 * Always returns published/approved, license-safe patterns only.
 * Query: q, domain, category, style, repeat_behavior, scale,
 *        colorizable, source_type, context, tags, limit, offset, sort, order
 */
router.get("/search", async (req, res) => {
  try {
    const query  = PatternSearchQuerySchema.parse(req.query);
    const result = await searchPatterns(query, /* publicOnly= */ true);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Compatibility check (public) ──────────────────────────────────────────────

/** GET /design-patterns/:id/compat/check?context=web */
router.get("/:id/compat/check", async (req, res) => {
  try {
    const id      = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const context = z.string().min(1).max(80).parse(req.query["context"]);
    const result  = await checkCompatibility(id, context);
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// ── List patterns (public — locked to published/approved + license-safe) ──────

/**
 * GET /design-patterns
 * Returns published/approved, license-safe patterns only. Callers cannot override status.
 * Query: domain, category, limit (max 100), offset
 */
router.get("/", async (req, res) => {
  try {
    const schema = z.object({
      domain:   z.string().optional(),
      category: z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(MAX_PATTERN_LIMIT).default(50),
      offset:   z.coerce.number().int().min(0).default(0),
    });
    const opts   = schema.parse(req.query);
    // P0: publicOnly=true — locks status to published/approved + license-safe
    const result = await listPatterns({ ...opts, publicOnly: true });
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Create pattern (admin only) ───────────────────────────────────────────────

/**
 * POST /design-patterns — create pattern
 * Requires admin auth. Returns 409 on duplicate slug, 422 on licensing violation.
 */
router.post("/", adminAuth, async (req, res) => {
  try {
    const input      = CreatePatternSchema.parse(req.body);
    const createdBy  = (req.internalUser as { email?: string } | undefined)?.email;
    const pattern    = await createPattern(input, createdBy);
    res.status(201).json(pattern);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Get pattern by id or slug (public — 404 if not published/approved) ────────

/**
 * GET /design-patterns/:id
 * Returns pattern only if status is published or approved (public visibility rule).
 * Draft, active, archived patterns → 404 to public callers.
 */
router.get("/:id", async (req, res) => {
  try {
    const idOrSlug = String(req.params["id"] ?? "");
    const pattern  = await getPattern(idOrSlug);

    // P0: public visibility filter — non-public statuses are 404 to callers
    if (!isPublicStatus(pattern.status)) {
      res.status(404).json({ error: "Pattern not found", code: "PATTERN_NOT_FOUND" });
      return;
    }
    res.json(pattern);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Update pattern (admin only) ───────────────────────────────────────────────

/**
 * PATCH /design-patterns/:id — update pattern fields
 * Requires admin auth. Returns 422 on licensing violation.
 */
router.patch("/:id", adminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const input   = UpdatePatternSchema.parse(req.body);
    const pattern = await updatePattern(id, input);
    res.json(pattern);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Archive pattern (admin only) ──────────────────────────────────────────────

/**
 * DELETE /design-patterns/:id — archive (soft delete)
 * Requires admin auth.
 */
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

/** GET /design-patterns/:id/variants (public) */
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

/**
 * POST /design-patterns/:id/variants — add variant (admin only)
 * Requires admin auth.
 */
router.post("/:id/variants", adminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const input   = CreateVariantSchema.parse(req.body);
    const variant = await createVariant(id, input);
    res.status(201).json(variant);
  } catch (err) {
    handleError(err, res);
  }
});

// ── Compatibility records ─────────────────────────────────────────────────────

/** GET /design-patterns/:id/compat (public) */
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

/**
 * POST /design-patterns/:id/compat — add compat record (admin only)
 * Requires admin auth.
 */
router.post("/:id/compat", adminAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid pattern id" }); return; }
    const input  = AddCompatSchema.parse(req.body);
    const record = await addCompat(id, input);
    res.status(201).json(record);
  } catch (err) {
    handleError(err, res);
  }
});

export default router;
