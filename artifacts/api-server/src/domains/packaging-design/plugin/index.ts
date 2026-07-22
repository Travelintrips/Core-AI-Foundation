/**
 * packaging-design/plugin/index.ts — Team 26
 *
 * Barrel export for the Packaging Design Domain Plugin.
 *
 * Import from this barrel to access all plugin public APIs:
 *
 *   import {
 *     buildPluginManifest,
 *     PackagingBriefSchema,
 *     PACKAGING_WORKFLOW,
 *     listArtifactTypes,
 *     listOverlayDefinitions,
 *     listSubstrates,
 *     listExportPresets,
 *     listComplianceProfiles,
 *   } from "@/domains/packaging-design/plugin/index.js";
 */

// ── Manifest ──────────────────────────────────────────────────────────────────
export {
  buildPluginManifest,
  assertVersionCompatible,
  PLUGIN_ID,
  PLUGIN_VERSION,
  PLUGIN_TEAM,
  MIN_CORE_VERSION,
  type PackagingPluginManifest,
} from "./manifest.js";

// ── Brief ─────────────────────────────────────────────────────────────────────
export {
  PackagingBriefSchema,
  PackagingDimensionsSchema,
  BarcodeLabelRequirementsSchema,
  validateBrief,
  PrintingMethodEnum,
  BarcodeTypeEnum,
  SustainabilityCertEnum,
  RegulatoryBodyEnum,
  LogisticsConstraintEnum,
  type PackagingBrief,
  type PackagingDimensions,
  type BarcodeLabelRequirements,
  type BriefValidationResult,
} from "./brief.js";

// ── Workflow ──────────────────────────────────────────────────────────────────
export {
  PACKAGING_WORKFLOW,
  WORKFLOW_STEP_IDS,
  getStep,
  getNextSteps,
  isStepTransitionAllowed,
  type WorkflowStep,
  type WorkflowStepId,
  type WorkflowDefinition,
} from "./workflow.js";

// ── Artifact types ────────────────────────────────────────────────────────────
export {
  PACKAGING_ARTIFACT_TYPE_IDS,
  listArtifactTypes,
  listDeliverableArtifactTypes,
  getArtifactType,
  isMimeAccepted,
  type PackagingArtifactType,
  type PackagingArtifactTypeId,
} from "./artifacts.js";

// ── Overlays ──────────────────────────────────────────────────────────────────
export {
  OVERLAY_TYPE_IDS,
  listOverlayDefinitions,
  listMandatoryOverlays,
  listStructuralOverlays,
  getOverlayDefinition,
  resolveActiveOverlays,
  type OverlayZoneDefinition,
  type OverlayTypeId,
  type OverlayRenderStyle,
} from "./overlays.js";

// ── Material ──────────────────────────────────────────────────────────────────
export {
  SUBSTRATE_IDS,
  COATING_IDS,
  listSubstrates,
  listSubstratesByCategory,
  getSubstrate,
  buildMaterialContribution,
  type SubstrateProfile,
  type SubstrateId,
  type CoatingId,
  type MaterialSpec,
  type MaterialContribution,
} from "./material.js";

// ── Export presets ────────────────────────────────────────────────────────────
export {
  EXPORT_PRESET_IDS,
  listExportPresets,
  getExportPreset,
  getRequiredFiles,
  type ExportPreset,
  type ExportPresetId,
  type ExportFileSpec,
} from "./export.js";

// ── Compliance ────────────────────────────────────────────────────────────────
export {
  COMPLIANCE_PROFILES,
  listComplianceProfiles,
  getComplianceProfile,
  resolveComplianceProfiles,
  buildComplianceSheet,
  recalculateOutcome,
  type ComplianceProfile,
  type ComplianceCheck,
  type ComplianceSheetMetadata,
  type ComplianceCheckSeverity,
  type ComplianceCheckOutcome,
} from "./compliance.js";
