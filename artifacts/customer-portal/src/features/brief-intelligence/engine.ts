/**
 * Brief Intelligence Engine — main entry point.
 *
 * computeBriefRecommendations() is a pure function: same input always
 * produces the same output. No I/O, no randomness, no AI/LLM calls.
 */

import { SCORE_WEIGHTS } from "./constants";
import { getIndustryProfile } from "./industry-profiles";
import { resolveFallbackIndustry, GENERIC_FALLBACK_PROFILE } from "./industry-fallback";
import { getServiceProfile } from "./service-profiles";
import { GOAL_RULES } from "./goal-rules";
import { AUDIENCE_RULES } from "./audience-rules";
import { COMPANY_SIZE_RULES } from "./company-size-rules";
import { PRIORITY_RULES } from "./priority-rules";
import { detectConflicts, type ConflictContext } from "./conflict-rules";
import { mergeCandidates, type Candidate } from "./recommendation-merger";
import { normalizeAndLimit } from "./recommendation-validator";
import { computeCompleteness } from "./completeness";
import { ENGINE_VERSION } from "./types";
import type {
  BriefIntelligenceContext, BriefIntelligenceResult, BriefRecommendation,
  IndustryProfile, RecommendationCategory, RecommendationCategoryResult, RecommendationSource,
} from "./types";

/** Industry profile category → RecommendationCategory field name mapping. */
const INDUSTRY_CATEGORY_FIELDS: { field: keyof IndustryProfile; category: RecommendationCategory }[] = [
  { field: "styles", category: "style" },
  { field: "colors", category: "color" },
  { field: "audiences", category: "audience" },
  { field: "personalities", category: "personality" },
  { field: "deliverables", category: "deliverable" },
  { field: "toneOfVoice", category: "toneOfVoice" },
  { field: "photographyDirection", category: "photographyDirection" },
  { field: "visualDirection", category: "visualDirection" },
  { field: "contentDirection", category: "contentDirection" },
];

function industryCandidates(profile: IndustryProfile, source: RecommendationSource, label: string): Candidate[] {
  const out: Candidate[] = [];
  for (const { field, category } of INDUSTRY_CATEGORY_FIELDS) {
    const values = profile[field] as string[];
    values.forEach((v, idx) => {
      // Earlier items in a profile's list carry slightly more weight —
      // deterministic, not random.
      const positionalBoost = Math.max(0, 6 - idx);
      out.push({
        category,
        key: v,
        label: v,
        score: SCORE_WEIGHTS.industryMatch + positionalBoost,
        source,
        reasonText: label,
      });
    });
  }
  return out;
}

