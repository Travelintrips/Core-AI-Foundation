/**
 * Validates/clamps the merged recommendation list: assigns confidence,
 * applies per-category limits, and guarantees categories are never empty
 * arrays with malformed data (section 15/21).
 */

import { CONFIDENCE_THRESHOLDS, DEFAULT_CATEGORY_LIMITS } from "./constants";
import type { BriefRecommendation, ConfidenceLevel, RecommendationCategory, ServiceProfile } from "./types";

export function scoreToConfidence(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (score >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

/** Normalizes raw accumulated scores into a 0-100 range relative to the
 *  highest-scoring item in the same category, so confidence bands stay
 *  meaningful regardless of how many rule sources contributed. */
export function normalizeAndLimit(
  recommendations: BriefRecommendation[],
  serviceProfile: ServiceProfile,
): BriefRecommendation[] {
  const byCategory = new Map<RecommendationCategory, BriefRecommendation[]>();
  for (const rec of recommendations) {
    const list = byCategory.get(rec.category) ?? [];
    list.push(rec);
    byCategory.set(rec.category, list);
  }

  const result: BriefRecommendation[] = [];
  for (const [category, items] of byCategory) {
    const max = Math.max(...items.map((i) => i.score), 1);
    const limit = serviceProfile.categoryLimits?.[category] ?? DEFAULT_CATEGORY_LIMITS[category];

    const normalized = items
      .map((item) => {
        const normalizedScore = Math.round((item.score / max) * 100);
        return { ...item, score: normalizedScore, confidence: scoreToConfidence(normalizedScore) };
      })
      // Deterministic tie-break already applied by the merger's sort, but
      // re-assert it here since normalization can create score ties.
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.key.localeCompare(b.key)))
      .slice(0, limit);

    result.push(...normalized);
  }

  return result;
}
