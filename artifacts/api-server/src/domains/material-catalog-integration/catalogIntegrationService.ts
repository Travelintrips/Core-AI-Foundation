/**
 * Phase 3 — Material Catalog Integration: service layer.
 *
 * Every public function in this module checks isCatalogIntegrationEnabled()
 * before touching a provider. When the flag is off the functions return
 * safe empty/stub values — no network requests, no database writes, no side
 * effects of any kind.
 *
 * Production startup does NOT call any function here and does NOT register any
 * provider. Phase 3 is foundation-only until the feature flag is enabled.
 */

import { isCatalogIntegrationEnabled } from "./featureFlag.js";
import { getProvider, listProviders, clearRegistry } from "./providerRegistry.js";
import { normalizeCatalogEntry } from "./normalizer.js";
import type { CatalogPage, IntegrationStatus, NormalizedCatalogEntry } from "./types.js";

// ── Read operations (all guarded by feature flag) ─────────────────────────────

/**
 * Fetch one page of raw catalog entries from a provider.
 * Returns an empty page when the integration is disabled or the provider is
 * not registered — no error is thrown so callers remain simple.
 */
export async function fetchCatalogPage(
  providerId: string,
  page = 1,
  pageSize = 50,
): Promise<CatalogPage> {
  if (!isCatalogIntegrationEnabled()) {
    return { entries: [], total: 0, pageNumber: 1, pageSize: 0 };
  }
  const provider = getProvider(providerId);
  if (!provider) {
    return { entries: [], total: 0, pageNumber: page, pageSize };
  }
  return provider.fetchPage(page, pageSize);
}

/**
 * Fetch one page and normalize entries to the canonical MaterialRecord shape.
 * Returns an empty result when the integration is disabled.
 * The normalized entries are NOT written to the database by this function.
 */
export async function fetchNormalizedCatalogPage(
  providerId: string,
  page = 1,
  pageSize = 50,
): Promise<{ items: NormalizedCatalogEntry[]; total: number }> {
  if (!isCatalogIntegrationEnabled()) {
    return { items: [], total: 0 };
  }
  const catalogPage = await fetchCatalogPage(providerId, page, pageSize);
  return {
    items: catalogPage.entries.map((entry) => normalizeCatalogEntry(entry)),
    total: catalogPage.total,
  };
}

/**
 * Return the list of registered provider ids.
 * Returns an empty array when the integration is disabled.
 */
export function listAvailableProviders(): string[] {
  if (!isCatalogIntegrationEnabled()) return [];
  return listProviders();
}

/**
 * Return an operational snapshot of the integration layer.
 * Safe to call at any time — never makes a network request.
 */
export function getIntegrationStatus(): IntegrationStatus {
  const enabled = isCatalogIntegrationEnabled();
  const registeredProviders = enabled ? listProviders() : [];
  return {
    enabled,
    providerCount: registeredProviders.length,
    registeredProviders,
  };
}

// ── Test helpers (never called in production) ─────────────────────────────────

/**
 * Reset the provider registry. Intended for use in tests only.
 * Call after each test that registers a provider.
 */
export function resetIntegrationState(): void {
  clearRegistry();
}
