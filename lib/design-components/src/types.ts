/**
 * Universal Design Component & Object Library — Core Types (Team 22)
 *
 * Domain-neutral. No hardcoded domain names in core types.
 * Domains are open strings — Teams 24–30 supply their domain catalogs via plugin registration.
 *
 * Integration contracts:
 *   Team 13 — layer nodes may reference component instances by componentId + instanceId
 *   Team 14 — previews/assets resolve via ComponentAssetReference
 *   Team 21 — material assignment flows through MaterialReferenceParameter
 *   Teams 24–30 — domain plugins register ComponentDefinition entries into the registry
 */

// ─────────────────────────────────────────────────────────────────────────────
// ComponentStatus
// ─────────────────────────────────────────────────────────────────────────────

export type ComponentStatus = "active" | "deprecated" | "unavailable";

// ─────────────────────────────────────────────────────────────────────────────
// ComponentSource
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentSource {
  /** "builtin" = shipped with the platform; "plugin" = contributed by a plugin */
  kind: "builtin" | "plugin";
  /** Only present when kind = "plugin" */
  pluginId?: string;
  pluginVersion?: string;
  /** Human-readable owner name */
  ownerLabel?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentCategory
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentCategory {
  id: string;
  label: string;
  description?: string;
  /** Parent category ID for nested taxonomies */
  parentId?: string;
  tags?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentParameterSchema
//
// Supports: text, number, boolean, color, enum, dimensions, material_reference,
//           asset_reference, plugin_schema_reference.
//
// SECURITY: plugin_schema_reference is resolved declaratively — no eval/exec.
// ─────────────────────────────────────────────────────────────────────────────

export type ParameterKind =
  | "text"
  | "number"
  | "boolean"
  | "color"
  | "enum"
  | "dimensions"
  | "material_reference"
  | "asset_reference"
  | "plugin_schema_reference";

interface BaseParameter {
  kind: ParameterKind;
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface TextParameter extends BaseParameter {
  kind: "text";
  minLength?: number;
  maxLength?: number;
  multiline?: boolean;
  /** Regex pattern for validation (no executable code) */
  pattern?: string;
}

export interface NumberParameter extends BaseParameter {
  kind: "number";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  integer?: boolean;
}

export interface BooleanParameter extends BaseParameter {
  kind: "boolean";
}

export interface ColorParameter extends BaseParameter {
  kind: "color";
  allowAlpha?: boolean;
}

export interface EnumParameter extends BaseParameter {
  kind: "enum";
  options: Array<{ value: string; label: string }>;
  multiple?: boolean;
}

export interface DimensionsParameter extends BaseParameter {
  kind: "dimensions";
  axes: Array<"width" | "height" | "depth">;
  unit?: "mm" | "cm" | "m" | "in" | "px" | "pt";
  min?: number;
  max?: number;
}

/**
 * Accepts a material reference from Team 21's material library.
 * The platform resolves the material by ID — no inline material data.
 */
export interface MaterialReferenceParameter extends BaseParameter {
  kind: "material_reference";
  /** Restricts accepted material types (open strings — Team 21 defines vocabulary) */
  allowedMaterialTypes?: string[];
}

/**
 * Accepts an asset reference from Team 14's asset browser.
 * The platform resolves the asset by ID — no inline binary data.
 */
export interface AssetReferenceParameter extends BaseParameter {
  kind: "asset_reference";
  allowedMimeTypes?: string[];
}

/**
 * References a schema defined by a plugin for complex structured values.
 *
 * SAFETY CONTRACT: The schema is identified by ID only. The registry never
 * evaluates code from plugin schemas. Plugins must register schema descriptors
 * through the type-safe schema registry API.
 *
 * Fields that indicate executable intent (exec, eval, fn, code, script, run,
 * callable, invoke) are rejected at registration time.
 */
export interface PluginSchemaReferenceParameter extends BaseParameter {
  kind: "plugin_schema_reference";
  /** Plugin-defined schema identifier (e.g. "acme-plugin:fabric-spec/v2") */
  schemaId: string;
  /** ID of the plugin that owns this schema */
  pluginId: string;
}

export type ComponentParameterSchema =
  | TextParameter
  | NumberParameter
  | BooleanParameter
  | ColorParameter
  | EnumParameter
  | DimensionsParameter
  | MaterialReferenceParameter
  | AssetReferenceParameter
  | PluginSchemaReferenceParameter;

// ─────────────────────────────────────────────────────────────────────────────
// ComponentAssetReference  (Team 14 integration point)
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentAssetReference {
  /** Stable asset ID within Team 14's asset store */
  assetId: string;
  /** Semantic role: "preview" | "thumbnail" | "source-file" | "icon" | … */
  role: string;
  mimeType?: string;
  /** Resolved URL (optional; may be signed/ephemeral) */
  url?: string;
  providedBy: "plugin" | "user" | "system";
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentPlacementCapability
// ─────────────────────────────────────────────────────────────────────────────

export type PlacementContext =
  | "canvas"
  | "layer"
  | "container"
  | "inline"
  | "overlay"
  | "background"
  | "frame";

export interface ComponentPlacementCapability {
  /** Where this component can be placed */
  contexts: PlacementContext[];
  /** Required parent component types (empty = can be root) */
  requiresParent?: string[];
  /** Cannot coexist with these component IDs under the same parent */
  exclusiveWith?: string[];
  /** Maximum instances per parent; undefined = unlimited */
  maxInstances?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentCompatibility
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentCompatibility {
  /**
   * Domain IDs this component works in.
   * Open strings — not an enum — so domain plugins (Teams 24–30) can contribute
   * their own domain identifiers without changing core types.
   */
  domains: string[];
  /**
   * Platform capability IDs required (e.g. "text-rendering", "3d-transform").
   * Renderer checks these before instantiation.
   */
  requiredCapabilities: string[];
  /**
   * Component IDs this component depends on (must be instantiated first).
   * Team 13 enforces ordering in the layer graph.
   */
  dependencies: string[];
  /** Component IDs that cannot coexist in the same artifact */
  incompatibleWith: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentVariant
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentVariant {
  id: string;
  label: string;
  description?: string;
  /**
   * Parameter value overrides applied on top of component defaults.
   * Keys must match parameter names declared in ComponentDefinition.parameters.
   */
  parameterOverrides: Record<string, unknown>;
  assetReferences?: ComponentAssetReference[];
  previewUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentDefinition  (the universal registry entry)
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentDefinition {
  /**
   * Globally unique, stable, namespaced ID.
   * Recommended format: "<pluginId>:<category>/<name>"
   * Example: "builtin:furniture/sofa", "acme-plugin:jewelry/ring-solitaire"
   */
  id: string;
  /** Semantic version string (e.g. "1.0.0") */
  version: string;
  /** Ordered list of previous stable version strings for backward resolution */
  previousVersions?: string[];

  label: string;
  description: string;
  /** Flat category from the platform category registry */
  category: ComponentCategory;

  source: ComponentSource;
  status: ComponentStatus;
  /** Required when status = "deprecated" */
  deprecationMessage?: string;
  /** Version string when this component was deprecated */
  deprecatedSince?: string;
  /** ID of the component that replaces this one (for migrations) */
  replacedBy?: string;

  compatibility: ComponentCompatibility;
  placement: ComponentPlacementCapability;

  /** Keyed parameter schema — no executable code in any value */
  parameters: Record<string, ComponentParameterSchema>;
  variants: ComponentVariant[];
  defaultVariantId?: string;

  /** Asset references (e.g. preview images) — resolved via Team 14 */
  assets: ComponentAssetReference[];

  tags: string[];
  /**
   * Permission keys required to use this component.
   * The calling context must hold all listed permission keys.
   */
  permissions?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentInstantiationRequest
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentTransform {
  x?: number;
  y?: number;
  z?: number;
  /** Degrees */
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface ComponentInstantiationRequest {
  /** Target component ID */
  componentId: string;
  /** Resolve a specific version; omit for latest active */
  version?: string;
  /** Variant ID within the component; omit for default variant */
  variantId?: string;
  /** Artifact (scene / document) this instance belongs to */
  targetArtifactId: string;
  /** Parent element ID within the artifact; omit for root placement */
  parentElementId?: string;
  /** Parameter values (merged with variant overrides server-side) */
  parameters: Record<string, unknown>;
  transform?: ComponentTransform;
  /** User / system actor making the request */
  requestedBy: string;
  /**
   * Client-generated idempotency key (UUID recommended).
   * Repeated requests with the same key return the original result without
   * creating a duplicate instance.
   */
  idempotencyKey: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation result (used by registry.validateInstantiationRequest)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface InstantiationValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentBrowserFilter  (used by ComponentBrowser UI and search logic)
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentBrowserFilter {
  query?: string;
  categoryId?: string;
  domain?: string;
  sourceKind?: "builtin" | "plugin";
  pluginId?: string;
  tags?: string[];
  variantId?: string;
  status?: ComponentStatus;
  /** Caller-held permission keys — used to surface unavailable-due-to-permission state */
  callerPermissions?: string[];
}
