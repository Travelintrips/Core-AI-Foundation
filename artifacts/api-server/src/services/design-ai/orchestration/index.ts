/**
 * Team 31 — Universal Design AI Orchestration Adapter
 * Public barrel — the only import surface callers should use.
 */

// Types
export type {
  DesignAiExecutionRequest,
  DesignAiExecutionContext,
  DesignAiCapabilityBinding,
  DesignAiExecutionPlan,
  DesignAiExecutionResult,
  DesignAiExecutionError,
  DesignAiJobPayload,
  DesignAiOutputEnvelope,
  DesignAiBudgetPolicy,
  DesignAiQualityPolicy,
  DesignAiArtifactDescriptor,
  DesignAiActorContext,
  DesignAiProvenance,
  DesignAiPlanStep,
  DesignAiPlanStepKind,
  DesignAiErrorCode,
  DesignAiValidationStatus,
} from "./types.js";

export { DESIGN_AI_ERROR_CODES } from "./types.js";

// Resolver
export { DesignAiCapabilityResolver } from "./capabilityResolver.js";
export type { CapabilityResolutionResult } from "./capabilityResolver.js";

// Adapter
export {
  DesignAiExecutionAdapter,
  designAiExecutionAdapter,
  buildIdempotencyHash,
} from "./executionAdapter.js";
