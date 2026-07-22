/**
 * design-lifecycle/index.ts — Team 08 public API
 *
 * Only these exports are intended for use by other modules.
 * Internal adapter functions are NOT re-exported here to preserve
 * the single-entry-point contract.
 */

// Application service — the primary integration point
export {
  getProject,
  getStages,
  getArtifacts,
  transitionLifecycle,
  upsertStage,
  attachProjectArtifact,
  mapLegacyProject,
} from "./designProjectLifecycleService.js";

// Types
export type {
  DesignStage,
  DesignProjectView,
  DesignStageRecord,
  DesignArtifact,
  LifecycleEventPayload,
  TransitionOptions,
} from "./types.js";

// Errors (typed — callers catch by name)
export {
  LifecycleNotFoundError,
  LifecycleInvalidTransitionError,
  LifecycleStaleVersionError,
  LifecycleTerminalStateError,
} from "./types.js";

// Status mapping helpers (read-only utilities for consumers)
export {
  toDesignStage,
  toRawStatus,
  isDesignStage,
  isTerminal,
  DESIGN_STAGE_TO_STATUS,
  STATUS_TO_DESIGN_STAGE,
  TERMINAL_STAGES,
} from "./lifecycleStatusMap.js";

// Transition graph (read-only — useful for UI "next actions" rendering)
export {
  ALLOWED_TRANSITIONS,
  allowedNext,
  isValidTransition,
  guardTransition,
} from "./lifecycleTransitions.js";
