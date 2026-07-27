/**
 * Phase 5 — Controlled Material Import & Human Review.
 *
 * This service intentionally starts after staging. It never calls extraction,
 * OCR, parsing, or normalization adapters. Staged payloads are reviewed,
 * approved, and imported into the canonical material library one item at a time.
 *
 * Duplicate-resolution paths (set via resolveDuplicate before import):
 *   keep_existing   — link staging to existing canonical; no new row
 *   replace_existing — update mutable fields on target canonical; no new row
 *   merge            — apply field-level merge map to target canonical; no new row
 *   create_new       — insert exactly one new canonical row; reject conflicts
 *   (null/default)   — same as create_new
 */
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";
import {
  getSupabasePublicUrl,
  isSupabaseStorageAvailable,
  uploadToSupabase,
} from "../lib/supabaseStorage.js";
import sharp from "sharp";

export const IMPORT_STATES = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
  "importing",
  "imported",
  "failed",
  "rolled_back",
] as const;
export type ImportState = (typeof IMPORT_STATES)[number];
export type DuplicateResolution =
  | "keep_existing"
  | "replace_existing"
  | "merge"
  | "create_new";

export type MergeStrategy = "keep_existing" | "use_incoming" | "combine";
export type MergeFieldMap = Record<string, MergeStrategy>;

export interface StagedMaterialInput {
  /** Phase 4A provenance — populated when handoff comes from Phase 4A job */
  sourceStagingId?: number;
  sourceJobId?: number;
  sourceChecksum?: string;

  collection?: string;
  productCode: string;
  variant?: string;
  brand?: string;
  category: string;
  materialType?: string;
  name?: string;
  description?: string;
  finish?: string;
  texture?: string;
  pattern?: string;
  dimensions?: string;
  thickness?: string;
  workingSize?: string;
  pei?: string;
  shadeVariation?: string;
  application?: string;
  technicalSpecifications?: Record<string, unknown>;
  warnings?: string[];
  previewImageUrl?: string;
  duplicateScore?: number;
  assetUrls?: string[];
  source?: string;
}

export interface ReviewFilters {
  status?: ImportState;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: "created_desc" | "created_asc" | "duplicate_desc";
}

const VALID_TRANSITIONS: Record<ImportState, ImportState[]> = {
  draft: ["needs_review", "rejected"],
  needs_review: ["approved", "rejected", "draft"],
  approved: ["needs_review", "rejected"],
  rejected: ["needs_review"],
  importing: ["failed", "imported", "rolled_back"],
  imported: ["rolled_back"],
  failed: ["needs_review", "approved", "rolled_back"],
  rolled_back: ["needs_review"],
};

