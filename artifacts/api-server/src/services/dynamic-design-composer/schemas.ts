/**
 * Team 13 — Dynamic Design Composition Engine
 * Zod schemas for input validation and output typing.
 */

import { z } from "zod";

// ── Hex color helper ──────────────────────────────────────────────────────────

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid 6-digit hex color (e.g. #FF5733)")
  .describe("6-digit hex color string");

// ── Blueprint ─────────────────────────────────────────────────────────────────

export const blueprintSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  columns: z.number().int().min(1).max(24),
  rows: z.number().int().min(0).max(100),
  gutter: z.number().min(0).max(96),
  maxWidth: z.number().min(320).max(3840),
  orientation: z.enum(["portrait", "landscape", "square"]),
  medium: z.enum(["digital", "print", "presentation", "social"]),
});

// ── Layout Plan ───────────────────────────────────────────────────────────────

export const layoutPlanSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  strategy: z.enum([
    "hero-content",
    "grid",
    "asymmetric",
    "magazine",
    "editorial",
    "minimal",
    "card-grid",
    "split",
    "full-bleed",
    "sidebar",
  ]),
  flow: z.enum(["vertical", "horizontal", "masonry"]),
  heroWeight: z.number().min(0).max(1),
  sectionCount: z.number().int().min(1).max(20),
  hasSidebar: z.boolean(),
  emphasis: z.enum(["headline", "image", "balanced", "data"]),
});

// ── Components ────────────────────────────────────────────────────────────────

export const componentSchema = z.object({
  id: z.string().optional(),
  type: z.enum([
    "header",
    "footer",
    "hero",
    "cta",
    "testimonial",
    "feature-grid",
    "pricing-table",
    "image-gallery",
    "stat-block",
    "timeline",
    "team-section",
    "form",
    "nav",
    "breadcrumb",
    "divider",
    "quote",
    "icon-row",
    "map",
    "video-embed",
    "accordion",
    "tab-group",
    "badge",
    "chip",
    "avatar",
    "progress-bar",
  ]),
  required: z.boolean(),
  zone: z.enum(["top", "middle", "bottom", "sidebar", "overlay"]).optional(),
  variant: z.string().optional(),
});

// ── Pattern ───────────────────────────────────────────────────────────────────

export const patternSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  type: z.enum([
    "geometric",
    "organic",
    "abstract",
    "textile",
    "dot-matrix",
    "stripe",
    "wave",
    "circuit",
    "botanical",
    "none",
  ]),
  intensity: z.number().min(0).max(1),
  placement: z.enum(["background", "section", "accent", "border", "overlay"]),
  tile: z.boolean(),
});

// ── Palette ───────────────────────────────────────────────────────────────────

export const paletteSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  background: hexColor,
  surface: hexColor,
  text: hexColor,
  textMuted: hexColor,
  extras: z.array(hexColor).max(10).optional(),
  mood: z.enum(["vibrant", "muted", "monochrome", "earthy", "cool", "warm", "neutral"]),
});

// ── Typography ────────────────────────────────────────────────────────────────

export const typographySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  headingFont: z.string().min(1).max(100),
  bodyFont: z.string().min(1).max(100),
  accentFont: z.string().max(100).optional(),
  headingWeight: z.enum(["300", "400", "500", "600", "700", "800", "900"]),
  bodyWeight: z.enum(["300", "400", "500"]),
  baseSize: z.number().min(10).max(24),
  scaleRatio: z.number().min(1.067).max(2.0),
  lineHeight: z.number().min(1.0).max(2.5),
  letterSpacing: z.enum(["tight", "normal", "wide"]),
  style: z.enum(["serif", "sans-serif", "display", "monospace", "mixed"]),
});

// ── Decoration ────────────────────────────────────────────────────────────────

export const decorationSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  borderRadius: z.enum(["none", "small", "medium", "large", "pill", "circle"]),
  borderStyle: z.enum(["none", "thin", "thick", "dashed", "double"]),
  shadowDepth: z.enum(["none", "low", "medium", "high", "dramatic"]),
  dividerStyle: z.enum(["none", "line", "dash", "dot", "ornamental"]),
  useGradients: z.boolean(),
  gradientDirection: z.enum(["horizontal", "vertical", "diagonal", "radial"]).optional(),
  overlayOpacity: z.number().min(0).max(1),
});

// ── Material ──────────────────────────────────────────────────────────────────

export const materialSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  surface: z.enum([
    "flat",
    "glass",
    "neumorphic",
    "material",
    "frosted",
    "metallic",
    "matte",
    "paper",
    "fabric",
  ]),
  texture: z.enum(["smooth", "grain", "noise", "halftone", "none"]),
  elevation: z.enum(["flat", "low", "medium", "high"]),
  opacity: z.enum(["solid", "semi-transparent", "transparent"]),
  blendMode: z.enum(["normal", "multiply", "screen", "overlay", "soft-light"]),
});

// ── Motif ─────────────────────────────────────────────────────────────────────

export const motifSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  theme: z.enum([
    "nature",
    "technology",
    "human",
    "abstract",
    "geometric",
    "cultural",
    "industrial",
    "luxury",
    "playful",
    "scientific",
    "none",
  ]),
  repetition: z.enum(["single", "scattered", "systematic", "none"]),
  scale: z.enum(["micro", "small", "medium", "large", "hero"]),
  colorTreatment: z.enum(["monochrome", "tinted", "full-color", "ghost"]),
});

// ── Brand DNA ─────────────────────────────────────────────────────────────────

export const brandDnaSchema = z.object({
  clientId: z.string().optional(),
  brandPersonality: z.array(z.string()).optional(),
  brandVoice: z.string().optional(),
  writingStyle: z.string().optional(),
  photographyStyle: z.string().optional(),
  illustrationStyle: z.string().optional(),
  iconStyle: z.string().optional(),
  layoutStyle: z.string().optional(),
  visualDensity: z.string().optional(),
  spacingStyle: z.string().optional(),
  detectedColors: z
    .object({
      primary: hexColor.optional(),
      secondary: hexColor.optional(),
      accent: hexColor.optional(),
      palette: z.array(hexColor).optional(),
    })
    .optional(),
  detectedTypography: z
    .object({
      heading: z.string().optional(),
      body: z.string().optional(),
      style: z.string().optional(),
    })
    .optional(),
  targetAudience: z
    .object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      demographics: z.string().optional(),
      psychographics: z.string().optional(),
    })
    .optional(),
  industry: z.string().optional(),
  riskProfile: z.string().optional(),
  completenessScore: z.number().min(0).max(100).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
});

// ── Composition Request ───────────────────────────────────────────────────────

export const compositionRequestSchema = z.object({
  requestId: z.string().optional(),
  blueprint: blueprintSchema,
  layoutPlan: layoutPlanSchema,
  components: z.array(componentSchema).min(0).max(50),
  pattern: patternSchema,
  palette: paletteSchema,
  typography: typographySchema,
  decoration: decorationSchema,
  material: materialSchema,
  motif: motifSchema,
  brandDna: brandDnaSchema.optional(),
  allowOverrides: z.boolean().default(false),
});

export type CompositionRequestInput = z.infer<typeof compositionRequestSchema>;

// ── Validate-only request ─────────────────────────────────────────────────────

export const validateRequestSchema = compositionRequestSchema;

// ── Compatibility check request ───────────────────────────────────────────────

export const compatibilityCheckSchema = z.object({
  material: materialSchema,
  pattern: patternSchema,
  palette: paletteSchema,
  decoration: decorationSchema,
});
