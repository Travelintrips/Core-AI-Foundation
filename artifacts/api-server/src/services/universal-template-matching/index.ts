/**
 * Universal Template Matching — Public API
 *
 * Import from here, not from sub-modules, to keep the interface stable.
 */

export type {
  Blueprint,
  Component,
  Pattern,
  TokenLibraryEntry,
  BlueprintPort,
  ComponentPort,
  PatternPort,
  TokenLibraryPort,
  MatchingDeps,
} from "./ports.js";

export type {
  BriefBrandDna,
  MatchInput,
  ScoreDimension,
  ScoreBreakdown,
  MatchRecommendation,
  RejectedBlueprint,
  MatchResult,
} from "./types.js";

export {
  scoreBlueprint,
  runMatching,
  normaliseScore,
  computeConfidence,
  computeMaxPossibleScore,
  checkConstraints,
  tokeniseBrief,
  compareRecommendations,
  auditSignals,
} from "./scoring.js";

export {
  DbBlueprintPort,
  StaticComponentPort,
  StaticPatternPort,
  StaticTokenLibraryPort,
  createDefaultDeps,
} from "./adapters.js";

export {
  UniversalTemplateMatcher,
  getDefaultMatcher,
} from "./service.js";
