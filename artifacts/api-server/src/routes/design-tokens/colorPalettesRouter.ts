// Team 10 — Color Palettes & Semantic Roles routes
// Mount point: /api/ai/design-tokens/color-palettes  (Team 24 registers this)

import { Router } from "express";
import { z } from "zod";
import { adminAuth, adminAuthWithExceptions } from "../../middleware/adminAuth.js";
import {
  listColorPalettes,
  getColorPaletteWithRoles,
  getColorPaletteBySlug,
  createColorPalette,
  updateColorPalette,
  deactivateColorPalette,
  getSemanticRoles,
  upsertSemanticRoles,
  findDuplicatePalette,
} from "../../services/design-tokens/colorPaletteService.js";
import {
  getCompatiblePalettes,
  scoreSpecificCombination,
} from "../../services/design-tokens/brandDnaCompatibilityService.js";
import {
  checkContrast,
  validatePaletteContrast,
  hexToHsl,
  hexToCmyk,
  formatCmyk,
  isPrintSafe,
  toPrintSafeHex,
  deltaE,
} from "../../services/design-tokens/colorUtils.js";
import { logAudit } from "../../services/aiAuditService.js";

const router = Router();

// ── Auth — explicit at router level (P0 audit) ────────────────────────────────
// Belt-and-suspenders on top of the global adminAuthWithExceptions in app.ts.
// All routes in this router require admin authentication.
router.use(adminAuthWithExceptions);

// ── Validation schemas ────────────────────────────────────────────────────────

const HexColorSchema = z
  .string()
  .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a valid hex colour");

const CreatePaletteSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  style: z.enum(["monochromatic", "complementary", "triadic", "analogous", "split-complementary", "tetradic", "custom"]),
  mood: z.array(z.enum(["professional", "playful", "elegant", "modern", "traditional", "bold", "minimal", "friendly"])).min(1),
  industries: z.array(z.string()).min(1),
  colors: z.array(HexColorSchema).min(2).max(12),
  tags: z.array(z.string()).optional(),
});

const SemanticRoleSchema = z.object({
  role: z.enum([
    "primary", "primaryDark", "primaryLight",
    "secondary", "secondaryDark", "secondaryLight",
    "accent",
    "background", "surface", "surfaceAlt",
    "textPrimary", "textSecondary", "textDisabled",
    "error", "warning", "success", "info",
    "border", "divider",
  ]),
  hexColor: HexColorSchema,
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

// ── GET /color-palettes ───────────────────────────────────────────────────────

router.get("/", async (req, res): Promise<void> => {
  try {
    const palettes = await listColorPalettes({
      style: req.query.style as any,
      mood: req.query.mood as any,
      industry: req.query.industry as any,
      accessible: req.query.accessible === "true" ? true : undefined,
      printSafe: req.query.printSafe === "true" ? true : undefined,
      wcagLevel: req.query.wcagLevel as any,
      search: req.query.search as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({ data: palettes, total: palettes.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list color palettes" });
  }
});

// ── GET /color-palettes/:id ───────────────────────────────────────────────────

router.get("/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const palette = await getColorPaletteWithRoles(id);
    if (!palette) { res.status(404).json({ error: "Color palette not found" }); return; }
    res.json(palette);
  } catch (err) {
    res.status(500).json({ error: "Failed to get color palette" });
  }
});

// ── POST /color-palettes ──────────────────────────────────────────────────────

router.post("/", adminAuth, async (req, res): Promise<void> => {
  const parsed = CreatePaletteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const palette = await createColorPalette(parsed.data);
    await logAudit("design-tokens", "create_color_palette", String(palette.id), "dt_color_palette", "success", { name: palette.name });
    res.status(201).json(palette);
  } catch (err: any) {
    if (err?.code === "DUPLICATE") { res.status(409).json({ error: err.message, existingId: err.existingId }); return; }
    res.status(500).json({ error: "Failed to create color palette" });
  }
});

// ── PATCH /color-palettes/:id ─────────────────────────────────────────────────

router.patch("/:id", adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = CreatePaletteSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const palette = await updateColorPalette(id, parsed.data);
    await logAudit("design-tokens", "update_color_palette", String(id), "dt_color_palette", "success", {});
    res.json(palette);
  } catch (err: any) {
    if (err?.code === "DUPLICATE") { res.status(409).json({ error: err.message, existingId: err.existingId }); return; }
    if (err?.message === "Color palette not found") { res.status(404).json({ error: "Color palette not found" }); return; }
    res.status(500).json({ error: "Failed to update color palette" });
  }
});

// ── DELETE /color-palettes/:id ────────────────────────────────────────────────

router.delete("/:id", adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await deactivateColorPalette(id);
    await logAudit("design-tokens", "deactivate_color_palette", String(id), "dt_color_palette", "success", {});
    res.status(204).end();
  } catch (err: any) {
    if (err?.message === "Color palette not found") { res.status(404).json({ error: "Color palette not found" }); return; }
    res.status(500).json({ error: "Failed to deactivate color palette" });
  }
});

