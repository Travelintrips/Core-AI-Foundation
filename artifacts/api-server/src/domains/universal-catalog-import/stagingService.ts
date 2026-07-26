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

export async function listJobs(params: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<{ jobs: ImportJob[]; total: number }> {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.status) {
    conditions.push(`status = $${idx++}`);
    values.push(params.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ai_platform.material_catalog_import_jobs ${where}`,
    values,
  );

  const dataResult = await pool.query<DbImportJob>(
    `SELECT * FROM ai_platform.material_catalog_import_jobs ${where}
     ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  return {
    jobs: dataResult.rows.map(mapJob),
    total: parseInt(countResult.rows[0]?.count ?? "0", 10),
  };
}

// ── Staging items ─────────────────────────────────────────────────────────────

/**
 * Persist all material attributes to staging.
 * All 41 columns written — nothing silently discarded.
 */
export async function bulkInsertStagingItems(
  jobId: string,
  items: StagingPreviewItem[],
): Promise<void> {
  if (items.length === 0) return;

  const CHUNK = 50;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;

    for (const item of chunk) {
      const m = item.material;
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},` +
        ` $${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},` +
        ` $${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},` +
        ` $${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
      );
      values.push(
        // Identity
        item.stagingId,                                            // $1  id
        jobId,                                                     // $2  import_job_id
        item.status,                                               // $3  status
        // Provenance
        m.sourceType,                                              // $4  source_type
        m.sourceName,                                              // $5  source_name
        m.sourceVersion ?? null,                                   // $6  source_version
        m.sourceUrl ?? null,                                       // $7  source_url
        m.sourcePage ?? null,                                      // $8  source_page
        item.sourceContext?.row ?? null,                           // $9  source_row
        item.sourceContext?.section ?? null,                       // $10 source_section
        JSON.stringify(m.sourceMetadata ?? {}),                    // $11 source_metadata
        // Raw data
        JSON.stringify(
          typeof item.rawData === "string"
            ? { _raw: item.rawData }
            : item.rawData,
        ),                                                         // $12 raw_data
        // Identity fields
        m.brand ?? null,                                           // $13 brand
        m.collection ?? null,                                      // $14 collection
        m.series ?? null,                                          // $15 series
        m.productCode ?? null,                                     // $16 product_code
        m.productName ?? null,                                     // $17 product_name
        m.variant ?? null,                                         // $18 variant
        // Classification
        m.category ?? null,                                        // $19 category
        m.subcategory ?? null,                                     // $20 subcategory
        m.materialType ?? null,                                    // $21 material_type
        // Description
        m.description ?? null,                                     // $22 description
        // Appearance — arrays stored as native PG arrays (node-postgres handles this)
        m.colors && m.colors.length > 0 ? m.colors : null,        // $23 colors TEXT[]
        m.finish && m.finish.length > 0 ? m.finish : null,        // $24 finish TEXT[]
        m.texture ?? null,                                         // $25 texture
        m.pattern ?? null,                                         // $26 pattern
        // Dimensions
        m.dimensions ? JSON.stringify(m.dimensions) : null,        // $27 dimensions JSONB
        m.workingSize ?? null,                                     // $28 working_size
        m.thickness ?? null,                                       // $29 thickness
        m.numberOfFaces ?? null,                                   // $30 number_of_faces
        // Tile-specific ratings
        m.peiRating ?? null,                                       // $31 pei_rating
        m.shadeVariation ?? null,                                  // $32 shade_variation
        // Technical
        m.technicalSpecifications
          ? JSON.stringify(m.technicalSpecifications)
          : null,                                                  // $33 technical_specs JSONB
        m.application && m.application.length > 0
          ? m.application
          : null,                                                  // $34 application TEXT[]
        m.certifications && m.certifications.length > 0
          ? m.certifications
          : null,                                                  // $35 certifications TEXT[]
        // Media
        m.thumbnailReference ?? null,                              // $36 thumbnail_reference
        m.previewReferences && m.previewReferences.length > 0
          ? m.previewReferences
          : null,                                                  // $37 preview_references TEXT[]
        // Classification
        item.duplicateInfo ? JSON.stringify(item.duplicateInfo) : null, // $38 duplicate_info
        item.validationErrors.length > 0 ? item.validationErrors : null, // $39 validation_errors
        // Timestamps
        item.extractedAt,                                          // $40 extracted_at
        item.status !== "extracted" ? new Date() : null,          // $41 normalized_at
      );
    }

    await pool.query(
      `INSERT INTO ai_platform.material_catalog_staging
        (id, import_job_id, status,
         source_type, source_name, source_version, source_url, source_page,
         source_row, source_section, source_metadata,
         raw_data,
         brand, collection, series, product_code, product_name, variant,
         category, subcategory, material_type,
         description,
         colors, finish, texture, pattern,
         dimensions, working_size, thickness, number_of_faces,
         pei_rating, shade_variation,
         technical_specs, application, certifications,
         thumbnail_reference, preview_references,
         duplicate_info, validation_errors,
         extracted_at, normalized_at)
       VALUES ${placeholders.join(",")}
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         brand = EXCLUDED.brand,
         collection = EXCLUDED.collection,
         series = EXCLUDED.series,
         product_code = EXCLUDED.product_code,
         product_name = EXCLUDED.product_name,
         variant = EXCLUDED.variant,
         category = EXCLUDED.category,
         subcategory = EXCLUDED.subcategory,
         material_type = EXCLUDED.material_type,
         description = EXCLUDED.description,
         colors = EXCLUDED.colors,
         finish = EXCLUDED.finish,
         texture = EXCLUDED.texture,
         pattern = EXCLUDED.pattern,
         dimensions = EXCLUDED.dimensions,
         working_size = EXCLUDED.working_size,
         thickness = EXCLUDED.thickness,
         number_of_faces = EXCLUDED.number_of_faces,
         pei_rating = EXCLUDED.pei_rating,
         shade_variation = EXCLUDED.shade_variation,
         technical_specs = EXCLUDED.technical_specs,
         application = EXCLUDED.application,
         certifications = EXCLUDED.certifications,
         thumbnail_reference = EXCLUDED.thumbnail_reference,
         preview_references = EXCLUDED.preview_references,
         duplicate_info = EXCLUDED.duplicate_info,
         validation_errors = EXCLUDED.validation_errors,
         source_metadata = EXCLUDED.source_metadata,
         normalized_at = EXCLUDED.normalized_at,
         updated_at = now()`,
      values,
    );
  }
}