export function computeBriefRecommendations(ctx: BriefIntelligenceContext): BriefIntelligenceResult {
  const appliedRuleSources: RecommendationSource[] = [];
  /** True ONLY for the truly-unknown generic fallback — alias matches are NOT
   *  considered "unknown" and must NOT trigger the "Industri belum spesifik" badge. */
  let usedFallbackIndustry = false;
  let matchedIndustryProfileKey: string | null = null;
  let industryMatchType: "exact" | "alias" | "generic-fallback" | null = null;

  // ── Resolve industry profile ────────────────────────────────────────────
  let industryProfile: IndustryProfile | null = getIndustryProfile(ctx.industryKey);
  if (industryProfile) {
    matchedIndustryProfileKey = industryProfile.key;
    industryMatchType = "exact";
  } else if (ctx.industryCustomText.trim()) {
    const fallback = resolveFallbackIndustry(ctx.industryCustomText);
    if (fallback.profile) {
      // Alias match — the industry IS known; do NOT set usedFallbackIndustry.
      industryProfile = fallback.profile;
      matchedIndustryProfileKey = fallback.matchedKey;
      industryMatchType = "alias";
    } else {
      // Truly unknown — use the safe generic profile and flag accordingly.
      industryProfile = GENERIC_FALLBACK_PROFILE;
      matchedIndustryProfileKey = null;
      usedFallbackIndustry = true;
      industryMatchType = "generic-fallback";
    }
  }

  const serviceProfile = getServiceProfile(ctx.serviceType);

  const candidates: Candidate[] = [];

  if (industryProfile) {
    appliedRuleSources.push("industry");
    candidates.push(...industryCandidates(industryProfile, "industry", `Cocok dengan profil industri "${industryProfile.label}"`));
  }

  // ── Service relevance: boost the categories this service prioritizes by
  //    adding a flat score bump to *existing* industry candidates in that
  //    category (never invents new keys on its own). ──────────────────────
  if (industryProfile) {
    appliedRuleSources.push("service");
    serviceProfile.priorityCategories.forEach((category, idx) => {
      const boost = Math.max(0, SCORE_WEIGHTS.serviceRelevance - idx * 4);
      for (const c of candidates) {
        if (c.category === category && c.source === "industry") {
          c.score += boost;
        }
      }
    });
  }

  // ── Goal rules ───────────────────────────────────────────────────────────
  if (ctx.goalKeys.length > 0) appliedRuleSources.push("goal");
  for (const goalKey of ctx.goalKeys) {
    const boosts = GOAL_RULES[goalKey] ?? [];
    for (const b of boosts) {
      candidates.push({
        category: b.category, key: b.key, label: b.label,
        score: SCORE_WEIGHTS.goal + b.weight, source: "goal",
        reasonText: `Mendukung tujuan project yang Anda pilih`,
      });
    }
  }

  // ── Audience rules ───────────────────────────────────────────────────────
  if (ctx.audienceKeys.length > 0) appliedRuleSources.push("audience");
  for (const audienceKey of ctx.audienceKeys) {
    const boosts = AUDIENCE_RULES[audienceKey] ?? [];
    for (const b of boosts) {
      candidates.push({
        category: b.category, key: b.key, label: b.label,
        score: SCORE_WEIGHTS.audience + b.weight, source: "audience",
        reasonText: `Sesuai dengan target audiens yang Anda pilih`,
      });
    }
  }

  // ── Company size rules ───────────────────────────────────────────────────
  if (ctx.companySizeKey) {
    appliedRuleSources.push("company-size");
    const boosts = COMPANY_SIZE_RULES[ctx.companySizeKey] ?? [];
    for (const b of boosts) {
      candidates.push({
        category: b.category, key: b.key, label: b.label,
        score: SCORE_WEIGHTS.companySize + b.weight, source: "company-size",
        reasonText: `Sesuai skala bisnis Anda`,
      });
    }
  }

  // ── Priority rules ───────────────────────────────────────────────────────
  if (ctx.priorityKey) {
    appliedRuleSources.push("priority");
    const boosts = PRIORITY_RULES[ctx.priorityKey] ?? [];
    for (const b of boosts) {
      candidates.push({
        category: b.category, key: b.key, label: b.label,
        score: SCORE_WEIGHTS.priority + b.weight, source: "priority",
        reasonText: `Sesuai prioritas yang Anda pilih`,
      });
    }
  }

  if (usedFallbackIndustry) appliedRuleSources.push("fallback");

  // ── Merge, apply conflict penalty, normalize, limit, confidence ─────────
  let merged = mergeCandidates(candidates);

  // Conflict penalty (section 15/17): apply a score penalty to items that
  // participate in a detected conflict, but never remove them — conflicts
  // are surfaced as non-blocking warnings, not filters.
  const recommendedStyleKeys = merged.filter((m) => m.category === "style").map((m) => m.key);
  const recommendedAudienceKeys = merged.filter((m) => m.category === "audience").map((m) => m.key);
  const allStyleKeys = Array.from(new Set([...ctx.selected.styleKeys, ...recommendedStyleKeys]));
  const allAudienceKeys = Array.from(new Set([...ctx.audienceKeys, ...recommendedAudienceKeys]));

  // Build extended context for Phase 3.1 context-aware conflict rules.
  const conflictCtx: ConflictContext = {
    existingAssetKeys: ctx.existingAssetKeys,
    priorityKey: ctx.priorityKey,
    deliverableCount: merged.filter((m) => m.category === "deliverable").length,
    hasPhotographyRecommendation: merged.some((m) => m.category === "photographyDirection"),
  };
  const warnings = detectConflicts(allStyleKeys, allAudienceKeys, conflictCtx);

  if (warnings.length > 0) {
    const conflictedKeys = new Set(warnings.flatMap((w) => w.affectedKeys));
    merged = merged.map((m) =>
      conflictedKeys.has(m.key) ? { ...m, score: m.score + SCORE_WEIGHTS.conflictPenalty } : m,
    );
  }

  // Never recommend a value the user already explicitly selected — filter
  // those out entirely rather than showing a "recommendation" for something
  // they've already chosen (section 16).
  merged = merged.filter((m) => {
    if (m.category === "style") return !ctx.selected.styleKeys.includes(m.key);
    if (m.category === "color") return !ctx.selected.colorKeys.includes(m.key);
    if (m.category === "audience") return !ctx.audienceKeys.includes(m.key);
    return true;
  });

  const normalized: BriefRecommendation[] = normalizeAndLimit(merged, serviceProfile);

  const categories: RecommendationCategoryResult[] = (Object.keys(
    normalized.reduce((acc, r) => ({ ...acc, [r.category]: true }), {} as Record<string, boolean>),
  ) as RecommendationCategory[])
    .sort()
    .map((category) => ({
      category,
      items: normalized.filter((r) => r.category === category),
    }));

  const completeness = computeCompleteness(ctx);
  const hasEnoughContext = Boolean(industryProfile) || ctx.serviceType !== "default";

  return {
    engineVersion: ENGINE_VERSION,
    hasEnoughContext,
    completeness,
    categories,
    warnings,
    usedFallbackIndustry,
    debug: {
      matchedIndustryProfileKey,
      industryMatchType,
      matchedServiceProfileKey: serviceProfile.serviceType,
      appliedRuleSources: Array.from(new Set(appliedRuleSources)),
    },
  };
}
