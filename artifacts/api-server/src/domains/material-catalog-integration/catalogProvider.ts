/**
 * Material Catalog Integration — Phase 3 Foundation
 * Provider contract interface. Vendor-independent.
 */

import type {
  CatalogFetchContext,
  CatalogProviderCapabilities,
  CatalogProviderValidationResult,
  ExternalCatalogResult,
} from "./types.js";

export type CatalogSourceType =
  | "official_api"
  | "official_feed"
  | "manual_fixture";

/**
 * Contract every catalog provider must satisfy.
 * No specific vendor, website, or network protocol is assumed.
 */
export interface MaterialCatalogProvider {
  /** Stable, unique identifier for this provider. Must be kebab-case. */
  readonly providerId: string;
  readonly displayName: string;
  readonly sourceType: CatalogSourceType;

  /** Declare what this provider supports without making network calls. */
  getCapabilities(): CatalogProviderCapabilities;

  /**
   * Validate provider-specific configuration.
   * Must not make network calls.
   * Must not log secrets.
   */
  validateConfig(config: unknown): Promise<CatalogProviderValidationResult>;

  /**
   * Fetch a page of catalog items from the source.
   * Phase 3: only the mock fixture provider is permitted — no live network calls.
   */
  fetchCatalog(context: CatalogFetchContext): Promise<ExternalCatalogResult>;
}
