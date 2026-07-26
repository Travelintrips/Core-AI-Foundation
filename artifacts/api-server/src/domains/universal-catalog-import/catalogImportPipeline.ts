/**
 * Universal Catalog Import Engine — Phase 4A
 * Pipeline orchestrator: Adapter → AI Extractor → Normalizer → Staging
 *
 * Pipeline stages:
 *   1. Catalog Discovery (adapter selection)
 *   2. Document/Page Extraction (adapter.extract)
 *   3. AI Material Extraction (aiMaterialExtractor)
 *   4. Normalization (stagingNormalizer)
 *   5. Duplicate Detection (within normalizer, uses existing detector)
 *   6. Staging Library (stagingService)
 *
 * STOP before Canonical Material Library — no writes to materials table.
 */

import type { AdapterInput, AdapterSourceType, ImportJob, PipelineOptions, PipelineResult, RawExtractedItem, StagingPreviewItem, UniversalMaterial } from "./types.js";
import { csvAdapter } from "./adapters/csvAdapter.js";
import { excelAdapter } from "./adapters/excelAdapter.js";
import { jsonAdapter } from "./adapters/jsonAdapter.js";
import { xmlAdapter } from "./adapters/xmlAdapter.js";
import { pdfAdapter } from "./adapters/pdfAdapter.js";
import { websiteAdapter } from "./adapters/websiteAdapter.js";
import { apiAdapter } from "./adapters/apiAdapter.js";
import { extractMaterialsWithAI, rawItemToText } from "./aiMaterialExtractor.js";
import { normalizeBatch } from "./stagingNormalizer.js";
import {
  createOrResumeJob,
  updateJobStatus,
  bulkInsertStagingItems,
  getStagingItems,
  computeChecksum,
} from "./stagingService.js";
import { createDetectionIndex } from "../material-catalog-integration/catalogDuplicateDetector.js";
import { logger } from "../../lib/logger.js";

const MAX_ITEMS = 500;
const AI_BATCH_SIZE = 5; // raw items per AI call to stay within token limits

// ── Adapter registry ──────────────────────────────────────────────────────────

const adapterRegistry = {
  csv: csvAdapter,
  excel: excelAdapter,
  json: jsonAdapter,
  xml: xmlAdapter,
  pdf: pdfAdapter,
  website: websiteAdapter,
  api: apiAdapter,
} as const;

// ── Main pipeline entry point ─────────────────────────────────────────────────

