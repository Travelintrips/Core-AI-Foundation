/**
 * orchestrator.ts — Main analysis pipeline (Team 06)
 *
 * Reads from ai_asset_library (existing table, no modification).
 * Writes to ai_asset_intelligence_v2 (new v2 table).
 * Coordinates: perceptual hash → tag normalization → knowledge tags →
 *              version detection → quality metadata → safety → licensing placeholder.
 *
 * Does NOT touch: Queue, Dispatcher, Event Bus, Payment, Storage core,
 *                 Signed URL core, or any shared registry.
 */

import { db, aiAssetLibraryTable, aiBrandKitAssetsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { pool } from "@workspace/db";
import { computeMetadataHash } from "./perceptualHash.js";
import { normalizeTags, extractTagsFromFileName } from "./tagNormalization.js";
import { inferAssetTypeFromTags, matchKnowledgeTags } from "./knowledgeTag.js";
import { detectVersionType } from "./versionChain.js";
import { computeQualityMetadata } from "./qualityMetadata.js";
import { classifyAndSaveAssetSafety } from "./assetSafety.js";
import { upsertLicensing, AI_GENERATED_LICENSE } from "./licensing.js";
import { getLicensing } from "./licensing.js";
import { getAssetSafety } from "./assetSafety.js";
import type {
  AssetIntelligenceV2View,
  AssetTypeV2,
  BatchAnalyzeRequest,
  BatchAnalyzeResult,
} from "./types.js";

// ── Subject detection (reused from v1 — no modification to v1 service) ────────

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  Office:      ["office", "desk", "workspace", "interior", "room"],
  Warehouse:   ["warehouse", "storage", "shelves", "logistics", "forklift"],
  Factory:     ["factory", "manufacturing", "machine", "production", "industrial"],
  CEO:         ["ceo", "director", "executive", "leader", "president"],
  Employee:    ["employee", "staff", "team", "worker", "person"],
  Product:     ["product", "item", "goods", "merchandise", "package"],
  Certificate: ["certificate", "award", "license", "accreditation"],
  Vehicle:     ["vehicle", "truck", "car", "fleet", "transport"],
  Building:    ["building", "facility", "office", "hq", "headquarters"],
  Document:    ["document", "report", "form", "contract", "file", "pdf"],
  Furniture:   ["furniture", "sofa", "chair", "table", "cabinet", "kursi", "meja"],
  Fabric:      ["batik", "tenun", "motif", "fabric", "textile", "pattern"],
  Packaging:   ["packaging", "kemasan", "box", "label", "wrapper"],
  Garment:     ["garment", "baju", "pakaian", "clothing", "apparel", "mockup"],
};

function detectSubjects(fileName: string, tags: string[]): string[] {
  const text = `${fileName} ${tags.join(" ")}`.toLowerCase();
  return Object.entries(SUBJECT_KEYWORDS)
    .filter(([, keywords]) => keywords.some((k) => text.includes(k)))
    .map(([subject]) => subject);
}

function deriveSuggestedUsage(assetType: AssetTypeV2, knowledgeTags: string[], subjects: string[]): string[] {
  const usage: string[] = [];
  if (assetType === "graphic" || assetType === "illustration") usage.push("Social Media", "Website Hero", "Presentation");
  if (assetType === "photo") usage.push("Website", "Email Campaign", "Print");
  if (assetType === "svg") usage.push("Website Icon", "App UI", "Print Logo");
  if (assetType === "document") usage.push("Client Deliverable", "Internal Report");
  if (assetType === "interior_material") usage.push("Material Board", "Client Proposal", "Product Catalog");
  if (assetType === "furniture_image") usage.push("Product Catalog", "E-commerce Listing", "Lookbook");
  if (assetType === "fashion_motif") usage.push("Print Production", "Pattern Library", "Client Presentation");
  if (assetType === "garment_mockup") usage.push("E-commerce Listing", "Social Media", "Lookbook");
  if (assetType === "packaging_asset") usage.push("Print Production", "Client Presentation", "Product Launch");
  if (subjects.includes("CEO") || subjects.includes("Employee")) usage.push("Company Profile", "About Us Page");
  if (knowledgeTags.includes("brand_guidelines")) usage.push("Brand Manual");
  return [...new Set(usage)].slice(0, 6);
}

