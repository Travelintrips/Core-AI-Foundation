/**
 * Universal Catalog Import — Staging Service
 * Manages import jobs and staging items in the database.
 *
 * HARD RULE: Zero writes to canonical materials table.
 * All writes go to material_catalog_import_jobs and material_catalog_staging only.
 *
 * Idempotency: jobs with the same checksum/idempotencyKey return the existing job.
 */

import { pool } from "@workspace/db";
import crypto from "node:crypto";
import type { ImportJob, JobStatus, StagingPreviewItem, AdapterSourceType } from "./types.js";
import { logger } from "../../lib/logger.js";

// ── Job CRUD ──────────────────────────────────────────────────────────────────

export async function createOrResumeJob(params: {
  sourceType: AdapterSourceType;
  sourceName: string;
  sourceUrl?: string;
  filename?: string;
  checksum?: string;
  idempotencyKey?: string;
  options?: Record<string, unknown>;
}): Promise<{ job: ImportJob; isExisting: boolean }> {
  const idemKey = params.idempotencyKey ?? params.checksum ?? null;

  // Check for existing job with same idempotency key
  if (idemKey) {
    const existing = await pool.query<DbImportJob>(
      `SELECT * FROM ai_platform.material_catalog_import_jobs
       WHERE checksum = $1 AND status NOT IN ('failed')
       ORDER BY created_at DESC LIMIT 1`,
      [idemKey],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      logger.info({ domain: "universal-catalog-import", jobId: row.id, checksum: idemKey }, "[stagingService] Resuming existing job");
      return { job: mapJob(row), isExisting: true };
    }
  }

  const result = await pool.query<DbImportJob>(
    `INSERT INTO ai_platform.material_catalog_import_jobs
      (source_type, source_name, source_url, filename, checksum, status, options)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING *`,
    [
      params.sourceType,
      params.sourceName,
      params.sourceUrl ?? null,
      params.filename ?? null,
      idemKey,
      params.options ? JSON.stringify(params.options) : null,
    ],
  );

  const row = result.rows[0]!;
  return { job: mapJob(row), isExisting: false };
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  counts?: {
    totalRaw?: number;
    totalNormalized?: number;
    totalNew?: number;
    totalDuplicate?: number;
    totalInvalid?: number;
    totalNeedsReview?: number;
    processedPages?: number;
    totalPages?: number;
  },
  summaries?: { warnings?: string[]; errors?: string[] },
): Promise<void> {
  await pool.query(
    `UPDATE ai_platform.material_catalog_import_jobs SET
      status = $2,
      total_raw = COALESCE($3, total_raw),
      total_normalized = COALESCE($4, total_normalized),
      total_new = COALESCE($5, total_new),
      total_duplicate = COALESCE($6, total_duplicate),
      total_invalid = COALESCE($7, total_invalid),
      total_needs_review = COALESCE($8, total_needs_review),
      processed_pages = COALESCE($9, processed_pages),
      total_pages = COALESCE($10, total_pages),
      warnings = COALESCE($11, warnings),
      errors = COALESCE($12, errors),
      processed_at = CASE WHEN $2 IN ('complete','partial','failed') THEN now() ELSE processed_at END,
      updated_at = now()
    WHERE id = $1`,
    [
      jobId,
      status,
      counts?.totalRaw ?? null,
      counts?.totalNormalized ?? null,
      counts?.totalNew ?? null,
      counts?.totalDuplicate ?? null,
      counts?.totalInvalid ?? null,
      counts?.totalNeedsReview ?? null,
      counts?.processedPages ?? null,
      counts?.totalPages ?? null,
      summaries?.warnings ?? null,
      summaries?.errors ?? null,
    ],
  );
}

export async function getJob(jobId: string): Promise<ImportJob | null> {
  const result = await pool.query<DbImportJob>(
    `SELECT * FROM ai_platform.material_catalog_import_jobs WHERE id = $1`,
    [jobId],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

// ── Staging items ─────────────────────────────────────────────────────────────

export async function bulkInsertStagingItems(
  jobId: string,
  items: StagingPreviewItem[],
): Promise<void> {
  if (items.length === 0) return;

  // Insert in chunks to avoid huge parameter lists
  const CHUNK = 50;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const item of chunk) {
      const m = item.material;
      placeholders.push(
        `($${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++})`,
      );
      values.push(
        item.stagingId,
        jobId,
        item.status,
        m.sourceType,
        m.sourceName,
        m.sourceVersion ?? null,
        m.sourceUrl ?? null,
        m.sourcePage ?? null,
        item.sourceContext?.row ?? null,
        item.sourceContext?.section ?? null,
        JSON.stringify(m.sourceMetadata ?? {}),
        JSON.stringify(typeof item.rawData === "string" ? { _raw: item.rawData } : item.rawData),
        m.brand ?? null,
        m.collection ?? null,
        m.series ?? null,
        m.productCode ?? null,
        m.productName ?? null,
        m.variant ?? null,
        m.category ?? null,
        m.subcategory ?? null,
        m.materialType ?? null,
        m.description ?? null,
        JSON.stringify(m.technicalSpecifications ?? null),
        m.thumbnailReference ?? null,
        item.duplicateInfo ? JSON.stringify(item.duplicateInfo) : null,
        item.validationErrors.length > 0 ? item.validationErrors : null,
        item.extractedAt,
        item.status !== "extracted" ? new Date() : null,
      );
    }

    await pool.query(
      `INSERT INTO ai_platform.material_catalog_staging
        (id, import_job_id, status, source_type, source_name, source_version,
         source_url, source_page, source_row, source_section, source_metadata,
         raw_data, brand, collection, series, product_code, product_name,
         variant, category, subcategory, material_type, description,
         technical_specs, thumbnail_reference, duplicate_info, validation_errors,
         extracted_at, normalized_at)
       VALUES ${placeholders.join(",")}
       ON CONFLICT (id) DO NOTHING`,
      values,
    );
  }
}

