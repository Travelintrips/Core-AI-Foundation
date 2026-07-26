/**
 * Material Catalog Integration — Phase 3
 * Tests: Duplicate Detector
 */

import { describe, it, expect } from "vitest";
import {
  classifyItem,
  classifyBatch,
  addToIndex,
  createDetectionIndex,
} from "../catalogDuplicateDetector.js";
import type { ExternalCatalogItem } from "../types.js";

function makeItem(overrides: Partial<ExternalCatalogItem>): ExternalCatalogItem {
  return {
    externalId: "TEST-001",
    providerId: "mock",
    productName: "Test Tile",
    brand: "Brand A",
    productCode: "CODE-001",
    sourceUrl: "https://example.com/products/TEST-001",
    ...overrides,
  };
}

describe("catalogDuplicateDetector", () => {
  // Test 15 — exact duplicate detection
  it("classifies as exact_duplicate when providerId+externalId match", () => {
    const index = createDetectionIndex();
    const item = makeItem({});
    addToIndex(item, index);

    const dup = makeItem({ productName: "Different Name" });
    const result = classifyItem(dup, index);
    expect(result.classification).toBe("exact_duplicate");
    expect(result.matchedKey).toBe("providerId+externalId");
  });

  it("classifies as conflicting_identity when brand+productCode match but externalId differs", () => {
    // Same brand+productCode, different externalId → conflicting_identity
    // (two catalog entries claim the same product code but have different IDs)
    const index = createDetectionIndex();
    const item = makeItem({ externalId: "ORIG-001" });
    addToIndex(item, index);

    const conflict = makeItem({ externalId: "COPY-001" }); // same brand+productCode, different externalId
    const result = classifyItem(conflict, index);
    expect(result.classification).toBe("conflicting_identity");
    expect(result.matchedKey).toBe("brand+productCode");
  });

  it("classifies as exact_duplicate via brand+productCode when externalId also matches", () => {
    // Different providerId (so strategy 1 does not fire), same brand+productCode+externalId
    const index = createDetectionIndex();
    const item = makeItem({ externalId: "SHARED-001", providerId: "provider-a" });
    addToIndex(item, index);

    const dup = makeItem({ externalId: "SHARED-001", providerId: "provider-b" }); // different provider, same code+externalId
    const result = classifyItem(dup, index);
    expect(result.classification).toBe("exact_duplicate");
    expect(result.matchedKey).toBe("brand+productCode");
  });

  it("classifies as exact_duplicate when sourceUrl matches", () => {
    const index = createDetectionIndex();
    const item = makeItem({ externalId: "URL-001", brand: undefined, productCode: undefined });
    addToIndex(item, index);

    const dup = makeItem({
      externalId: "URL-002",
      brand: undefined,
      productCode: undefined,
      sourceUrl: item.sourceUrl,
    });
    const result = classifyItem(dup, index);
    expect(result.classification).toBe("exact_duplicate");
    expect(result.matchedKey).toBe("sourceUrl");
  });

  // Test 16 — possible duplicate detection
  it("classifies as possible_duplicate when brand+productName match but productCode differs", () => {
    const index = createDetectionIndex();
    const item = makeItem({ productCode: "CODE-A" });
    addToIndex(item, index);

    const similar = makeItem({
      externalId: "DIFF-001",
      productCode: "CODE-B", // different code
    });
    const result = classifyItem(similar, index);
    expect(result.classification).toBe("possible_duplicate");
    expect(result.matchedKey).toBe("brand+productName");
  });

  // Test 17 — invalid identity detection
  it("classifies as invalid when externalId is missing", () => {
    const index = createDetectionIndex();
    const item = makeItem({ externalId: "" });
    const result = classifyItem(item, index);
    expect(result.classification).toBe("invalid");
  });

  it("classifies as invalid when productName is missing", () => {
    const index = createDetectionIndex();
    const item = makeItem({ productName: "" });
    const result = classifyItem(item, index);
    expect(result.classification).toBe("invalid");
  });

  it("classifies as invalid when providerId is missing", () => {
    const index = createDetectionIndex();
    const item = makeItem({ providerId: "" });
    const result = classifyItem(item, index);
    expect(result.classification).toBe("invalid");
  });

  it("classifies conflicting_identity when brand+productCode matches a different externalId", () => {
    const index = createDetectionIndex();
    // First item with externalId A
    const original = makeItem({ externalId: "ORIG-AAA", productCode: "CODE-X" });
    addToIndex(original, index);

    // Second item: same brand+productCode but a DIFFERENT externalId
    const conflict = makeItem({ externalId: "DIFF-BBB", productCode: "CODE-X" });
    const result = classifyItem(conflict, index);
    expect(result.classification).toBe("conflicting_identity");
  });

  it("classifies as new when no keys match", () => {
    const index = createDetectionIndex();
    const item = makeItem({
      externalId: "BRAND-NEW",
      brand: "Unique Brand",
      productCode: "UNIQUE-CODE",
      productName: "Unique Product",
      sourceUrl: "https://example.com/unique",
    });
    const result = classifyItem(item, index);
    expect(result.classification).toBe("new");
  });

  it("classifyBatch returns correct counts", () => {
    const items: ExternalCatalogItem[] = [
      makeItem({ externalId: "A", productCode: "PC-A", brand: "Brand A", productName: "Tile A", sourceUrl: "https://example.com/a" }),
      makeItem({ externalId: "A", productCode: "PC-A", brand: "Brand A", productName: "Tile A", sourceUrl: "https://example.com/a" }), // exact dup
      makeItem({ externalId: "B", productCode: "PC-B", brand: "Brand B", productName: "Tile B", sourceUrl: "https://example.com/b" }),
      makeItem({ externalId: "C", productCode: "PC-C", brand: "Brand A", productName: "Tile A", sourceUrl: "https://example.com/c" }), // possible dup (same brand+name as A)
      makeItem({ externalId: "", productCode: "INV", brand: "Brand X", productName: "Invalid" }), // invalid
    ];

    const { results, counts } = classifyBatch(items);
    expect(counts.new).toBeGreaterThanOrEqual(2); // A and B are new
    expect(counts.exact_duplicate).toBeGreaterThanOrEqual(1); // second A is exact dup
    expect(counts.invalid).toBeGreaterThanOrEqual(1); // empty externalId
    expect(results).toHaveLength(5);
  });

  // Test 30 — deterministic output ordering
  it("preserves input ordering in batch results", () => {
    const ids = ["Z-001", "A-001", "M-001"];
    const items = ids.map((id) =>
      makeItem({ externalId: id, productCode: id, brand: `Brand ${id}`, productName: `Product ${id}`, sourceUrl: `https://example.com/${id}` }),
    );
    const { results } = classifyBatch(items);
    expect(results.map((r) => r.externalId)).toEqual(ids);
  });

  // Test 26 — no canonical Material Library mutation
  it("does not mutate input items", () => {
    const index = createDetectionIndex();
    const original = makeItem({ externalId: "IMMUTABLE-001" });
    const snapshot = { ...original };
    classifyItem(original, index);
    expect(original).toEqual(snapshot);
  });
});