export interface StagingItemFilter {
  status?: string;
  brand?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: "extracted_at" | "product_name" | "brand" | "product_code" | "status";
  sortDir?: "asc" | "desc";
}

export async function getStagingItems(
  jobId: string,
  filterOrLimit: StagingItemFilter | number = 500,
): Promise<StagingPreviewItem[]> {
  // Backward-compat: accept plain number as limit
  const filter: StagingItemFilter =
    typeof filterOrLimit === "number" ? { limit: filterOrLimit } : filterOrLimit;

  const limit = Math.min(filter.limit ?? 500, 500);
  const offset = filter.offset ?? 0;
  const conditions: string[] = ["import_job_id = $1"];
  const values: unknown[] = [jobId];
  let idx = 2;

  if (filter.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filter.status);
  }
  if (filter.brand) {
    conditions.push(`brand ILIKE $${idx++}`);
    values.push(`%${filter.brand}%`);
  }
  if (filter.category) {
    conditions.push(`category ILIKE $${idx++}`);
    values.push(`%${filter.category}%`);
  }
  if (filter.search) {
    conditions.push(
      `(product_name ILIKE $${idx} OR brand ILIKE $${idx} OR product_code ILIKE $${idx})`,
    );
    values.push(`%${filter.search}%`);
    idx++;
  }

  const ALLOWED_SORT = ["extracted_at", "product_name", "brand", "product_code", "status"] as const;
  const sortCol = ALLOWED_SORT.includes(filter.sortBy as typeof ALLOWED_SORT[number])
    ? filter.sortBy!
    : "extracted_at";
  const sortDir = filter.sortDir === "desc" ? "DESC" : "ASC";

  const result = await pool.query<DbStagingItem>(
    `SELECT * FROM ai_platform.material_catalog_staging
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );
  return result.rows.map(mapStagingItem);
}

export async function getStagingItemById(
  jobId: string,
  stagingId: string,
): Promise<StagingPreviewItem | null> {
  const result = await pool.query<DbStagingItem>(
    `SELECT * FROM ai_platform.material_catalog_staging
     WHERE import_job_id = $1 AND id = $2`,
    [jobId, stagingId],
  );
  return result.rows[0] ? mapStagingItem(result.rows[0]) : null;
}

export async function countStagingItems(
  jobId: string,
  filter: StagingItemFilter = {},
): Promise<number> {
  const conditions: string[] = ["import_job_id = $1"];
  const values: unknown[] = [jobId];
  let idx = 2;

  if (filter.status) { conditions.push(`status = $${idx++}`); values.push(filter.status); }
  if (filter.brand) { conditions.push(`brand ILIKE $${idx++}`); values.push(`%${filter.brand}%`); }
  if (filter.category) { conditions.push(`category ILIKE $${idx++}`); values.push(`%${filter.category}%`); }
  if (filter.search) {
    conditions.push(`(product_name ILIKE $${idx} OR brand ILIKE $${idx} OR product_code ILIKE $${idx})`);
    values.push(`%${filter.search}%`);
    idx++;
  }

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ai_platform.material_catalog_staging WHERE ${conditions.join(" AND ")}`,
    values,
  );
  return parseInt(result.rows[0]?.count ?? "0", 10);
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
    sourceContext:
      row.source_page !== null || row.source_row !== null
        ? {
            page: row.source_page ?? undefined,
            row: row.source_row ?? undefined,
            section: row.source_section ?? undefined,
          }
        : undefined,
    duplicateInfo: row.duplicate_info as StagingPreviewItem["duplicateInfo"],
    validationErrors: row.validation_errors ?? [],
    extractedAt: row.extracted_at,
  };
}