export async function getStagingItems(
  jobId: string,
  limit = 500,
): Promise<StagingPreviewItem[]> {
  const result = await pool.query<DbStagingItem>(
    `SELECT * FROM ai_platform.material_catalog_staging
     WHERE import_job_id = $1
     ORDER BY extracted_at ASC
     LIMIT $2`,
    [jobId, limit],
  );
  return result.rows.map(mapStagingItem);
}

// ── Checksum ──────────────────────────────────────────────────────────────────

export function computeChecksum(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

// ── DB row mappers ────────────────────────────────────────────────────────────

interface DbImportJob {
  id: string;
  source_type: string;
  source_name: string;
  source_url: string | null;
  filename: string | null;
  checksum: string | null;
  status: string;
  total_raw: number;
  total_normalized: number;
  total_new: number;
  total_duplicate: number;
  total_invalid: number;
  total_needs_review: number;
  processed_pages: number | null;
  total_pages: number | null;
  warnings: string[];
  errors: string[];
  options: unknown;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface DbStagingItem {
  id: string;
  import_job_id: string;
  status: string;
  source_type: string;
  source_name: string;
  source_version: string | null;
  source_url: string | null;
  source_page: number | null;
  source_row: number | null;
  source_section: string | null;
  source_metadata: unknown;
  raw_data: unknown;
  brand: string | null;
  collection: string | null;
  series: string | null;
  product_code: string | null;
  product_name: string | null;
  variant: string | null;
  category: string | null;
  subcategory: string | null;
  material_type: string | null;
  description: string | null;
  colors: string[] | null;
  finish: string[] | null;
  texture: string | null;
  pattern: string | null;
  dimensions: unknown;
  working_size: string | null;
  thickness: string | null;
  number_of_faces: number | null;
  pei_rating: number | null;
  shade_variation: string | null;
  technical_specs: unknown;
  application: string[] | null;
  certifications: string[] | null;
  thumbnail_reference: string | null;
  preview_references: string[] | null;
  duplicate_info: unknown;
  validation_errors: string[] | null;
  extracted_at: Date;
  normalized_at: Date | null;
  created_at: Date;
}

function mapJob(row: DbImportJob): ImportJob {
  return {
    id: row.id,
    sourceType: row.source_type as AdapterSourceType,
    sourceName: row.source_name,
    sourceUrl: row.source_url ?? undefined,
    filename: row.filename ?? undefined,
    checksum: row.checksum ?? undefined,
    status: row.status as JobStatus,
    totalRaw: row.total_raw,
    totalNormalized: row.total_normalized,
    totalNew: row.total_new,
    totalDuplicate: row.total_duplicate,
    totalInvalid: row.total_invalid,
    totalNeedsReview: row.total_needs_review,
    processedPages: row.processed_pages ?? undefined,
    totalPages: row.total_pages ?? undefined,
    warnings: row.warnings ?? [],
    errors: row.errors ?? [],
    options: row.options as Record<string, unknown> | undefined,
    processedAt: row.processed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStagingItem(row: DbStagingItem): StagingPreviewItem {
  return {
    stagingId: row.id,
    status: row.status as StagingPreviewItem["status"],
    material: {
      brand: row.brand ?? undefined,
      collection: row.collection ?? undefined,
      series: row.series ?? undefined,
      productCode: row.product_code ?? undefined,
      productName: row.product_name ?? undefined,
      variant: row.variant ?? undefined,
      category: row.category ?? undefined,
      subcategory: row.subcategory ?? undefined,
      materialType: row.material_type ?? undefined,
      description: row.description ?? undefined,
      colors: row.colors ?? undefined,
      finish: row.finish ?? undefined,
      texture: row.texture ?? undefined,
      pattern: row.pattern ?? undefined,
      dimensions: row.dimensions as Record<string, unknown> | undefined,
      workingSize: row.working_size ?? undefined,
      thickness: row.thickness ?? undefined,
      numberOfFaces: row.number_of_faces ?? undefined,
      peiRating: row.pei_rating ?? undefined,
      shadeVariation: row.shade_variation ?? undefined,
      technicalSpecifications: row.technical_specs as Record<string, unknown> | undefined,
      application: row.application ?? undefined,
      certifications: row.certifications ?? undefined,
      thumbnailReference: row.thumbnail_reference ?? undefined,
      previewReferences: row.preview_references ?? undefined,
      sourceType: row.source_type as AdapterSourceType,
      sourceName: row.source_name,
      sourceVersion: row.source_version ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      sourcePage: row.source_page ?? undefined,
      sourceMetadata: row.source_metadata as Record<string, unknown> | undefined,
    },
    rawData: row.raw_data as Record<string, unknown>,
    sourceContext: row.source_page !== null || row.source_row !== null
      ? { page: row.source_page ?? undefined, row: row.source_row ?? undefined, section: row.source_section ?? undefined }
      : undefined,
    duplicateInfo: row.duplicate_info as StagingPreviewItem["duplicateInfo"],
    validationErrors: row.validation_errors ?? [],
    extractedAt: row.extracted_at,
  };
}
