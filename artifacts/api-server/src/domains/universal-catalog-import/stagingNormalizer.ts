/**
 * Universal Catalog Import — Staging Normalizer
 * Maps raw extracted items + AI extraction output to the universal material schema.
 * Also bridges to the existing duplicate detector for classification.
 *
 * Rules:
 * - Never fabricates values
 * - Produces deterministic output for the same input
 * - Validates against UniversalMaterialSchema
 */

import crypto from "node:crypto";
import type { RawExtractedItem, AdapterSourceType, UniversalMaterial, StagingPreviewItem, StagingStatus, DuplicateClassification } from "./types.js";
import type { ExternalCatalogItem } from "../material-catalog-integration/types.js";
import { classifyItem, addToIndex, createDetectionIndex, type DetectionIndex } from "../material-catalog-integration/catalogDuplicateDetector.js";
import { validateUniversalMaterial } from "./universalMaterialSchema.js";

export interface NormalizeItemInput {
  partialMaterial: Partial<UniversalMaterial>;
  rawItem: RawExtractedItem;
  sourceType: AdapterSourceType;
  sourceName: string;
  index: DetectionIndex;
}

export interface NormalizeItemOutput {
  stagingItem: StagingPreviewItem;
  shouldAddToIndex: boolean;
}

/**
 * Normalize a single raw item + AI-extracted partial material into a StagingPreviewItem.
 */
export function normalizeStagingItem(input: NormalizeItemInput): NormalizeItemOutput {
  const { partialMaterial, rawItem, sourceType, sourceName, index } = input;

  const material: UniversalMaterial = {
    ...partialMaterial,
    sourceType,
    sourceName,
    sourcePage: rawItem.sourceContext?.page,
    sourceMetadata: {
      ...partialMaterial.sourceMetadata,
      extractionContext: rawItem.sourceContext,
    },
  } as UniversalMaterial;

  // Validate
  const validation = validateUniversalMaterial(material);
  const validationErrors: string[] = validation.success ? [] : validation.errors;

  // Generate a deterministic staging ID
  const stagingId = generateStagingId(material, sourceName);

  // Classify via existing duplicate detector (adapt to ExternalCatalogItem shape)
  const externalItem = toExternalCatalogItem(material, stagingId);
  const dupResult = classifyItem(externalItem, index);

  const classification = dupResult.classification as DuplicateClassification;

  const status = deriveStatus(classification, validationErrors);
  const shouldAddToIndex =
    classification === "new" || classification === "possible_duplicate";

  if (shouldAddToIndex) {
    addToIndex(externalItem, index);
  }

  return {
    stagingItem: {
      stagingId,
      status,
      material: validation.success ? validation.data as UniversalMaterial : material,
      rawData: rawItem.raw,
      sourceContext: rawItem.sourceContext,
      duplicateInfo: classification !== "new"
        ? { classification, matchedKey: dupResult.matchedKey, reason: dupResult.reason }
        : undefined,
      validationErrors,
      extractedAt: new Date(),
    },
    shouldAddToIndex,
  };
}

/**
 * Normalize a batch of items, building the duplicate index progressively.
 */
export function normalizeBatch(
  items: Array<{ partialMaterial: Partial<UniversalMaterial>; rawItem: RawExtractedItem }>,
  sourceType: AdapterSourceType,
  sourceName: string,
  seedIndex?: DetectionIndex,
): {
  stagingItems: StagingPreviewItem[];
  index: DetectionIndex;
  counts: Record<DuplicateClassification, number>;
} {
  const index = seedIndex ?? createDetectionIndex();
  const stagingItems: StagingPreviewItem[] = [];
  const counts: Record<DuplicateClassification, number> = {
    new: 0,
    exact_duplicate: 0,
    possible_duplicate: 0,
    conflicting_identity: 0,
    invalid: 0,
  };

  for (const { partialMaterial, rawItem } of items) {
    const { stagingItem } = normalizeStagingItem({
      partialMaterial,
      rawItem,
      sourceType,
      sourceName,
      index,
    });
    stagingItems.push(stagingItem);

    const classification = stagingItem.duplicateInfo?.classification ?? "new";
    if (stagingItem.status === "normalized" || stagingItem.status === "needs_review") {
      counts[classification as DuplicateClassification]++;
    } else if (stagingItem.status === "duplicate") {
      counts[classification as DuplicateClassification]++;
    } else if (stagingItem.validationErrors.length > 0) {
      counts.invalid++;
    }
  }

  return { stagingItems, index, counts };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveStatus(
  classification: DuplicateClassification,
  validationErrors: string[],
): StagingStatus {
  if (validationErrors.length > 0 && classification === "invalid") return "draft";
  if (classification === "exact_duplicate" || classification === "conflicting_identity") return "duplicate";
  if (classification === "possible_duplicate") return "needs_review";
  if (validationErrors.length > 0) return "needs_review";
  return "normalized";
}

function generateStagingId(material: Partial<UniversalMaterial>, sourceName: string): string {
  const key = [
    sourceName,
    material.brand ?? "",
    material.productCode ?? "",
    material.productName ?? "",
    material.variant ?? "",
  ].join("::");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Adapt a UniversalMaterial to ExternalCatalogItem for duplicate detection.
 * The duplicate detector is provider-agnostic — we reuse it here with a
 * synthetic providerId derived from the source name.
 */
function toExternalCatalogItem(
  mat: Partial<UniversalMaterial>,
  stagingId: string,
): ExternalCatalogItem {
  return {
    externalId: mat.productCode ?? stagingId,
    providerId: `universal-import::${mat.sourceType ?? "unknown"}::${mat.sourceName ?? ""}`,
    brand: mat.brand,
    productCode: mat.productCode,
    productName: mat.productName ?? "",
    category: mat.category,
    subcategory: mat.subcategory,
    materialType: mat.materialType,
    description: mat.description,
    color: mat.colors,
    finish: mat.finish,
    texture: mat.texture,
    pattern: mat.pattern,
    sourceUrl: mat.sourceUrl,
    sourceMetadata: mat.sourceMetadata,
  };
}