function assertState(value: unknown): asserts value is ImportState {
  if (!IMPORT_STATES.includes(value as ImportState)) {
    throw new Error(`Invalid material import state: ${String(value)}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function safeSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "material";
}

interface StagedMaterialRow extends Record<string, unknown> {
  id: number;
  status: string;
  productCode: string;
  category: string;
  duplicateScore: number | null;
  technicalSpecifications: Record<string, unknown>;
  warnings: unknown[];
  assetUrls: unknown[];
  duplicateResolution: DuplicateResolution | null;
  targetCanonicalId: number | null;
  mergeFieldMap: MergeFieldMap | null;
  sourceStagingId: number | null;
  sourceJobId: number | null;
}

function rowToMaterial(row: Record<string, unknown>): StagedMaterialRow {
  return {
    ...row,
    id: Number(row.id),
    status: String(row.status ?? "needs_review"),
    productCode: String(row.product_code ?? ""),
    category: String(row.category ?? ""),
    duplicateScore: row.duplicate_score == null ? null : Number(row.duplicate_score),
    technicalSpecifications: (row.technical_specifications as Record<string, unknown>) ?? {},
    warnings: (row.warnings as unknown[]) ?? [],
    assetUrls: (row.asset_urls as unknown[]) ?? [],
    duplicateResolution: (row.duplicate_resolution as DuplicateResolution | null) ?? null,
    targetCanonicalId: row.target_canonical_id == null ? null : Number(row.target_canonical_id),
    mergeFieldMap: (row.merge_field_map as MergeFieldMap | null) ?? null,
    sourceStagingId: row.source_staging_id == null ? null : Number(row.source_staging_id),
    sourceJobId: row.source_job_id == null ? null : Number(row.source_job_id),
  };
}

/** Verify that Phase 5 tables exist — call at startup, does NOT create tables. */
export async function verifyMaterialImportTables(): Promise<void> {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS cnt
    FROM information_schema.tables
    WHERE table_schema = 'ai_platform'
      AND table_name IN ('material_import_staging','material_import_audit')
  `);
  const found = Number(result.rows[0]?.cnt ?? 0);
  if (found < 2) {
    logger.warn(
      { found },
      "[material-import] Phase 5 tables not found — run migration 20260726_material_import_phase5.sql",
    );
  }
}

/** @deprecated Use the migration 20260726_material_import_phase5.sql instead. Kept for backward-compat only. */
export async function ensureMaterialImportTables(): Promise<void> {
  await verifyMaterialImportTables();
}

export async function createStagedMaterial(input: StagedMaterialInput, actor?: Actor) {
  if (!input.productCode?.trim() || !input.category?.trim()) {
    throw new Error("productCode and category are required");
  }
  const result = await pool.query(
    `INSERT INTO ai_platform.material_import_staging
      (source_staging_id, source_job_id, source_checksum,
       collection, product_code, variant, brand, category, material_type, name, description,
       finish, texture, pattern, dimensions, thickness, working_size, pei, shade_variation,
       application, technical_specifications, warnings, preview_image_url, duplicate_score,
       asset_urls, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21::jsonb,$22::jsonb,$23,$24,$25::jsonb,$26,'needs_review')
     RETURNING *`,
    [
      input.sourceStagingId ?? null,
      input.sourceJobId ?? null,
      input.sourceChecksum ?? null,
      input.collection ?? null,
      input.productCode.trim(),
      input.variant ?? null,
      input.brand ?? null,
      input.category.trim(),
      input.materialType ?? null,
      input.name ?? null,
      input.description ?? null,
      input.finish ?? null,
      input.texture ?? null,
      input.pattern ?? null,
      input.dimensions ?? null,
      input.thickness ?? null,
      input.workingSize ?? null,
      input.pei ?? null,
      input.shadeVariation ?? null,
      input.application ?? null,
      JSON.stringify(input.technicalSpecifications ?? {}),
      JSON.stringify(input.warnings ?? []),
      input.previewImageUrl ?? null,
      input.duplicateScore ?? null,
      JSON.stringify(input.assetUrls ?? []),
      input.source ?? null,
    ],
  );
  const row = rowToMaterial(result.rows[0] as Record<string, unknown>);
  await recordAudit(Number(row.id), "staged", null, "needs_review", actor, "Material entered review staging");
  return row;
}

export async function listStagedMaterials(filters: ReviewFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (filters.status) {
    assertState(filters.status);
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    conditions.push(`(product_code ILIKE $${values.length} OR COALESCE(name,'') ILIKE $${values.length} OR COALESCE(brand,'') ILIKE $${values.length} OR category ILIKE $${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = filters.sort === "created_asc"
    ? "created_at ASC"
    : filters.sort === "duplicate_desc"
      ? "duplicate_score DESC NULLS LAST, created_at DESC"
      : "created_at DESC";
  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ai_platform.material_import_staging ${where}`, values);
  const total = Number(countResult.rows[0]?.total ?? 0);
  values.push(pageSize, (page - 1) * pageSize);
  const result = await pool.query(
    `SELECT * FROM ai_platform.material_import_staging ${where}
     ORDER BY ${orderBy} LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: result.rows.map((row) => rowToMaterial(row as Record<string, unknown>)), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getStagedMaterial(id: number) {
  const result = await pool.query(
    `SELECT * FROM ai_platform.material_import_staging WHERE id = $1`,
    [id],
  );
  if (!result.rows[0]) throw new Error("Staged material not found");
  const audit = await pool.query(
    `SELECT * FROM ai_platform.material_import_audit WHERE staging_id = $1 ORDER BY created_at DESC`,
    [id],
  );
  return {
    material: rowToMaterial(result.rows[0] as Record<string, unknown>),
    audit: audit.rows,
  };
}

async function recordAudit(
  stagingId: number,
  eventType: string,
  fromStatus: ImportState | null,
  toStatus: ImportState | null,
  actor?: Actor,
  notes?: string,
  extras: Record<string, unknown> = {},
) {
  await pool.query(
    `INSERT INTO ai_platform.material_import_audit
      (staging_id,event_type,from_status,to_status,reviewer_id,reviewer_name,notes,
       changed_fields,duplicate_resolution,target_canonical_id,merge_field_map,asset_result,rollback_reason,duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13,$14)`,
    [
      stagingId, eventType, fromStatus, toStatus, actor?.id ?? null, actor?.name ?? null,
      notes ?? null, JSON.stringify(extras.changedFields ?? []),
      extras.duplicateResolution ?? null,
      extras.targetCanonicalId ?? null,
      JSON.stringify(extras.mergeFieldMap ?? null),
      JSON.stringify(extras.assetResult ?? null),
      extras.rollbackReason ?? null,
      extras.durationMs ?? null,
    ],
  );
  await logAudit(
    "material-import",
    eventType,
    String(stagingId),
    "material_import_staging",
    "success",
    { fromStatus, toStatus, reviewerId: actor?.id ?? null, reviewerName: actor?.name ?? null, ...extras, notes },
    { actorId: actor?.id ?? null, actorType: actor?.type === "system" ? ("system" as const) : ("internal_user" as const) },
  );
}

export interface Actor {
  id?: string;
  name?: string;
  type?: "internal" | "system";
}

export async function transitionStagedMaterial(
  id: number,
  nextStatus: ImportState,
  actor: Actor,
  notes?: string,
) {
  assertState(nextStatus);
  const current = await getStagedMaterial(id);
  const from = current.material.status as ImportState;
  if (!VALID_TRANSITIONS[from]?.includes(nextStatus)) {
    throw new Error(`Cannot transition material ${id} from ${from} to ${nextStatus}`);
  }
  // Notes are required when rejecting
  if (nextStatus === "rejected" && !notes) {
    throw new Error("Reviewer notes are required when rejecting a material");
  }
  const result = await pool.query(
    `UPDATE ai_platform.material_import_staging
     SET status = $2, reviewer_id = $3, reviewer_name = $4, reviewer_notes = COALESCE($5, reviewer_notes),
         reviewed_at = CASE WHEN $2 IN ('approved','rejected') THEN NOW() ELSE reviewed_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, nextStatus, actor.id ?? null, actor.name ?? null, notes ?? null],
  );
  await recordAudit(id, `status_${nextStatus}`, from, nextStatus, actor, notes);
  return rowToMaterial(result.rows[0] as Record<string, unknown>);
}

export async function bulkTransition(
  ids: number[],
  nextStatus: Extract<ImportState, "approved" | "rejected" | "needs_review">,
  actor: Actor,
  notes?: string,
) {
  const results: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const id of [...new Set(ids)]) {
    try {
      await transitionStagedMaterial(id, nextStatus, actor, notes);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : "Transition failed" });
    }
  }
  return { results, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length };
}

