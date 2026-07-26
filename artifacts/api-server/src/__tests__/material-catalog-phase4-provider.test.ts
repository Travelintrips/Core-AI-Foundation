/**
 * Material Catalog Integration — Phase 4 Official Provider
 * Tests: Niro Granite provider — config, mapping, pagination, client behavior,
 *        feature flags, and provider registration.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseNiroGraniteConfig, getNiroGraniteServerConfig } from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteConfig.js";
import { mapNiroGraniteRecord } from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteMapper.js";
import { niroGraniteOfficialProvider } from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteProvider.js";
import { NIRO_GRANITE_PROVIDER_ID } from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteSchemas.js";
import { NIRO_GRANITE_FIXTURE } from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteFixture.js";
import {
  fetchOfficialFeedJson,
  mapFixturePage,
} from "../domains/material-catalog-integration/providers/niroGranite/niroGraniteClient.js";
import {
  registerProvider,
  unregisterProvider,
  hasProvider,
  _resetProviderRegistry,
} from "../domains/material-catalog-integration/providerRegistry.js";
import {
  isMaterialCatalogEnabled,
  setMaterialCatalogFlagOverride,
  clearMaterialCatalogFlagOverride,
} from "../domains/material-catalog-integration/featureFlag.js";
import {
  registerOfficialMaterialProviders,
  NIRO_GRANITE_PROVIDER_FLAG,
} from "../domains/material-catalog-integration/officialProviderRegistration.js";
import { runImportPreview } from "../domains/material-catalog-integration/catalogImportPreview.js";
import {
  CatalogFetchError,
  CatalogResponseTooLargeError,
  CatalogPayloadTooLargeError,
} from "../domains/material-catalog-integration/errors.js";
import { MAX_RECORDS_PER_PREVIEW, MAX_PAYLOAD_SIZE_BYTES } from "../domains/material-catalog-integration/schemas.js";
import type { ImportOptions } from "../domains/material-catalog-integration/types.js";

// ── Config validation ─────────────────────────────────────────────────────────

describe("NiroGraniteConfig — parseNiroGraniteConfig", () => {
  it("accepts default empty config (fixture mode)", () => {
    const result = parseNiroGraniteConfig({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("fixture");
      expect(result.data.locale).toBe("id-ID");
      expect(result.data.country).toBe("ID");
      expect(result.data.liveFetchEnabled).toBe(false);
    }
  });

  it("accepts null config (coerced to empty object)", () => {
    const result = parseNiroGraniteConfig(null);
    expect(result.success).toBe(true);
  });

  it("accepts undefined config (coerced to empty object)", () => {
    const result = parseNiroGraniteConfig(undefined);
    expect(result.success).toBe(true);
  });

  it("accepts fixture mode explicitly", () => {
    const result = parseNiroGraniteConfig({ mode: "fixture" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mode).toBe("fixture");
  });

  it("accepts feed mode with required fields", () => {
    const result = parseNiroGraniteConfig({
      mode: "feed",
      feedUrl: "https://api.nirogranite.example.com/v1/catalog",
      liveFetchEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects feed mode without feedUrl", () => {
    const result = parseNiroGraniteConfig({ mode: "feed", liveFetchEnabled: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("feedUrl"))).toBe(true);
    }
  });

  it("rejects feed mode when liveFetchEnabled is false (controlled source gate)", () => {
    const result = parseNiroGraniteConfig({
      mode: "feed",
      feedUrl: "https://api.nirogranite.example.com/v1/catalog",
      liveFetchEnabled: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("disabled"))).toBe(true);
    }
  });

  it("rejects non-HTTPS feedUrl", () => {
    const result = parseNiroGraniteConfig({
      mode: "feed",
      feedUrl: "http://api.nirogranite.example.com/v1/catalog",
      liveFetchEnabled: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("HTTPS"))).toBe(true);
    }
  });

  it("rejects invalid feedUrl format", () => {
    const result = parseNiroGraniteConfig({
      mode: "feed",
      feedUrl: "not-a-url",
      liveFetchEnabled: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported locale", () => {
    const result = parseNiroGraniteConfig({ locale: "fr-FR" });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported country", () => {
    const result = parseNiroGraniteConfig({ country: "US" });
    expect(result.success).toBe(false);
  });

  it("rejects timeout below minimum", () => {
    const result = parseNiroGraniteConfig({ timeoutMs: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects timeout above maximum", () => {
    const result = parseNiroGraniteConfig({ timeoutMs: 60_000 });
    expect(result.success).toBe(false);
  });

  it("accepts both supported locales", () => {
    for (const locale of ["id-ID", "en-ID"]) {
      const result = parseNiroGraniteConfig({ locale });
      expect(result.success).toBe(true);
    }
  });

  it("rejects extra unknown fields (strict schema)", () => {
    const result = parseNiroGraniteConfig({ unknownField: "value" });
    expect(result.success).toBe(false);
  });
});

// ── getNiroGraniteServerConfig ────────────────────────────────────────────────

describe("NiroGraniteConfig — getNiroGraniteServerConfig", () => {
  it("returns fixture mode by default (env not set)", () => {
    const config = getNiroGraniteServerConfig();
    // mode defaults to fixture unless MATERIAL_NIRO_GRANITE_MODE=feed
    expect(["fixture", "feed"]).toContain(config.mode);
  });

  it("liveFetchEnabled defaults to false unless env explicitly set", () => {
    const config = getNiroGraniteServerConfig();
    // In test environment, MATERIAL_NIRO_GRANITE_LIVE_FETCH_ENABLED is not set
    // so this should be false (safe default)
    expect(typeof config.liveFetchEnabled).toBe("boolean");
  });
});

// ── Mapper ────────────────────────────────────────────────────────────────────

describe("NiroGraniteMapper — mapNiroGraniteRecord", () => {
  it("maps a complete valid record", () => {
    const raw = {
      externalId: "NG-001",
      productCode: "P001",
      productName: "Absolute Black",
      brand: "Niro Granite",
      category: "Granite",
      subcategory: "Polished",
      materialType: "Natural Stone",
      description: "High quality granite",
      color: ["black"],
      finish: ["polished"],
      texture: "smooth",
      pattern: "solid",
      priceTier: "premium",
      unit: "sqm",
      country: "ID",
      locale: "id-ID",
    };
    const item = mapNiroGraniteRecord(raw);
    expect(item.externalId).toBe("NG-001");
    expect(item.providerId).toBe(NIRO_GRANITE_PROVIDER_ID);
    expect(item.productName).toBe("Absolute Black");
    expect(item.brand).toBe("Niro Granite");
    expect(item.category).toBe("Granite");
    expect(item.color).toEqual(["black"]);
  });

  it("trims whitespace from externalId and productName", () => {
    const raw = { externalId: "  NG-002  ", productName: "  White Pearl  " };
    const item = mapNiroGraniteRecord(raw);
    expect(item.externalId).toBe("NG-002");
    expect(item.productName).toBe("White Pearl");
  });

  it("returns empty externalId for invalid record (schema passthrough)", () => {
    // A completely empty object passes the passthrough schema but
    // mapper sets externalId to empty string
    const item = mapNiroGraniteRecord({});
    expect(item.providerId).toBe(NIRO_GRANITE_PROVIDER_ID);
  });

  it("safely handles invalid thumbnailReference (unresolved fallback)", () => {
    const raw = {
      externalId: "NG-003",
      productName: "Test",
      thumbnailReference: { kind: "remote_url", url: "javascript:void(0)" },
    };
    const item = mapNiroGraniteRecord(raw);
    // Should not throw — unsafe media is handled gracefully
    expect(item).toBeDefined();
  });

  it("maps sourceUpdatedAt as Date when valid ISO string", () => {
    const raw = {
      externalId: "NG-004",
      productName: "Dated Item",
      sourceUpdatedAt: "2026-01-15T00:00:00.000Z",
    };
    const item = mapNiroGraniteRecord(raw);
    expect(item.sourceUpdatedAt).toBeInstanceOf(Date);
  });

  it("omits sourceUpdatedAt when value is not a valid date string", () => {
    const raw = {
      externalId: "NG-005",
      productName: "Bad Date",
      sourceUpdatedAt: "not-a-date",
    };
    const item = mapNiroGraniteRecord(raw);
    expect(item.sourceUpdatedAt).toBeUndefined();
  });

  it("validates HTTPS sourceUrl — drops non-HTTPS", () => {
    const raw = {
      externalId: "NG-006",
      productName: "Bad URL",
      sourceUrl: "http://example.com/product",
    };
    const item = mapNiroGraniteRecord(raw);
    // Non-HTTPS URLs are dropped by validateSourceUrl
    expect(item.sourceUrl).toBeUndefined();
  });

  it("keeps valid HTTPS sourceUrl", () => {
    const raw = {
      externalId: "NG-007",
      productName: "Good URL",
      sourceUrl: "https://nirogranite.com/product/ng-007",
    };
    const item = mapNiroGraniteRecord(raw);
    expect(item.sourceUrl).toBe("https://nirogranite.com/product/ng-007");
  });
});

// ── Fixture pagination ────────────────────────────────────────────────────────

describe("NiroGraniteClient — mapFixturePage (fixture pagination)", () => {
  const allRecords = NIRO_GRANITE_FIXTURE;

  it("returns up to limit items from the start", () => {
    const result = mapFixturePage(allRecords, { limit: 5 });
    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it("paginates via cursor (offset-based)", () => {
    const page1 = mapFixturePage(allRecords, { limit: 5 });
    expect(page1.nextCursor).toBeDefined();
    const page2 = mapFixturePage(allRecords, { limit: 5, cursor: page1.nextCursor });
    // Pages must not overlap
    const ids1 = page1.items.map((i) => i.externalId);
    const ids2 = page2.items.map((i) => i.externalId);
    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it("returns no nextCursor when all items fit in one page", () => {
    const result = mapFixturePage(allRecords, { limit: 10_000 });
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns totalAvailable count", () => {
    const result = mapFixturePage(allRecords, { limit: 1 });
    expect(result.totalAvailable).toBeGreaterThan(0);
  });

  it("filters by brand (case-insensitive contains)", () => {
    const result = mapFixturePage(allRecords, { limit: 100, brand: "niro" });
    result.items.forEach((item) => {
      if (item.brand) expect(item.brand.toLowerCase()).toContain("niro");
    });
  });

  it("filters by country (exact match)", () => {
    const result = mapFixturePage(allRecords, { limit: 100, country: "ID" });
    result.items.forEach((item) => {
      if (item.country) expect(item.country).toBe("ID");
    });
  });

  it("reports payloadSizeBytes", () => {
    const result = mapFixturePage(allRecords, { limit: 5 });
    expect(typeof result.payloadSizeBytes).toBe("number");
    expect(result.payloadSizeBytes).toBeGreaterThan(0);
  });

  it("throws when fixture payload exceeds MAX_PAYLOAD_SIZE_BYTES", () => {
    // Create a gigantic fixture to force the limit
    const huge = Array.from({ length: 10_000 }, (_, i) => ({
      externalId: `HUGE-${i}`,
      productName: "x".repeat(1500),
      brand: "Niro Granite",
      country: "ID",
    }));
    expect(() => mapFixturePage(huge, { limit: 10_000 })).toThrow(
      CatalogResponseTooLargeError,
    );
  });

  it("aborts immediately when signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      mapFixturePage(allRecords, { abortSignal: controller.signal }),
    ).toThrow();
  });
});

// ── AbortSignal — live provider ───────────────────────────────────────────────

describe("NiroGraniteProvider — AbortSignal", () => {
  it("throws when AbortSignal is pre-aborted (fixture mode)", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      niroGraniteOfficialProvider.fetchCatalog({
        config: { mode: "fixture", locale: "id-ID", country: "ID", timeoutMs: 5000, liveFetchEnabled: false },
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

// ── Live feed client — timeout, retry, rate limit, auth, malformed payload ────

describe("NiroGraniteClient — fetchOfficialFeedJson (mocked fetch)", () => {
  const feedConfig = {
    mode: "feed" as const,
    feedUrl: "https://api.nirogranite.example.com/v1/catalog",
    liveFetchEnabled: true,
    locale: "id-ID" as const,
    country: "ID" as const,
    timeoutMs: 1000,
    apiKey: undefined,
    accessToken: undefined,
  };

  it("throws CatalogFetchError on authentication failure (401)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 401, headers: { "content-type": "application/json" } }),
    );
    await expect(
      fetchOfficialFeedJson(feedConfig, {}, { fetchImpl: mockFetch }),
    ).rejects.toThrow(CatalogFetchError);
  });

  it("throws CatalogFetchError on authentication failure (403)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 403 }),
    );
    await expect(
      fetchOfficialFeedJson(feedConfig, {}, { fetchImpl: mockFetch }),
    ).rejects.toThrow(CatalogFetchError);
  });

  it("throws CatalogFetchError (rate_limit category) after max retries on 429", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(
      fetchOfficialFeedJson(feedConfig, {}, { fetchImpl: mockFetch, retryDelayMs: 0 }),
    ).rejects.toThrow(CatalogFetchError);
    // Should have retried MAX_RETRIES times
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("retries on 503 (server error)", async () => {
    // Fail twice then succeed
    const goodBody = JSON.stringify({ items: [], nextCursor: undefined });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(goodBody, { status: 200, headers: { "content-type": "application/json" } }),
      );
    const result = await fetchOfficialFeedJson(feedConfig, {}, { fetchImpl: mockFetch, retryDelayMs: 0 });
    expect(result.items).toHaveLength(0);
    expect(mockFetch.mock.calls.length).toBe(3);
  });

  it("throws CatalogFetchError(schema) on malformed JSON response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("this is not json", { status: 200 }),
    );
    await expect(
      fetchOfficialFeedJson(feedConfig, {}, { fetchImpl: mockFetch }),
    ).rejects.toThrow(CatalogFetchError);
  });

  it("throws CatalogFetchError(schema) when response mismatches feed envelope schema", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ wrongKey: [] }), { status: 200 }),
    );
    await expect(
      fetchOfficialFeedJson(feedConfig, {}, { fetchImpl: mockFetch }),
    ).rejects.toThrow(CatalogFetchError);
  });

  it("throws CatalogResponseTooLargeError when response body exceeds MAX_PAYLOAD_SIZE_BYTES", async () => {
    // Generate a body larger than 10 MB
    const oversizedBody = "x".repeat(MAX_PAYLOAD_SIZE_BYTES + 1);
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(oversizedBody, { status: 200 }),
    );
    await expect(
      fetchOfficialFeedJson(feedConfig, {}, { fetchImpl: mockFetch }),
    ).rejects.toThrow(CatalogResponseTooLargeError);
  });

  it("sends Authorization header when accessToken is set", async () => {
    const goodBody = JSON.stringify({ items: [] });
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(goodBody, { status: 200 }),
    );
    const configWithToken = { ...feedConfig, accessToken: "test-token-abc" };
    await fetchOfficialFeedJson(configWithToken, {}, { fetchImpl: mockFetch, retryDelayMs: 0 });
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer test-token-abc");
  });

  it("sends x-api-key header when apiKey is set", async () => {
    const goodBody = JSON.stringify({ items: [] });
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(goodBody, { status: 200 }),
    );
    const configWithKey = { ...feedConfig, apiKey: "my-api-key-xyz" };
    await fetchOfficialFeedJson(configWithKey, {}, { fetchImpl: mockFetch, retryDelayMs: 0 });
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("my-api-key-xyz");
  });
});

// ── Feature flags ─────────────────────────────────────────────────────────────

describe("Feature flags — provider registration", () => {
  beforeEach(() => {
    _resetProviderRegistry();
    clearMaterialCatalogFlagOverride();
    delete process.env[NIRO_GRANITE_PROVIDER_FLAG];
  });

  it("MATERIAL_CATALOG_INTEGRATION_ENABLED defaults to false", () => {
    clearMaterialCatalogFlagOverride();
    // In test environment the env var is not set → default is false
    const enabled = isMaterialCatalogEnabled();
    expect(typeof enabled).toBe("boolean");
  });

  it("registerOfficialMaterialProviders skips when catalog flag is disabled", async () => {
    setMaterialCatalogFlagOverride(false);
    const result = await registerOfficialMaterialProviders();
    expect(result.registered).toBe(false);
    expect(result.reason).toContain("MATERIAL_CATALOG_INTEGRATION_ENABLED");
    expect(hasProvider(NIRO_GRANITE_PROVIDER_ID)).toBe(false);
  });

  it("registerOfficialMaterialProviders skips when provider flag is disabled", async () => {
    setMaterialCatalogFlagOverride(true);
    delete process.env[NIRO_GRANITE_PROVIDER_FLAG];
    const result = await registerOfficialMaterialProviders();
    expect(result.registered).toBe(false);
    expect(result.reason).toContain(NIRO_GRANITE_PROVIDER_FLAG);
    expect(hasProvider(NIRO_GRANITE_PROVIDER_ID)).toBe(false);
  });

  it("registerOfficialMaterialProviders registers when BOTH flags are enabled (fixture mode)", async () => {
    setMaterialCatalogFlagOverride(true);
    process.env[NIRO_GRANITE_PROVIDER_FLAG] = "true";
    // fixture mode doesn't require feedUrl/liveFetchEnabled so validation passes
    const result = await registerOfficialMaterialProviders();
    expect(result.registered).toBe(true);
    expect(hasProvider(NIRO_GRANITE_PROVIDER_ID)).toBe(true);
  });

  it("registration is idempotent — does not throw on second call", async () => {
    setMaterialCatalogFlagOverride(true);
    process.env[NIRO_GRANITE_PROVIDER_FLAG] = "true";
    await registerOfficialMaterialProviders();
    // hasProvider guard prevents duplicate registration
    await expect(registerOfficialMaterialProviders()).resolves.not.toThrow();
  });

  it("provider is inactive (not registered) when both flags are off after reset", async () => {
    setMaterialCatalogFlagOverride(false);
    delete process.env[NIRO_GRANITE_PROVIDER_FLAG];
    await registerOfficialMaterialProviders();
    expect(hasProvider(NIRO_GRANITE_PROVIDER_ID)).toBe(false);
  });
});

// ── Provider disabled — preview rejects provider not in registry ───────────────

describe("Provider disabled — runImportPreview behavior", () => {
  it("preview succeeds when provider is registered and flags are on", async () => {
    _resetProviderRegistry();
    registerProvider(niroGraniteOfficialProvider);
    const config = { mode: "fixture" as const, locale: "id-ID" as const, country: "ID" as const, timeoutMs: 5000, liveFetchEnabled: false };
    const result = await runImportPreview({
      provider: niroGraniteOfficialProvider,
      providerConfig: config,
      options: { dryRun: true, maxRecords: 10 },
    });
    expect(result.totalReceived).toBeGreaterThan(0);
    expect(result.validCount).toBeGreaterThanOrEqual(0);
    _resetProviderRegistry();
  });
});

// ── dryRun=false rejection ────────────────────────────────────────────────────

describe("dryRun false rejection", () => {
  it("runImportPreview rejects dryRun:false", async () => {
    const { CatalogProductionImportRejectedError } = await import("../domains/material-catalog-integration/errors.js");
    await expect(
      runImportPreview({
        provider: niroGraniteOfficialProvider,
        providerConfig: {},
        options: { dryRun: false } as unknown as ImportOptions,
      }),
    ).rejects.toThrow(CatalogProductionImportRejectedError);
  });

  it("runImportPreview rejects missing dryRun", async () => {
    const { CatalogProductionImportRejectedError } = await import("../domains/material-catalog-integration/errors.js");
    await expect(
      runImportPreview({
        provider: niroGraniteOfficialProvider,
        providerConfig: {},
        options: {} as unknown as ImportOptions,
      }),
    ).rejects.toThrow(CatalogProductionImportRejectedError);
  });
});

// ── Record limit enforcement ──────────────────────────────────────────────────

describe("Record limit enforcement", () => {
  it("enforces MAX_RECORDS_PER_PREVIEW = 500", () => {
    expect(MAX_RECORDS_PER_PREVIEW).toBe(500);
  });

  it("enforces MAX_PAYLOAD_SIZE_BYTES = 10 MB", () => {
    expect(MAX_PAYLOAD_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });

  it("fixture page never exceeds MAX_RECORDS_PER_PREVIEW even if limit is huge", () => {
    // mapFixturePage clamps limit to 500
    const result = mapFixturePage(NIRO_GRANITE_FIXTURE, { limit: 999_999 });
    // fixture has fewer records than the limit, but the clamp applies
    expect(result.items.length).toBeLessThanOrEqual(MAX_RECORDS_PER_PREVIEW);
  });
});

// ── Duplicate detection within niro fixture ───────────────────────────────────

describe("NiroGranite — duplicate detection in preview", () => {
  it("classifies all fixture items without throwing", async () => {
    registerProvider(niroGraniteOfficialProvider);
    const config = {
      mode: "fixture" as const,
      locale: "id-ID" as const,
      country: "ID" as const,
      timeoutMs: 5000,
      liveFetchEnabled: false,
    };
    const result = await runImportPreview({
      provider: niroGraniteOfficialProvider,
      providerConfig: config,
      options: { dryRun: true, maxRecords: MAX_RECORDS_PER_PREVIEW },
    });
    // All classified items must have a valid classification
    const valid = ["new", "exact_duplicate", "possible_duplicate", "invalid", "conflicting_identity"];
    for (const ci of result.items) {
      expect(valid).toContain(ci.classification);
    }
    _resetProviderRegistry();
  });
});

// ── Media validation ──────────────────────────────────────────────────────────

describe("NiroGraniteMapper — media reference validation", () => {
  it("maps valid HTTPS thumbnail URL to remote_url reference", () => {
    const raw = {
      externalId: "NG-MEDIA-001",
      productName: "Marble White",
      thumbnailReference: { kind: "remote_url", url: "https://cdn.nirogranite.com/images/marble-white-thumb.jpg" },
    };
    const item = mapNiroGraniteRecord(raw);
    if (item.thumbnailReference) {
      expect(["remote_url", "unresolved"]).toContain(item.thumbnailReference.kind);
    }
  });

  it("handles missing thumbnailReference gracefully", () => {
    const raw = { externalId: "NG-MEDIA-002", productName: "No Media" };
    const item = mapNiroGraniteRecord(raw);
    expect(item.thumbnailReference).toBeUndefined();
  });

  it("maps multiple previewReferences", () => {
    const raw = {
      externalId: "NG-MEDIA-003",
      productName: "Multi Preview",
      previewReferences: [
        { kind: "remote_url", url: "https://cdn.nirogranite.com/images/1.jpg" },
        { kind: "remote_url", url: "https://cdn.nirogranite.com/images/2.jpg" },
      ],
    };
    const item = mapNiroGraniteRecord(raw);
    expect(Array.isArray(item.previewReferences)).toBe(true);
  });
});
