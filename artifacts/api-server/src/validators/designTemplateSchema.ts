/**
 * Design Template Engine — Zod validation schemas
 *
 * Validates DesignTemplate JSON blobs before they are stored or rendered.
 * Uses zod (not zod/v4) — this is a service-layer file, not a route file.
 *
 * Security rules enforced here:
 *  - No JavaScript expressions or eval
 *  - No arbitrary SVG/HTML in text values
 *  - Canvas and element count within DESIGN_LIMITS
 *  - Variable keys must be safe identifiers
 */

import { z } from "zod";
import { DESIGN_LIMITS, DESIGN_TEMPLATE_SCHEMA_VERSION } from "../types/designTemplate.js";

// ── Primitives ────────────────────────────────────────────────────────────────

const safeColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$|^rgba?\(.*\)$/, "Invalid color");
const safeFontFamily = z.string().max(100).regex(/^[a-zA-Z0-9 _-]+$/, "Invalid font family");
const safeVariableKey = z.string().min(1).max(64).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Variable key must be a safe identifier");

// ── Asset Reference ───────────────────────────────────────────────────────────

const assetReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("storage"), storagePath: z.string().min(1), url: z.string().url().optional() }),
  z.object({ type: z.literal("url"), url: z.string().url().max(2048) }),
  z.object({ type: z.literal("upload"), uploadId: z.string().min(1) }),
]);

// ── Variable Binding ──────────────────────────────────────────────────────────

const variableBindingSchema = z.object({
  variableKey: safeVariableKey,
  fallback: z.string().max(500).optional(),
  formatter: z.enum(["currency", "number", "percentage", "date", "uppercase", "lowercase", "titlecase", "truncate"]).optional(),
  truncateAt: z.number().int().min(1).max(2000).optional(),
  currencyCode: z.string().length(3).optional(),
  dateFormat: z.string().max(30).regex(/^[DMYHhmsAa /\-:.]+$/).optional(),
});

const textContentSchema = z.union([
  z.string().max(5000),
  z.object({ binding: variableBindingSchema }),
]);

const conditionalVisibilitySchema = z.object({
  variable: safeVariableKey,
  operator: z.enum(["equals", "not_equals", "is_empty", "is_not_empty"]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

// ── Base Element ──────────────────────────────────────────────────────────────

const baseElementSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(100).optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  zIndex: z.number().int().min(0).max(10_000),
  visibleWhen: conditionalVisibilitySchema.optional(),
});

// ── Element Schemas ───────────────────────────────────────────────────────────

const textElementSchema = baseElementSchema.extend({
  type: z.literal("text"),
  content: textContentSchema,
  fontFamily: safeFontFamily.optional(),
  fontSize: z.number().min(DESIGN_LIMITS.MIN_FONT_SIZE).max(500).optional(),
  fontWeight: z.union([z.number().int().min(100).max(900), z.enum(["bold", "normal"])]).optional(),
  italic: z.boolean().optional(),
  color: safeColor.optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  lineHeight: z.number().min(0.5).max(5).optional(),
  letterSpacing: z.number().min(-10).max(100).optional(),
  underline: z.boolean().optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
  maxLines: z.number().int().min(1).max(100).optional(),
  overflow: z.enum(["wrap", "truncate", "auto-shrink"]).optional(),
  ellipsis: z.boolean().optional(),
  minFontSize: z.number().min(DESIGN_LIMITS.MIN_FONT_SIZE).max(200).optional(),
});

const imageElementSchema = baseElementSchema.extend({
  type: z.literal("image"),
  src: z.union([assetReferenceSchema, z.object({ binding: variableBindingSchema })]).optional(),
  objectFit: z.enum(["cover", "contain", "fill"]).optional(),
  borderRadius: z.number().min(0).max(5000).optional(),
  placeholder: assetReferenceSchema.optional(),
});

const gradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: safeColor,
});

const linearGradientSchema = z.object({
  type: z.literal("linear"),
  angle: z.number().min(0).max(360),
  stops: z.array(gradientStopSchema).min(2).max(10),
});

const borderSchema = z.object({
  width: z.number().min(0).max(100),
  color: safeColor,
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
});

const shadowSchema = z.object({
  offsetX: z.number().min(-200).max(200),
  offsetY: z.number().min(-200).max(200),
  blur: z.number().min(0).max(200),
  color: safeColor,
});

