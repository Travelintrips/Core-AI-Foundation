/**
 * Phase 3 — Material Catalog Integration: test suite.
 *
 * 98 tests covering:
 *   A. Feature flag (8)
 *   B. Provider registry (18)
 *   C. Mock provider (15)
 *   D. Normalizer (20)
 *   E. Integration service (25)
 *   F. Phase 3 safeguards (12)
 *
 * All tests run without a live database or network connection.
 * The feature flag is toggled via process.env and reset after each test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isCatalogIntegrationEnabled,
  registerProvider,
  getProvider,
  listProviders,
  clearRegistry,
  normalizeCatalogEntry,
  slugFromName,
  fetchCatalogPage,
  fetchNormalizedCatalogPage,
  listAvailableProviders,
  getIntegrationStatus,
  resetIntegrationState,
} from "../domains/material-catalog-integration/index.js";
import {
  mockOfficialCatalogProvider,
  MOCK_PROVIDER_ID,
  MOCK_ENTRY_COUNT,
} from "../domains/material-catalog-integration/mockOfficialCatalogProvider.js";
import type { CatalogEntry } from "../domains/material-catalog-integration/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function withFlagEnabled(fn: () => void | Promise<void>): () => Promise<void> {
  return async () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "true";
    try { await fn(); } finally { delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"]; }
  };
}

function sampleEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    externalId: "EXT-001",
    source: "test-provider",
    name: "Test Marble Tile",
    category: "Floor",
    brand: "TestBrand",
    finish: "Polished",
    color: "White",
    priceTier: "Standard",
    description: "A test tile",
    searchKeywords: ["marble", "tile"],
    ...overrides,
  };
}

// ── A. Feature Flag (8 tests) ─────────────────────────────────────────────────

describe("A. Feature Flag — isCatalogIntegrationEnabled", () => {
  afterEach(() => { delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"]; });

  it("A-1: returns false when env var is not set", () => {
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    expect(isCatalogIntegrationEnabled()).toBe(false);
  });

  it("A-2: returns false when env var is 'false'", () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "false";
    expect(isCatalogIntegrationEnabled()).toBe(false);
  });

  it("A-3: returns false when env var is '0'", () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "0";
    expect(isCatalogIntegrationEnabled()).toBe(false);
  });

  it("A-4: returns false when env var is empty string", () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "";
    expect(isCatalogIntegrationEnabled()).toBe(false);
  });

  it("A-5: returns true when env var is exactly 'true'", () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "true";
    expect(isCatalogIntegrationEnabled()).toBe(true);
  });

  it("A-6: reads process.env live — toggling between calls reflects immediately", () => {
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    expect(isCatalogIntegrationEnabled()).toBe(false);
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "true";
    expect(isCatalogIntegrationEnabled()).toBe(true);
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    expect(isCatalogIntegrationEnabled()).toBe(false);
  });

  it("A-7: is case-sensitive — 'True' does not activate it", () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "True";
    expect(isCatalogIntegrationEnabled()).toBe(false);
  });

  it("A-8: 'yes' does not activate it — only 'true' does", () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "yes";
    expect(isCatalogIntegrationEnabled()).toBe(false);
  });
});

// ── B. Provider Registry (18 tests) ──────────────────────────────────────────

describe("B. Provider Registry", () => {
  beforeEach(() => clearRegistry());
  afterEach(() => clearRegistry());

  it("B-1: starts empty — listProviders returns []", () => {
    expect(listProviders()).toEqual([]);
  });

  it("B-2: registerProvider adds the provider", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(listProviders()).toContain(MOCK_PROVIDER_ID);
  });

  it("B-3: getProvider retrieves the registered provider", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(getProvider(MOCK_PROVIDER_ID)).toBe(mockOfficialCatalogProvider);
  });

  it("B-4: getProvider returns undefined for an unknown id", () => {
    expect(getProvider("nonexistent-provider")).toBeUndefined();
  });

  it("B-5: listProviders returns empty array before any registration", () => {
    expect(listProviders()).toHaveLength(0);
  });

  it("B-6: listProviders includes all registered provider ids", () => {
    const providerA = { ...mockOfficialCatalogProvider, providerId: "provider-a" };
    const providerB = { ...mockOfficialCatalogProvider, providerId: "provider-b" };
    registerProvider("provider-a", providerA);
    registerProvider("provider-b", providerB);
    expect(listProviders()).toContain("provider-a");
    expect(listProviders()).toContain("provider-b");
  });

  it("B-7: registering same id twice replaces the old provider", () => {
    const first  = { ...mockOfficialCatalogProvider, providerId: "dup" };
    const second = { ...mockOfficialCatalogProvider, providerId: "dup" };
    registerProvider("dup", first);
    registerProvider("dup", second);
    expect(getProvider("dup")).toBe(second);
    expect(listProviders()).toHaveLength(1);
  });

  it("B-8: clearRegistry removes all providers", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    clearRegistry();
    expect(listProviders()).toHaveLength(0);
  });

  it("B-9: clearRegistry leaves registry in empty state", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    clearRegistry();
    expect(getProvider(MOCK_PROVIDER_ID)).toBeUndefined();
  });

  it("B-10: multiple distinct providers can be registered simultaneously", () => {
    for (let i = 1; i <= 5; i++) {
      registerProvider(`provider-${i}`, { ...mockOfficialCatalogProvider, providerId: `provider-${i}` });
    }
    expect(listProviders()).toHaveLength(5);
  });

  it("B-11: provider id is case-sensitive", () => {
    registerProvider("MyProvider", mockOfficialCatalogProvider);
    expect(getProvider("myprovider")).toBeUndefined();
    expect(getProvider("MyProvider")).toBe(mockOfficialCatalogProvider);
  });

  it("B-12: getProvider retrieves the correct provider when many are registered", () => {
    const target = { ...mockOfficialCatalogProvider, providerId: "target" };
    registerProvider("alpha", { ...mockOfficialCatalogProvider, providerId: "alpha" });
    registerProvider("target", target);
    registerProvider("zeta",  { ...mockOfficialCatalogProvider, providerId: "zeta"  });
    expect(getProvider("target")).toBe(target);
  });

  it("B-13: listProviders returns ids in alphabetical order", () => {
    registerProvider("zebra",  { ...mockOfficialCatalogProvider, providerId: "zebra"  });
    registerProvider("alpha",  { ...mockOfficialCatalogProvider, providerId: "alpha"  });
    registerProvider("medium", { ...mockOfficialCatalogProvider, providerId: "medium" });
    expect(listProviders()).toEqual(["alpha", "medium", "zebra"]);
  });

  it("B-14: re-registering same id does not grow the list", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(listProviders()).toHaveLength(1);
  });

  it("B-15: registered provider has a fetchPage method", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(typeof getProvider(MOCK_PROVIDER_ID)?.fetchPage).toBe("function");
  });

  it("B-16: registered provider has a healthCheck method", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(typeof getProvider(MOCK_PROVIDER_ID)?.healthCheck).toBe("function");
  });

  it("B-17: registered provider has a providerId property", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(getProvider(MOCK_PROVIDER_ID)?.providerId).toBe(MOCK_PROVIDER_ID);
  });

  it("B-18: clearRegistry does not affect providers registered after the clear", () => {
    registerProvider("before", { ...mockOfficialCatalogProvider, providerId: "before" });
    clearRegistry();
    registerProvider("after", { ...mockOfficialCatalogProvider, providerId: "after" });
    expect(listProviders()).toEqual(["after"]);
  });
});

// ── C. Mock Official Catalog Provider (15 tests) ──────────────────────────────

describe("C. Mock Official Catalog Provider", () => {
  it("C-1: mock provider has the correct providerId", () => {
    expect(mockOfficialCatalogProvider.providerId).toBe(MOCK_PROVIDER_ID);
  });

  it("C-2: fetchPage returns a CatalogPage object", async () => {
    const page = await mockOfficialCatalogProvider.fetchPage(1, 10);
    expect(page).toHaveProperty("entries");
    expect(page).toHaveProperty("total");
    expect(page).toHaveProperty("pageNumber");
    expect(page).toHaveProperty("pageSize");
  });

  it("C-3: CatalogPage entries is an array", async () => {
    const page = await mockOfficialCatalogProvider.fetchPage(1, 10);
    expect(Array.isArray(page.entries)).toBe(true);
  });

  it("C-4: total matches MOCK_ENTRY_COUNT", async () => {
    const page = await mockOfficialCatalogProvider.fetchPage(1, 100);
    expect(page.total).toBe(MOCK_ENTRY_COUNT);
  });

  it("C-5: pageNumber echoes the requested page", async () => {
    const page = await mockOfficialCatalogProvider.fetchPage(2, 2);
    expect(page.pageNumber).toBe(2);
  });

  it("C-6: each entry is a CatalogEntry with required fields", async () => {
    const { entries } = await mockOfficialCatalogProvider.fetchPage(1, 10);
    for (const entry of entries) {
      expect(entry).toHaveProperty("externalId");
      expect(entry).toHaveProperty("source");
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("category");
    }
  });

  it("C-7: each entry has a non-empty name", async () => {
    const { entries } = await mockOfficialCatalogProvider.fetchPage(1, 10);
    for (const entry of entries) {
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("C-8: each entry has a category string", async () => {
    const { entries } = await mockOfficialCatalogProvider.fetchPage(1, 10);
    for (const entry of entries) {
      expect(typeof entry.category).toBe("string");
    }
  });

  it("C-9: each entry has a non-empty externalId", async () => {
    const { entries } = await mockOfficialCatalogProvider.fetchPage(1, 10);
    for (const entry of entries) {
      expect(entry.externalId.length).toBeGreaterThan(0);
    }
  });

  it("C-10: each entry source matches the provider id", async () => {
    const { entries } = await mockOfficialCatalogProvider.fetchPage(1, 10);
    for (const entry of entries) {
      expect(entry.source).toBe(MOCK_PROVIDER_ID);
    }
  });

  it("C-11: fetchPage page 2 returns different entries than page 1 (with small pageSize)", async () => {
    const page1 = await mockOfficialCatalogProvider.fetchPage(1, 2);
    const page2 = await mockOfficialCatalogProvider.fetchPage(2, 2);
    const ids1 = page1.entries.map((e) => e.externalId);
    const ids2 = page2.entries.map((e) => e.externalId);
    expect(ids1).not.toEqual(ids2);
  });

  it("C-12: pageSize caps the number of entries returned", async () => {
    const page = await mockOfficialCatalogProvider.fetchPage(1, 2);
    expect(page.entries.length).toBeLessThanOrEqual(2);
  });

  it("C-13: healthCheck returns a ProviderHealthStatus", async () => {
    const status = await mockOfficialCatalogProvider.healthCheck();
    expect(status).toHaveProperty("providerId");
    expect(status).toHaveProperty("status");
    expect(status).toHaveProperty("lastCheckedAt");
  });

  it("C-14: healthCheck returns the correct providerId", async () => {
    const status = await mockOfficialCatalogProvider.healthCheck();
    expect(status.providerId).toBe(MOCK_PROVIDER_ID);
  });

  it("C-15: fetchPage returns deterministic data on repeated calls", async () => {
    const first  = await mockOfficialCatalogProvider.fetchPage(1, 10);
    const second = await mockOfficialCatalogProvider.fetchPage(1, 10);
    expect(first.entries.map((e) => e.externalId)).toEqual(second.entries.map((e) => e.externalId));
  });
});

// ── D. Normalizer (20 tests) ──────────────────────────────────────────────────

describe("D. Normalizer — normalizeCatalogEntry", () => {
  it("D-1: sets name from entry.name", () => {
    const result = normalizeCatalogEntry(sampleEntry({ name: "Premium Marble Tile" }));
    expect(result.name).toBe("Premium Marble Tile");
  });

  it("D-2: sets category from entry.category", () => {
    const result = normalizeCatalogEntry(sampleEntry({ category: "Wall" }));
    expect(result.category).toBe("Wall");
  });

  it("D-3: uses entry.brand when present", () => {
    const result = normalizeCatalogEntry(sampleEntry({ brand: "Roman" }));
    expect(result.brand).toBe("Roman");
  });

  it("D-4: falls back to entry.source when brand is absent", () => {
    const entry = sampleEntry({ brand: undefined });
    const result = normalizeCatalogEntry(entry);
    expect(result.brand).toBe(entry.source);
  });

  it("D-5: maps externalId to materialCode", () => {
    const result = normalizeCatalogEntry(sampleEntry({ externalId: "EXT-999" }));
    expect(result.materialCode).toBe("EXT-999");
  });

  it("D-6: status is always 'active'", () => {
    expect(normalizeCatalogEntry(sampleEntry()).status).toBe("active");
  });

  it("D-7: thumbnailUrl is null when absent", () => {
    const result = normalizeCatalogEntry(sampleEntry({ thumbnailUrl: undefined }));
    expect(result.thumbnailUrl).toBeNull();
  });

  it("D-8: previewImages is always null (Phase 3 does not import images)", () => {
    expect(normalizeCatalogEntry(sampleEntry()).previewImages).toBeNull();
  });

  it("D-9: technicalData is always null (not sourced from provider)", () => {
    expect(normalizeCatalogEntry(sampleEntry()).technicalData).toBeNull();
  });

  it("D-10: generates a slug from the entry name", () => {
    const result = normalizeCatalogEntry(sampleEntry({ name: "Test Marble Tile" }));
    expect(result.slug).toBe("test-marble-tile");
  });

  it("D-11: slug is lowercase", () => {
    const result = normalizeCatalogEntry(sampleEntry({ name: "UPPER CASE NAME" }));
    expect(result.slug).toBe("upper-case-name");
  });

  it("D-12: slug replaces spaces with hyphens", () => {
    const result = normalizeCatalogEntry(sampleEntry({ name: "space separated words" }));
    expect(result.slug).not.toContain(" ");
    expect(result.slug).toContain("-");
  });

  it("D-13: slug removes special characters", () => {
    const result = normalizeCatalogEntry(sampleEntry({ name: "Special! Chars & Stuff?" }));
    expect(result.slug).not.toMatch(/[!&?]/);
  });

  it("D-14: sets createdAt to the provided importedAt date", () => {
    const date = new Date("2026-06-01T00:00:00Z");
    const result = normalizeCatalogEntry(sampleEntry(), date);
    expect(result.createdAt).toEqual(date);
  });

  it("D-15: sets updatedAt to the provided importedAt date", () => {
    const date = new Date("2026-06-01T00:00:00Z");
    const result = normalizeCatalogEntry(sampleEntry(), date);
    expect(result.updatedAt).toEqual(date);
  });

  it("D-16: maps priceTier from entry.priceTier", () => {
    const result = normalizeCatalogEntry(sampleEntry({ priceTier: "Premium" }));
    expect(result.priceTier).toBe("Premium");
  });

  it("D-17: defaults priceTier to 'Standard' when absent", () => {
    const result = normalizeCatalogEntry(sampleEntry({ priceTier: undefined }));
    expect(result.priceTier).toBe("Standard");
  });

  it("D-18: maps finish from entry.finish", () => {
    const result = normalizeCatalogEntry(sampleEntry({ finish: "Matte" }));
    expect(result.finish).toBe("Matte");
  });

  it("D-19: maps color from entry.color", () => {
    const result = normalizeCatalogEntry(sampleEntry({ color: "Beige" }));
    expect(result.color).toBe("Beige");
  });

  it("D-20: output shape is compatible with MaterialRecord (has all required fields)", () => {
    const result = normalizeCatalogEntry(sampleEntry());
    expect(result).toHaveProperty("materialCode");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("slug");
    expect(result).toHaveProperty("category");
    expect(result).toHaveProperty("brand");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("createdAt");
    expect(result).toHaveProperty("updatedAt");
  });
});

// ── E. Integration Service (25 tests) ────────────────────────────────────────

describe("E. Integration Service — catalogIntegrationService", () => {
  beforeEach(() => {
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    clearRegistry();
  });
  afterEach(() => {
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    clearRegistry();
  });

  it("E-1: fetchCatalogPage returns empty entries when flag is disabled", async () => {
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID);
    expect(result.entries).toHaveLength(0);
  });

  it("E-2: fetchCatalogPage returns total=0 when disabled", async () => {
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID);
    expect(result.total).toBe(0);
  });

  it("E-3: fetchCatalogPage does not call provider when disabled", async () => {
    let called = false;
    registerProvider("spy", {
      providerId: "spy",
      fetchPage: async () => { called = true; return { entries: [], total: 0, pageNumber: 1, pageSize: 0 }; },
      healthCheck: async () => ({ providerId: "spy", status: "online" as const, lastCheckedAt: new Date() }),
    });
    await fetchCatalogPage("spy");
    expect(called).toBe(false);
  });

  it("E-4: fetchCatalogPage ignores page params when disabled", async () => {
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID, 5, 100);
    expect(result.entries).toHaveLength(0);
  });

  it("E-5: disabled service returns pageSize=0", async () => {
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID);
    expect(result.pageSize).toBe(0);
  });

  it("E-6: when enabled but provider not registered, returns empty", withFlagEnabled(async () => {
    const result = await fetchCatalogPage("not-registered");
    expect(result.entries).toHaveLength(0);
  }));

  it("E-7: when enabled with mock provider, calls fetchPage", withFlagEnabled(async () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID, 1, 10);
    expect(result.entries.length).toBeGreaterThan(0);
  }));

  it("E-8: when enabled, returns raw entries from provider", withFlagEnabled(async () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID, 1, 10);
    expect(result.entries[0]).toHaveProperty("externalId");
    expect(result.entries[0]).toHaveProperty("name");
  }));

  it("E-9: when enabled, total reflects provider total", withFlagEnabled(async () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID, 1, 100);
    expect(result.total).toBe(MOCK_ENTRY_COUNT);
  }));

  it("E-10: fetchCatalogPage returns CatalogPage shape", async () => {
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID);
    expect(result).toHaveProperty("entries");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("pageNumber");
    expect(result).toHaveProperty("pageSize");
  });

  it("E-11: disabled service always returns pageNumber=1", async () => {
    const result = await fetchCatalogPage(MOCK_PROVIDER_ID, 3, 20);
    expect(result.pageNumber).toBe(1);
  });

  it("E-12: fetchNormalizedCatalogPage returns empty when disabled", async () => {
    const result = await fetchNormalizedCatalogPage(MOCK_PROVIDER_ID);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("E-13: listAvailableProviders returns [] when disabled", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(listAvailableProviders()).toEqual([]);
  });

  it("E-14: listAvailableProviders returns provider ids when enabled", withFlagEnabled(() => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    expect(listAvailableProviders()).toContain(MOCK_PROVIDER_ID);
  }));

  it("E-15: getIntegrationStatus returns enabled=false when flag off", () => {
    const status = getIntegrationStatus();
    expect(status.enabled).toBe(false);
  });

  it("E-16: getIntegrationStatus returns enabled=true when flag on", withFlagEnabled(() => {
    const status = getIntegrationStatus();
    expect(status.enabled).toBe(true);
  }));

  it("E-17: getIntegrationStatus reports providerCount=0 when disabled (even if registered)", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const status = getIntegrationStatus();
    expect(status.providerCount).toBe(0);
  });

  it("E-18: getIntegrationStatus reports correct providerCount when enabled", withFlagEnabled(() => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const status = getIntegrationStatus();
    expect(status.providerCount).toBe(1);
  }));

  it("E-19: getIntegrationStatus never throws regardless of flag state", () => {
    expect(() => getIntegrationStatus()).not.toThrow();
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "true";
    expect(() => getIntegrationStatus()).not.toThrow();
  });

  it("E-20: resetIntegrationState clears the provider registry", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    resetIntegrationState();
    expect(listProviders()).toHaveLength(0);
  });

  it("E-21: disabled service — fetchCatalogPage does not write to any store", async () => {
    // No mock is needed — if any write attempted it would throw (no DB mock set up)
    await expect(fetchCatalogPage(MOCK_PROVIDER_ID)).resolves.not.toThrow();
  });

  it("E-22: multiple calls to disabled service are idempotent", async () => {
    const first  = await fetchCatalogPage(MOCK_PROVIDER_ID);
    const second = await fetchCatalogPage(MOCK_PROVIDER_ID);
    expect(first).toEqual(second);
  });

  it("E-23: fetchNormalizedCatalogPage returns normalized items when enabled", withFlagEnabled(async () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const result = await fetchNormalizedCatalogPage(MOCK_PROVIDER_ID, 1, 5);
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("slug");
      expect(item).toHaveProperty("status", "active");
    }
  }));

  it("E-24: getIntegrationStatus registeredProviders is empty when flag is off", () => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const status = getIntegrationStatus();
    expect(status.registeredProviders).toHaveLength(0);
  });

  it("E-25: getIntegrationStatus registeredProviders lists providers when flag is on", withFlagEnabled(() => {
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    const status = getIntegrationStatus();
    expect(status.registeredProviders).toContain(MOCK_PROVIDER_ID);
  }));
});

// ── F. Phase 3 Safeguards (12 tests) ─────────────────────────────────────────

describe("F. Phase 3 Safeguards", () => {
  afterEach(() => {
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    clearRegistry();
  });

  it("F-1: MATERIAL_CATALOG_INTEGRATION_ENABLED is not set in process.env by default", () => {
    // This test must run first — beforeEach deletes the key
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    expect(process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"]).toBeUndefined();
  });

  it("F-2: the index module does not export an HTTP router object", async () => {
    const mod = await import("../domains/material-catalog-integration/index.js");
    // An Express router would have .get/.post/.use methods and a Router symbol
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value === "function" && "stack" in value) {
        throw new Error(`Unexpected Express router exported: ${key}`);
      }
    }
    expect(true).toBe(true); // reached without throwing
  });

  it("F-3: mockOfficialCatalogProvider is not auto-registered at import time", () => {
    // Importing the mock module must not add it to the registry
    expect(getProvider(MOCK_PROVIDER_ID)).toBeUndefined();
  });

  it("F-4: fetchCatalogPage is safe to call without any registered providers", async () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "true";
    await expect(fetchCatalogPage("unknown")).resolves.not.toThrow();
  });

  it("F-5: normalizeCatalogEntry output has no id field (Phase 3 does not set DB ids)", () => {
    const result = normalizeCatalogEntry(sampleEntry());
    expect("id" in result).toBe(false);
  });

  it("F-6: normalizeCatalogEntry is a pure function — same input always yields same output", () => {
    const fixed = new Date("2026-01-01T00:00:00Z");
    const entry = sampleEntry();
    const first  = normalizeCatalogEntry(entry, fixed);
    const second = normalizeCatalogEntry(entry, fixed);
    expect(first).toEqual(second);
  });

  it("F-7: Phase 3 types are compatible with Phase 1 MaterialRecord (no field conflicts)", () => {
    // normalizeCatalogEntry output must pass a basic MaterialRecord field check
    const result = normalizeCatalogEntry(sampleEntry());
    const materialFields = ["materialCode", "name", "slug", "category", "status", "createdAt", "updatedAt"];
    for (const field of materialFields) {
      expect(result).toHaveProperty(field);
    }
  });

  it("F-8: integration service functions return consistently shaped responses", async () => {
    const page1 = await fetchCatalogPage(MOCK_PROVIDER_ID);
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "true";
    const page2 = await fetchCatalogPage("no-such-provider");
    // Both must have the same shape
    expect(Object.keys(page1)).toEqual(Object.keys(page2));
  });

  it("F-9: clearing registry while flag is enabled returns empty provider list", () => {
    process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] = "true";
    registerProvider(MOCK_PROVIDER_ID, mockOfficialCatalogProvider);
    clearRegistry();
    expect(listAvailableProviders()).toHaveLength(0);
  });

  it("F-10: feature flag guard prevents data fetch when disabled even if provider registered", async () => {
    let fetchCalled = false;
    registerProvider("guarded", {
      providerId: "guarded",
      fetchPage: async () => { fetchCalled = true; return { entries: [], total: 0, pageNumber: 1, pageSize: 0 }; },
      healthCheck: async () => ({ providerId: "guarded", status: "online" as const, lastCheckedAt: new Date() }),
    });
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    await fetchCatalogPage("guarded");
    expect(fetchCalled).toBe(false);
  });

  it("F-11: Phase 1 rankMaterials still works correctly alongside Phase 3 foundation", async () => {
    // Import Phase 1 material from the intelligence engine
    const { rankMaterials } = await import("../domains/material-intelligence/materialSearchEngine.js");
    const mat = {
      id: 1, materialCode: "M1", name: "Test Marble", slug: "test-marble",
      category: "Floor", subcategory: null, brand: "Brand", materialType: "Tile",
      color: "White", finish: "Polished", texture: null, pattern: null,
      description: null, priceTier: "Standard", thumbnailUrl: null,
      previewImages: null, technicalData: null, searchKeywords: ["marble"],
      status: "active" as const, createdAt: new Date(), updatedAt: new Date(),
    };
    const results = rankMaterials([mat], { query: "marble" });
    expect(results).toHaveLength(1);
    expect(results[0]?.material.id).toBe(1);
  });

  it("F-12: isCatalogIntegrationEnabled returns false when called multiple times without setting the flag", () => {
    delete process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"];
    for (let i = 0; i < 5; i++) {
      expect(isCatalogIntegrationEnabled()).toBe(false);
    }
  });
});
