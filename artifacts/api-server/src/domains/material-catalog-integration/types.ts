/**
 * Material Catalog Integration — Phase 3 Foundation
 * Core TypeScript types (decoupled from canonical materials table).
 *
 * ⚠️  PHASE 3 ONLY — no writes to canonical materials, no external network calls.
 */

// ── Media references ──────────────────────────────────────────────────────────

export type MediaReferenceKind =
  | "remote_url"
  | "provider_asset_id"
  | "local_fixture"
  | "unresolved";

export interface MediaReference {
  readonly kind: MediaReferenceKind;
  /** Validated HTTPS URL — only set when kind === "remote_url" */
  readonly url?: string;
  /** Opaque asset ID from the provider — only set when kind === "provider_asset_id" */
  readonly assetId?: string;
  /** Relative path for fixture data — only set when kind === "local_fixture" */
  readonly fixturePath?: string;
  /** Original raw value that could not be resolved */
  readonly rawValue?: string;
}

// ── External catalog DTO ──────────────────────────────────────────────────────

export interface ExternalCatalogItem {
  /** Unique ID within the provider's catalog */
  readonly externalId: string;
  readonly providerId: string;
  readonly sourceUrl?: string;
  readonly brand?: string;
  readonly productCode?: string;
  readonly productName: string;
  readonly category?: string;
  readonly subcategory?: string;
  readonly materialType?: string;
  readonly description?: string;
  readonly color?: string[];
  readonly finish?: string[];
  readonly texture?: string;
  readonly pattern?: string;
  readonly priceTier?: string;
  readonly unit?: string;
  readonly dimensions?: Record<string, unknown>;
  readonly technicalData?: Record<string, unknown>;
  readonly certifications?: string[];
  readonly thumbnailReference?: MediaReference;
  readonly previewReferences?: MediaReference[];
  readonly country?: string;
  readonly locale?: string;
  readonly sourceUpdatedAt?: Date;
  readonly sourceMetadata?: Record<string, unknown>;
}

// ── Provider capabilities ─────────────────────────────────────────────────────

export interface CatalogProviderCapabilities {
  readonly supportedBrands: string[];
  readonly supportedCountries: string[];
  readonly supportsPagination: boolean;
  readonly supportsFiltering: boolean;
  readonly maxItemsPerFetch: number;
  readonly requiresCredentials: boolean;
}

// ── Provider I/O ──────────────────────────────────────────────────────────────

export interface CatalogFetchContext {
  readonly cursor?: string;
  readonly limit?: number;
  readonly brand?: string;
  readonly country?: string;
  readonly abortSignal?: AbortSignal;
  /** Provider-specific server-side configuration, never supplied by callers. */
  readonly config?: unknown;
}

export interface ExternalCatalogResult {
  readonly items: ExternalCatalogItem[];
  readonly nextCursor?: string;
  readonly totalAvailable?: number;
  readonly sourceMetadata?: Record<string, unknown>;
  readonly fetchedAt: Date;
  /** Serialized response size when known, used for pre-normalization limits. */
  readonly payloadSizeBytes?: number;
}

export interface CatalogProviderValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

// ── Duplicate detection ───────────────────────────────────────────────────────

export type DuplicateClassification =
  | "new"
  | "exact_duplicate"
  | "possible_duplicate"
  | "invalid"
  | "conflicting_identity";

export interface DuplicateCheckResult {
  readonly externalId: string;
  readonly classification: DuplicateClassification;
  readonly matchedKey?: string;
  readonly reason?: string;
}

// ── Import options ────────────────────────────────────────────────────────────

export interface ImportOptions {
  /** Must always be true in Phase 3 — production writes are rejected. */
  readonly dryRun: true;
  readonly maxRecords?: number;
  readonly cursor?: string;
  readonly brand?: string;
  readonly country?: string;
}

// ── Normalization ─────────────────────────────────────────────────────────────

export interface NormalizationResult {
  readonly item: ExternalCatalogItem;
  readonly warnings: string[];
}

// ── Import preview result ─────────────────────────────────────────────────────

export interface ClassifiedItem {
  readonly item: ExternalCatalogItem;
  readonly classification: DuplicateClassification;
  readonly normalizationWarnings: string[];
}

export interface ImportPreviewResult {
  readonly totalReceived: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly newCount: number;
  readonly exactDuplicateCount: number;
  readonly possibleDuplicateCount: number;
  readonly warnings: string[];
  readonly errors: string[];
  readonly items: ClassifiedItem[];
  readonly nextCursor?: string;
  readonly sourceMetadata?: Record<string, unknown>;
  readonly payloadSizeBytes?: number;
  readonly executionDurationMs: number;
}

// ── Import report ─────────────────────────────────────────────────────────────

export type ImportReportStatus =
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "rejected";

export interface ImportReportCounts {
  readonly totalReceived: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly newCount: number;
  readonly exactDuplicateCount: number;
  readonly possibleDuplicateCount: number;
}

export interface ImportReport {
  readonly runId: string;
  readonly providerId: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly status: ImportReportStatus;
  readonly counts: ImportReportCounts;
  readonly warnings: string[];
  readonly validationErrors: string[];
  readonly providerErrors: string[];
  readonly previewSummary: string;
  readonly items: ClassifiedItem[];
  readonly nextCursor?: string;
  readonly payloadSizeBytes?: number;
  readonly sourceMetadata?: Record<string, unknown>;
}
