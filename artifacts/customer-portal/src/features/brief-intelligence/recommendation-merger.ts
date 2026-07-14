/**
 * Dedup/merge candidate recommendations that arrive from multiple rule
 * sources (industry, service, goal, audience, company-size, priority) into
 * one BriefRecommendation per (category, key), accumulating score/reasons.
 */

import type { BriefRecommendation, RecommendationCategory, RecommendationReason, RecommendationSource } from "./types";

export interface Candidate {
  category: RecommendationCategory;
  key: string;
  label: string;
  score: number;
  source: RecommendationSource;
  reasonText: string;
}

/** Deterministic dedup key — category+key, case-insensitive on key so
 *  "Bold" and "bold" never split into two entries. */
function dedupeKey(category: RecommendationCategory, key: string): string {
  return `${category}::${key.toLowerCase()}`;
}

export function mergeCandidates(candidates: Candidate[]): BriefRecommendation[] {
  const byKey = new Map<string, BriefRecommendation>();

  for (const c of candidates) {
    const dk = dedupeKey(c.category, c.key);
    const existing = byKey.get(dk);
    const reason: RecommendationReason = { source: c.source, text: c.reasonText };

    if (!existing) {
      byKey.set(dk, {
        category: c.category,
        key: c.key,
        label: c.label,
        score: c.score,
        confidence: "low", // assigned later by the engine after normalization
        reasons: [reason],
        sources: [c.source],
      });
    } else {
      existing.score += c.score;
      if (!existing.sources.includes(c.source)) existing.sources.push(c.source);
      // Keep at most 3 reasons (section 29) — first 3 sources encountered win,
      // which is deterministic given the engine always evaluates sources in
      // the same fixed order (industry -> service -> goal -> audience ->
      // company-size -> priority -> fallback).
      if (existing.reasons.length < 3) existing.reasons.push(reason);
    }
  }

  // Deterministic order: sort by score desc, then category asc, then key asc
  // (tie-break) so output never depends on Map iteration/insertion nuances.
  return Array.from(byKey.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.key.localeCompare(b.key);
  });
}
