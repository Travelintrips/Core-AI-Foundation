/**
 * Design Template AI — Zod Schemas
 *
 * Validates AI-generated template proposals before they can be saved.
 * All schemas are strict (no passthrough) to block unknown fields.
 */
import { z } from "zod";

// ── Security constants ─────────────────────────────────────────────────────────

const SAFE_HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SAFE_FONT_FAMILY = /^[A-Za-z0-9 _\-,]+$/; // no URLs, no quotes
const SAFE_ID = /^[a-zA-Z0-9_\-]+$/;
const PRIVATE_URL = /^(file:|javascript:|data:|vbscript:|blob:)|(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i;

const MAX_CANVAS_W = 8000;
const MAX_CANVAS_H = 8000;
const MAX_ELEMENTS = 200;
const MAX_VARIABLES = 50;
const MAX_TEXT_LEN  = 2000;

// ── Variable binding ───────────────────────────────────────────────────────────

const variableFormatterSchema = z.enum([
  "currency","number","percentage","date","uppercase","lowercase","titlecase","truncate",
]);

const variableBindingSchema = z.object({
  variableKey: z.string().min(1).max(64).regex(SAFE_ID),
  fallback: z.string().max(500).optional(),
  formatter: variableFormatterSchema.optional(),
  truncateAt: z.number().int().min(1).max(2000).optional(),
  currencyCode: z.string().max(10).optional(),
  dateFormat: z.string().max(20).optional(),
});

// ── Variable definition ────────────────────────────────────────────────────────

const templateVariableSchema = z.object({
  key: z.string().min(1).max(64).regex(SAFE_ID),
  label: z.string().min(1).max(100),
  type: z.enum(["text","number","currency","image","color","url","date","boolean"]),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  validation: z.object({
    maxLength: z.number().int().min(1).max(5000).optional(),
    minLength: z.number().int().min(0).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().max(200).optional(),
  }).optional(),
});

// ── Elements ───────────────────────────────────────────────────────────────────

const baseElementSchema = z.object({
  id: z.string().min(1).max(64).regex(SAFE_ID),
  name: z.string().max(100).optional(),
  x: z.number().min(-MAX_CANVAS_W).max(MAX_CANVAS_W),
  y: z.number().min(-MAX_CANVAS_H).max(MAX_CANVAS_H),
  width: z.number().min(1).max(MAX_CANVAS_W),
  height: z.number().min(1).max(MAX_CANVAS_H),
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  zIndex: z.number().int().min(0).max(9999),
});

// Text — no script injection
const textContentSchema = z.union([
  z.string().max(MAX_TEXT_LEN).refine(
    (s) => !/<script|<iframe|javascript:|on\w+=/i.test(s),
    { message: "Text content contains unsafe HTML/script" },
  ),
  z.object({ binding: variableBindingSchema }),
]);

const textElementSchema = baseElementSchema.extend({
  type: z.literal("text"),
  content: textContentSchema,
  fontFamily: z.string().max(100).regex(SAFE_FONT_FAMILY).optional(),
  fontSize: z.number().min(6).max(500).optional(),
  fontWeight: z.union([z.number().int().min(100).max(900), z.enum(["bold","normal"])]).optional(),
  italic: z.boolean().optional(),
  color: z.string().regex(SAFE_HEX_COLOR).optional(),
  textAlign: z.enum(["left","center","right","justify"]).optional(),
  lineHeight: z.number().min(0.5).max(5).optional(),
  letterSpacing: z.number().min(-10).max(50).optional(),
  underline: z.boolean().optional(),
  textTransform: z.enum(["none","uppercase","lowercase","capitalize"]).optional(),
  maxLines: z.number().int().min(1).max(100).optional(),
  overflow: z.enum(["wrap","truncate","auto-shrink"]).optional(),
});

// Image — SSRF-safe URL constraint applied at service level; schema only ensures HTTPS
const safeUrlSchema = z.string().url()
  .refine((u) => u.startsWith("https://"), { message: "Only HTTPS URLs allowed" })
  .refine((u) => !PRIVATE_URL.test(u), { message: "Private/local network URLs are not allowed" });

const assetRefSchema = z.union([
  z.object({ type: z.literal("storage"), storagePath: z.string().max(500), url: z.string().optional() }),
  z.object({ type: z.literal("url"), url: safeUrlSchema }),
]);

const imageElementSchema = baseElementSchema.extend({
  type: z.literal("image"),
  src: z.union([assetRefSchema, z.object({ binding: variableBindingSchema })]).optional(),
  objectFit: z.enum(["cover","contain","fill"]).optional(),
  borderRadius: z.number().min(0).max(1000).optional(),
});

const gradientStopSchema = z.object({ offset: z.number().min(0).max(1), color: z.string().regex(SAFE_HEX_COLOR) });
const fillSchema = z.union([
  z.string().regex(SAFE_HEX_COLOR),
  z.object({ type: z.literal("linear"), angle: z.number(), stops: z.array(gradientStopSchema).min(2).max(10) }),
]);

const shapeElementSchema = baseElementSchema.extend({
  type: z.literal("shape"),
  shape: z.enum(["rectangle","circle","rounded-rectangle"]),
  borderRadius: z.number().min(0).max(1000).optional(),
  fill: fillSchema.optional(),
  border: z.object({
    width: z.number().min(0).max(100),
    color: z.string().regex(SAFE_HEX_COLOR),
    style: z.enum(["solid","dashed","dotted"]).optional(),
  }).optional(),
});

const qrCodeElementSchema = baseElementSchema.extend({
  type: z.literal("qrcode"),
  content: z.union([
    z.string().max(2048),
    z.object({ binding: variableBindingSchema }),
  ]),
  fgColor: z.string().regex(SAFE_HEX_COLOR).optional(),
  bgColor: z.string().regex(SAFE_HEX_COLOR).optional(),
  errorLevel: z.enum(["L","M","Q","H"]).optional(),
});

const lineElementSchema = baseElementSchema.extend({
  type: z.literal("line"),
  stroke: z.string().regex(SAFE_HEX_COLOR).optional(),
  strokeWidth: z.number().min(0).max(100).optional(),
});

// Only allow known element types — no arbitrary HTML/SVG
export const designElementSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    textElementSchema,
    imageElementSchema,
    shapeElementSchema,
    qrCodeElementSchema,
    lineElementSchema,
  ])
);