// ── Load asset from existing tables ──────────────────────────────────────────

async function loadAssetRecord(assetId: number, assetSource: string): Promise<{
  fileName: string; mimeType: string | null; fileSizeBytes: number | null;
  checksum: string | null; title: string; tags: string[];
  previewUrl: string | null; uploadedBy: string | null; category: string | null;
  slot: string | null;
} | null> {
  if (assetSource === "library") {
    const rows = await db.select().from(aiAssetLibraryTable)
      .where(eq(aiAssetLibraryTable.id, assetId)).limit(1);
    if (!rows[0]) return null;
    const r = rows[0]!;
    return {
      fileName: r.fileName, mimeType: r.mimeType, fileSizeBytes: r.fileSizeBytes,
      checksum: r.checksum, title: r.title, tags: (r.tags as string[]) ?? [],
      previewUrl: r.previewUrl, uploadedBy: r.uploadedBy ?? null,
      category: r.category, slot: null,
    };
  }
  if (assetSource === "brand_kit") {
    const rows = await db.select().from(aiBrandKitAssetsTable)
      .where(eq(aiBrandKitAssetsTable.id, assetId)).limit(1);
    if (!rows[0]) return null;
    const r = rows[0]!;
    return {
      fileName: r.fileName, mimeType: r.mimeType, fileSizeBytes: r.fileSizeBytes ?? null,
      checksum: r.checksum ?? null, title: r.slot, tags: [],
      previewUrl: r.previewUrl ?? null, uploadedBy: null,
      category: null, slot: r.slot,
    };
  }
  return null;
}

// ── Core analysis ─────────────────────────────────────────────────────────────

