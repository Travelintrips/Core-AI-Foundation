/**
 * material-library/types.ts — Team 21: Universal Material Library Foundation
 *
 * Canonical contracts for the domain-neutral Material Library.
 * These types are intentionally free of any domain-specific logic
 * (no fabric, no wall, no garment — use compatibleDomains + plugin extensions).
 *
 * Design invariants:
 *   - tenantId follows RequestContext semantics: null = platform-owned material.
 *   - All preview URLs must be signed/safe before handing to the client.
 *   - extensions is an open envelope for plugin-provided data; core never
 *     reads or validates extension keys beyond their declared schema.
 *   - status transitions are enforced by materialLibraryService, not this module.
 */

// ── Status ───────────────────────────────────────────────────────────────────

export const MATERIAL_STATUSES = ["active", "inactive", "deprecated", "unavailable", "draft"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

// ── Source ───────────────────────────────────────────────────────────────────

export const MATERIAL_SOURCES = [
  "platform",    // provided by the platform, shared across all tenants
  "tenant",      // created by a tenant for their own use
  "plugin",      // contributed by a registered plugin
  "uploaded",    // uploaded asset reference
  "external",    // external catalog reference (e.g. supplier URL)
] as const;
export type MaterialSource = (typeof MATERIAL_SOURCES)[number];

// ── Property types ────────────────────────────────────────────────────────────

export const PROPERTY_TYPES = [
  "text",
  "number",
  "boolean",
  "enum",
  "range",
  "color",
  "measurement",
  "percentage",
  "reference",
  "texture_asset",
  "metadata",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

// ── Permission ────────────────────────────────────────────────────────────────

export const MATERIAL_PERMISSIONS = ["read", "assign", "edit", "delete", "create"] as const;
export type MaterialPermission = (typeof MATERIAL_PERMISSIONS)[number];

// ── Feature stability (for category/plugin metadata) ─────────────────────────

export const FEATURE_STABILITIES = ["stable", "beta", "experimental", "deprecated"] as const;
export type FeatureStability = (typeof FEATURE_STABILITIES)[number];

// ── Preview descriptor ────────────────────────────────────────────────────────

export interface MaterialPreview {
  /** Safe signed URL for the primary preview image. Never a raw storage path. */
  readonly previewUrl: string | null;
  /** Optional thumbnail (smaller) signed URL. */
  readonly thumbnailUrl: string | null;
  /** Alt text for accessibility. */
  readonly altText: string;
  /** Dominant color swatch (hex), if available. */
  readonly swatchColor: string | null;
  /** Array of additional preview swatches (hex colors or signed asset URLs). */
  readonly additionalSwatches: readonly string[];
}

// ── Property definition ───────────────────────────────────────────────────────

export interface MaterialPropertyDefinition {
  readonly propertyId: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly unit?: string;          // e.g. "kg/m²", "mm", "%"
  readonly required: boolean;
  readonly defaultValue?: MaterialPropertyValue;
  /** Allowed values for enum type. */
  readonly enumOptions?: readonly string[];
  /** Min/max for number, range, measurement, percentage. */
  readonly min?: number;
  readonly max?: number;
  readonly description?: string;
}

export type MaterialPropertyValue =
  | string
  | number
  | boolean
  | null
  | { min: number; max: number }        // range
  | { value: number; unit: string }     // measurement
  | { assetId: string; url: string }    // texture_asset / reference
  | Record<string, unknown>;            // metadata

// ── Sustainability metadata ───────────────────────────────────────────────────

export interface MaterialSustainabilityMetadata {
  /** % of recycled content. */
  readonly recycledContentPct?: number;
  /** Is it recyclable at end-of-life? */
  readonly recyclable?: boolean;
  /** Carbon footprint kg CO₂e per kg. */
  readonly carbonFootprintKgPerKg?: number;
  /** Third-party certifications (e.g. "FSC", "OEKO-TEX"). */
  readonly certifications?: readonly string[];
  /** Expected useful life in years. */
  readonly usefulLifeYears?: number;
}

// ── Technical metadata ────────────────────────────────────────────────────────

export interface MaterialTechnicalMetadata {
  /** Weight kg/m² or kg/m³ depending on category. */
  readonly weightKgPerM2?: number;
  readonly weightKgPerM3?: number;
  readonly thicknessMm?: number;
  /** Tensile strength MPa. */
  readonly tensileStrengthMpa?: number;
  /** Mohs hardness scale 1–10. */
  readonly mohsHardness?: number;
  /** Thermal conductivity W/(m·K). */
  readonly thermalConductivity?: number;
  /** UV resistance rating 1–10. */
  readonly uvResistance?: number;
  /** Moisture resistance rating 1–10. */
  readonly moistureResistance?: number;
  /** Fire rating (e.g. "Class A", "B1"). */
  readonly fireRating?: string;
  /** Durability estimate in years. */
  readonly durabilityYears?: number;
}

// ── Availability ──────────────────────────────────────────────────────────────

export interface MaterialAvailability {
  readonly inStock: boolean;
  readonly leadTimeDays?: number;
  /** ISO 3166-1 alpha-2 country codes. Empty = globally available. */
  readonly availableRegions?: readonly string[];
  readonly supplierIds?: readonly string[];
  readonly notes?: string;
}

// ── Compatibility ─────────────────────────────────────────────────────────────

export interface MaterialCompatibility {
  /**
   * Domain slugs this material is compatible with.
   * e.g. ["fashion", "interior", "furniture", "packaging"]
   * Empty = no domain restrictions (universal).
   */
  readonly compatibleDomains: readonly string[];
  /**
   * Category IDs within those domains where assignment is valid.
   * Empty = any category in the compatible domains.
   */
  readonly compatibleCategories?: readonly string[];
  /** Optional human-readable note about compatibility. */
  readonly compatibilityNote?: string;
}

// ── Core: MaterialDefinition ──────────────────────────────────────────────────

export interface MaterialDefinition {
  readonly materialId: string;
  /** null = platform-level material (visible to all tenants). */
  readonly tenantId: string | null;
  readonly name: string;
  readonly categoryId: string;
  readonly description: string;
  readonly status: MaterialStatus;
  readonly source: MaterialSource;
  readonly preview: MaterialPreview;
  /** Validated property values keyed by propertyId. */
  readonly properties: Readonly<Record<string, MaterialPropertyValue>>;
  readonly tags: readonly string[];
  readonly compatibility: MaterialCompatibility;
  readonly sustainability?: MaterialSustainabilityMetadata;
  readonly technical?: MaterialTechnicalMetadata;
  readonly availability?: MaterialAvailability;
  readonly createdAt: string;   // ISO-8601
  readonly updatedAt: string;
  readonly version: number;
  /** Open extension envelope for plugin-provided domain-specific fields. */
  readonly extensions: Readonly<Record<string, unknown>>;
  /** ID of the plugin that owns this material, if any. */
  readonly pluginId?: string;
  /** If true, this material is read-only (cannot be edited or deleted). */
  readonly readOnly: boolean;
  /** Actor who created this material. */
  readonly createdBy?: string;
}

// ── Category ──────────────────────────────────────────────────────────────────

export interface MaterialCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly description?: string;
  /** Parent category ID for hierarchy support. */
  readonly parentId?: string | null;
  /** Display order (lower = first). */
  readonly sortOrder: number;
  /** Which plugin owns this category. null = core platform. */
  readonly pluginId?: string | null;
  /** Domain slugs this category belongs to. Empty = universal. */
  readonly applicableDomains: readonly string[];
  readonly stability: FeatureStability;
  /** Capability flags for this category. */
  readonly capabilities: readonly string[];
  /** Property definitions that apply to all materials in this category. */
  readonly propertyDefinitions: readonly MaterialPropertyDefinition[];
}

// ── Assignment ────────────────────────────────────────────────────────────────

export interface MaterialAssignment {
  readonly assignmentId: string;
  readonly materialId: string;
  readonly materialVersion: number;
  /** ID of the artifact (design, project, template) being assigned to. */
  readonly targetArtifactId: string;
  /** Element or region within the artifact. */
  readonly targetElementId?: string | null;
  readonly targetRegionId?: string | null;
  /** Override values that supersede the material's default properties for this assignment. */
  readonly overrideProperties: Readonly<Record<string, MaterialPropertyValue>>;
  /** Source of the assignment ("user", "plugin", "ai_suggestion"). */
  readonly assignmentSource: string;
  /** Plugin capability that performed this assignment, if any. */
  readonly capability?: string;
  readonly assignedAt: string;
  readonly assignedBy?: string;
  /** Validation result from the last validation run. */
  readonly validationResult?: MaterialAssignmentValidationResult;
}

export interface MaterialAssignmentValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly checkedAt: string;
}

