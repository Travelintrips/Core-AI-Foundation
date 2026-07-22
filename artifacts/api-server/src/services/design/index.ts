/**
 * services/design/index.ts — Team 38 barrel export.
 *
 * Public surface of the Universal Design Platform migration layer.
 * Import from here, not from individual files.
 */

// Shared types
export type {
  CanonicalDesignBrief,
  CanonicalDesignWorkflow,
  CanonicalWorkflowStatus,
  CanonicalWorkflowStep,
  CanonicalDesignAsset,
  CanonicalAssetStatus,
  CanonicalRenderStage,
  CanonicalDesignProject,
  CanonicalProjectSourceType,
  DesignFlagKey,
  DesignMigrationIssue,
  DesignMigrationPlan,
  DesignMigrationResult,
  DesignReadinessCheck,
  DualReadResult,
  DualReadComparison,
  MigrationIssueSeverity,
  MigrationStatus,
  ReadinessCheckStatus,
} from "./designMigrationTypes.js";
export { DESIGN_FLAG_KEYS } from "./designMigrationTypes.js";

// Feature flags
export {
  isDesignWorkspaceEnabled,
  isDynamicBriefEnabled,
  isPluginRuntimeEnabled,
  isMaterialLibraryEnabled,
  isComponentLibraryEnabled,
  isAiOrchestrationEnabled,
  isExportWorkspaceEnabled,
  getDesignFlagContext,
  seedDesignFlags,
  isFlagEnabled,
  upsertFlag,
} from "./designFeatureFlag.js";

// Adapters (unit-testable, pure mapping)
export { mapLegacyBrief } from "./legacyBriefAdapter.js";
export { mapLegacyWorkflow, isProjectStatusMappable } from "./legacyWorkflowAdapter.js";
export { mapLegacyAsset, mapLegacyAssets } from "./legacyArtifactAdapter.js";
export { mapLegacyDesignProject } from "./legacyDesignProjectAdapter.js";
export type { LegacyProjectInput } from "./legacyDesignProjectAdapter.js";

// Compatibility adapter (DB reads + feature-flag routing)
export {
  DESIGN_CONTRACT_VERSION,
  loadLegacyProjectData,
  getCanonicalProject,
  getFeatureFlaggedProject,
  dualReadCompare,
  checkProjectReadiness,
} from "./designCompatibilityAdapter.js";
export type { LegacyProjectData } from "./designCompatibilityAdapter.js";

// Migration service
export {
  ensureMigrationTable,
  buildMigrationPlan,
  discoverProjectsForMigration,
  executeMigration,
  getMigrationRollbackSnapshot,
} from "./designMigrationService.js";