export async function analyzeAssetV2(
  assetId: number,
  assetSource: "brand_kit" | "library" | "creative_asset",
  clientId: string,
  opts?: { reanalyze?: boolean; skipSafety?: boolean; skipLicensing?: boolean },
): Promise<AssetIntelligenceV2View> {
  // Check if already analyzed (unless reanalyze requested)
  if (!opts?.reanalyze) {
    const existing = await getIntelligenceV2(assetId, assetSource, clientId);
    if (existing) return existing;
  }

  let record: Awaited<ReturnType<typeof loadAssetRecord>> = null;
  try {
    record = await loadAssetRecord(assetId, assetSource);
  } catch (_e) {
    // asset source not in DB yet (creative_asset path)
  }

  if (!record) {
    // Store failure
    await upsertIntelligenceV2Record({
      assetId, assetSource, clientId,
      analysisFailed: true,
      failureReason: "Asset record not found in source table",
    });
    return buildFailureView(assetId, assetSource, clientId, "Asset record not found in source table");
  }

  try {
    // 1. Perceptual hash
    const pHash = computeMetadataHash(record.fileName, record.mimeType, record.fileSizeBytes, record.checksum);

    // 2. Tag normalization
    const rawTags  = [...record.tags, ...extractTagsFromFileName(record.fileName)];
    const normTags = normalizeTags(rawTags);

    // 3. Asset type inference
    const assetType = inferAssetTypeFromTags(normTags, record.mimeType, record.fileName);

    // 4. Knowledge tags
    const knowledgeTags = matchKnowledgeTags(normTags, assetType, record.fileName);

    // 5. Version detection
    const versionType = detectVersionType(record.fileName);

    // 6. Subjects
    const subjects = detectSubjects(record.fileName, normTags);

    // 7. Search keywords
    const searchKeywords = [...new Set([...normTags, ...knowledgeTags, ...subjects.map((s) => s.toLowerCase())])].slice(0, 15);

    // 8. Quality metadata
    const quality = computeQualityMetadata({
      assetType,
      fileName:     record.fileName,
      mimeType:     record.mimeType,
      fileSizeBytes: record.fileSizeBytes,
      hasTransparency: false,
      hasTitle:     record.title.length > 0,
      hasTags:      normTags.length > 0,
      hasPreviewUrl: !!record.previewUrl,
      hasChecksum:  !!record.checksum,
    });

    // 9. Duplicate detection — check if another asset with same hash exists
    const dupCheck = await pool.query<{ asset_id: number }>(
      `SELECT asset_id FROM ai_platform.ai_asset_intelligence_v2
       WHERE client_id = $1 AND perceptual_hash = $2 AND hash_tier = $3
         AND NOT (asset_id = $4 AND asset_source = $5)
       LIMIT 1`,
      [clientId, pHash.hash, pHash.tier, assetId, assetSource],
    );
    const isDuplicate = dupCheck.rows.length > 0;
    const duplicateOfId = dupCheck.rows[0]?.asset_id ?? null;

    // 10. Suggested usage
    const suggestedUsage = deriveSuggestedUsage(assetType, knowledgeTags, subjects);

    // 11. Persist to v2 table
    await upsertIntelligenceV2Record({
      assetId, assetSource, clientId,
      assetTypeV2: assetType,
      autoTags: normTags,
      normalizedTags: normTags,
      knowledgeTags,
      searchKeywords,
      detectedSubjects: subjects,
      perceptualHash: pHash.hash,
      hashTier: pHash.tier,
      isDuplicate,
      duplicateOfId,
      duplicateSimilarityScore: isDuplicate ? 100 : null,
      versionType,
      qualityScore: quality.overallScore,
      qualityMetadata: quality,
      suggestedUsage,
      confidenceScore: 0.8,
      analysisFailed: false,
      failureReason: null,
    });

    // 12. Safety classification
    let safety = null;
    if (!opts?.skipSafety) {
      safety = await classifyAndSaveAssetSafety({
        assetId, assetSource, clientId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        tags: normTags,
        title: record.title,
        detectedSubjects: subjects,
      });
    }

    // 13. Default licensing for AI-generated assets
    let licensing = await getLicensing(assetId, assetSource);
    if (!licensing && !opts?.skipLicensing) {
      const isAiGenerated = record.uploadedBy === "ai" || assetSource === "creative_asset";
      if (isAiGenerated) {
        licensing = await upsertLicensing({
          assetId, assetSource, clientId,
          ...AI_GENERATED_LICENSE,
        });
      }
    }

    return {
      id: 0, // populated by getIntelligenceV2 after insert
      assetId, assetSource, clientId,
      assetTypeV2: assetType,
      autoTags: normTags,
      normalizedTags: normTags,
      knowledgeTags,
      searchKeywords,
      detectedSubjects: subjects,
      perceptualHash: pHash.hash,
      hashTier: pHash.tier,
      isDuplicate,
      duplicateOfId: duplicateOfId ?? null,
      duplicateSimilarityScore: isDuplicate ? 100 : null,
      versionType,
      versionChainId: null,
      quality,
      suggestedUsage,
      colorPalette: [],
      licensing: licensing ?? null,
      safety: safety ?? null,
      analysisFailed: false,
      failureReason: null,
      confidenceScore: 0.8,
      analyzedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await upsertIntelligenceV2Record({ assetId, assetSource, clientId, analysisFailed: true, failureReason: msg });
    return buildFailureView(assetId, assetSource, clientId, msg);
  }
}

// ── Batch analyze ─────────────────────────────────────────────────────────────

export async function batchAnalyzeAssetsV2(req: BatchAnalyzeRequest): Promise<BatchAnalyzeResult> {
  const results: BatchAnalyzeResult["results"] = [];
  let succeeded = 0;
  let failed = 0;

  for (const asset of req.assets) {
    try {
      await analyzeAssetV2(asset.assetId, asset.assetSource, req.clientId, req.options);
      results.push({ assetId: asset.assetId, assetSource: asset.assetSource, ok: true });
      succeeded++;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ assetId: asset.assetId, assetSource: asset.assetSource, ok: false, error });
      failed++;
    }
  }

  return { requested: req.assets.length, succeeded, failed, results };
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getIntelligenceV2(
  assetId: number,
  assetSource: string,
  clientId: string,
): Promise<AssetIntelligenceV2View | null> {
  const res = await pool.query<{
    id: number; asset_id: number; asset_source: string; client_id: string;
    asset_type_v2: string | null;
    auto_tags: string[] | null; normalized_tags: string[] | null;
    knowledge_tags: string[] | null; search_keywords: string[] | null;
    detected_subjects: string[] | null; perceptual_hash: string | null;
    hash_tier: string | null; is_duplicate: boolean; duplicate_of_id: number | null;
    duplicate_similarity_score: number | null; version_type: string;
    version_chain_id: number | null; quality_score: number | null;
    quality_metadata: Record<string, unknown> | null;
    suggested_usage: string[] | null; confidence_score: number;
    analysis_failed: boolean; failure_reason: string | null; analyzed_at: Date;
  }>(
    `SELECT * FROM ai_platform.ai_asset_intelligence_v2
     WHERE asset_id = $1 AND asset_source = $2 AND client_id = $3 LIMIT 1`,
    [assetId, assetSource, clientId],
  );
  if (!res.rows[0]) return null;
  const r = res.rows[0]!;

  const [licensing, safety] = await Promise.all([
    getLicensing(assetId, assetSource),
    getAssetSafety(assetId, assetSource),
  ]);

  return {
    id: r.id,
    assetId: r.asset_id,
    assetSource: r.asset_source,
    clientId: r.client_id,
    assetTypeV2: (r.asset_type_v2 as AssetTypeV2) ?? null,
    autoTags: r.auto_tags ?? [],
    normalizedTags: r.normalized_tags ?? [],
    knowledgeTags: r.knowledge_tags ?? [],
    searchKeywords: r.search_keywords ?? [],
    detectedSubjects: r.detected_subjects ?? [],
    perceptualHash: r.perceptual_hash,
    hashTier: (r.hash_tier as "full" | "metadata") ?? null,
    isDuplicate: r.is_duplicate,
    duplicateOfId: r.duplicate_of_id ?? null,
    duplicateSimilarityScore: r.duplicate_similarity_score ?? null,
    versionType: r.version_type,
    versionChainId: r.version_chain_id ?? null,
    quality: r.quality_metadata as AssetIntelligenceV2View["quality"],
    suggestedUsage: r.suggested_usage ?? [],
    colorPalette: [],
    licensing: licensing ?? null,
    safety: safety ?? null,
    analysisFailed: r.analysis_failed,
    failureReason: r.failure_reason ?? null,
    confidenceScore: r.confidence_score,
    analyzedAt: r.analyzed_at.toISOString(),
  };
}

