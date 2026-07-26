/**
 * Material Catalog Integration — Phase 3 Foundation
 * Feature flag: MATERIAL_CATALOG_INTEGRATION_ENABLED
 *
 * Default is FALSE — the feature is inactive in production until explicitly enabled.
 * Pattern mirrors artifacts/api-server/src/domains/design-plugins/featureFlags.ts
 */

const FLAG_NAME = "MATERIAL_CATALOG_INTEGRATION_ENABLED";

// In-process overrides — used in tests and at startup.
let _override: boolean | undefined = undefined;

/**
 * Override the flag value in-process (for tests or programmatic control).
 * Pass `undefined` to clear the override and resume env-var lookup.
 */
export function setMaterialCatalogFlagOverride(value: boolean | undefined): void {
  _override = value;
}

/** Clear the in-process override (useful in test afterEach). */
export function clearMaterialCatalogFlagOverride(): void {
  _override = undefined;
}

/**
 * Resolve whether the material catalog integration feature is enabled.
 *
 * Resolution order:
 *   1. In-process override (tests / programmatic control)
 *   2. MATERIAL_CATALOG_INTEGRATION_ENABLED env var ("true" → true, anything else → false)
 *   3. Default: FALSE (feature is opt-in, never auto-activated)
 */
export function isMaterialCatalogEnabled(): boolean {
  if (_override !== undefined) return _override;
  const raw = process.env[FLAG_NAME];
  if (raw === undefined) return false; // default: disabled
  return raw.toLowerCase() === "true";
}