/**
 * Persist the chosen duplicate-resolution strategy on the staging row.
 * Must be called before importApprovedMaterials to take effect.
 *
 * replace_existing and merge require targetCanonicalId.
 * merge additionally requires mergeFieldMap.
 *
 * Terminal states (imported, rolled_back) block resolution changes.
 */
export async function resolveDuplicate(
  id: number,
  resolution: DuplicateResolution,
  actor: Actor,
  notes?: string,
  options?: { targetCanonicalId?: number; mergeFieldMap?: MergeFieldMap },
) {
  if (!["keep_existing", "replace_existing", "merge", "create_new"].includes(resolution)) {
    throw new Error("Invalid duplicate resolution");
  }
  const current = await getStagedMaterial(id);
  const currentStatus = current.material.status;
  if (!["approved", "needs_review", "draft"].includes(currentStatus)) {
    throw new Error("Duplicate resolution is only available before import");
  }

  // Validate requirements
  if ((resolution === "replace_existing" || resolution === "merge") && !options?.targetCanonicalId) {
    throw new Error(`${resolution} requires a targetCanonicalId pointing to the existing canonical material`);
  }
  if (resolution === "merge" && (!options?.mergeFieldMap || Object.keys(options.mergeFieldMap).length === 0)) {
    throw new Error("merge requires a mergeFieldMap specifying field-level strategies (keep_existing|use_incoming|combine)");
  }

  // Validate merge strategy values
  if (resolution === "merge" && options?.mergeFieldMap) {
    const validStrategies: MergeStrategy[] = ["keep_existing", "use_incoming", "combine"];
    for (const [field, strategy] of Object.entries(options.mergeFieldMap)) {
      if (!validStrategies.includes(strategy as MergeStrategy)) {
        throw new Error(`Invalid merge strategy "${strategy}" for field "${field}". Use keep_existing, use_incoming, or combine.`);
      }
    }
  }

  // Persist the resolution decision on the staging row
  await pool.query(
    `UPDATE ai_platform.material_import_staging
     SET duplicate_resolution = $2, target_canonical_id = $3, merge_field_map = $4::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      resolution,
      options?.targetCanonicalId ?? null,
      JSON.stringify(options?.mergeFieldMap ?? null),
    ],
  );

  await recordAudit(id, "duplicate_resolved", currentStatus as ImportState, currentStatus as ImportState, actor, notes, {
    duplicateResolution: resolution,
    targetCanonicalId: options?.targetCanonicalId ?? null,
    mergeFieldMap: options?.mergeFieldMap ?? null,
  });

  return { id, resolution, targetCanonicalId: options?.targetCanonicalId ?? null, saved: true };
}

async function downloadAndStoreAsset(staging: Record<string, unknown>) {
  const sourceUrl = String(staging.preview_image_url ?? (Array.isArray(staging.asset_urls) ? staging.asset_urls[0] ?? "" : ""));
  if (!sourceUrl) return { status: "not_available" as const };
  if (!/^https?:\/\//i.test(sourceUrl)) throw new Error("Asset source URL must use http or https");
  const parsed = new URL(sourceUrl);
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname)) {
    throw new Error("Local asset source URLs are not allowed");
  }
  const response = await fetch(sourceUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Asset download failed with HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) throw new Error(`Asset MIME type is not an image: ${contentType || "unknown"}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 10 * 1024 * 1024) throw new Error("Asset exceeds the 10 MB limit");
  const source = Buffer.from(await response.arrayBuffer());
  if (source.byteLength > 10 * 1024 * 1024) throw new Error("Asset exceeds the 10 MB limit");
  const converted = await sharp(source).webp({ quality: 86 }).toBuffer();
  const thumb = await sharp(source).resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const brand = safeSlug(String(staging.brand ?? "unknown-brand"));
  const collection = safeSlug(String(staging.collection ?? "uncategorized"));
  const code = safeSlug(String(staging.product_code));
  const basePath = `material-assets/${brand}/${collection}/${code}`;
  if (!isSupabaseStorageAvailable()) {
    return { status: "pending" as const, sourceUrl, checksum: crypto.createHash("sha256").update(source).digest("hex") };
  }
  const [mainUrl] = await Promise.all([
    uploadToSupabase(`${basePath}/main.webp`, converted, "image/webp"),
    uploadToSupabase(`${basePath}/thumb.webp`, thumb, "image/webp"),
  ]);
  return {
    status: "uploaded" as const,
    sourceUrl,
    checksum: crypto.createHash("sha256").update(source).digest("hex"),
    storagePath: `${basePath}/main.webp`,
    storageUrl: mainUrl ?? getSupabasePublicUrl(`${basePath}/main.webp`),
  };
}

