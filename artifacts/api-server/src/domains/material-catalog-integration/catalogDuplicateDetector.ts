/**
 * Material Catalog Integration — Phase 3 Foundation
 * Duplicate-detection abstraction — deterministic only, no fuzzy/semantic matching.
 *
 * Uses four deterministic key strategies:
 *   1. providerId + externalId  (exact)
 *   2. brand + productCode      (exact)
 *   3. normalized brand + normalized productName  (conservative similarity)
 *   4. sourceUrl                (exact)
 *
 * Never writes to canonical materials table.
 * Never reads from canonical materials table (operates on in-memory index only).
 */

import type { DuplicateCheckResult, DuplicateClassification, ExternalCatalogItem } from "./types.js";

// ── Detection index ───────────────────────────────────────────────────────────

/**
 * In-memory index built from items already processed in this import session.
 * NOT connected to the canonical materials database.
 */
export interface DetectionIndex {
  /** key: `${providerId}::${externalId}` */
  readonly byProviderExternalId: Map<string, string>;
  /** key: `${normalizedBrand}::${productCode}` */
  readonly byBrandProductCode: Map<string, string>;
  /** key: `${normalizedBrand}::${normalizedProductName}` */
  readonly byBrandProductName: Map<string, string>;
  /** key: sourceUrl */
  readonly bySourceUrl: Map<string, string>;
}

export function createDetectionIndex(): DetectionIndex {
  return {
    byProviderExternalId: new Map(),
    byBrandProductCode: new Map(),
    byBrandProductName: new Map(),
    bySourceUrl: new Map(),
  };
}

// ── Key builders ──────────────────────────────────────────────────────────────

function keyProviderExternalId(item: ExternalCatalogItem): string | undefined {
  if (!item.externalId || !item.providerId) return undefined;
  return `${item.providerId.toLowerCase()}::${item.externalId.toLowerCase()}`;
}

function keyBrandProductCode(item: ExternalCatalogItem): string | undefined {
  if (!item.brand || !item.productCode) return undefined;
  return `${item.brand.toLowerCase().replace(/\s+/g, "-")}::${item.productCode.toLowerCase()}`;
}

function keyBrandProductName(item: ExternalCatalogItem): string | undefined {
  if (!item.brand || !item.productName) return undefined;
  const b = item.brand.toLowerCase().replace(/\s+/g, "-");
  const n = item.productName.toLowerCase().replace(/\s+/g, "-");
  return `${b}::${n}`;
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Check an item against the detection index and return a classification.
 * Does NOT add the item to the index — call `addToIndex` separately.
 */
export function classifyItem(
  item: ExternalCatalogItem,
  index: DetectionIndex,
): DuplicateCheckResult {
  const id = item.externalId;

  // Validation: required fields
  if (!item.externalId || !item.providerId || !item.productName) {
    return {
      externalId: id || "(missing)",
      classification: "invalid",
      reason: "Missing required fields: externalId, providerId, or productName",
    };
  }

  // Strategy 1: providerId + externalId (strongest signal — exact duplicate)
  const k1 = keyProviderExternalId(item);
  if (k1 && index.byProviderExternalId.has(k1)) {
    return {
      externalId: id,
      classification: "exact_duplicate",
      matchedKey: "providerId+externalId",
      reason: `Exact match on providerId '${item.providerId}' + externalId '${item.externalId}'`,
    };
  }

  // Strategy 2: brand + productCode (exact duplicate from same brand)
  const k2 = keyBrandProductCode(item);
  if (k2 && index.byBrandProductCode.has(k2)) {
    const existingId = index.byBrandProductCode.get(k2)!;
    if (existingId !== item.externalId) {
      return {
        externalId: id,
        classification: "conflicting_identity",
        matchedKey: "brand+productCode",
        reason: `brand+productCode matches a different externalId ('${existingId}')`,
      };
    }
    return {
      externalId: id,
      classification: "exact_duplicate",
      matchedKey: "brand+productCode",
    };
  }

  // Strategy 3: normalized brand + normalized productName (possible duplicate)
  const k3 = keyBrandProductName(item);
  if (k3 && index.byBrandProductName.has(k3)) {
    return {
      externalId: id,
      classification: "possible_duplicate",
      matchedKey: "brand+productName",
      reason: `Same normalized brand+productName as an existing item`,
    };
  }

  // Strategy 4: sourceUrl (exact duplicate by URL)
  if (item.sourceUrl && index.bySourceUrl.has(item.sourceUrl)) {
    return {
      externalId: id,
      classification: "exact_duplicate",
      matchedKey: "sourceUrl",
      reason: `Exact match on sourceUrl`,
    };
  }

  return { externalId: id, classification: "new" };
}

/**
 * Add an item's keys to the detection index after it has been classified.
 * Only adds keys for items classified as "new" (or by caller preference).
 */
export function addToIndex(item: ExternalCatalogItem, index: DetectionIndex): void {
  const k1 = keyProviderExternalId(item);
  if (k1) index.byProviderExternalId.set(k1, item.externalId);

  const k2 = keyBrandProductCode(item);
  if (k2) index.byBrandProductCode.set(k2, item.externalId);

  const k3 = keyBrandProductName(item);
  if (k3) index.byBrandProductName.set(k3, item.externalId);

  if (item.sourceUrl) index.bySourceUrl.set(item.sourceUrl, item.externalId);
}

// ── Batch classification ──────────────────────────────────────────────────────

export interface BatchClassificationResult {
  readonly results: DuplicateCheckResult[];
  readonly counts: Record<DuplicateClassification, number>;
}

/**
 * Classify a batch of items, building the index progressively.
 * Items are processed in input order (deterministic).
 */
export function classifyBatch(
  items: ExternalCatalogItem[],
  seedIndex?: DetectionIndex,
): BatchClassificationResult {
  const index = seedIndex ?? createDetectionIndex();
  const results: DuplicateCheckResult[] = [];
  const counts: Record<DuplicateClassification, number> = {
    new: 0,
    exact_duplicate: 0,
    possible_duplicate: 0,
    invalid: 0,
    conflicting_identity: 0,
  };

  for (const item of items) {
    const result = classifyItem(item, index);
    results.push(result);
    counts[result.classification]++;

    // Add new and possibly-duplicate items to the index so subsequent items
    // can detect duplicates against them. Skip invalid and confirmed duplicates.
    if (result.classification === "new" || result.classification === "possible_duplicate") {
      addToIndex(item, index);
    }
  }

  return { results, counts };
}
