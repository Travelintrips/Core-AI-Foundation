/**
 * Material Catalog Integration — Phase 3 Foundation
 * Zod schemas for all I/O contracts.
 * Uses workspace zod package (not zod/v4).
 */

import { z } from "zod";

// ── Limits ────────────────────────────────────────────────────────────────────

export const MAX_RECORDS_PER_PREVIEW = 500;
export const MAX_PAYLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Media reference ───────────────────────────────────────────────────────────

export const MediaReferenceKindSchema = z.enum([
  "remote_url",
  "provider_asset_id",
  "local_fixture",
  "unresolved",
]);

export const MediaReferenceSchema = z.object({
  kind: MediaReferenceKindSchema,
  url: z.string().url().optional(),
  assetId: z.string().optional(),
  fixturePath: z.string().optional(),
  rawValue: z.string().optional(),
});

// ── External catalog DTO ──────────────────────────────────────────────────────

export const ExternalCatalogItemSchema = z.object({
  externalId: z.string().min(1),
  providerId: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  brand: z.string().optional(),
  productCode: z.string().optional(),
  productName: z.string().min(1),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  materialType: z.string().optional(),
  description: z.string().optional(),
  color: z.array(z.string()).optional(),
  finish: z.array(z.string()).optional(),
  texture: z.string().optional(),
  pattern: z.string().optional(),
  priceTier: z.string().optional(),
  unit: z.string().optional(),
  dimensions: z.record(z.unknown()).optional(),
  technicalData: z.record(z.unknown()).optional(),
  certifications: z.array(z.string()).optional(),
  thumbnailReference: MediaReferenceSchema.optional(),
  previewReferences: z.array(MediaReferenceSchema).optional(),
  country: z.string().optional(),
  locale: z.string().optional(),
  sourceUpdatedAt: z.date().optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
});

// ── Provider capabilities ─────────────────────────────────────────────────────

export const CatalogProviderCapabilitiesSchema = z.object({
  supportedBrands: z.array(z.string()),
  supportedCountries: z.array(z.string()),
  supportsPagination: z.boolean(),
  supportsFiltering: z.boolean(),
  maxItemsPerFetch: z.number().int().positive(),
  requiresCredentials: z.boolean(),
});

// ── Provider I/O ──────────────────────────────────────────────────────────────

export const CatalogFetchContextSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(MAX_RECORDS_PER_PREVIEW).optional(),
  brand: z.string().optional(),
  country: z.string().optional(),
});

export const ExternalCatalogResultSchema = z.object({
  items: z.array(ExternalCatalogItemSchema),
  nextCursor: z.string().optional(),
  totalAvailable: z.number().int().nonnegative().optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
  fetchedAt: z.date(),
  payloadSizeBytes: z.number().int().nonnegative().optional(),
});

export const CatalogProviderValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
});

// ── Duplicate classification ──────────────────────────────────────────────────

export const DuplicateClassificationSchema = z.enum([
  "new",
  "exact_duplicate",
  "possible_duplicate",
  "invalid",
  "conflicting_identity",
]);

export const DuplicateCheckResultSchema = z.object({
  externalId: z.string(),
  classification: DuplicateClassificationSchema,
  matchedKey: z.string().optional(),
  reason: z.string().optional(),
});

// ── Import options ────────────────────────────────────────────────────────────

export const ImportOptionsSchema = z.object({
  dryRun: z.literal(true),
  maxRecords: z.number().int().positive().max(MAX_RECORDS_PER_PREVIEW).optional(),
  cursor: z.string().optional(),
  brand: z.string().optional(),
  country: z.string().optional(),
});

// ── Import preview result ─────────────────────────────────────────────────────

export const ClassifiedItemSchema = z.object({
  item: ExternalCatalogItemSchema,
  classification: DuplicateClassificationSchema,
  normalizationWarnings: z.array(z.string()),
});

export const ImportPreviewResultSchema = z.object({
  totalReceived: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  exactDuplicateCount: z.number().int().nonnegative(),
  possibleDuplicateCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  items: z.array(ClassifiedItemSchema),
  nextCursor: z.string().optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
  payloadSizeBytes: z.number().int().nonnegative().optional(),
  executionDurationMs: z.number().nonnegative(),
});

// ── Import report ─────────────────────────────────────────────────────────────

export const ImportReportStatusSchema = z.enum([
  "completed",
  "completed_with_warnings",
  "failed",
  "rejected",
]);

export const ImportReportCountsSchema = z.object({
  totalReceived: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  exactDuplicateCount: z.number().int().nonnegative(),
  possibleDuplicateCount: z.number().int().nonnegative(),
});

export const ImportReportSchema = z.object({
  runId: z.string().min(1),
  providerId: z.string().min(1),
  startedAt: z.date(),
  completedAt: z.date(),
  status: ImportReportStatusSchema,
  counts: ImportReportCountsSchema,
  warnings: z.array(z.string()),
  validationErrors: z.array(z.string()),
  providerErrors: z.array(z.string()),
  previewSummary: z.string(),
  items: z.array(ClassifiedItemSchema),
  nextCursor: z.string().optional(),
  payloadSizeBytes: z.number().int().nonnegative().optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
});

// ── Inferred types (for schema-first consumers) ───────────────────────────────

export type ExternalCatalogItemInput = z.input<typeof ExternalCatalogItemSchema>;
export type CatalogFetchContextInput = z.input<typeof CatalogFetchContextSchema>;
export type ImportOptionsInput = z.input<typeof ImportOptionsSchema>;
