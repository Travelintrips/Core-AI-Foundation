/**
 * index.ts — Fashion Design Plugin
 *
 * Public barrel export.
 *
 * Consumer code (execution engine, integration layer) should only import
 * from this barrel — not from individual contribution files.
 */

// ── Plugin loader ──────────────────────────────────────────────────────────────
export { loadFashionPlugin, fashionPluginSupportsCapability } from "./fashionPlugin.js";

// ── Contract types ─────────────────────────────────────────────────────────────
export type {
  DomainPluginManifest,
  AssembledFashionPlugin,
  ArtifactTypeDefinition,
  CapabilityContribution,
  MaterialCategoryContribution,
  ComponentCategoryContribution,
  PropertySectionContribution,
  RendererMetadataContribution,
  ExportPreset,
  FashionMaterialMetadata,
  PluginDependency,
} from "./types/pluginContracts.js";
export { PLUGIN_CONTRACT_VERSION } from "./types/pluginContracts.js";

// ── Brief schema ───────────────────────────────────────────────────────────────
export { FashionBriefSchema } from "./brief/fashionBriefSchema.js";
export type {
  FashionBrief,
  FashionProductCategory,
  FashionSeason,
  FashionStyleDirection,
  FashionSilhouette,
  FashionMarketSegment,
} from "./brief/fashionBriefSchema.js";

// ── Workflow ───────────────────────────────────────────────────────────────────
export { fashionWorkflowDefinition, FASHION_WORKFLOW_ID } from "./workflow/fashionWorkflowDefinition.js";

// ── Artifact types ─────────────────────────────────────────────────────────────
export {
  fashionArtifactTypes,
  fashionArtifactTypeMap,
  FASHION_ARTIFACT_TYPE_IDS,
} from "./artifacts/fashionArtifactTypes.js";
export type { FashionArtifactTypeId } from "./artifacts/fashionArtifactTypes.js";

// ── Contributions (read-only lookups) ─────────────────────────────────────────
export { getFashionCapability, isFashionCapabilitySupported } from "./contributions/capabilities.js";
export { getFashionMaterialCategory } from "./contributions/materials.js";
export { getFashionComponentCategory } from "./contributions/components.js";
export { getFashionPropertySection } from "./contributions/properties.js";
export { getRendererMetadataForArtifactType } from "./contributions/rendererMetadata.js";
export { getFashionExportPreset, getExportPresetsForArtifactType } from "./contributions/exportPresets.js";
