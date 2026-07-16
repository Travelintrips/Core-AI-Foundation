// Team 10 — Font Pairs & Typography Roles routes
// Mount point: /api/ai/design-tokens/font-pairs  (Team 24 registers this)

import { Router } from "express";
import { z } from "zod";
import {
  listFontPairs,
  getFontPairWithRoles,
  getFontPairBySlug,
  createFontPair,
  updateFontPair,
  deactivateFontPair,
  getTypographyRoles,
  upsertTypographyRoles,
  deleteTypographyRole,
  findDuplicateFontPair,
} from "../../services/design-tokens/fontPairService.js";
import {
  getCompatibleFontPairs,
} from "../../services/design-tokens/brandDnaCompatibilityService.js";
import {
  getIndustryRecommendation,
  listAllIndustries,
  rankFontPairForIndustry,
} from "../../services/design-tokens/industryRecommendationService.js";
import { validateTypographyHierarchy } from "../../services/design-tokens/colorUtils.js";
import { logAudit } from "../../services/aiAuditService.js";

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const CreateFontPairSchema = z.object({
  name: z.string().min(2).max(100),
  displayFont: z.string().min(1).max(100),
  bodyFont: z.string().min(1).max(100),
  accentFont: z.string().max(100).optional(),
  category: z.enum(["serif", "sans-serif", "display", "monospace", "handwriting"]),
  mood: z.array(z.enum(["professional", "playful", "elegant", "modern", "traditional", "bold", "minimal", "friendly"])).min(1),
  industries: z.array(z.string()).min(1),
  displayFontWeight: z.string().optional(),
  bodyFontWeight: z.string().optional(),
  license: z.enum(["open", "commercial", "custom"]).optional(),
  pairingRationale: z.string().max(500).optional(),
  sampleHeading: z.string().max(200).optional(),
  sampleBody: z.string().max(500).optional(),
  googleFontsUrl: z.string().url().optional(),
});

const TypographyRoleSchema = z.object({
  role: z.enum(["display", "heading1", "heading2", "heading3", "heading4", "subtitle", "body", "bodySmall", "caption", "label", "overline", "code"]),
  fontFamily: z.string().min(1).max(100),
  fontSize: z.number().positive().max(300),
  fontWeight: z.string().default("400"),
  lineHeight: z.number().positive().max(5),
  letterSpacing: z.number().min(-10).max(50),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
});

const BrandDnaSchema = z.object({
  clientId: z.string(),
  brandPersonality: z.array(z.string()),
  detectedColors: z.object({
    primary: z.string().nullable(),
    palette: z.array(z.string()),
  }),
  confidenceScore: z.number().min(0).max(1),
});

// ── GET /font-pairs ───────────────────────────────────────────────────────────

router.get("/", async (req, res): Promise<void> => {
  try {
    const category = req.query.category as string | undefined;
    const mood = req.query.mood as string | undefined;
    const industry = req.query.industry as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const pairs = await listFontPairs({ category: category as any, mood: mood as any, industry: industry as any, search, limit, offset });
    res.json({ data: pairs, total: pairs.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list font pairs" });
  }
});

// ── GET /font-pairs/:id ───────────────────────────────────────────────────────

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const pair = await getFontPairWithRoles(id);
    if (!pair) { res.status(404).json({ error: "Font pair not found" }); return; }
    res.json(pair);
  } catch (err) {
    res.status(500).json({ error: "Failed to get font pair" });
  }
});

// ── POST /font-pairs ──────────────────────────────────────────────────────────

router.post("/", async (req, res): Promise<void> => {
  const parsed = CreateFontPairSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const pair = await createFontPair(parsed.data);
    await logAudit("design-tokens", "create_font_pair", String(pair.id), "dt_font_pair", "success", { name: pair.name });
    res.status(201).json(pair);
  } catch (err: any) {
    if (err?.code === "DUPLICATE") {
      res.status(409).json({ error: err.message, existingId: err.existingId });
      return;
    }
    res.status(500).json({ error: "Failed to create font pair" });
  }
});

// ── PATCH /font-pairs/:id ─────────────────────────────────────────────────────

router.patch("/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = CreateFontPairSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const pair = await updateFontPair(id, parsed.data);
    await logAudit("design-tokens", "update_font_pair", String(id), "dt_font_pair", "success", {});
    res.json(pair);
  } catch (err: any) {
    if (err?.code === "DUPLICATE") { res.status(409).json({ error: err.message, existingId: err.existingId }); return; }
    if (err?.message === "Font pair not found") { res.status(404).json({ error: "Font pair not found" }); return; }
    res.status(500).json({ error: "Failed to update font pair" });
  }
});

// ── DELETE /font-pairs/:id ────────────────────────────────────────────────────

router.delete("/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await deactivateFontPair(id);
    await logAudit("design-tokens", "deactivate_font_pair", String(id), "dt_font_pair", "success", {});
    res.status(204).end();
  } catch (err: any) {
    if (err?.message === "Font pair not found") { res.status(404).json({ error: "Font pair not found" }); return; }
    res.status(500).json({ error: "Failed to deactivate font pair" });
  }
});

// ── GET /font-pairs/:id/roles ─────────────────────────────────────────────────

router.get("/:id/roles", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const roles = await getTypographyRoles(id);
    res.json({ data: roles });
  } catch (err) {
    res.status(500).json({ error: "Failed to get typography roles" });
  }
});

// ── PUT /font-pairs/:id/roles ─────────────────────────────────────────────────

router.put("/:id/roles", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.array(TypographyRoleSchema).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const result = await upsertTypographyRoles(id, parsed.data);
    if (result.errors.length > 0) {
      res.status(422).json({ error: "Typography hierarchy violation", details: result.errors });
      return;
    }
    res.json({ data: result.roles });
  } catch (err: any) {
    if (err?.message === "Font pair not found") { res.status(404).json({ error: "Font pair not found" }); return; }
    res.status(500).json({ error: "Failed to upsert typography roles" });
  }
});

// ── DELETE /font-pairs/:id/roles/:role ───────────────────────────────────────

router.delete("/:id/roles/:role", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await deleteTypographyRole(id, req.params.role);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete typography role" });
  }
});

// ── POST /font-pairs/validate-hierarchy ──────────────────────────────────────

router.post("/validate-hierarchy", async (req, res): Promise<void> => {
  const parsed = z.array(z.object({ role: z.string(), fontSize: z.number() })).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const errors = validateTypographyHierarchy(parsed.data);
  res.json({ valid: errors.length === 0, errors });
});

// ── POST /font-pairs/check-duplicate ─────────────────────────────────────────

router.post("/check-duplicate", async (req, res): Promise<void> => {
  const parsed = z.object({ displayFont: z.string(), bodyFont: z.string() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const dup = await findDuplicateFontPair(parsed.data.displayFont, parsed.data.bodyFont);
    res.json({ isDuplicate: !!dup, existingPair: dup ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to check duplicate" });
  }
});

// ── POST /font-pairs/brand-dna-compatible ────────────────────────────────────

router.post("/brand-dna-compatible", async (req, res): Promise<void> => {
  const parsed = BrandDnaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const results = await getCompatibleFontPairs(parsed.data, limit);
    res.json({ data: results });
  } catch (err) {
    res.status(500).json({ error: "Failed to compute compatibility" });
  }
});

// ── GET /font-pairs/industry/:industry ───────────────────────────────────────

router.get("/industry/:industry", async (req, res): Promise<void> => {
  try {
    const rec = getIndustryRecommendation(req.params.industry as any);
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: "Failed to get industry recommendation" });
  }
});

export default router;
