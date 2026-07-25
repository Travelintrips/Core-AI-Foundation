/**
 * Phase 3 — Material Catalog Integration: shared type definitions.
 *
 * These types define the contract between the integration layer and external
 * catalog providers. They are deliberately separate from the Phase 1 DB schema
 * so that the integration layer never writes directly to the canonical
 * materials table — all persistence goes through the normal admin seeding flow.
 *
 * Feature flag: MATERIAL_CATALOG_INTEGRATION_ENABLED=false (default)
 * While the flag is off, no provider methods are called and no data leaves the
 * process boundary.
 */

import type { MaterialRecord } from "../material-library/types.js";

// ── External catalog entry (raw from provider) ────────────────────────────────

export interface CatalogEntry {
  /** Provider-assigned unique identifier for this item. */
  externalId: string;
  /** Provider id that supplied this entry (set by the registry on ingest). */
  source: string;
  name: string;
  category: string;
  subcategory?: string;
  brand?: string;
  materialType?: string;
  finish?: string;
  color?: string;
  texture?: string;
  pattern?: string;
  description?: string;
  priceTier?: string;
  thumbnailUrl?: string;
  searchKeywords?: string[];
  /** Raw metadata bag from the provider — never written to the canonical table. */
  providerMetadata?: Record<string, unknown>;
}

// ── Paginated response from a provider ───────────────────────────────────────

export interface CatalogPage {
  entries: CatalogEntry[];
  /** Total number of entries available from this provider (all pages). */
  total: number;
  pageNumber: number;
  pageSize: number;
}

// ── Provider health status ────────────────────────────────────────────────────

export interface ProviderHealthStatus {
  providerId: string;
  status: "online" | "offline" | "degraded";
  lastCheckedAt: Date;
  latencyMs?: number;
  error?: string;
}

// ── Provider contract ─────────────────────────────────────────────────────────

/**
 * All external catalog providers must implement this interface.
 *
 * IMPORTANT: implementations are ONLY allowed to make network requests when
 * MATERIAL_CATALOG_INTEGRATION_ENABLED=true. The integration service enforces
 * the feature-flag guard before calling any provider method.
 */
export interface CatalogProvider {
  readonly providerId: string;
  fetchPage(page: number, pageSize: number): Promise<CatalogPage>;
  healthCheck(): Promise<ProviderHealthStatus>;
}

// ── Integration status (operational snapshot) ─────────────────────────────────

export interface IntegrationStatus {
  enabled: boolean;
  providerCount: number;
  registeredProviders: string[];
}

// ── Normalized output ─────────────────────────────────────────────────────────

/** A catalog entry after normalization to the canonical MaterialRecord shape. */
export type NormalizedCatalogEntry = Omit<MaterialRecord, "id">;
