/**
 * Universal Design Blueprint Library — Domain Types (Team 7)
 *
 * A blueprint is a structural contract for a design domain. It declares:
 *   - canvas dimensions + DPI
 *   - zones (named rectangular regions)
 *   - slots (typed content placeholders within zones)
 *   - constraints (hard limits on content and composition)
 *   - supported components (what renderers can be attached)
 *   - required data fields (what the caller must supply)
 *   - output capabilities (what export formats the domain supports)
 *   - versioning, status, and tags
 *
 * Rules:
 *   - Blueprints describe STRUCTURE only — no rendering logic here.
 *   - Slot IDs must be unique within a blueprint.
 *   - Zone slotRefs must point to existing slot IDs.
 *   - Dimensions, zone bounds, and slot constraints are validated by blueprintValidator.
 */

// ── Schema versioning ─────────────────────────────────────────────────────────

export const BLUEPRINT_SCHEMA_VERSION = "1.0" as const;
export type BlueprintSchemaVersion = "1.0";

// ── Domains ───────────────────────────────────────────────────────────────────

export const BLUEPRINT_DOMAINS = [
  "graphic_design",
  "presentation",
  "interior",
  "fashion",
  "packaging",
  "product_design",
] as const;

export type BlueprintDomain = (typeof BLUEPRINT_DOMAINS)[number];

// ── Status ────────────────────────────────────────────────────────────────────

export const BLUEPRINT_STATUSES = ["draft", "active", "deprecated"] as const;
export type BlueprintStatus = (typeof BLUEPRINT_STATUSES)[number];

// ── Dimensions ────────────────────────────────────────────────────────────────

