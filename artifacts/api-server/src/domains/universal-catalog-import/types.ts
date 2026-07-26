/**
 * Universal Material Catalog Import Engine — Phase 4A
 * Core types for adapters, pipeline, and staging.
 *
 * HARD RULE: Nothing in this domain writes to canonical material tables.
 * All output lands in material_catalog_staging only.
 */

// ── Source types ──────────────────────────────────────────────────────────────

export type AdapterSourceType =
  | "pdf"
  | "website"
  | "csv"
  | "excel"
  | "json"
  | "xml"
  | "api";

// ── Staging statuses ──────────────────────────────────────────────────────────

export type StagingStatus =
  | "draft"
  | "extracted"
  | "normalized"
  | "duplicate"
  | "approved"
  | "rejected"
  | "needs_review";

// ── Duplicate classification (mirrors existing duplicate detector) ─────────────

export type DuplicateClassification =
  | "new"
  | "exact_duplicate"
  | "possible_duplicate"
  | "conflicting_identity"
  | "invalid";

// ── Universal material schema (all optional except source provenance) ──────────

export interface UniversalMaterial {
  // Identity
  brand?: string;
  collection?: string;
  series?: string;
  productCode?: string;
  productName?: string;
  variant?: string;
  // Classification
  category?: string;
  subcategory?: string;
  materialType?: string;
  // Description
  description?: string;
  // Appearance
  colors?: string[];
  finish?: string[];
  texture?: string;
  pattern?: string;
  // Dimensions
  dimensions?: Record<string, unknown>;
  workingSize?: string;
  thickness?: string;
  numberOfFaces?: number;
  // Tile-specific ratings
  peiRating?: number;
  shadeVariation?: string;
  // Technical
  technicalSpecifications?: Record<string, unknown>;
  application?: string[];
  certifications?: string[];
  // Media
  thumbnailReference?: string;
  previewReferences?: string[];
  // Provenance (required)
  sourceType: AdapterSourceType;
  sourceName: string;
  sourceVersion?: string;
  sourceUrl?: string;
  sourcePage?: number;
  sourceMetadata?: Record<string, unknown>;
}

// ── Raw item from adapter (pre-AI extraction) ─────────────────────────────────

export interface RawExtractedItem {
  /** Unstructured or partially structured raw data from the source */
  raw: Record<string, unknown> | string;
  sourceContext?: {
    page?: number;
    row?: number;
    section?: string;
    elementType?: string;
  };
}

// ── Adapter interface ─────────────────────────────────────────────────────────

export interface AdapterInput {
  type: AdapterSourceType;
  /** Raw file bytes (PDF, CSV, Excel, etc.) */
  buffer?: Buffer;
  /** Original filename (used for source provenance) */
  filename?: string;
  /** For URL-based sources */
  url?: string;
  /** Additional adapter-specific options */
  options?: Record<string, unknown>;
}

export interface AdapterResult {
  /** Raw extracted items before AI normalization */
  rawItems: RawExtractedItem[];
  totalPages?: number;
  processedPages?: number;
  /** Non-fatal issues encountered during extraction */
  warnings: string[];
  /** Fatal issues that stopped some pages from being extracted */
  errors: string[];
  /** Source-level metadata (checksum, version detected, etc.) */
  sourceMetadata?: Record<string, unknown>;
}

export interface CatalogAdapter {
  readonly sourceType: AdapterSourceType;
  readonly displayName: string;
  readonly supportedMimeTypes: string[];
  extract(input: AdapterInput): Promise<AdapterResult>;
}

// ── AI extraction types ───────────────────────────────────────────────────────

export interface AIExtractionInput {
  rawText: string;
  sourceType: AdapterSourceType;
  sourceName: string;
  sourcePage?: number;
  hints?: {
    brand?: string;
    category?: string;
  };
}

export interface AIExtractionResult {
  materials: Partial<UniversalMaterial>[];
  confidence: number;
  warnings: string[];
}

// ── Staging item (enriched after full pipeline) ───────────────────────────────

export interface StagingPreviewItem {
  stagingId: string;
  status: StagingStatus;
  material: UniversalMaterial;
  rawData: Record<string, unknown> | string;
  sourceContext?: RawExtractedItem["sourceContext"];
  duplicateInfo?: {
    classification: DuplicateClassification;
    matchedKey?: string;
    reason?: string;
  };
  validationErrors: string[];
  extractedAt: Date;
}

// ── Job / pipeline types ──────────────────────────────────────────────────────

export type JobStatus = "pending" | "processing" | "complete" | "partial" | "failed";

export interface ImportJob {
  id: string;
  sourceType: AdapterSourceType;
  sourceName: string;
  sourceUrl?: string;
  filename?: string;
  checksum?: string;
  status: JobStatus;
  totalRaw: number;
  totalNormalized: number;
  totalNew: number;
  totalDuplicate: number;
  totalInvalid: number;
  totalNeedsReview: number;
  processedPages?: number;
  totalPages?: number;
  warnings: string[];
  errors: string[];
  options?: Record<string, unknown>;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineOptions {
  /** Max items to process in a single preview run */
  maxItems?: number;
  /** If true, skip AI extraction and use raw adapter output directly */
  skipAI?: boolean;
  /** Brand hint for AI extraction */
  brandHint?: string;
  /** Category hint for AI extraction */
  categoryHint?: string;
  /** For idempotency: reuse existing job if same checksum */
  idempotencyKey?: string;
}

export interface PipelineResult {
  job: ImportJob;
  items: StagingPreviewItem[];
  counts: {
    new: number;
    exact_duplicate: number;
    possible_duplicate: number;
    conflicting_identity: number;
    invalid: number;
    needs_review: number;
  };
}
