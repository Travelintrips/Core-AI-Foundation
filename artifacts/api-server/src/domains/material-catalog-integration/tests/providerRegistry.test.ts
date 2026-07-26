/**
 * Material Catalog Integration — Phase 3
 * Tests: Provider Registry
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerProvider,
  unregisterProvider,
  getProvider,
  listProviders,
  listProvidersByCapability,
  enableProvider,
  disableProvider,
  hasProvider,
  providerCount,
  _resetProviderRegistry,
} from "../providerRegistry.js";
import {
  CatalogDuplicateProviderError,
  CatalogProviderNotFoundError,
} from "../errors.js";
import { mockOfficialCatalogProvider } from "../providers/mockOfficialCatalogProvider.js";
import type { MaterialCatalogProvider } from "../catalogProvider.js";
import type { CatalogFetchContext, CatalogProviderCapabilities, CatalogProviderValidationResult, ExternalCatalogResult } from "../types.js";

function makeProvider(id: string, requiresCredentials = false): MaterialCatalogProvider {
  return {
    providerId: id,
    displayName: `Test Provider ${id}`,
    sourceType: "manual_fixture",
    getCapabilities: (): CatalogProviderCapabilities => ({
      supportedBrands: ["BrandA"],
      supportedCountries: ["ID"],
      supportsPagination: true,
      supportsFiltering: false,
      maxItemsPerFetch: 100,
      requiresCredentials,
    }),
    validateConfig: async (): Promise<CatalogProviderValidationResult> => ({ valid: true, errors: [] }),
    fetchCatalog: async (_ctx: CatalogFetchContext): Promise<ExternalCatalogResult> => ({
      items: [],
      fetchedAt: new Date(),
    }),
  };
}

describe("ProviderRegistry", () => {
  beforeEach(() => {
    _resetProviderRegistry();
  });

  // Test 1 — provider registration
  it("registers a provider successfully", () => {
    registerProvider(mockOfficialCatalogProvider);
    expect(hasProvider("mock-official-catalog")).toBe(true);
  });

  // Test 2 — duplicate provider rejection
  it("throws CatalogDuplicateProviderError on duplicate ID", () => {
    registerProvider(mockOfficialCatalogProvider);
    expect(() => registerProvider(mockOfficialCatalogProvider)).toThrow(
      CatalogDuplicateProviderError,
    );
  });

  // Test 3 — provider lookup
  it("retrieves a registered provider by ID", () => {
    registerProvider(mockOfficialCatalogProvider);
    const p = getProvider("mock-official-catalog");
    expect(p.providerId).toBe("mock-official-catalog");
    expect(p.displayName).toBe("Mock Official Catalog Provider (Test Only)");
  });

  it("throws CatalogProviderNotFoundError for unknown ID", () => {
    expect(() => getProvider("does-not-exist")).toThrow(CatalogProviderNotFoundError);
  });

  // Test 4 — provider capability filtering
  it("filters providers by requiresCredentials capability", () => {
    registerProvider(makeProvider("no-cred", false));
    registerProvider(makeProvider("needs-cred", true));
    const withCred = listProvidersByCapability("requiresCredentials", true);
    const withoutCred = listProvidersByCapability("requiresCredentials", false);
    expect(withCred.map((p) => p.providerId)).toEqual(["needs-cred"]);
    expect(withoutCred.map((p) => p.providerId)).toEqual(["no-cred"]);
  });

  it("filters providers by supportsPagination capability", () => {
    registerProvider(makeProvider("paginated", false));
    const results = listProvidersByCapability("supportsPagination", true);
    expect(results.length).toBe(1);
    expect(results[0]!.providerId).toBe("paginated");
  });

  it("lists all registered providers in registration order", () => {
    registerProvider(makeProvider("alpha"));
    registerProvider(makeProvider("beta"));
    registerProvider(makeProvider("gamma"));
    const ids = listProviders().map((p) => p.providerId);
    expect(ids).toEqual(["alpha", "beta", "gamma"]);
  });

  it("enables and disables a provider", () => {
    registerProvider(makeProvider("toggle"));
    disableProvider("toggle");
    expect(listProviders({ enabledOnly: true }).map((p) => p.providerId)).not.toContain("toggle");
    enableProvider("toggle");
    expect(listProviders({ enabledOnly: true }).map((p) => p.providerId)).toContain("toggle");
  });

  it("unregisters a provider", () => {
    registerProvider(makeProvider("temp"));
    unregisterProvider("temp");
    expect(hasProvider("temp")).toBe(false);
    expect(providerCount()).toBe(0);
  });

  it("enableProvider throws for unknown provider", () => {
    expect(() => enableProvider("ghost")).toThrow(CatalogProviderNotFoundError);
  });

  it("disableProvider throws for unknown provider", () => {
    expect(() => disableProvider("ghost")).toThrow(CatalogProviderNotFoundError);
  });

  it("providerCount reflects registry size", () => {
    expect(providerCount()).toBe(0);
    registerProvider(makeProvider("a"));
    expect(providerCount()).toBe(1);
    registerProvider(makeProvider("b"));
    expect(providerCount()).toBe(2);
    unregisterProvider("a");
    expect(providerCount()).toBe(1);
  });

  it("_resetProviderRegistry clears all entries", () => {
    registerProvider(makeProvider("x"));
    registerProvider(makeProvider("y"));
    _resetProviderRegistry();
    expect(providerCount()).toBe(0);
  });

  // Test 28 — feature flag defaults to disabled (registry not auto-populated)
  it("registry starts empty — no providers hard-coded at startup", () => {
    expect(providerCount()).toBe(0);
  });
});