// ── GET /color-palettes/:id/semantic-roles ────────────────────────────────────

router.get("/:id/semantic-roles", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const roles = await getSemanticRoles(id);
    res.json({ data: roles });
  } catch (err) {
    res.status(500).json({ error: "Failed to get semantic roles" });
  }
});

// ── PUT /color-palettes/:id/semantic-roles ────────────────────────────────────

router.put("/:id/semantic-roles", adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.array(SemanticRoleSchema).min(1).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const result = await upsertSemanticRoles(id, parsed.data);
    res.json({ data: result.roles, wcagLevel: result.wcagLevel, accessible: result.accessible });
  } catch (err: any) {
    if (err?.message === "Color palette not found") { res.status(404).json({ error: "Color palette not found" }); return; }
    res.status(500).json({ error: "Failed to upsert semantic roles" });
  }
});

// ── POST /color-palettes/contrast-check ──────────────────────────────────────

router.post("/contrast-check", async (req, res): Promise<void> => {
  const schema = z.object({
    hex1: HexColorSchema,
    hex2: HexColorSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const result = checkContrast(parsed.data.hex1, parsed.data.hex2);
  res.json(result);
});

// ── POST /color-palettes/contrast-check-batch ────────────────────────────────

router.post("/contrast-check-batch", async (req, res): Promise<void> => {
  const schema = z.object({
    foregrounds: z.array(HexColorSchema).min(1).max(20),
    background: HexColorSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const results = validatePaletteContrast(parsed.data.foregrounds, parsed.data.background);
  res.json({ data: results });
});

// ── POST /color-palettes/print-safe-check ─────────────────────────────────────

router.post("/print-safe-check", async (req, res): Promise<void> => {
  const schema = z.object({ colors: z.array(HexColorSchema).min(1).max(20) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const results = parsed.data.colors.map((hex) => {
    const safe = isPrintSafe(hex);
    const printSafeHex = toPrintSafeHex(hex);
    const cmyk = hexToCmyk(hex);
    return {
      originalHex: hex,
      cmyk,
      cmykFormatted: formatCmyk(cmyk),
      isPrintSafe: safe,
      printSafeHex,
      deltaE: safe ? 0 : deltaE(hex, printSafeHex),
      note: safe ? null : "Colour adjusted for CMYK press limits (300% ink coverage)",
    };
  });

  res.json({
    data: results,
    allPrintSafe: results.every((r) => r.isPrintSafe),
  });
});

// ── POST /color-palettes/check-duplicate ─────────────────────────────────────

router.post("/check-duplicate", async (req, res): Promise<void> => {
  const parsed = z.object({ colors: z.array(HexColorSchema).min(2) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const dup = await findDuplicatePalette(parsed.data.colors);
    res.json({ isDuplicate: !!dup, existingPalette: dup ?? null });
  } catch (err) {
    res.status(500).json({ error: "Failed to check duplicate" });
  }
});

// ── POST /color-palettes/brand-dna-compatible ─────────────────────────────────

router.post("/brand-dna-compatible", async (req, res): Promise<void> => {
  const parsed = BrandDnaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const results = await getCompatiblePalettes(parsed.data, limit);
    res.json({ data: results });
  } catch (err) {
    res.status(500).json({ error: "Failed to compute compatibility" });
  }
});

// ── POST /color-palettes/score-combination ────────────────────────────────────

router.post("/score-combination", async (req, res): Promise<void> => {
  const schema = z.object({
    fontPairId: z.number().int().positive(),
    colorPaletteId: z.number().int().positive(),
    brandDna: BrandDnaSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const result = await scoreSpecificCombination(
      parsed.data.fontPairId,
      parsed.data.colorPaletteId,
      parsed.data.brandDna
    );
    res.json(result);
  } catch (err: any) {
    if (err?.message?.includes("not found")) { res.status(404).json({ error: err.message }); return; }
    res.status(500).json({ error: "Failed to score combination" });
  }
});

// ── GET /color-palettes/color-info/:hex ───────────────────────────────────────

router.get("/color-info/:hex", async (req, res): Promise<void> => {
  const hex = "#" + req.params.hex.replace(/^#/, "");
  const hexRe = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  if (!hexRe.test(hex)) { res.status(400).json({ error: "Invalid hex colour" }); return; }

  const cmyk = hexToCmyk(hex);
  const hsl = hexToHsl(hex);
  const printSafe = isPrintSafe(hex);
  const printSafeHex = toPrintSafeHex(hex);
  const onWhite = checkContrast(hex, "#ffffff");
  const onBlack = checkContrast(hex, "#000000");

  res.json({
    hex,
    hsl,
    cmyk,
    cmykFormatted: formatCmyk(cmyk),
    printSafe,
    printSafeHex,
    contrastOnWhite: onWhite,
    contrastOnBlack: onBlack,
  });
});

export default router;