export const DIMENSION_UNITS = ["px", "mm", "cm", "in", "pt"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

export interface BlueprintDimensions {
  width: number;          // must be > 0
  height: number;         // must be > 0
  unit: DimensionUnit;
  dpi?: number;           // dots-per-inch for print output (72–2400)
  aspectRatio?: string;   // e.g. "16:9", "A4", "letter" — informational only
}

// ── Zones ─────────────────────────────────────────────────────────────────────

export interface BlueprintZone {
  id: string;             // unique within blueprint
  name: string;
  description?: string;
  x: number;              // top-left in dimension units
  y: number;
  width: number;          // must be > 0
  height: number;         // must be > 0
  required: boolean;
  slotRefs: string[];     // slot IDs that may appear in this zone
  zIndex?: number;        // layer ordering hint (0 = bottom)
}

// ── Slots ─────────────────────────────────────────────────────────────────────

export const SLOT_TYPES = [
  "text",
  "image",
  "shape",
  "video",
  "icon",
  "data_table",
  "component",
  "color_swatch",
  "measurement",
  "annotation",
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export interface SlotConstraints {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** e.g. "16:9", "1:1", "4:3" */
  aspectRatio?: string;
  /** For text slots */
  minFontSize?: number;
  maxFontSize?: number;
  maxChars?: number;
  minChars?: number;
  /** For image/video slots */
  allowedFormats?: string[];   // e.g. ["jpg","png","webp"]
  maxFileSizeMb?: number;
  /** For measurement/annotation */
  unit?: string;               // e.g. "cm", "m²", "gsm"
  /** For data_table slots */
  maxRows?: number;
  maxColumns?: number;
}

export interface BlueprintSlot {
  id: string;             // unique within blueprint
  name: string;
  description?: string;
  type: SlotType;
  required: boolean;
  maxItems?: number;      // how many times the slot may repeat in a zone
  constraints: SlotConstraints;
  /** Default value or placeholder text (informational) */
  defaultValue?: string;
  /** If true, content may cross zone boundaries */
  allowsOverflow?: boolean;
}

// ── Supported Components ──────────────────────────────────────────────────────

export interface SupportedComponent {
  /** Component type identifier, e.g. "rich-text-editor", "color-picker" */
  type: string;
  /** Semver range that this blueprint expects, e.g. ">=1.0.0 <2.0.0" */
  versionRange: string;
  required: boolean;
  /** Slot types this component can fill */
  fillsSlotTypes: SlotType[];
  /** Additional static config passed to the component at mount */
  config?: Record<string, unknown>;
}

// ── Required Data ─────────────────────────────────────────────────────────────

export const DATA_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "image_url",
  "color",
  "date",
  "enum",
  "string_array",
  "object",
] as const;
export type DataFieldType = (typeof DATA_FIELD_TYPES)[number];

export interface RequiredDataField {
  key: string;            // unique within blueprint
  label: string;
  type: DataFieldType;
  required: boolean;
  description?: string;
  /** For enum type — allowed values */
  allowedValues?: string[];
  /** Validation regex (string type only) */
  pattern?: string;
  /** Max string length */
  maxLength?: number;
  /** Numeric range */
  min?: number;
  max?: number;
  defaultValue?: unknown;
}

// ── Output Capabilities ───────────────────────────────────────────────────────

export const OUTPUT_FORMATS = [
  "pdf",
  "png",
  "jpg",
  "svg",
  "pptx",
  "ai",
  "sketch",
  "figma",
  "dxf",
  "obj",
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const COLOR_SPACES = ["rgb", "cmyk", "pantone", "lab"] as const;
export type ColorSpace = (typeof COLOR_SPACES)[number];

export interface OutputCapability {
  format: OutputFormat;
  maxDpi?: number;
  multiPage?: boolean;
  colorSpace?: ColorSpace;
  /** ICC profile name, e.g. "ISOcoated_v2_eci" */
  iccProfile?: string;
  /** Bleed margin in mm (print output) */
  bleedMm?: number;
}

// ── Blueprint ─────────────────────────────────────────────────────────────────

export interface Blueprint {
  id: string;             // UUID
  slug: string;           // kebab-case, unique
  schemaVersion: BlueprintSchemaVersion;
  domain: BlueprintDomain;
  name: string;
  description: string;
  version: string;        // semver, e.g. "1.0.0"
  status: BlueprintStatus;
  dimensions: BlueprintDimensions;
  zones: BlueprintZone[];
  slots: BlueprintSlot[];
  constraints: BlueprintConstraints;
  supportedComponents: SupportedComponent[];
  requiredData: RequiredDataField[];
  outputCapabilities: OutputCapability[];
  industryTags: string[];
  styleTags: string[];
  createdAt: string;      // ISO 8601
  updatedAt: string;
}

export interface BlueprintConstraints {
  /** Absolute max number of zones */
  maxZones?: number;
  /** Absolute max number of slots */
  maxSlots?: number;
  /** Whether zones may overlap each other */
  allowZoneOverlap?: boolean;
  /** Min total content coverage (fraction 0–1) */
  minContentCoverage?: number;
  /** Max total content coverage (fraction 0–1) */
  maxContentCoverage?: number;
  /** Required zones that must always be present */
  requiredZoneIds?: string[];
  /** Slot IDs that cannot coexist in the same zone */
  mutuallyExclusiveSlots?: string[][];
  /** Domain-specific constraint bag */
  domainSpecific?: Record<string, unknown>;
}

// ── Validation Results ────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  path: string;           // dot-notation path to the offending field
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ── Compatibility ─────────────────────────────────────────────────────────────

export interface CompatibilityRequest {
  blueprintId: string;
  schemaVersion: string;
  componentTypes?: string[];
  slotTypesFilled?: Partial<Record<SlotType, number>>;
}

export interface CompatibilityIssue {
  code: string;
  component?: string;
  slotType?: SlotType;
  expected?: string;
  actual?: string;
  message: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  issues: CompatibilityIssue[];
  warnings: CompatibilityIssue[];
}

// ── Normalization ─────────────────────────────────────────────────────────────

export interface NormalizationResult {
  blueprint: Blueprint;
  /** Changes applied during normalization */
  changes: string[];
}

// ── Service layer inputs ──────────────────────────────────────────────────────

export type CreateBlueprintInput = Omit<Blueprint, "id" | "slug" | "createdAt" | "updatedAt" | "schemaVersion"> & { slug?: string };

export type UpdateBlueprintInput = Partial<
  Omit<Blueprint, "id" | "slug" | "domain" | "createdAt" | "updatedAt" | "schemaVersion">
>;

export interface ListBlueprintsFilter {
  domain?: BlueprintDomain;
  status?: BlueprintStatus;
  industryTag?: string;
  styleTag?: string;
  limit?: number;
  offset?: number;
}
