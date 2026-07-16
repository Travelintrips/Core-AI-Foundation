/**
 * Universal Creative Component Library — Core Types (Team 8)
 *
 * Defines the schema for every reusable component type across four creative
 * domains: Graphic, Interior, Fashion, Packaging.
 *
 * These types are shared across the registry, validation service, blueprint
 * compatibility service, and the CRUD layer.
 */

// ── Domains ──────────────────────────────────────────────────────────────────

export type ComponentDomain =
  | "graphic"
  | "interior"
  | "fashion"
  | "packaging";

// ── Component types per domain ────────────────────────────────────────────────

export type GraphicComponentType =
  | "text"
  | "logo"
  | "qr"
  | "contact"
  | "image"
  | "icon"
  | "table"
  | "chart";

export type InteriorComponentType =
  | "sofa"
  | "interior_table"
  | "lighting"
  | "cabinet"
  | "door_window"
  | "decoration";

export type FashionComponentType =
  | "body_panel"
  | "sleeve"
  | "collar"
  | "pocket"
  | "logo_area"
  | "sponsor"
  | "name_number";

export type PackagingComponentType =
  | "front"
  | "back"
  | "side"
  | "top"
  | "bottom"
  | "label"
  | "barcode"
  | "legal_block";

export type ComponentType =
  | GraphicComponentType
  | InteriorComponentType
  | FashionComponentType
  | PackagingComponentType;

// ── Field definitions ─────────────────────────────────────────────────────────

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "color"
  | "url"
  | "enum"
  | "font"
  | "textarea"
  | "json"
  | "mm"        // millimetres — dimensional values
  | "pt"        // points — typography
  | "px";       // pixels — screen values

export interface FieldDefinition {
  type: FieldType;
  label: string;
  required: boolean;
  default?: unknown;
  /** Valid options for `type: "enum"` */
  options?: string[];
  /** Inclusive minimum for numeric / dimensional types */
  min?: number;
  /** Inclusive maximum for numeric / dimensional types */
  max?: number;
  maxLength?: number;
  description?: string;
}

// ── Constraints ───────────────────────────────────────────────────────────────

export type ConstraintRule =
  | "required"
  | "min"
  | "max"
  | "pattern"
  | "enum"
  | "depends_on"
  | "exclusive_with"
  | "custom";

export interface Constraint {
  name: string;
  description: string;
  rule: ConstraintRule;
  /** The value to compare against (depends on rule) */
  value?: unknown;
  /** For `depends_on` / `exclusive_with` — the other field name(s) */
  relatedFields?: string[];
}

// ── Component definition (registry entry) ────────────────────────────────────

export interface ComponentDefinition {
  /** Unique machine-readable type identifier */
  type: ComponentType;
  /** Primary domain this component belongs to */
  domain: ComponentDomain;
  /** Human-readable name */
  name: string;
  /** URL-safe slug */
  slug: string;
  description: string;
  /** Semantic version of this component definition */
  version: string;
  /** All domains this component can be used in */
  supportedDomains: ComponentDomain[];
  /** Typed schema for every editable field */
  properties: Record<string, FieldDefinition>;
  /** Cross-field and domain-level constraints */
  constraints: Constraint[];
  /** Searchable tags */
  tags: string[];
}

// ── Instance (user-created component) ─────────────────────────────────────────

export interface ComponentInstanceInput {
  type: ComponentType;
  tenantId: string;
  name: string;
  domain: ComponentDomain;
  /** User-supplied values keyed by property name */
  fieldValues: Record<string, unknown>;
  /** Optional blueprint/template this instance is tied to */
  blueprintId?: string;
  createdBy?: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ── Blueprint compatibility ───────────────────────────────────────────────────

export interface BlueprintCompatibilityResult {
  compatible: boolean;
  /** Human-readable explanations when not compatible */
  reasons: string[];
  /** Required fields that have no value */
  missingFields: string[];
  /** Constraints that cannot be satisfied */
  unsupportedConstraints: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const ALL_DOMAINS: ComponentDomain[] = [
  "graphic",
  "interior",
  "fashion",
  "packaging",
];

export const COMPONENT_SCHEMA_VERSION = "1.0.0";
