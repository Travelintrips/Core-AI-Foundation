/**
 * Universal Material Catalog Import Engine — Phase 4A
 * Zod validation schema for the universal material record.
 * Never fabricates values — all fields optional except source provenance.
 */

import { z } from "zod";

export const AdapterSourceTypeSchema = z.enum([
  "pdf",
  "website",
  "csv",
  "excel",
  "json",
  "xml",
  "api",
]);

export const StagingStatusSchema = z.enum([
  "draft",
  "extracted",
  "normalized",
  "duplicate",
  "approved",
  "rejected",
  "needs_review",
]);

export const UniversalMaterialSchema = z.object({
  // Identity
  brand: z.string().min(1).optional(),
  collection: z.string().optional(),
  series: z.string().optional(),
  productCode: z.string().optional(),
  productName: z.string().optional(),
  variant: z.string().optional(),
  // Classification
  category: z.string().optional(),
  subcategory: z.string().optional(),
  materialType: z.string().optional(),
  // Description
  description: z.string().optional(),
  // Appearance
  colors: z.array(z.string()).optional(),
  finish: z.array(z.string()).optional(),
  texture: z.string().optional(),
  pattern: z.string().optional(),
  // Dimensions
  dimensions: z.record(z.unknown()).optional(),
  workingSize: z.string().optional(),
  thickness: z.string().optional(),
  numberOfFaces: z.number().int().nonnegative().optional(),
  // Tile ratings
  peiRating: z.number().int().min(0).max(5).optional(),
  shadeVariation: z.string().optional(),
  // Technical
  technicalSpecifications: z.record(z.unknown()).optional(),
  application: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  // Media
  thumbnailReference: z.string().optional(),
  previewReferences: z.array(z.string()).optional(),
  // Provenance (required)
  sourceType: AdapterSourceTypeSchema,
  sourceName: z.string().min(1),
  sourceVersion: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  sourcePage: z.number().int().nonnegative().optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
});

export type UniversalMaterialInput = z.input<typeof UniversalMaterialSchema>;
export type UniversalMaterialOutput = z.output<typeof UniversalMaterialSchema>;

/** Validate a raw object as a universal material; returns errors if invalid */
export function validateUniversalMaterial(raw: unknown): {
  success: true;
  data: UniversalMaterialOutput;
} | {
  success: false;
  errors: string[];
} {
  const result = UniversalMaterialSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".") || "root"}: ${i.message}`,
    ),
  };
}

// ── Request schemas (for route validation) ─────────────────────────────────────

export const ImportPreviewRequestSchema = z.object({
  sourceType: AdapterSourceTypeSchema,
  url: z.string().url().optional(),
  options: z.object({
    maxItems: z.number().int().positive().max(500).default(100),
    skipAI: z.boolean().default(false),
    brandHint: z.string().optional(),
    categoryHint: z.string().optional(),
    idempotencyKey: z.string().optional(),
  }).default({}),
});

export const ImportPreviewResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(["complete", "partial", "failed"]),
  sourceType: AdapterSourceTypeSchema,
  sourceName: z.string(),
  counts: z.object({
    totalRaw: z.number(),
    totalNormalized: z.number(),
    new: z.number(),
    exact_duplicate: z.number(),
    possible_duplicate: z.number(),
    conflicting_identity: z.number(),
    invalid: z.number(),
    needs_review: z.number(),
  }),
  items: z.array(z.object({
    stagingId: z.string(),
    status: StagingStatusSchema,
    productName: z.string().optional(),
    brand: z.string().optional(),
    productCode: z.string().optional(),
    category: z.string().optional(),
    sourceType: AdapterSourceTypeSchema,
    sourceName: z.string(),
    sourcePage: z.number().optional(),
    duplicateInfo: z.object({
      classification: z.string(),
      matchedKey: z.string().optional(),
      reason: z.string().optional(),
    }).optional(),
    validationErrors: z.array(z.string()),
  })),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  processedAt: z.string(),
});
