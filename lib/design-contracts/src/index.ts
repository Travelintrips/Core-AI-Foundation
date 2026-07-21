/**
 * @workspace/design-contracts — Public API
 *
 * This is the ONLY import path Team 02–40 should use.
 * Do not import from internal sub-modules directly.
 *
 * Usage:
 *   import {
 *     DesignProjectContextSchema,
 *     DesignArtifactContractSchema,
 *     DESIGN_CONTRACT_VERSION,
 *     assertCompatibleVersion,
 *   } from "@workspace/design-contracts";
 *
 * Example JSON objects (for testing / documentation):
 *   import { FASHION_EXAMPLE, INTERIOR_EXAMPLE } from "@workspace/design-contracts/examples";
 */

// ── Version ───────────────────────────────────────────────────────────────────
export {
  DESIGN_CONTRACT_VERSION,
  MINIMUM_SUPPORTED_CONTRACT_VERSION,
  DESIGN_CONTRACT_VERSION_LABEL,
} from "./version.js";

// ── Compatibility ─────────────────────────────────────────────────────────────
export {
  ArchitectureCompatibilityError,
  isCompatibleVersion,
  assertCompatibleVersion,
  checkCompatibility,
} from "./compatibility.js";

// ── Validation ────────────────────────────────────────────────────────────────
export {
  ARCHITECTURE_ERROR_CODES,
  type ArchitectureErrorCode,
  type ValidationIssue,
  type ValidationSuccess,
  type ValidationFailure,
  type ValidationResult,
  ok,
  fail,
  parseContract,
} from "./validation.js";

// ── Context ───────────────────────────────────────────────────────────────────
export {
  DESIGN_ACTOR_TYPES,
  type DesignActorType,
  DesignActorRefSchema,
  type DesignActorRef,
  DESIGN_PROJECT_STATUSES,
  type DesignProjectStatus,
  DesignBrandContextSchema,
  type DesignBrandContext,
  DesignProjectContextSchema,
  type DesignProjectContext,
} from "./context.js";

// ── Stage ─────────────────────────────────────────────────────────────────────
export {
  DESIGN_STAGE_CATEGORIES,
  type DesignStageCategory,
  DESIGN_ARTIFACT_TYPES,
  type DesignArtifactType,
  COMPLETION_POLICIES,
  type CompletionPolicy,
  DesignStageDefinitionSchema,
  type DesignStageDefinition,
  detectStageCycles,
} from "./stage.js";

// ── Artifact ──────────────────────────────────────────────────────────────────
export {
  ARTIFACT_STATUSES,
  type ArtifactStatus,
  ARTIFACT_REVIEW_STATUSES,
  type ArtifactReviewStatus,
  GENERATION_SOURCES,
  type GenerationSource,
  StorageRefSchema,
  type StorageRef,
  ArtifactProvenanceSchema,
  type ArtifactProvenance,
  ArtifactMetadataSchema,
  type ArtifactMetadata,
  DesignArtifactContractSchema,
  type DesignArtifactContract,
} from "./artifact.js";

// ── Plugin ────────────────────────────────────────────────────────────────────
export {
  PluginCapabilityFlagSchema,
  type PluginCapabilityFlag,
  PluginFeatureFlagSchema,
  type PluginFeatureFlag,
  PluginDependencySchema,
  type PluginDependency,
  DesignPluginManifestSchema,
  type DesignPluginManifest,
} from "./plugin.js";

// ── Capability ────────────────────────────────────────────────────────────────
export {
  EXECUTION_MODES,
  type ExecutionMode,
  CAPABILITY_CATEGORIES,
  type CapabilityCategory,
  EXECUTION_PRIORITIES,
  type ExecutionPriority,
  ExecutionEstimationSchema,
  type ExecutionEstimation,
  AiRequirementSchema,
  type AiRequirement,
  RendererRequirementSchema,
  type RendererRequirement,
  DesignCapabilityContractSchema,
  type DesignCapabilityContract,
} from "./capability.js";

// ── Events & Commands ─────────────────────────────────────────────────────────
export {
  DesignCommandSchema,
  type DesignCommand,
  GenericDesignCommandSchema,
  type GenericDesignCommand,
  DesignEventSchema,
  type DesignEvent,
  GenericDesignEventSchema,
  type GenericDesignEvent,
  WELL_KNOWN_DESIGN_EVENTS,
  type WellKnownDesignEvent,
  WELL_KNOWN_DESIGN_COMMANDS,
  type WellKnownDesignCommand,
} from "./events.js";

// ── Contract Metadata (Task A) ────────────────────────────────────────────────
export {
  CONTRACT_METADATA_SOURCES,
  type ContractMetadataSource,
  WELL_KNOWN_GENERATORS,
  type WellKnownGenerator,
  ContractMetadataSchema,
  type ContractMetadata,
} from "./metadata.js";

// ── Artifact Relationship & Graph (Tasks B, C) ────────────────────────────────
export {
  RELATIONSHIP_TYPES,
  type RelationshipType,
  ArtifactRelationshipSchema,
  type ArtifactRelationship,
  type ArtifactGraphValidationResult,
  validateArtifactGraph,
  detectArtifactCycles,
  findArtifactDependencies,
  findArtifactDependents,
} from "./relationship.js";

// ── Deprecation & Feature Stability (Tasks H, I) ──────────────────────────────
export {
  FEATURE_STABILITIES,
  type FeatureStability,
  FeatureStabilitySchema,
  DeprecationPolicySchema,
  type DeprecationPolicy,
} from "./deprecation.js";
