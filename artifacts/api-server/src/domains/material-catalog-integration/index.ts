/**
 * Phase 3 — Material Catalog Integration: public API.
 *
 * This module exposes only read/query operations. It intentionally does NOT
 * export any HTTP router, route-mounting helper, DB write function, or
 * background-job starter. Phase 3 remains foundation-only; those surfaces will
 * be added in a later phase behind the same feature flag.
 */

export { isCatalogIntegrationEnabled } from "./featureFlag.js";
export { registerProvider, getProvider, listProviders, clearRegistry } from "./providerRegistry.js";
export { normalizeCatalogEntry, slugFromName } from "./normalizer.js";
export {
  fetchCatalogPage,
  fetchNormalizedCatalogPage,
  listAvailableProviders,
  getIntegrationStatus,
  resetIntegrationState,
} from "./catalogIntegrationService.js";
export type {
  CatalogEntry,
  CatalogPage,
  CatalogProvider,
  ProviderHealthStatus,
  IntegrationStatus,
  NormalizedCatalogEntry,
} from "./types.js";
