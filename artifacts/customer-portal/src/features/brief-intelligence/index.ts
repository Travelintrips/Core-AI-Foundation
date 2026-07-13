/**
 * Brief Intelligence Engine — public barrel.
 *
 * Consumers (brief.tsx) should only import from this file, never reach
 * into individual modules directly.
 */

export { computeBriefRecommendations } from "./engine";
export { buildBriefIntelligenceContext } from "./context-adapter";
export { applyRecommendations } from "./apply-adapter";
export { explainRecommendation } from "./recommendation-explanations";
export { ENGINE_VERSION, APPLIABLE_CATEGORIES, ADVISORY_ONLY_CATEGORIES } from "./types";
export type {
  BriefIntelligenceContext, BriefIntelligenceResult, BriefRecommendation,
  RecommendationCategory, RecommendationCategoryResult, ConflictWarning,
  ApplyMode, ApplyRecommendationResult, ApplySkip, ConfidenceLevel,
} from "./types";

export { BriefRecommendationPanel } from "./components/BriefRecommendationPanel";
