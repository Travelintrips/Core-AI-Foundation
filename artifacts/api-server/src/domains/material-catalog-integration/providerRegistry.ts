/**
 * Material Catalog Integration — Phase 3 Foundation
 * In-process provider registry with deterministic ordering.
 *
 * Supports dependency injection — no providers are hard-coded here.
 * All production providers must be registered explicitly at startup
 * (Phase 3: only mock provider is used; registry remains empty by default).
 */

import type { MaterialCatalogProvider } from "./catalogProvider.js";
import type { CatalogProviderCapabilities } from "./types.js";
import {
  CatalogDuplicateProviderError,
  CatalogProviderNotFoundError,
} from "./errors.js";
import { logger } from "../../lib/logger.js";

interface RegistryEntry {
  readonly provider: MaterialCatalogProvider;
  readonly enabled: boolean;
  readonly registeredAt: Date;
}

// Singleton in-process registry (Node.js single-threaded — Map is safe).
const registry = new Map<string, RegistryEntry>();

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a provider.
 * @throws {CatalogDuplicateProviderError} if the provider ID is already registered.
 */
export function registerProvider(provider: MaterialCatalogProvider): void {
  if (registry.has(provider.providerId)) {
    throw new CatalogDuplicateProviderError(provider.providerId);
  }
  registry.set(provider.providerId, {
    provider,
    enabled: true,
    registeredAt: new Date(),
  });
  logger.info(
    { providerId: provider.providerId, sourceType: provider.sourceType },
    "[material-catalog] Provider registered",
  );
}

/**
 * Unregister a provider by ID (used in test lifecycle and runtime teardown).
 * Silent no-op if the provider was not registered.
 */
export function unregisterProvider(providerId: string): void {
  const removed = registry.delete(providerId);
  if (removed) {
    logger.info({ providerId }, "[material-catalog] Provider unregistered");
  }
}

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Get a registered provider by ID.
 * @throws {CatalogProviderNotFoundError} if not found.
 */
export function getProvider(providerId: string): MaterialCatalogProvider {
  const entry = registry.get(providerId);
  if (!entry) throw new CatalogProviderNotFoundError(providerId);
  return entry.provider;
}

/**
 * List all registered providers in deterministic order (registration order).
 * Optionally filter by enabled state.
 */
export function listProviders(options?: { enabledOnly?: boolean }): MaterialCatalogProvider[] {
  const entries = Array.from(registry.values());
  const filtered = options?.enabledOnly
    ? entries.filter((e) => e.enabled)
    : entries;
  return filtered.map((e) => e.provider);
}

/**
 * List providers that declare support for a given capability.
 * Capability is matched against the provider's `getCapabilities()` return value.
 */
export function listProvidersByCapability(
  capability: keyof CatalogProviderCapabilities,
  value: boolean | string,
): MaterialCatalogProvider[] {
  return listProviders({ enabledOnly: true }).filter((p) => {
    const caps = p.getCapabilities();
    return caps[capability] === value;
  });
}

/**
 * Enable a previously disabled provider.
 * @throws {CatalogProviderNotFoundError} if not registered.
 */
export function enableProvider(providerId: string): void {
  const entry = registry.get(providerId);
  if (!entry) throw new CatalogProviderNotFoundError(providerId);
  registry.set(providerId, { ...entry, enabled: true });
}

/**
 * Disable a registered provider without removing it.
 * @throws {CatalogProviderNotFoundError} if not registered.
 */
export function disableProvider(providerId: string): void {
  const entry = registry.get(providerId);
  if (!entry) throw new CatalogProviderNotFoundError(providerId);
  registry.set(providerId, { ...entry, enabled: false });
}

/** Whether a provider ID is currently registered. */
export function hasProvider(providerId: string): boolean {
  return registry.has(providerId);
}

/** Count of registered providers. */
export function providerCount(): number {
  return registry.size;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Clear all providers. Only for use in tests (vitest beforeEach / afterEach). */
export function _resetProviderRegistry(): void {
  registry.clear();
}
