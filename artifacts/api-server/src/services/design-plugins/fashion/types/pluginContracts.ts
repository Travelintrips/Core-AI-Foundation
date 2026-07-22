/**
 * pluginContracts.ts — Fashion Design Plugin
 *
 * Local adapter for domain plugin contracts.
 *
 * TEAM 39 INTEGRATION NOTE:
 *   These interfaces are intentionally defined here as a narrow local adapter
 *   because Team 21 Universal Design Engine plugin contracts were not available
 *   at the time this plugin was built (2026-07-22).
 *   When Team 21 publishes @workspace/design-engine-contracts (or equivalent),
 *   replace these local types with imports from that package and delete this file.
 *   The fashion plugin's own contributions must not change — only the import path.
 *
 * CONTRACT VERSION: "1.0"
 *   Bump this string (and the test that asserts it) whenever a breaking change
 *   is made to the manifest shape consumed by the loader.
 */

// ── Plugin Manifest ────────────────────────────────────────────────────────────

export interface PluginDependency {
  /** Stable ID of the required plugin or core subsystem. */
  id: string;
  /** Whether execution should fail if this dependency is absent. */
  required: boolean;
  /** Minimum acceptable semver — informational, not enforced here. */
  minVersion?: string;
}

export interface DomainPluginManifest {
  /** Globally unique, stable, lowercase-kebab identifier (e.g. "fashion-design"). */
  pluginId: string;
  /** Human display name. */
  displayName: string;
  /** Semver of this plugin release. */
  version: string;
  /**
   * Version of the DomainPluginManifest contract this plugin conforms to.
   * Must equal PLUGIN_CONTRACT_VERSION to load successfully.
   */
  contractVersion: string;
  description: string;
  /** Machine-readable domain tag. No spaces. */
  domain: string;
  /** IDs of AI capabilities this plugin contributes. */
  capabilityIds: string[];
  /** IDs of artifact types this plugin contributes. */
  artifactTypeIds: string[];
  /** IDs of property sections this plugin contributes. */
  propertySectionIds: string[];
  /** IDs of material categories this plugin contributes. */
  materialCategoryIds: string[];
  /** IDs of component categories this plugin contributes. */
  componentCategoryIds: string[];
  /** IDs of renderer metadata blocks this plugin contributes. */
  rendererMetadataIds: string[];
  /** IDs of export presets this plugin contributes. */
  exportPresetIds: string[];
  /** Plugin dependencies (other plugins or core subsystems). */
  dependencies: PluginDependency[];
  /** Searchable tags. */
  tags: string[];
  createdAt: string; // ISO-8601
}

// ── Artifact Types ─────────────────────────────────────────────────────────────

export type ArtifactOutputFormat = "image" | "pdf" | "svg" | "zip" | "json";
export type ArtifactAspectRatio = "1:1" | "4:5" | "16:9" | "A4" | "custom";

export interface ArtifactTypeDefinition {
  /** Stable machine key, must match the value in the manifest's artifactTypeIds. */
  id: string;
  displayName: string;
  description: string;
  /** Output formats the renderer is expected to produce for this artifact. */
  outputFormats: ArtifactOutputFormat[];
  defaultAspectRatio: ArtifactAspectRatio;
  /** Position within the production workflow (1 = earliest). */
  workflowOrder: number;
  /** Whether this artifact type requires a prior artifact to be completed first. */
  requiresPriorArtifactId?: string;
  /** Arbitrary metadata forwarded to the renderer. */
  rendererHints?: Record<string, unknown>;
}

// ── AI Capabilities ────────────────────────────────────────────────────────────

export interface CapabilityContribution {
  /** Stable machine key, must match manifest.capabilityIds. */
  id: string;
  displayName: string;
  description: string;
  /**
   * Prompt template boundary — describes the context variables available.
   * The actual model/provider is resolved by the execution engine at runtime.
   * Never hard-code a model name here.
   */
  promptTemplateBoundary: {
    /** Variables the template expects to receive. */
    inputVariables: string[];
    /** What the template produces (for documentation / type safety). */
    outputDescription: string;
    /** Example invocation showing variables filled in. Informational only. */
    examplePrompt?: string;
  };
  /** Job type to dispatch — must be registered in the worker cluster. */
  jobType: string;
}

