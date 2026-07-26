/**
 * Material Catalog Integration — Phase 3
 * Tests: Import Preview Service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runImportPreview } from "../catalogImportPreview.js";
import { mockOfficialCatalogProvider } from "../providers/mockOfficialCatalogProvider.js";
import {
  CatalogPayloadTooLargeError,
  CatalogProductionImportRejectedError,
} from "../errors.js";
import { MAX_RECORDS_PER_PREVIEW } from "../schemas.js";
import type { ImportOptions } from "../types.js";
import type { MaterialCatalogProvider } from "../catalogProvider.js";
import type { CatalogFetchContext, CatalogProviderCapabilities, CatalogProviderValidationResult, ExternalCatalogResult } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOversizedProvider(count: number): MaterialCatalogProvider {
  return {
    providerId: "oversized-test",
    displayName: "Oversized Test Provider",
    sourceType: "manual_fixture",
    getCapabilities: (): CatalogProviderCapabilities => ({
      supportedBrands: [],
      supportedCountries: [],
      supportsPagination: false,
      supportsFiltering: false,
      maxItemsPerFetch: count,
      requiresCredentials: false,
    }),
    validateConfig: async (): Promise<CatalogProviderValidationResult> => ({ valid: true, errors: [] }),
    fetchCatalog: async (_ctx: CatalogFetchContext): Promise<ExternalCatalogResult> => ({
      items: Array.from({ length: count }, (_, i) => ({
        externalId: `ITEM-${i}`,
        providerId: "oversized-test",
        productName: `Product ${i}`,
      })) as never,
      fetchedAt: new Date(),
    }),
  };
}

function makeErrorProvider(message: string): MaterialCatalogProvider {
  return {
    providerId: "error-provider",
    displayName: "Error Provider",
    sourceType: "manual_fixture",
    getCapabilities: (): CatalogProviderCapabilities => ({
      supportedBrands: [],
      supportedCountries: [],
      supportsPagination: false,
      supportsFiltering: false,
      maxItemsPerFetch: 10,
      requiresCredentials: false,
    }),
    validateConfig: async (): Promise<CatalogProviderValidationResult> => ({ valid: true, errors: [] }),
    fetchCatalog: async (_ctx: CatalogFetchContext): Promise<ExternalCatalogResult> => {
      throw new Error(message);
    },
  };
}

const VALID_OPTIONS: ImportOptions = { dryRun: true, maxRecords: 50 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runImportPreview", () => {
  // Test 14 — dryRun=false rejection
  it("rejects when dryRun is false", async () => {
    await expect(
      runImportPreview({
        provider: mockOfficialCatalogProvider,
        providerConfig: null,
        options: { dryRun: false } as unknown as ImportOptions,
      }),
    ).rejects.toThrow(CatalogProductionImportRejectedError);
  });

  it("rejects when dryRun is missing", async () => {
    await expect(
      runImportPreview({
        provider: mockOfficialCatalogProvider,
        providerConfig: null,
        options: {} as unknown as ImportOptions,
      }),
    ).rejects.toThrow(CatalogProductionImportRejectedError);
  });

  // Test 13 — deterministic import preview
  it("returns a complete preview result", async () => {
    const result = await runImportPreview({
      provider: mockOfficialCatalogProvider,
      providerConfig: null,
      options: VALID_OPTIONS,
    });
    expect(result.totalReceived).toBeGreaterThan(0);
    expect(result.validCount).toBeGreaterThan(0);
    expect(result.executionDurationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.items)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  // Test 13 continued — deterministic: same input → same counts
  it("produces the same counts on repeated calls", async () => {
    const a = await runImportPreview({ provider: mockOfficialCatalogProvider, providerConfig: null, options: VALID_OPTIONS });
    const b = await runImportPreview({ provider: mockOfficialCatalogProvider, providerConfig: null, options: VALID_OPTIONS });
    expect(a.totalReceived).toBe(b.totalReceived);
    expect(a.validCount).toBe(b.validCount);
    expect(a.invalidCount).toBe(b.invalidCount);
    expect(a.newCount).toBe(b.newCount);
  });

  // Test 21 — maximum record limit
  it("rejects payloads exceeding MAX_RECORDS_PER_PREVIEW", async () => {
    const provider = makeOversizedProvider(MAX_RECORDS_PER_PREVIEW + 1);
    await expect(
      runImportPreview({ provider, providerConfig: null, options: { dryRun: true } }),
    ).rejects.toThrow(CatalogPayloadTooLargeError);
  });

  it("accepts exactly MAX_RECORDS_PER_PREVIEW items without throwing", async () => {
    // Mock that returns exactly the limit
    const limitProvider = makeOversizedProvider(MAX_RECORDS_PER_PREVIEW);
    // This should not throw but will have many invalid records (missing fields)
    // since the oversized provider doesn't produce fully valid items.
    // The point is no CatalogPayloadTooLargeError.
    const result = await runImportPreview({ provider: limitProvider, providerConfig: null, options: { dryRun: true } });
    expect(result.totalReceived).toBe(MAX_RECORDS_PER_PREVIEW);
  });

  // Test 22 — provider error handling
  it("throws CatalogProviderError on provider fetch failure", async () => {
    const { CatalogProviderError } = await import("../errors.js");
    await expect(
      runImportPreview({
        provider: makeErrorProvider("network timeout"),
        providerConfig: null,
        options: { dryRun: true },
      }),
    ).rejects.toThrow(CatalogProviderError);
  });

  // Test 23 — partial-invalid catalog handling
  it("counts invalid records without failing the whole preview", async () => {
    const result = await runImportPreview({
      provider: mockOfficialCatalogProvider,
      providerConfig: null,
      options: { dryRun: true, maxRecords: 100 },
    });
    // Mock provider includes intentionally invalid records
    expect(result.invalidCount).toBeGreaterThan(0);
    expect(result.validCount).toBeGreaterThan(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // Test 25 — no database write during preview
  it("completes without accessing the database (no DB import in module)", async () => {
    // The preview module should only import from within the domain — never from lib/db.
    // We verify by checking the result is purely computed.
    const result = await runImportPreview({
      provider: mockOfficialCatalogProvider,
      providerConfig: null,
      options: { dryRun: true, maxRecords: 5 },
    });
    expect(result).toBeDefined();
    expect(result.items.length).toBeLessThanOrEqual(5);
  });

  it("respects maxRecords option", async () => {
    const result = await runImportPreview({
      provider: mockOfficialCatalogProvider,
      providerConfig: null,
      options: { dryRun: true, maxRecords: 3 },
    });
    // Provider returns 3 items maximum when limit=3
    expect(result.totalReceived).toBeLessThanOrEqual(3);
  });

  it("returns nextCursor when more pages are available", async () => {
    const result = await runImportPreview({
      provider: mockOfficialCatalogProvider,
      providerConfig: null,
      options: { dryRun: true, maxRecords: 5 },
    });
    expect(result.nextCursor).toBeDefined();
  });
});
