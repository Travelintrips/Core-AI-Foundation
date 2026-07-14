import type { RecommendationCategory } from "./types";

/** Deterministic scoring weights (section 15 of the brief). */
export const SCORE_WEIGHTS = {
  industryMatch: 40,
  serviceRelevance: 30,
  goal: 20,
  audience: 15,
  companySize: 5,
  priority: 5,
  conflictPenalty: -30,
} as const;

/** Default per-category recommendation limits (section 21), before any
 *  per-service-profile override is applied. */
export const DEFAULT_CATEGORY_LIMITS: Record<RecommendationCategory, number> = {
  style: 4,
  color: 4,
  audience: 4,
  personality: 5,
  deliverable: 6,
  toneOfVoice: 4,
  visualDirection: 5,
  photographyDirection: 4,
  contentDirection: 5,
};

/** Confidence thresholds against the normalized (0-100) score. */
export const CONFIDENCE_THRESHOLDS = {
  high: 70,
  medium: 40,
} as const;
