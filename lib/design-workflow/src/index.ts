/**
 * @workspace/design-workflow — Public API
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * HOW TO ADD A NEW WORKFLOW
 * ─────────────────────────
 * 1. Create a DesignWorkflowDefinition in your plugin module:
 *
 *    import type { DesignWorkflowDefinition } from "@workspace/design-workflow";
 *
 *    export const myWorkflow: DesignWorkflowDefinition = {
 *      workflowId: "my-plugin.my-workflow",
 *      version: 1,
 *      pluginId: "my-plugin",
 *      supportedServiceTypes: ["my_service_type"],
 *      stages: [...],
 *      requiredCapabilities: [...],
 *      completionPolicy: { type: "all_required" },
 *      fallbackBehavior: { onRequiredStageFailure: "fail_workflow", onOptionalStageFailure: "continue" },
 *      createdAt: new Date(), updatedAt: new Date(),
 *    };
 *
 * 2. Validate before registering:
 *
 *    const validator = new WorkflowValidator({ knownCapabilities });
 *    validator.assertValid(myWorkflow); // throws on invalid definition
 *
 * 3. Register with the shared registry:
 *
 *    const registry = new WorkflowRegistry();
 *    registry.register(myWorkflow);
 *
 * 4. Resolve at runtime:
 *
 *    const { definition, explanation } = registry.resolve({
 *      workflowId: "my-plugin.my-workflow",
 *    });
 *    console.log(explanation.reason); // explainability
 *
 * 5. Resolve active stages for a project:
 *
 *    const resolver = new ConditionalStageResolver();
 *    const { active, excluded } = resolver.resolve(definition, projectContext);
 *
 * 6. Adapt legacy steps (read-only):
 *
 *    const adapter = new LegacyCreativeStepAdapter(definition);
 *    const { snapshots, unmappedStepNames } = adapter.adaptSteps(legacySteps);
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  ConditionExpression,
  ArtifactSpec,
  ReviewGateRef,
  StageDefinition,
  CompletionPolicySpec,
  FallbackBehavior,
  MigrationMetadata,
  DesignWorkflowDefinition,
} from "./types/definition.js";

export type {
  WorkflowQuery,
  WorkflowResolutionExplanation,
  ResolvedWorkflow,
  RegistryEntry,
} from "./types/registry.js";

export type {
  ProjectContext,
  ConditionEvaluation,
  EligibilityResult,
  ResolvedStageSet,
} from "./types/evaluator.js";

export type {
  LegacyProjectStep,
  LegacyStageSnapshot,
  LegacyAdapterResult,
} from "./types/adapter.js";

export type {
  StageStatus,
  StageState,
  GateStatus,
  ReviewRecord,
  CompletionCheck,
  GateCheck,
} from "./types/policy.js";

// ── Schemas ───────────────────────────────────────────────────────────────────

export {
  conditionExpressionSchema,
  artifactSpecSchema,
  reviewGateRefSchema,
  stageDefinitionSchema,
  completionPolicySchema,
  fallbackBehaviorSchema,
  migrationMetadataSchema,
  designWorkflowDefinitionSchema,
} from "./schema/definition.schema.js";

// ── Registry ──────────────────────────────────────────────────────────────────

export { WorkflowRegistry, WorkflowRegistryError } from "./registry/WorkflowRegistry.js";

// ── Validator ─────────────────────────────────────────────────────────────────

export {
  WorkflowValidator,
  type ValidationResult,
  type ValidationIssue,
  type ValidationSeverity,
  type ValidatorOptions,
} from "./validator/WorkflowValidator.js";

// ── Evaluator ─────────────────────────────────────────────────────────────────

export { StageEligibilityEvaluator } from "./evaluator/StageEligibilityEvaluator.js";
export { ConditionalStageResolver } from "./evaluator/ConditionalStageResolver.js";

// ── Policy ────────────────────────────────────────────────────────────────────

export { CompletionPolicyEvaluator } from "./policy/CompletionPolicy.js";
export { ReviewGatePolicy } from "./policy/ReviewGatePolicy.js";

// ── Adapter ───────────────────────────────────────────────────────────────────

export { LegacyCreativeStepAdapter } from "./adapter/LegacyCreativeStepAdapter.js";

// ── Fixtures (domain workflow examples) ──────────────────────────────────────

export { fashionWorkflow } from "./fixtures/fashion.workflow.js";
export { interiorWorkflow } from "./fixtures/interior.workflow.js";
export { packagingWorkflow } from "./fixtures/packaging.workflow.js";
export { brandingWorkflow } from "./fixtures/branding.workflow.js";
