/**
 * Team 13 — Dynamic Design Composition Engine
 * Public API
 *
 * Re-exports everything the route layer needs.
 * Internal modules are not exported from here — import them directly.
 */

export { compose } from "./composerEngine.js";
export { checkCompatibility } from "./compatibilityChecker.js";
export { checkBrandConsistency } from "./brandConsistencyChecker.js";
export { applyFallbacks } from "./fallbackHandler.js";
export { buildExplainabilityReport } from "./explainabilityEngine.js";
export {
  compositionRequestSchema,
  validateRequestSchema,
  compatibilityCheckSchema,
} from "./schemas.js";

// ── State machine + session store ─────────────────────────────────────────────

export {
  guardCompositionState,
  validateTransition,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
} from "./compositionStateGuard.js";
export type { TerminalStateError } from "./compositionStateGuard.js";

export {
  getSession,
  createSession,
  transitionSession,
  deleteSession,
  sessionCount,
  clearStore,
  SESSION_TTL_MS,
} from "./compositionSessionStore.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  CompositionRequest,
  DesignCompositionSpec,
  BrandDnaInput,
  BlueprintInput,
  LayoutPlanInput,
  ComponentInput,
  PatternInput,
  PaletteInput,
  TypographyInput,
  DecorationInput,
  MaterialInput,
  MotifInput,
  ResolvedComponent,
  ExplainabilityReport,
  DecisionExplanation,
  FallbackRecord,
  BrandConsistencyReport,
  CompatibilityReport,
  CompositionState,
  CompositionSession,
} from "./types.js";
