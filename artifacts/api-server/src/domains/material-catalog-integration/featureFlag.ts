/**
 * Phase 3 — Material Catalog Integration: feature flag.
 *
 * The integration layer is disabled by default. Set
 *   MATERIAL_CATALOG_INTEGRATION_ENABLED=true
 * to enable it. The flag is read from process.env on every call so that tests
 * can toggle it without restarting the process.
 *
 * IMPORTANT: This is the single authoritative guard. Every integration-layer
 * operation that could make a network request, import external data, or write
 * to the catalog must call isCatalogIntegrationEnabled() first.
 */

export function isCatalogIntegrationEnabled(): boolean {
  return process.env["MATERIAL_CATALOG_INTEGRATION_ENABLED"] === "true";
}