// ── Material Contribution ──────────────────────────────────────────────────────

export interface FashionMaterialMetadata {
  /** Fashion-specific property: fabric stretch property. */
  stretch: "none" | "two-way" | "four-way" | "mechanical";
  /** Grams per square metre (gsm). */
  weightGsm?: number;
  /** Drape quality. */
  drape: "stiff" | "moderate" | "fluid" | "draped";
  /** Visual opacity of the fabric. */
  opacity: "opaque" | "semi-sheer" | "sheer" | "transparent";
  /** Fibre composition as a free-text string (e.g. "95% cotton, 5% elastane"). */
  composition: string;
  /** Care instructions (machine-wash, dry-clean, etc.). */
  care: string[];
  /** Surface finish. */
  finish: "matte" | "satin" | "glossy" | "brushed" | "embossed" | "printed" | "plain";
}

export interface MaterialCategoryContribution {
  /** Stable machine key, must match manifest.materialCategoryIds. */
  id: string;
  displayName: string;
  description: string;
  /** Representative fabric names in this category. */
  examples: string[];
  /** Fashion-specific metadata template for this category. */
  fashionMetadataTemplate: FashionMaterialMetadata;
}

// ── Component Contribution ─────────────────────────────────────────────────────

export interface ComponentOption {
  value: string;
  label: string;
  /** Optional sketch/icon hint for the visual editor. */
  iconHint?: string;
}

export interface ComponentCategoryContribution {
  /** Stable machine key, must match manifest.componentCategoryIds. */
  id: string;
  displayName: string;
  description: string;
  /** Whether this component category is required for every fashion artifact. */
  required: boolean;
  /** Available options for this component. */
  options: ComponentOption[];
}

// ── Property Sections ──────────────────────────────────────────────────────────

export interface PropertyField {
  key: string;
  label: string;
  type: "text" | "select" | "multiselect" | "number" | "range" | "boolean" | "color";
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}

export interface PropertySectionContribution {
  /** Stable machine key, must match manifest.propertySectionIds. */
  id: string;
  displayName: string;
  description: string;
  /** Render order within the property panel. Lower = higher. */
  displayOrder: number;
  fields: PropertyField[];
}

// ── Renderer Metadata ──────────────────────────────────────────────────────────

export interface RendererMetadataContribution {
  /** Stable machine key, must match manifest.rendererMetadataIds. */
  id: string;
  /** Artifact type IDs this metadata applies to. */
  artifactTypeIds: string[];
  /** Renderer-specific hints (canvas size, bleed, safe zones, etc.). */
  hints: Record<string, unknown>;
}

// ── Export Presets ─────────────────────────────────────────────────────────────

export type ExportColorSpace = "sRGB" | "CMYK" | "P3";
export type ExportResolutionDpi = 72 | 150 | 300 | 600;

export interface ExportPreset {
  /** Stable machine key, must match manifest.exportPresetIds. */
  id: string;
  displayName: string;
  description: string;
  format: ArtifactOutputFormat;
  colorSpace: ExportColorSpace;
  resolutionDpi: ExportResolutionDpi;
  /** Whether to include a bleed area (print presets). */
  includeBleed: boolean;
  bleedMm?: number;
  /** Artifact type IDs this preset is recommended for. */
  recommendedForArtifactTypes: string[];
}

// ── Assembled Plugin ───────────────────────────────────────────────────────────

export interface AssembledFashionPlugin {
  manifest: DomainPluginManifest;
  artifactTypes: ArtifactTypeDefinition[];
  capabilities: CapabilityContribution[];
  materialCategories: MaterialCategoryContribution[];
  componentCategories: ComponentCategoryContribution[];
  propertySections: PropertySectionContribution[];
  rendererMetadata: RendererMetadataContribution[];
  exportPresets: ExportPreset[];
}

/** Current version of the DomainPluginManifest contract. */
export const PLUGIN_CONTRACT_VERSION = "1.0" as const;