/** Mutable fields that replace_existing and merge are allowed to update. */
const MUTABLE_MATERIAL_FIELDS = [
  "name", "slug", "category", "subcategory", "brand", "material_type",
  "color", "finish", "texture", "pattern", "description",
  "thumbnail_url", "preview_images", "technical_data", "search_keywords",
] as const;

/** Immutable identity fields that must not be changed by replace/merge. */
const IMMUTABLE_MATERIAL_FIELDS = ["id", "material_code", "created_at"] as const;

type MutableField = (typeof MUTABLE_MATERIAL_FIELDS)[number];

/**
 * Import approved materials into the canonical library.
 *
 * Each item is processed in its own transaction. A per-item failure does not
 * roll back other items. The duplicate_resolution field on the staging row
 * controls which import path is taken:
 *
 *   keep_existing   — link staging to existing canonical; no INSERT
 *   replace_existing — UPDATE mutable fields on target_canonical_id; no INSERT
 *   merge            — apply mergeFieldMap to target_canonical_id; no INSERT
 *   create_new/null  — INSERT new row; reject material_code conflicts
 */
export async function importApprovedMaterials(ids: number[] | "all", actor: Actor) {
  const started = Date.now();
  const query = ids === "all"
    ? await pool.query(`SELECT * FROM ai_platform.material_import_staging WHERE status = 'approved' ORDER BY id`)
    : await pool.query(`SELECT * FROM ai_platform.material_import_staging WHERE id = ANY($1::bigint[]) AND status = 'approved' ORDER BY id`, [ids]);
  const approvedIds = new Set(query.rows.map((r) => Number((r as Record<string, unknown>).id)));
  const requestedIds: number[] = ids === "all" ? [] : ids;
  const report = {
    imported: 0,
    skipped: 0,
    rejected: 0,
    kept: 0,
    replaced: 0,
    merged: 0,
    failed: 0,
    pendingAssets: 0,
    processingTimeMs: 0,
    items: [] as Array<Record<string, unknown>>,
  };

  if (ids !== "all") {
    for (const reqId of requestedIds) {
      if (!approvedIds.has(reqId)) {
        report.skipped++;
        report.items.push({ id: reqId, status: "skipped" });
      }
    }
  }

  for (const stagingRaw of query.rows) {
    const staging = stagingRaw as Record<string, unknown>;
    const id = Number(staging.id);
    const itemStarted = Date.now();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Atomic claim — prevents concurrent import of same item
      const claim = await client.query(
        `UPDATE ai_platform.material_import_staging
         SET status = 'importing', import_started_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'approved' RETURNING *`,
        [id],
      );
      if (!claim.rows[0]) {
        await client.query("ROLLBACK");
        report.skipped++;
        report.items.push({ id, status: "skipped" });
        continue;
      }
      const row = claim.rows[0] as Record<string, unknown>;
      const resolution = (row.duplicate_resolution as DuplicateResolution | null) ?? "create_new";
      const targetCanonicalId = row.target_canonical_id == null ? null : Number(row.target_canonical_id);
      const mergeFieldMap = (row.merge_field_map as MergeFieldMap | null) ?? null;

      let canonicalId: number | null = null;
      let resolvedAs: string = resolution;
      let assetResult: Record<string, unknown> = { status: "not_available" };

      // ── keep_existing ──────────────────────────────────────────────────────
      if (resolution === "keep_existing") {
        const existing = await client.query(
          `SELECT id FROM ai_platform.materials WHERE material_code = $1 LIMIT 1`,
          [row.product_code],
        );
        if (!existing.rows[0]) {
          throw new Error(`keep_existing: no canonical material found with code ${String(row.product_code)}`);
        }
        canonicalId = Number(existing.rows[0].id);
        resolvedAs = "keep_existing";

      // ── replace_existing ───────────────────────────────────────────────────
      } else if (resolution === "replace_existing") {
        if (!targetCanonicalId) throw new Error("replace_existing requires target_canonical_id");

        // Capture before-state for audit
        const before = await client.query(
          `SELECT * FROM ai_platform.materials WHERE id = $1`,
          [targetCanonicalId],
        );
        if (!before.rows[0]) throw new Error(`replace_existing: canonical material ${targetCanonicalId} not found`);

        const name = String(row.name ?? `${row.brand ?? ""} ${row.product_code}`).trim();
        const slugBase = safeSlug(`${row.brand ?? ""}-${name}-${row.product_code}`);
        const slug = `${slugBase}-${id}`;
        const technicalData = buildTechnicalData(row, id);

        // Only update mutable fields; never touch material_code or id
        await client.query(
          `UPDATE ai_platform.materials
           SET name=$2, slug=$3, category=$4, subcategory=$5, brand=$6, material_type=$7,
               finish=$8, texture=$9, pattern=$10, description=$11,
               thumbnail_url=$12, preview_images=$13::jsonb, technical_data=$14::jsonb,
               search_keywords=$15::jsonb, updated_at=NOW()
           WHERE id=$1`,
          [
            targetCanonicalId, name, slug, row.category, row.variant ?? null, row.brand ?? null,
            row.material_type ?? null, row.finish ?? null, row.texture ?? null, row.pattern ?? null,
            row.description ?? null, row.preview_image_url ?? null,
            JSON.stringify(row.asset_urls ?? []),
            JSON.stringify(technicalData),
            JSON.stringify([row.product_code, row.brand, row.collection].filter(Boolean)),
          ],
        );
        canonicalId = targetCanonicalId;
        resolvedAs = "replace_existing";
        report.replaced++;

      // ── merge ──────────────────────────────────────────────────────────────
      } else if (resolution === "merge") {
        if (!targetCanonicalId) throw new Error("merge requires target_canonical_id");
        if (!mergeFieldMap) throw new Error("merge requires a mergeFieldMap");

        const existing = await client.query(
          `SELECT * FROM ai_platform.materials WHERE id = $1`,
          [targetCanonicalId],
        );
        if (!existing.rows[0]) throw new Error(`merge: canonical material ${targetCanonicalId} not found`);

        const existingRow = existing.rows[0] as Record<string, unknown>;
        const incoming = row;
        const merged: Record<string, unknown> = {};

        // Apply field-level merge strategies for each mutable field
        for (const field of MUTABLE_MATERIAL_FIELDS) {
          const strategy: MergeStrategy = (mergeFieldMap[field] as MergeStrategy | undefined) ?? "keep_existing";
          const dbField = field;
          const existingVal = existingRow[dbField];
          const incomingVal = incoming[field] ?? incoming[camelToSnake(field)];
          if (strategy === "use_incoming") {
            merged[dbField] = incomingVal ?? existingVal;
          } else if (strategy === "combine") {
            // For text fields: concatenate; for JSONB arrays: union
            if (Array.isArray(existingVal) && Array.isArray(incomingVal)) {
              merged[dbField] = [...new Set([...existingVal, ...incomingVal])];
            } else if (typeof existingVal === "string" && typeof incomingVal === "string") {
              merged[dbField] = existingVal && incomingVal ? `${existingVal} / ${incomingVal}` : (existingVal || incomingVal);
            } else {
              merged[dbField] = incomingVal ?? existingVal;
            }
          } else {
            // keep_existing (default)
            merged[dbField] = existingVal;
          }
        }

        await client.query(
          `UPDATE ai_platform.materials
           SET name=$2, slug=$3, category=$4, subcategory=$5, brand=$6, material_type=$7,
               finish=$8, texture=$9, pattern=$10, description=$11,
               thumbnail_url=$12, preview_images=$13::jsonb, technical_data=$14::jsonb,
               search_keywords=$15::jsonb, updated_at=NOW()
           WHERE id=$1`,
          [
            targetCanonicalId,
            merged.name, merged.slug, merged.category, merged.subcategory, merged.brand,
            merged.material_type, merged.finish, merged.texture, merged.pattern, merged.description,
            merged.thumbnail_url, JSON.stringify(merged.preview_images ?? []),
            JSON.stringify(merged.technical_data ?? {}),
            JSON.stringify(merged.search_keywords ?? []),
          ],
        );
        canonicalId = targetCanonicalId;
        resolvedAs = "merge";
        report.merged++;

      // ── create_new (default) ───────────────────────────────────────────────
      } else {
        // Check for material_code conflict — create_new must not silently upsert
        const conflict = await client.query(
          `SELECT id FROM ai_platform.materials WHERE material_code = $1 LIMIT 1`,
          [row.product_code],
        );
        if (conflict.rows[0]) {
          throw new Error(
            `create_new: material_code "${String(row.product_code)}" already exists (canonical id ${Number(conflict.rows[0].id)}). ` +
            `Set duplicate_resolution to keep_existing, replace_existing, or merge via POST /ai/material-import/duplicates/${id}/resolve.`,
          );
        }
        const name = String(row.name ?? `${row.brand ?? ""} ${row.product_code}`).trim();
        const slugBase = safeSlug(`${row.brand ?? ""}-${name}-${row.product_code}`);
        const slug = `${slugBase}-${id}`;
        const technicalData = buildTechnicalData(row, id);

        const canonical = await client.query(
          `INSERT INTO ai_platform.materials
            (material_code,name,slug,category,subcategory,brand,material_type,color,finish,texture,pattern,
             description,price_tier,thumbnail_url,preview_images,technical_data,search_keywords,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,'Standard',$12,$13::jsonb,$14::jsonb,$15::jsonb,'active')
           RETURNING id`,
          [
            row.product_code, name, slug, row.category, row.variant ?? null, row.brand ?? null,
            row.material_type ?? null, row.finish ?? null, row.texture ?? null, row.pattern ?? null,
            row.description ?? null, row.preview_image_url ?? null, JSON.stringify(row.asset_urls ?? []),
            JSON.stringify(technicalData),
            JSON.stringify([row.product_code, row.brand, row.collection].filter(Boolean)),
          ],
        );
        canonicalId = Number(canonical.rows[0]?.id ?? null);
        resolvedAs = "create_new";
      }

      // Asset processing (non-blocking for import transaction)
      try {
        assetResult = await downloadAndStoreAsset(row);
      } catch (assetError) {
        assetResult = { status: "pending", error: assetError instanceof Error ? assetError.message : "Asset ingestion failed" };
      }

      const finalStatus = "imported";
      const durationMs = Date.now() - itemStarted;
      await client.query(
        `UPDATE ai_platform.material_import_staging
         SET status=$2, canonical_material_id=$3, imported_at=NOW(), import_duration_ms=$4,
             asset_status=$5, asset_storage_path=$6, asset_storage_url=$7, asset_checksum=$8,
             asset_error=$9, updated_at=NOW()
         WHERE id=$1`,
        [
          id, finalStatus, canonicalId, durationMs, assetResult.status,
          assetResult.storagePath ?? null, assetResult.storageUrl ?? null, assetResult.checksum ?? null,
          "error" in assetResult ? assetResult.error : null,
        ],
      );
      await client.query("COMMIT");

      await recordAudit(id, "imported", "importing", "imported", actor, "Canonical material created/updated", {
        durationMs, assetResult, resolvedAs, canonicalMaterialId: canonicalId,
        changedFields: ["canonical_material_id", "status", "asset_status"],
        duplicateResolution: resolution,
        targetCanonicalId,
      });
      await logAudit(
        "material-search", "refresh_indexes",
        String(canonicalId ?? id), "material", "success",
        { indexes: ["material_search", "material_intelligence", "similarity", "tags", "color", "finish", "texture"] },
        { actorId: actor.id ?? null, actorType: actor.type === "system" ? ("system" as const) : ("internal_user" as const) },
      );

      report.imported++;
      if (assetResult.status === "pending") report.pendingAssets++;
      if (resolvedAs === "keep_existing") report.kept++;
      report.items.push({ id, status: finalStatus, resolvedAs, canonicalMaterialId: canonicalId, assetStatus: assetResult.status });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const message = error instanceof Error ? error.message : "Import failed";
      await pool.query(
        `UPDATE ai_platform.material_import_staging SET status='failed', failure_reason=$2, import_duration_ms=$3, updated_at=NOW() WHERE id=$1`,
        [id, message, Date.now() - itemStarted],
      ).catch(() => undefined);
      await recordAudit(id, "import_failed", "importing", "failed", actor, message, {
        rollbackReason: message, durationMs: Date.now() - itemStarted,
      });
      report.failed++;
      report.items.push({ id, status: "failed", error: message });
      logger.error({ err: error, stagingId: id }, "[material-import] item failed; continuing");
    } finally {
      client.release();
    }
  }
  report.processingTimeMs = Date.now() - started;
  return report;
}