export async function listIntelligenceV2ForClient(clientId: string): Promise<AssetIntelligenceV2View[]> {
  const res = await pool.query<{ asset_id: number; asset_source: string }>(
    `SELECT asset_id, asset_source FROM ai_platform.ai_asset_intelligence_v2
     WHERE client_id = $1 ORDER BY analyzed_at DESC`,
    [clientId],
  );
  const views: AssetIntelligenceV2View[] = [];
  for (const row of res.rows) {
    const v = await getIntelligenceV2(row.asset_id, row.asset_source, clientId);
    if (v) views.push(v);
  }
  return views;
}

export async function getDuplicateReportV2(clientId: string): Promise<{
  clientId: string;
  totalAnalyzed: number;
  totalDuplicates: number;
  duplicateGroups: Array<{
    perceptualHash: string;
    hashTier: string;
    assetIds: number[];
    versionTypes: string[];
    recommendation: string;
  }>;
}> {
  const res = await pool.query<{
    asset_id: number; perceptual_hash: string | null;
    hash_tier: string | null; is_duplicate: boolean; version_type: string;
  }>(
    `SELECT asset_id, perceptual_hash, hash_tier, is_duplicate, version_type
     FROM ai_platform.ai_asset_intelligence_v2
     WHERE client_id = $1 AND analysis_failed = false`,
    [clientId],
  );

  const groups = new Map<string, typeof res.rows>();
  for (const row of res.rows) {
    if (!row.perceptual_hash) continue;
    const key = `${row.hash_tier}:${row.perceptual_hash}`;
    const g = groups.get(key) ?? [];
    g.push(row);
    groups.set(key, g);
  }

  const duplicateGroups = [];
  for (const [key, assets] of groups.entries()) {
    if (assets.length <= 1) continue;
    const [tier, hash] = key.split(":");
    const versionTypes = assets.map((a) => a.version_type);
    const uniqueVersions = new Set(versionTypes).size;
    duplicateGroups.push({
      perceptualHash: hash ?? "",
      hashTier: tier ?? "",
      assetIds: assets.map((a) => a.asset_id),
      versionTypes,
      recommendation: uniqueVersions > 1
        ? "Intentional variants detected — consider grouping into a version chain."
        : "Duplicate uploads detected — review and remove redundant copies.",
    });
  }

  return {
    clientId,
    totalAnalyzed: res.rows.length,
    totalDuplicates: res.rows.filter((r) => r.is_duplicate).length,
    duplicateGroups,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertIntelligenceV2Record(params: {
  assetId: number; assetSource: string; clientId: string;
  assetTypeV2?: AssetTypeV2; autoTags?: string[]; normalizedTags?: string[];
  knowledgeTags?: string[]; searchKeywords?: string[]; detectedSubjects?: string[];
  perceptualHash?: string; hashTier?: string; isDuplicate?: boolean;
  duplicateOfId?: number | null; duplicateSimilarityScore?: number | null;
  versionType?: string; qualityScore?: number; qualityMetadata?: unknown;
  suggestedUsage?: string[]; confidenceScore?: number;
  analysisFailed: boolean; failureReason?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ai_platform.ai_asset_intelligence_v2
       (asset_id, asset_source, client_id, asset_type_v2,
        auto_tags, normalized_tags, knowledge_tags, search_keywords, detected_subjects,
        perceptual_hash, hash_tier, is_duplicate, duplicate_of_id, duplicate_similarity_score,
        version_type, quality_score, quality_metadata, suggested_usage,
        confidence_score, analysis_failed, failure_reason, analyzed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW(),NOW())
     ON CONFLICT (asset_id, asset_source) DO UPDATE SET
       asset_type_v2              = COALESCE(EXCLUDED.asset_type_v2, ai_asset_intelligence_v2.asset_type_v2),
       auto_tags                  = EXCLUDED.auto_tags,
       normalized_tags            = EXCLUDED.normalized_tags,
       knowledge_tags             = EXCLUDED.knowledge_tags,
       search_keywords            = EXCLUDED.search_keywords,
       detected_subjects          = EXCLUDED.detected_subjects,
       perceptual_hash            = EXCLUDED.perceptual_hash,
       hash_tier                  = EXCLUDED.hash_tier,
       is_duplicate               = EXCLUDED.is_duplicate,
       duplicate_of_id            = EXCLUDED.duplicate_of_id,
       duplicate_similarity_score = EXCLUDED.duplicate_similarity_score,
       version_type               = EXCLUDED.version_type,
       quality_score              = EXCLUDED.quality_score,
       quality_metadata           = EXCLUDED.quality_metadata,
       suggested_usage            = EXCLUDED.suggested_usage,
       confidence_score           = EXCLUDED.confidence_score,
       analysis_failed            = EXCLUDED.analysis_failed,
       failure_reason             = EXCLUDED.failure_reason,
       analyzed_at                = NOW(),
       updated_at                 = NOW()`,
    [
      params.assetId, params.assetSource, params.clientId,
      params.assetTypeV2 ?? null,
      params.autoTags ?? [], params.normalizedTags ?? [],
      params.knowledgeTags ?? [], params.searchKeywords ?? [],
      params.detectedSubjects ?? [],
      params.perceptualHash ?? null, params.hashTier ?? null,
      params.isDuplicate ?? false,
      params.duplicateOfId ?? null, params.duplicateSimilarityScore ?? null,
      params.versionType ?? "original",
      params.qualityScore ?? null,
      params.qualityMetadata ? JSON.stringify(params.qualityMetadata) : null,
      params.suggestedUsage ?? [],
      params.confidenceScore ?? 0,
      params.analysisFailed,
      params.failureReason ?? null,
    ],
  );
}

function buildFailureView(assetId: number, assetSource: string, clientId: string, reason: string): AssetIntelligenceV2View {
  return {
    id: 0, assetId, assetSource, clientId, assetTypeV2: null,
    autoTags: [], normalizedTags: [], knowledgeTags: [], searchKeywords: [], detectedSubjects: [],
    perceptualHash: null, hashTier: null, isDuplicate: false, duplicateOfId: null,
    duplicateSimilarityScore: null, versionType: "original", versionChainId: null,
    quality: null, suggestedUsage: [], colorPalette: [],
    licensing: null, safety: null,
    analysisFailed: true, failureReason: reason, confidenceScore: 0,
    analyzedAt: new Date().toISOString(),
  };
}
