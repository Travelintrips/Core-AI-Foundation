/**
 * Team 25 — Interior Design Domain Plugin
 * index.ts — public barrel export
 *
 * Only re-export symbols that are part of the plugin's public contract.
 * Internal helpers that are only used within the plugin do not need to be
 * re-exported here.
 */

// Manifest — primary entry point for the Universal Design Platform loader
export {
  INTERIOR_DESIGN_PLUGIN_MANIFEST,
  INTERIOR_CAPABILITIES,
  validateManifest,
  getCapability,
  type InteriorDesignPluginManifest,
  type PluginCapability,
  type ManifestValidationResult,
} from "./manifest.js";

// Workflow DAG
export {
  INTERIOR_WORKFLOW,
  INTERIOR_WORKFLOW_STEP_IDS,
  detectCycles,
  topologicalOrder,
  computeParallelGroups,
  computeCriticalPath,
  type InteriorWorkflowDefinition,
  type InteriorWorkflowNode,
  type InteriorWorkflowEdge,
  type InteriorWorkflowStepId,
} from "./workflow.js";

// Artifact types
export {
  INTERIOR_ARTIFACT_TYPE_IDS,
  INTERIOR_ARTIFACT_TYPES,
  getRequiredArtifactTypes,
  getArtifactType,
  type InteriorArtifactTypeId,
  type InteriorArtifactType,
} from "./artifactTypes.js";

// Brief schema
export {
  InteriorDesignBriefSchema,
  INTERIOR_BRIEF_FIELDS,
  INTERIOR_SPACE_TYPES,
  INTERIOR_STYLE_PREFERENCES,
  INTERIOR_BUDGET_RANGES,
  INTERIOR_CLIMATE_TYPES,
  INTERIOR_LIGHTING_NEEDS,
  type InteriorDesignBrief,
  type InteriorSpaceType,
  type InteriorStylePreference,
  type BriefFieldDescriptor,
} from "./briefSchema.js";

// Property contributions
export {
  INTERIOR_PROPERTY_SECTION_IDS,
  INTERIOR_PROPERTY_SECTIONS,
  getSectionsForArtifact,
  getRequiredFields,
  type InteriorPropertySectionId,
  type InteriorPropertySection,
  type PropertyField,
} from "./propertyContributions.js";

// Components and material categories
export {
  INTERIOR_COMPONENT_CATEGORY_IDS,
  INTERIOR_COMPONENT_CATEGORIES,
  INTERIOR_MATERIAL_CATEGORIES,
  INTERIOR_MATERIAL_CATEGORY_DESCRIPTORS,
  getAllFixtures,
  getFixturesByCategory,
  getComponentCategory,
  type InteriorComponentCategoryId,
  type ComponentCategoryDescriptor,
  type ComponentFixture,
  type InteriorMaterialCategoryId,
} from "./components.js";

// Export presets
export {
  INTERIOR_EXPORT_PRESET_IDS,
  INTERIOR_EXPORT_PRESETS,
  listExportPresets,
  getRequiredArtifactsForPreset,
  type InteriorExportPresetId,
  type InteriorExportPreset,
  type ArtifactInclusion,
} from "./exportPresets.js";