function buildTechnicalData(row: Record<string, unknown>, stagingId: number): Record<string, unknown> {
  return {
    collection: row.collection,
    variant: row.variant,
    dimensions: row.dimensions,
    thickness: row.thickness,
    workingSize: row.working_size,
    pei: row.pei,
    shadeVariation: row.shade_variation,
    application: row.application,
    technicalSpecifications: row.technical_specifications,
    warnings: row.warnings,
    source: row.source,
    sourceStagingId: row.source_staging_id,
    sourceJobId: row.source_job_id,
    sourceChecksum: row.source_checksum,
    importedFromStagingId: stagingId,
  };
}

/** Simple camelCase → snake_case helper for merge field mapping. */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export async function getMaterialImportDashboard() {
  const result = await pool.query(`
    SELECT status, COUNT(*)::int AS count
    FROM ai_platform.material_import_staging
    GROUP BY status
  `);
  const assets = await pool.query(`
    SELECT COUNT(*)::int AS count FROM ai_platform.material_import_staging WHERE asset_status IN ('pending','failed')
  `);
  const duplicates = await pool.query(`
    SELECT COUNT(*)::int AS count FROM ai_platform.material_import_staging WHERE duplicate_score >= 0.7 AND status NOT IN ('imported','rejected')
  `);
  const recent = await pool.query(`
    SELECT * FROM ai_platform.material_import_staging ORDER BY updated_at DESC LIMIT 10
  `);
  const counts = Object.fromEntries(IMPORT_STATES.map((state) => [state, 0]));
  for (const row of result.rows) counts[String(row.status)] = Number(row.count);
  return {
    pendingReview: counts.needs_review + counts.draft,
    approved: counts.approved,
    rejected: counts.rejected,
    imported: counts.imported,
    failed: counts.failed,
    pendingAssets: Number(assets.rows[0]?.count ?? 0),
    duplicates: Number(duplicates.rows[0]?.count ?? 0),
    counts,
    recentImports: recent.rows.map((row) => rowToMaterial(row as Record<string, unknown>)),
  };
}

export async function retryAsset(id: number, actor: Actor) {
  const current = await getStagedMaterial(id);
  if (!["imported", "failed"].includes(current.material.status)) throw new Error("Asset retry is only available after import or failed");
  const assetResult = await downloadAndStoreAsset(current.material as Record<string, unknown>);
  await pool.query(
    `UPDATE ai_platform.material_import_staging SET asset_status=$2, asset_storage_path=$3, asset_storage_url=$4, asset_checksum=$5, asset_error=$6, updated_at=NOW() WHERE id=$1`,
    [id, assetResult.status, assetResult.storagePath ?? null, assetResult.storageUrl ?? null, assetResult.checksum ?? null, "error" in assetResult ? assetResult.error : null],
  );
  await recordAudit(id, "asset_retry", current.material.status as ImportState, current.material.status as ImportState, actor, "Asset retry completed", { assetResult });
  return getStagedMaterial(id);
}

// Suppress unused warning for IMMUTABLE_MATERIAL_FIELDS (used as documentation / future guard)
void IMMUTABLE_MATERIAL_FIELDS;
