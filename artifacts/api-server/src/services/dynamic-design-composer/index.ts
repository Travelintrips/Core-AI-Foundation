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
} from "./types.js";