// ── Search / Filter / Sort ────────────────────────────────────────────────────

export interface MaterialSearchFilter {
  readonly q?: string;
  readonly categoryIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly source?: MaterialSource;
  readonly domain?: string;
  readonly status?: MaterialStatus;
  /** If true, include deprecated and unavailable materials. */
  readonly includeInactive?: boolean;
  readonly tenantId?: string | null;
  /** Filter to platform-only materials. */
  readonly platformOnly?: boolean;
}

export const MATERIAL_SORT_OPTIONS = [
  "name_asc",
  "name_desc",
  "created_desc",
  "created_asc",
  "updated_desc",
  "category_asc",
] as const;
export type MaterialSort = (typeof MATERIAL_SORT_OPTIONS)[number];

// ── Paginated result ──────────────────────────────────────────────────────────

export interface MaterialListResult {
  readonly items: readonly MaterialDefinition[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
}

// ── Unsafe preview guard ──────────────────────────────────────────────────────

/** Thrown when a preview URL is detected to be unsafe (non-https, data:, etc.) */
export class UnsafePreviewError extends Error {
  constructor(url: string) {
    super(`Material preview URL is not safe: "${url}"`);
    this.name = "UnsafePreviewError";
  }
}

/** Validate that a preview URL is https or null. Never allow data:, javascript:, or raw paths. */
export function assertSafePreviewUrl(url: string | null): void {
  if (url === null) return;
  if (!url.startsWith("https://")) {
    throw new UnsafePreviewError(url);
  }
}
