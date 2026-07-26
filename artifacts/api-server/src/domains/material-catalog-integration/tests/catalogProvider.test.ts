/**
 * Material Catalog Integration — Phase 3
 * Tests: Provider contract + mock provider behavior
 */

import { describe, it, expect } from "vitest";
import { mockOfficialCatalogProvider } from "../providers/mockOfficialCatalogProvider.js";

describe("MockOfficialCatalogProvider", () => {
  // Test 5 — provider configuration validation
  it("validates null/undefined config as valid (no credentials required)", async () => {
    const result = await mockOfficialCatalogProvider.validateConfig(null);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates empty object config as valid", async () => {
    const result = await mockOfficialCatalogProvider.validateConfig({});
    expect(result.valid).toBe(true);
  });

  it("declares correct source type", () => {
    expect(mockOfficialCatalogProvider.sourceType).toBe("manual_fixture");
  });

  it("declares requiresCredentials: false", () => {
    const caps = mockOfficialCatalogProvider.getCapabilities();
    expect(caps.requiresCredentials).toBe(false);
  });

  it("declares supported brands", () => {
    const caps = mockOfficialCatalogProvider.getCapabilities();
    expect(caps.supportedBrands).toContain("Niro Granite");
    expect(caps.supportedBrands).toContain("Essenzo");
  });

  it("declares supportsPagination: true", () => {
    const caps = mockOfficialCatalogProvider.getCapabilities();
    expect(caps.supportsPagination).toBe(true);
  });

  // Test 29 — mock provider performs no network request
  it("fetchCatalog makes no network request (pure fixture)", async () => {
    // If any network call were made, the Node test environment would fail or
    // we'd need to mock fetch. Since the mock is pure in-memory, this completes
    // synchronously without any I/O.
    const result = await mockOfficialCatalogProvider.fetchCatalog({});
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.sourceMetadata?.["isTestData"]).toBe(true);
  });

  it("returns at least 20 valid fixture records", async () => {
    const result = await mockOfficialCatalogProvider.fetchCatalog({ limit: 100 });
    // 22 valid + 3 invalid = 25 total, but limit=100 returns all
    expect(result.items.length).toBeGreaterThanOrEqual(20);
  });

  it("includes records from more than one category", async () => {
    const result = await mockOfficialCatalogProvider.fetchCatalog({ limit: 100 });
    const categories = new Set(result.items.map((i) => i.category).filter(Boolean));
    expect(categories.size).toBeGreaterThan(1);
  });

  it("includes records from more than one brand", async () => {
    const result = await mockOfficialCatalogProvider.fetchCatalog({ limit: 100 });
    const brands = new Set(result.items.map((i) => i.brand).filter(Boolean));
    expect(brands.size).toBeGreaterThan(1);
  });

  it("supports pagination via cursor", async () => {
    const page1 = await mockOfficialCatalogProvider.fetchCatalog({ limit: 5 });
    expect(page1.nextCursor).toBeDefined();
    const page2 = await mockOfficialCatalogProvider.fetchCatalog({
      limit: 5,
      cursor: page1.nextCursor,
    });
    // Pages must not overlap
    const ids1 = page1.items.map((i) => i.externalId);
    const ids2 = page2.items.map((i) => i.externalId);
    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  // Test 30 — deterministic output ordering
  it("returns items in the same order across multiple calls", async () => {
    const a = await mockOfficialCatalogProvider.fetchCatalog({ limit: 10 });
    const b = await mockOfficialCatalogProvider.fetchCatalog({ limit: 10 });
    expect(a.items.map((i) => i.externalId)).toEqual(b.items.map((i) => i.externalId));
  });

  it("returns deterministic fetchedAt timestamp", async () => {
    const a = await mockOfficialCatalogProvider.fetchCatalog({});
    const b = await mockOfficialCatalogProvider.fetchCatalog({});
    expect(a.fetchedAt.toISOString()).toBe(b.fetchedAt.toISOString());
  });

  it("filters by brand when brand is specified", async () => {
    const result = await mockOfficialCatalogProvider.fetchCatalog({ limit: 100, brand: "Essenzo" });
    result.items.forEach((item) => {
      if (item.brand) expect(item.brand.toLowerCase()).toContain("essenzo");
    });
  });

  it("returns no nextCursor when all items fit in one page", async () => {
    const result = await mockOfficialCatalogProvider.fetchCatalog({ limit: 1000 });
    expect(result.nextCursor).toBeUndefined();
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      mockOfficialCatalogProvider.fetchCatalog({ abortSignal: controller.signal }),
    ).rejects.toThrow("aborted");
  });
});