// ── Canvas ─────────────────────────────────────────────────────────────────────

const canvasSchema = z.object({
  width: z.number().int().min(10).max(MAX_CANVAS_W),
  height: z.number().int().min(10).max(MAX_CANVAS_H),
  unit: z.literal("px"),
  backgroundColor: z.string().regex(SAFE_HEX_COLOR).optional(),
});

// ── Template draft (AI output) ─────────────────────────────────────────────────

export const aiTemplateDraftSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  canvas: canvasSchema,
  elements: z.array(designElementSchema).max(MAX_ELEMENTS),
  variables: z.array(templateVariableSchema).max(MAX_VARIABLES),
});

// ── Full AI proposal ──────────────────────────────────────────────────────────

export const aiTemplateProposalSchema = z.object({
  summary: z.string().max(2000),
  assumptions: z.array(z.string().max(500)).max(20),
  variables: z.array(templateVariableSchema).max(MAX_VARIABLES),
  template: aiTemplateDraftSchema,
  warnings: z.array(z.string().max(500)).max(20),
});

export type AiTemplateProposal = z.infer<typeof aiTemplateProposalSchema>;

// ── Request schema ─────────────────────────────────────────────────────────────

export const aiTemplateAssistRequestSchema = z.object({
  prompt: z.string().min(10).max(4000),
  sizePreset: z.enum(["instagram-square","instagram-portrait","instagram-landscape","a4","custom"]).optional(),
  canvasWidth: z.number().int().min(10).max(MAX_CANVAS_W).optional(),
  canvasHeight: z.number().int().min(10).max(MAX_CANVAS_H).optional(),
  industry: z.string().max(100).optional(),
  brandColors: z.array(z.string().regex(SAFE_HEX_COLOR)).max(10).optional(),
  desiredVariables: z.array(z.string().max(64)).max(MAX_VARIABLES).optional(),
  language: z.string().max(10).optional().default("id"),
});

export type AiTemplateAssistRequest = z.infer<typeof aiTemplateAssistRequestSchema>;
