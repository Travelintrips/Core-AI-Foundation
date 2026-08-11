import { z } from "zod";

export const MOODBOARD_MAX_ITEMS = 24;
export const MOODBOARD_MAX_SECTIONS = 12;

export const moodboardGenerateRequestSchema = z.object({
  force: z.boolean().optional().default(false),
}).strict();

export const moodboardProjectUuidSchema = z.string().uuid();

export const moodboardPaletteSchema = z.object({
  colors: z.array(z.string().min(1).max(80)).max(8),
  moodWords: z.array(z.string().min(1).max(50)).max(8),
  style: z.string().min(1).max(100),
  source: z.enum(["brief", "concept_draft", "style_default"]),
}).strict();

export const moodboardMaterialItemSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(240),
  category: z.string().max(120).nullable(),
  color: z.string().max(120).nullable(),
  finish: z.string().max(120).nullable(),
  texture: z.string().max(160).nullable(),
  thumbnailUrl: z.string().url().nullable(),
  source: z.enum(["material_library", "concept_draft"]),
}).strict();

export const moodboardFurnitureItemSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(240),
  type: z.string().max(120).nullable(),
  style: z.string().max(120).nullable(),
  materials: z.array(z.string().max(120)).max(12),
  colors: z.array(z.string().max(120)).max(12),
  thumbnailUrl: z.string().url().nullable(),
  source: z.enum(["furniture_library", "concept_draft"]),
}).strict();

export const moodboardImageItemSchema = z.object({
  id: z.string().min(1).max(160),
  role: z.enum(["material", "furniture", "lighting", "space_plan", "concept"]),
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  alt: z.string().max(300),
  source: z.string().min(1).max(80),
  sourceItemId: z.string().max(160).nullable(),
}).strict();

export const moodboardSectionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  description: z.string().max(600),
  itemIds: z.array(z.string().max(160)).max(MOODBOARD_MAX_ITEMS),
  imageIds: z.array(z.string().max(160)).max(MOODBOARD_MAX_ITEMS),
}).strict();

export const moodboardGenerationMetadataSchema = z.object({
  algorithmVersion: z.string().min(1).max(40),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  resourceCounts: z.object({
    materials: z.number().int().nonnegative(),
    furniture: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
    sections: z.number().int().nonnegative(),
  }).strict(),
  truncated: z.boolean(),
}).strict();

export const moodboardResultSchema = z.object({
  schemaVersion: z.literal("wp08.v1"),
  moodboardId: z.string().min(1).max(200),
  projectUuid: z.string().uuid(),
  title: z.string().min(1).max(240),
  roomType: z.string().min(1).max(100),
  style: z.string().min(1).max(100),
  colorPalette: z.array(z.string().min(1).max(80)).max(8),
  palette: moodboardPaletteSchema,
  materials: z.array(moodboardMaterialItemSchema).max(MOODBOARD_MAX_ITEMS),
  furniture: z.array(moodboardFurnitureItemSchema).max(MOODBOARD_MAX_ITEMS),
  images: z.array(moodboardImageItemSchema).max(MOODBOARD_MAX_ITEMS),
  referenceImages: z.array(moodboardImageItemSchema).max(MOODBOARD_MAX_ITEMS),
  sections: z.array(moodboardSectionSchema).max(MOODBOARD_MAX_SECTIONS),
  warnings: z.array(z.string().max(500)).max(40),
  status: z.enum(["ready"]),
  metadata: moodboardGenerationMetadataSchema,
}).strict();

export const moodboardResponseSchema = z.object({
  moodboard: moodboardResultSchema.nullable(),
  available: z.boolean(),
  reused: z.boolean().optional(),
}).strict();

export type MoodboardGenerateRequest = z.infer<typeof moodboardGenerateRequestSchema>;
export type MoodboardPalette = z.infer<typeof moodboardPaletteSchema>;
export type MoodboardMaterialItem = z.infer<typeof moodboardMaterialItemSchema>;
export type MoodboardFurnitureItem = z.infer<typeof moodboardFurnitureItemSchema>;
export type MoodboardImageItem = z.infer<typeof moodboardImageItemSchema>;
export type MoodboardSection = z.infer<typeof moodboardSectionSchema>;
export type MoodboardGenerationMetadata = z.infer<typeof moodboardGenerationMetadataSchema>;
export type MoodboardResult = z.infer<typeof moodboardResultSchema>;