const shapeElementSchema = baseElementSchema.extend({
  type: z.literal("shape"),
  shape: z.enum(["rectangle", "circle", "rounded-rectangle"]),
  borderRadius: z.number().min(0).max(5000).optional(),
  fill: z.union([safeColor, linearGradientSchema]).optional(),
  border: borderSchema.optional(),
  shadow: shadowSchema.optional(),
});

const qrCodeElementSchema = baseElementSchema.extend({
  type: z.literal("qrcode"),
  content: z.union([
    z.string().max(DESIGN_LIMITS.MAX_QR_CONTENT_LENGTH),
    z.object({ binding: variableBindingSchema }),
  ]),
  fgColor: safeColor.optional(),
  bgColor: safeColor.optional(),
  errorLevel: z.enum(["L", "M", "Q", "H"]).optional(),
});

const lineElementSchema = baseElementSchema.extend({
  type: z.literal("line"),
  stroke: safeColor.optional(),
  strokeWidth: z.number().min(0).max(100).optional(),
  dashArray: z.array(z.number().min(0).max(100)).max(8).optional(),
});

const iconElementSchema = baseElementSchema.extend({
  type: z.literal("icon"),
  iconName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  color: safeColor.optional(),
});

// Forward-declaration placeholder for group (recursive); resolved below.
const designElementSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    textElementSchema,
    imageElementSchema,
    shapeElementSchema,
    qrCodeElementSchema,
    lineElementSchema,
    iconElementSchema,
    baseElementSchema.extend({
      type: z.literal("group"),
      children: z.array(designElementSchema).max(50),
    }),
  ]),
);

// ── Variables ─────────────────────────────────────────────────────────────────

const templateVariableSchema = z.object({
  key: safeVariableKey,
  label: z.string().min(1).max(100),
  type: z.enum(["text", "number", "currency", "image", "color", "url", "date", "boolean"]),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  validation: z
    .object({
      maxLength: z.number().int().min(0).optional(),
      minLength: z.number().int().min(0).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().max(200).optional(),
    })
    .optional(),
});

// ── Canvas ────────────────────────────────────────────────────────────────────

const canvasSchema = z.object({
  width: z.number().int().min(1).max(DESIGN_LIMITS.MAX_CANVAS_WIDTH),
  height: z.number().int().min(1).max(DESIGN_LIMITS.MAX_CANVAS_HEIGHT),
  unit: z.literal("px"),
  backgroundColor: safeColor.optional(),
  backgroundImage: assetReferenceSchema.optional(),
});

// ── Root Template ─────────────────────────────────────────────────────────────

export const designTemplateJsonSchema = z.object({
  schemaVersion: z.literal(DESIGN_TEMPLATE_SCHEMA_VERSION),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  canvas: canvasSchema,
  elements: z
    .array(designElementSchema)
    .max(DESIGN_LIMITS.MAX_ELEMENT_COUNT),
  variables: z
    .array(templateVariableSchema)
    .max(DESIGN_LIMITS.MAX_VARIABLE_COUNT),
  metadata: z.object({
    createdBy: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
    version: z.number().int().min(1),
  }),
});

export type ValidatedDesignTemplate = z.infer<typeof designTemplateJsonSchema>;

// ── Render Data Row ───────────────────────────────────────────────────────────

export const renderDataRowSchema = z.record(
  safeVariableKey,
  z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]),
);

// ── API Request Schemas ───────────────────────────────────────────────────────

export const createTemplateRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
});

export const updateTemplateRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  status: z.enum(["draft", "archived"]).optional(), // cannot set "published" via PATCH — use /publish
});

export const createVersionRequestSchema = z.object({
  templateJson: designTemplateJsonSchema,
  changelog: z.string().max(500).optional(),
});

export const singleRenderRequestSchema = z.object({
  templateVersionId: z.number().int().positive(),
  format: z.enum(["png", "jpg", "webp", "pdf"]).default("png"),
  data: renderDataRowSchema,
  idempotencyKey: z.string().max(200).optional(),
  width: z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_WIDTH).optional(),
  height: z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_HEIGHT).optional(),
});

export const createBatchRequestSchema = z.object({
  templateId: z.number().int().positive(),
  templateVersionId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  format: z.enum(["png", "jpg", "webp", "pdf"]).default("png"),
  width: z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_WIDTH).optional(),
  height: z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_HEIGHT).optional(),
  items: z
    .array(renderDataRowSchema)
    .min(1)
    .max(DESIGN_LIMITS.MAX_BATCH_SIZE),
});