export async function runImportPipeline(
  adapterInput: AdapterInput,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const domain = "universal-catalog-import";
  const maxItems = Math.min(options.maxItems ?? MAX_ITEMS, MAX_ITEMS);
  const sourceType = adapterInput.type as AdapterSourceType;
  const sourceName = adapterInput.filename ?? adapterInput.url ?? adapterInput.type;

  // ── Stage 1: Job creation / idempotency ───────────────────────────────────
  const checksum = adapterInput.buffer
    ? computeChecksum(adapterInput.buffer)
    : options.idempotencyKey ?? undefined;

  const { job: importJob, isExisting } = await createOrResumeJob({
    sourceType,
    sourceName,
    sourceUrl: adapterInput.url,
    filename: adapterInput.filename,
    checksum,
    idempotencyKey: options.idempotencyKey ?? checksum,
    options: { maxItems, skipAI: options.skipAI },
  });

  logger.info({ domain, jobId: importJob.id, sourceType, isExisting }, "[pipeline] Job created/resumed");

  // If resuming a completed job, return existing staging items
  if (isExisting && (importJob.status === "complete" || importJob.status === "partial")) {
    logger.info({ domain, jobId: importJob.id }, "[pipeline] Returning existing completed job");
    const existingItems = await getStagingItems(importJob.id, maxItems);
    return buildResult(importJob, existingItems);
  }

  await updateJobStatus(importJob.id, "processing");

  const allWarnings: string[] = [];
  const allErrors: string[] = [];

  // ── Stage 2: Catalog Discovery + Extraction ───────────────────────────────
  const adapter = adapterRegistry[sourceType];
  if (!adapter) {
    const msg = `No adapter registered for source type: ${sourceType}`;
    await updateJobStatus(importJob.id, "failed", {}, { errors: [msg] });
    throw new Error(msg);
  }

  let adapterResult;
  try {
    adapterResult = await adapter.extract(adapterInput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobStatus(importJob.id, "failed", {}, { errors: [`Adapter error: ${msg}`] });
    throw err;
  }

  allWarnings.push(...adapterResult.warnings);
  allErrors.push(...adapterResult.errors);

  const rawItems = adapterResult.rawItems.slice(0, maxItems);
  const totalRaw = rawItems.length;

  logger.info({ domain, jobId: importJob.id, totalRaw }, "[pipeline] Extraction complete");

  // ── Stage 3: AI Material Extraction ──────────────────────────────────────
  const extractedPairs: Array<{ partialMaterial: Partial<UniversalMaterial>; rawItem: RawExtractedItem }> = [];

  if (options.skipAI) {
    // Skip AI: pass raw items directly to normalizer with minimal mapping
    for (const rawItem of rawItems) {
      const partial = rawToPartialMaterial(rawItem, sourceType, sourceName);
      extractedPairs.push({ partialMaterial: partial, rawItem });
    }
    allWarnings.push("AI extraction skipped (skipAI=true)");
  } else {
    // Batch raw items through AI extraction
    const batches = chunkArray(rawItems, AI_BATCH_SIZE);
    for (const batch of batches) {
      const batchText = batch.map((item) => rawItemToText(item.raw)).join("\n\n---\n\n");
      const firstItem = batch[0];
      const aiResult = await extractMaterialsWithAI({
        rawText: batchText,
        sourceType,
        sourceName,
        sourcePage: firstItem?.sourceContext?.page,
        hints: {
          brand: options.brandHint,
          category: options.categoryHint,
        },
      });
      allWarnings.push(...aiResult.warnings);

      // Pair AI-extracted materials back to raw items (best-effort by index)
      for (let i = 0; i < batch.length; i++) {
        const rawItem = batch[i]!;
        const aiMat = aiResult.materials[i] ?? {};
        extractedPairs.push({ partialMaterial: aiMat, rawItem });
      }
    }
  }

  logger.info({ domain, jobId: importJob.id, totalExtracted: extractedPairs.length }, "[pipeline] AI extraction complete");

  // ── Stage 4+5: Normalization + Duplicate Detection ────────────────────────
  const { stagingItems, counts } = normalizeBatch(
    extractedPairs,
    sourceType,
    sourceName,
    createDetectionIndex(),
  );

  const totalNormalized = stagingItems.filter((i) => i.status === "normalized").length;
  const totalNew = stagingItems.filter((i) => !i.duplicateInfo || i.duplicateInfo.classification === "new").length;
  const totalDuplicate = stagingItems.filter((i) => i.status === "duplicate").length;
  const totalInvalid = stagingItems.filter((i) => i.validationErrors.length > 0 && i.status === "draft").length;
  const totalNeedsReview = stagingItems.filter((i) => i.status === "needs_review").length;

  // ── Stage 6: Staging Library ──────────────────────────────────────────────
  await bulkInsertStagingItems(importJob.id, stagingItems);

  const finalStatus = allErrors.length > 0 && totalNormalized === 0 ? "failed"
    : allErrors.length > 0 ? "partial"
    : "complete";

  await updateJobStatus(
    importJob.id,
    finalStatus,
    {
      totalRaw,
      totalNormalized,
      totalNew,
      totalDuplicate,
      totalInvalid,
      totalNeedsReview,
      processedPages: adapterResult.processedPages,
      totalPages: adapterResult.totalPages,
    },
    { warnings: allWarnings, errors: allErrors },
  );

  logger.info({ domain, jobId: importJob.id, finalStatus, totalRaw, totalNormalized }, "[pipeline] Complete");

  const finalJob = {
    ...importJob,
    status: finalStatus as typeof importJob.status,
    totalRaw,
    totalNormalized,
    totalNew,
    totalDuplicate,
    totalInvalid,
    totalNeedsReview,
    warnings: allWarnings,
    errors: allErrors,
  };

  return buildResult(finalJob, stagingItems);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildResult(job: ImportJob, items: StagingPreviewItem[]): PipelineResult {
  return {
    job,
    items,
    counts: {
      new: items.filter((i: StagingPreviewItem) => !i.duplicateInfo || i.duplicateInfo.classification === "new").length,
      exact_duplicate: items.filter((i: StagingPreviewItem) => i.duplicateInfo?.classification === "exact_duplicate").length,
      possible_duplicate: items.filter((i: StagingPreviewItem) => i.duplicateInfo?.classification === "possible_duplicate").length,
      conflicting_identity: items.filter((i: StagingPreviewItem) => i.duplicateInfo?.classification === "conflicting_identity").length,
      invalid: items.filter((i: StagingPreviewItem) => i.validationErrors.length > 0 && i.status === "draft").length,
      needs_review: items.filter((i: StagingPreviewItem) => i.status === "needs_review").length,
    },
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Convert a raw item from a structured source (CSV/Excel/JSON/XML) to a partial
 * UniversalMaterial using common field name mapping — no AI required.
 */
function rawToPartialMaterial(
  rawItem: RawExtractedItem,
  _sourceType: AdapterSourceType,
  _sourceName: string,
): Partial<UniversalMaterial> {
  if (typeof rawItem.raw === "string") {
    return {};
  }

  const raw = rawItem.raw as Record<string, unknown>;

  // Common field name patterns across catalog exports
  const getString = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = raw[k] ?? raw[k.toLowerCase()] ?? raw[k.toUpperCase()];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return undefined;
  };

  const getArray = (...keys: string[]): string[] | undefined => {
    for (const k of keys) {
      const v = raw[k] ?? raw[k.toLowerCase()];
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
      if (typeof v === "string" && v.trim()) return v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    }
    return undefined;
  };

  return {
    brand: getString("brand", "Brand", "merek", "Merek"),
    collection: getString("collection", "Collection", "koleksi"),
    series: getString("series", "Series"),
    productCode: getString("productCode", "product_code", "ProductCode", "SKU", "sku", "code", "kode"),
    productName: getString("productName", "product_name", "ProductName", "name", "nama", "Name"),
    variant: getString("variant", "Variant", "varian"),
    category: getString("category", "Category", "kategori", "Kategori"),
    subcategory: getString("subcategory", "Subcategory", "subkategori"),
    materialType: getString("materialType", "material_type", "type", "Type", "jenis"),
    description: getString("description", "Description", "deskripsi", "Deskripsi", "desc"),
    colors: getArray("colors", "color", "Color", "Colors", "warna"),
    finish: getArray("finish", "Finish", "finishing"),
    texture: getString("texture", "Texture"),
    pattern: getString("pattern", "Pattern"),
    workingSize: getString("workingSize", "working_size", "size", "Size", "ukuran"),
    thickness: getString("thickness", "Thickness", "tebal"),
  };
}
