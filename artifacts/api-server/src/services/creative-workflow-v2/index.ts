/**
 * creative-workflow-v2 — Service Barrel
 *
 * Public surface of the Creative Workflow Engine domain (Team 1).
 * Team 24 imports from here when wiring routes and adapters.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

// ── Core engine ───────────────────────────────────────────────────────────────
export { buildExecutionPlan, validateWorkflowDefinition, MAX_WORKFLOW_NODES } from "./executionPlanBuilder.js";

// ── Graph algorithms ──────────────────────────────────────────────────────────
export { detectCycle, assertAcyclic } from "./cycleDetector.js";
export { buildParallelGroups, resolveUnblockedSuccessors, buildReverseAdjacency } from "./parallelGrouper.js";
export { calculateCriticalPath } from "./criticalPathCalculator.js";

// ── Progress & state ──────────────────────────────────────────────────────────
export { calculateProgress, isMilestoneReached, derivePlanStatus } from "./progressCalculator.js";

// ── Plan lifecycle (pure transitions) ─────────────────────────────────────────
export {
  startPlan,
  pausePlan,
  resumePlan,
  cancelPlan,
  markNodeRunning,
  markNodeCompleted,
  markNodeSkipped,
  markNodeReady,
} from "./planControlService.js";

// ── Retry policy ──────────────────────────────────────────────────────────────
export {
  applyRetry,
  canAutoRetry,
  isRetryExhausted,
  computeNextRetryDelayMs,
  buildRetryState,
  mergeRetryPolicy,
  DEFAULT_RETRY_POLICY,
} from "./retryPolicyService.js";

// ── Null ports (for testing / local dev) ──────────────────────────────────────
export { NullQueuePort }      from "./ports/nullQueuePort.js";
export { NullDispatcherPort } from "./ports/nullDispatcherPort.js";
export { NullEventBusPort }   from "./ports/nullEventBusPort.js";
export { NullWorkerPort }     from "./ports/nullWorkerPort.js";
