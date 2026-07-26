/**
 * Phase 5 — Controlled Material Import & Human Review.
 *
 * This service intentionally starts after staging. It never calls extraction,
 * OCR, parsing, or normalization adapters. Staged payloads are reviewed,
 * approved, and imported into the canonical material library one item at a
 * time.
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

export interface StagedMaterialInput {
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
  };
}

export async function ensureMaterialImportTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_platform.material_import_staging (
      id BIGSERIAL PRIMARY KEY,
      collection TEXT,
      product_code TEXT NOT NULL,
      variant TEXT,
      brand TEXT,
      category TEXT NOT NULL,
      material_type TEXT,
      name TEXT,
      description TEXT,
      finish TEXT,
      texture TEXT,
      pattern TEXT,
      dimensions TEXT,
      thickness TEXT,
      working_size TEXT,
      pei TEXT,
      shade_variation TEXT,
      application TEXT,
      technical_specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      preview_image_url TEXT,
      duplicate_score NUMERIC(5,4),
      asset_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'needs_review',
      reviewer_id TEXT,
      reviewer_name TEXT,
      reviewer_notes TEXT,
      reviewed_at TIMESTAMPTZ,
      import_started_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ,
      import_duration_ms INTEGER,
      canonical_material_id INTEGER,
      asset_status TEXT NOT NULL DEFAULT 'not_started',
      asset_storage_path TEXT,
      asset_storage_url TEXT,
      asset_checksum TEXT,
      asset_error TEXT,
      failure_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT material_import_staging_status_ck CHECK (
        status IN ('draft','needs_review','approved','rejected','importing','imported','failed','rolled_back')
      )
    );
    CREATE INDEX IF NOT EXISTS idx_material_import_staging_status
      ON ai_platform.material_import_staging(status);
    CREATE INDEX IF NOT EXISTS idx_material_import_staging_product_code
      ON ai_platform.material_import_staging(product_code);
    CREATE INDEX IF NOT EXISTS idx_material_import_staging_duplicate_score
      ON ai_platform.material_import_staging(duplicate_score DESC NULLS LAST);

    CREATE TABLE IF NOT EXISTS ai_platform.material_import_audit (
      id BIGSERIAL PRIMARY KEY,
      staging_id BIGINT NOT NULL REFERENCES ai_platform.material_import_staging(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      reviewer_id TEXT,
      reviewer_name TEXT,
      notes TEXT,
      changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      duplicate_resolution TEXT,
      asset_result JSONB,
      rollback_reason TEXT,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_material_import_audit_staging
      ON ai_platform.material_import_audit(staging_id, created_at DESC);
  `);
}

export async function createStagedMaterial(input: StagedMaterialInput, actor?: Actor) {
  if (!input.productCode?.trim() || !input.category?.trim()) {
    throw new Error("productCode and category are required");
  }
  const result = await pool.query(
    `INSERT INTO ai_platform.material_import_staging
      (collection, product_code, variant, brand, category, material_type, name, description,
       finish, texture, pattern, dimensions, thickness, working_size, pei, shade_variation,
       application, technical_specifications, warnings, preview_image_url, duplicate_score,
       asset_urls, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,
             $20,$21,$22::jsonb,$23,'needs_review')
     RETURNING *`,
    [
      input.collection ?? null, input.productCode.trim(), input.variant ?? null, input.brand ?? null,
      input.category.trim(), input.materialType ?? null, input.name ?? null, input.description ?? null,
      input.finish ?? null, input.texture ?? null, input.pattern ?? null, input.dimensions ?? null,
      input.thickness ?? null, input.workingSize ?? null, input.pei ?? null, input.shadeVariation ?? null,
      input.application ?? null, JSON.stringify(input.technicalSpecifications ?? {}),
      JSON.stringify(input.warnings ?? []), input.previewImageUrl ?? null,
      input.duplicateScore ?? null, JSON.stringify(input.assetUrls ?? []), input.source ?? null,
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
       changed_fields,duplicate_resolution,asset_result,rollback_reason,duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12)`,
    [
      stagingId, eventType, fromStatus, toStatus, actor?.id ?? null, actor?.name ?? null,
      notes ?? null, JSON.stringify(extras.changedFields ?? []), extras.duplicateResolution ?? null,
      JSON.stringify(extras.assetResult ?? null), extras.rollbackReason ?? null, extras.durationMs ?? null,
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
  if ((nextStatus === "approved" || nextStatus === "rejected") && !notes && nextStatus === "rejected") {
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

export async function importApprovedMaterials(ids: number[] | "all", actor: Actor) {
  const started = Date.now();
  const query = ids === "all"
    ? await pool.query(`SELECT * FROM ai_platform.material_import_staging WHERE status = 'approved' ORDER BY id`)
    : await pool.query(`SELECT * FROM ai_platform.material_import_staging WHERE id = ANY($1::bigint[]) AND status = 'approved' ORDER BY id`, [ids]);
  const approvedIds = new Set(query.rows.map((r) => Number((r as Record<string, unknown>).id)));
  const requestedIds: number[] = ids === "all" ? [] : ids;
  const report = { imported: 0, skipped: 0, rejected: 0, duplicates: 0, updated: 0, failed: 0, pendingAssets: 0, processingTimeMs: 0, items: [] as Array<Record<string, unknown>> };

  // Count IDs that were requested but not approved (not in query result)
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
      const duplicate = await client.query(
        `SELECT id FROM ai_platform.materials WHERE material_code = $1 LIMIT 1`,
        [row.product_code],
      );
      if (duplicate.rows[0]) {
        report.duplicates++;
      }
      const name = String(row.name ?? `${row.brand ?? ""} ${row.product_code}`).trim();
      const slugBase = safeSlug(`${row.brand ?? ""}-${name}-${row.product_code}`);
      const slug = `${slugBase}-${id}`;
      const technicalData = {
        collection: row.collection, variant: row.variant, dimensions: row.dimensions,
        thickness: row.thickness, workingSize: row.working_size, pei: row.pei,
        shadeVariation: row.shade_variation, application: row.application,
        technicalSpecifications: row.technical_specifications, warnings: row.warnings,
        source: row.source, importedFromStagingId: id,
      };
      const canonical = await client.query(
        `INSERT INTO ai_platform.materials
          (material_code,name,slug,category,subcategory,brand,material_type,color,finish,texture,pattern,
           description,price_tier,thumbnail_url,preview_images,technical_data,search_keywords,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,'Standard',$12,$13::jsonb,$14::jsonb,$15::jsonb,'active')
         ON CONFLICT (material_code) DO UPDATE SET
           name=EXCLUDED.name, slug=EXCLUDED.slug, category=EXCLUDED.category, brand=EXCLUDED.brand,
           material_type=EXCLUDED.material_type, finish=EXCLUDED.finish, texture=EXCLUDED.texture,
           pattern=EXCLUDED.pattern, description=EXCLUDED.description, thumbnail_url=EXCLUDED.thumbnail_url,
           preview_images=EXCLUDED.preview_images, technical_data=EXCLUDED.technical_data,
           updated_at=NOW()
         RETURNING id`,
        [
          row.product_code, name, slug, row.category, row.variant ?? null, row.brand ?? null,
          row.material_type ?? null, row.finish ?? null, row.texture ?? null, row.pattern ?? null,
          row.description ?? null, row.preview_image_url ?? null, JSON.stringify(row.asset_urls ?? []),
          JSON.stringify(technicalData), JSON.stringify([row.product_code, row.brand, row.collection].filter(Boolean)),
        ],
      );
      let assetResult: Record<string, unknown> = { status: "not_available" };
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
        [id, finalStatus, canonical.rows[0]?.id ?? null, durationMs, assetResult.status,
          assetResult.storagePath ?? null, assetResult.storageUrl ?? null, assetResult.checksum ?? null,
          assetResult.error ?? null],
      );
      await client.query("COMMIT");
      await recordAudit(id, "imported", "importing", "imported", actor, "Canonical material created", {
        durationMs, assetResult, changedFields: ["canonical_material_id", "status", "asset_status"],
      });
      await logAudit("material-search", "refresh_indexes", String(canonical.rows[0]?.id ?? id), "material", "success", {
        indexes: ["material_search", "material_intelligence", "similarity", "tags", "color", "finish", "texture"],
      }, { actorId: actor.id ?? null, actorType: actor.type === "system" ? ("system" as const) : ("internal_user" as const) });
      report.imported++;
      if (assetResult.status === "pending") report.pendingAssets++;
      report.updated += duplicate.rows[0] ? 1 : 0;
      report.items.push({ id, status: finalStatus, canonicalMaterialId: canonical.rows[0]?.id ?? null, assetStatus: assetResult.status });
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

export async function resolveDuplicate(
  id: number,
  resolution: DuplicateResolution,
  actor: Actor,
  notes?: string,
) {
  if (!["keep_existing", "replace_existing", "merge", "create_new"].includes(resolution)) {
    throw new Error("Invalid duplicate resolution");
  }
  const current = await getStagedMaterial(id);
  if (current.material.status !== "approved" && current.material.status !== "needs_review") {
    throw new Error("Duplicate resolution is only available before import");
  }
  await recordAudit(id, "duplicate_resolved", current.material.status as ImportState, current.material.status as ImportState, actor, notes, {
    duplicateResolution: resolution,
  });
  return { id, resolution, saved: true };
}

export async function retryAsset(id: number, actor: Actor) {
  const current = await getStagedMaterial(id);
  if (!["imported", "failed"].includes(current.material.status)) throw new Error("Asset retry is only available after import");
  const assetResult = await downloadAndStoreAsset(current.material as Record<string, unknown>);
  await pool.query(
    `UPDATE ai_platform.material_import_staging SET asset_status=$2, asset_storage_path=$3, asset_storage_url=$4, asset_checksum=$5, asset_error=$6, updated_at=NOW() WHERE id=$1`,
    [id, assetResult.status, assetResult.storagePath ?? null, assetResult.storageUrl ?? null, assetResult.checksum ?? null, "error" in assetResult ? assetResult.error : null],
  );
  await recordAudit(id, "asset_retry", current.material.status as ImportState, current.material.status as ImportState, actor, "Asset retry completed", { assetResult });
  return getStagedMaterial(id);
}