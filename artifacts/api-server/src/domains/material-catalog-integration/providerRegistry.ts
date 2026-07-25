/**
 * Phase 3 — Material Catalog Integration: provider registry.
 *
 * Holds references to registered CatalogProvider instances. The registry is
 * in-memory and starts empty. At production startup, NO providers are
 * registered — Phase 3 is foundation-only and the feature flag defaults to
 * false. Providers may be registered in tests via registerProvider().
 */

import type { CatalogProvider } from "./types.js";

const registry = new Map<string, CatalogProvider>();

/**
 * Register a catalog provider under the given id.
 * If a provider with the same id already exists it is replaced.
 */
export function registerProvider(id: string, provider: CatalogProvider): void {
  registry.set(id, provider);
}

/** Return the provider registered under id, or undefined if not found. */
export function getProvider(id: string): CatalogProvider | undefined {
  return registry.get(id);
}

/** Return the ids of all registered providers, sorted alphabetically. */
export function listProviders(): string[] {
  return [...registry.keys()].sort();
}

/** Remove all registered providers. Used by tests to reset state. */
export function clearRegistry(): void {
  registry.clear();
}
