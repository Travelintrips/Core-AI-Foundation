/**
 * Brief Intelligence Engine — Domain types.
 *
 * Pure, deterministic, rule-based domain model. No AI/LLM calls, no
 * scraping, no embeddings, no network I/O. Every type here is plain data;
 * the engine never imports React.
 */

import type { ServiceType } from "@/config/brief-service-config";

export const ENGINE_VERSION = "brief-intelligence-v1" as const;

// ── Context (engine input) ─────────────────────────────────────────────────

/** Stable-key context built from the live brief state. Never contains labels. */
export interface BriefIntelligenceContext {
  serviceType: ServiceType;
  /** Matched INDUSTRY_OPTIONS value, or null if nothing selected yet. */
  industryKey: string | null;
  /** Raw text typed for "Lainnya" — used only for fallback alias matching. */
  industryCustomText: string;
  companySizeKey: string | null;
  /** GOAL_OPTIONS values already selected by the user. */
  goalKeys: string[];
  /** AUDIENCE_OPTIONS values already selected by the user. */
  audienceKeys: string[];
  /** ASSET_OPTIONS values already selected by the user (existing assets). */
  existingAssetKeys: string[];
  priorityKey: string | null;
  /** Values the user has ALREADY chosen — never recommend or overwrite these. */
  selected: {
    styleKeys: string[];
    colorKeys: string[];
  };
}

// ── Recommendation categories ──────────────────────────────────────────────

export type RecommendationCategory =
  | "style"
  | "color"
  | "audience"
  | "personality"
  | "deliverable"
  | "toneOfVoice"
  | "photographyDirection"
  | "visualDirection"
  | "contentDirection";

/** Categories with a direct, existing BriefData field they can be applied to. */
export const APPLIABLE_CATEGORIES: RecommendationCategory[] = ["style", "color", "audience", "deliverable"];

/** Categories that are advisory-only: shown for context, no direct field to write into. */
export const ADVISORY_ONLY_CATEGORIES: RecommendationCategory[] = [
  "personality", "toneOfVoice", "photographyDirection", "visualDirection", "contentDirection",
];

export type ConfidenceLevel = "low" | "medium" | "high";

export type RecommendationSource =
  | "industry"
  | "service"
  | "goal"
  | "audience"
  | "company-size"
  | "priority"
  | "existing-assets"
  | "fallback";

export interface RecommendationReason {
  source: RecommendationSource;
  text: string;
}

/** A single recommended value within a category (e.g. style="minimalis"). */
export interface BriefRecommendation {
  category: RecommendationCategory;
  /** Stable key — matches the relevant *_OPTIONS registry in brief-options.ts.
   *  For advisory categories with no registry (personality, tone, etc.) this
   *  is a free-form slug local to industry-profiles.ts (still stable/typed,
   *  just not user-facing chip data). */
  key: string;
  /** Human label to render (Indonesian, matches existing UI copy style). */
  label: string;
  /** 0-100 raw score before normalization. */
  score: number;
  confidence: ConfidenceLevel;
  reasons: RecommendationReason[];
  sources: RecommendationSource[];
}

export type ConflictSeverity = "info" | "warning";

export interface ConflictWarning {
  code: string;
  severity: ConflictSeverity;
  message: string;
  affectedKeys: string[];
}

export interface RecommendationCategoryResult {
  category: RecommendationCategory;
  items: BriefRecommendation[];
}

export interface BriefIntelligenceResult {
  engineVersion: typeof ENGINE_VERSION;
  /** Whether at least industry or service context was available to reason from. */
  hasEnoughContext: boolean;
  /** 0-100: how much of the relevant context the engine had to work with. */
  completeness: number;
  categories: RecommendationCategoryResult[];
  warnings: ConflictWarning[];
  /** True when the industry didn't match a named profile and a generic
   *  category-default / alias fallback was used instead. */
  usedFallbackIndustry: boolean;
  /** Debug-only breakdown; never rendered in production UI. */
  debug: {
    matchedIndustryProfileKey: string | null;
    /** How the industry profile was resolved:
     *  - "exact"   — industryKey matched a named profile directly
     *  - "alias"   — free-text was matched via the alias table to a named profile
     *  - "generic-fallback" — alias matching failed; using the generic profile
     *  - null      — no industry context provided
     */
    industryMatchType: "exact" | "alias" | "generic-fallback" | null;
    matchedServiceProfileKey: string;
    appliedRuleSources: RecommendationSource[];
  };
}

// ── Apply adapter ───────────────────────────────────────────────────────────

export type ApplyMode = "apply-single" | "apply-category" | "apply-all-empty-only";

export interface ApplySkip {
  category: RecommendationCategory;
  key?: string;
  reason: string;
}

export interface ApplyRecommendationResult<TBrief> {
  updatedBrief: TBrief;
  applied: { category: RecommendationCategory; key: string }[];
  skipped: ApplySkip[];
  warnings: string[];
}

// ── Industry / service / rule registries ───────────────────────────────────

export interface IndustryProfile {
  key: string;
  label: string;
  categoryGroup: string;
  styles: string[];
  colors: string[];
  audiences: string[];
  personalities: string[];
  deliverables: string[];
  toneOfVoice: string[];
  photographyDirection: string[];
  visualDirection: string[];
  contentDirection: string[];
  avoid: string[];
  notes: string;
}

export interface ServiceProfile {
  serviceType: ServiceType;
  /** Categories most relevant for this service, in priority order (first = highest weight). */
  priorityCategories: RecommendationCategory[];
  /** Per-category item limit overrides (falls back to CATEGORY_LIMITS default). */
  categoryLimits?: Partial<Record<RecommendationCategory, number>>;
}

export interface CategoryBoost {
  category: RecommendationCategory;
  key: string;
  label: string;
  weight: number;
}
