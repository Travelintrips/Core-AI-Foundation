/**
 * Universal Template Matching — Deterministic Scoring Engine
 *
 * Rules:
 * - Pure functions only. No I/O, no side effects, no randomness.
 * - Same inputs always produce the same scores (deterministic).
 * - Domain-agnostic: works for any service type / domain.
 * - Constraint violations hard-reject a blueprint (score is never returned).
 * - Confidence reflects input richness, not just score height.
 * - Stable sort: ties broken by (featured DESC, usageCount DESC, id ASC).
 */

import type { Blueprint, TokenLibraryEntry } from "./ports.js";
import type {
  MatchInput,
  ScoreDimension,
  ScoreBreakdown,
  MatchRecommendation,
  RejectedBlueprint,
  MatchResult,
} from "./types.js";

// ── Weight Table ─────────────────────────────────────────────────────────────
// Sum of all base weights = 100. Bonus dimensions can push total above 100.

const WEIGHTS = {
  SERVICE_TYPE:    20,  // service type code match
  INDUSTRY:        18,  // industry match
  CATEGORY:        15,  // category / output type alignment
  PERSONALITY:     12,  // brand personality tags (up to 4 × 3 pts)
  AUDIENCE:        10,  // target audience overlap
  VOICE_STYLE:      8,  // brand voice / writing style
  OUTPUT_FORMAT:    7,  // required output format support
  PACKAGE:          5,  // package tier support
  STYLE_PREF:       5,  // style preference overlap
  // Bonus (outside 100 base)
  BRIEF_KEYWORDS:   8,  // brief keyword overlap
  COLOR_FAMILY:     5,  // primary color hue family match
  FEATURED:         4,  // admin-featured bonus
  POPULARITY:       3,  // usage-based bonus (capped)
} as const;

const MAX_BASE_SCORE = 100;
const MAX_PERSONALITY_BONUS = WEIGHTS.PERSONALITY; // cap

// ── Constraint Checking ───────────────────────────────────────────────────────

/**
 * Returns the first unsatisfied constraint, or null if all are satisfied.
 * A blueprint explicitly lists constraints it CANNOT handle; if any of the
 * required constraints appear in that deny-list, the blueprint is rejected.
 */
export function checkConstraints(
  blueprint: Blueprint,
  requiredConstraints: string[],
): string | null {
  if (requiredConstraints.length === 0) return null;
  const denied = new Set(blueprint.unsupportedConstraints.map((c) => c.toLowerCase()));
  for (const req of requiredConstraints) {
    if (denied.has(req.toLowerCase())) {
      return `Blueprint does not support constraint: "${req}"`;
    }
  }
  return null;
}

// ── Keyword Tokenizer ─────────────────────────────────────────────────────────

/**
 * Tokenises a free-text brief into lowercase alpha tokens (≥3 chars).
 * Stopwords are stripped to reduce noise.
 */
const STOPWORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "by","from","up","about","into","through","during","that","this","these",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can","need",
  "kami","dan","di","ke","dari","yang","dengan","untuk","ini","itu","adalah",
  "pada","dalam","atau","juga","tidak","telah","akan","dapat","sebagai",
]);

export function tokeniseBrief(brief: string): string[] {
  return brief
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// ── Per-Dimension Scorers ─────────────────────────────────────────────────────

function scoreServiceType(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Service Type";
  if (!input.serviceType) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.SERVICE_TYPE, matched: false,
      explanation: "No service type provided." };
  }
  const st = input.serviceType.toLowerCase();
  // Cross-service blueprints (empty serviceTypes) get half credit
  if (blueprint.serviceTypes.length === 0) {
    return { dimension: dim, awarded: Math.round(WEIGHTS.SERVICE_TYPE * 0.4), maximum: WEIGHTS.SERVICE_TYPE,
      matched: true, explanation: "Cross-service blueprint — partial credit." };
  }
  const hit = blueprint.serviceTypes.some((s) => s.toLowerCase() === st);
  if (hit) {
    return { dimension: dim, awarded: WEIGHTS.SERVICE_TYPE, maximum: WEIGHTS.SERVICE_TYPE,
      matched: true, explanation: `Service type "${input.serviceType}" matched.` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.SERVICE_TYPE, matched: false,
    explanation: `Blueprint supports [${blueprint.serviceTypes.join(", ")}], not "${input.serviceType}".` };
}

function scoreIndustry(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Industry";
  if (!input.industry) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.INDUSTRY, matched: false,
      explanation: "No industry provided." };
  }
  const ind = input.industry.toLowerCase();
  if (blueprint.industries.length === 0) {
    return { dimension: dim, awarded: Math.round(WEIGHTS.INDUSTRY * 0.4), maximum: WEIGHTS.INDUSTRY,
      matched: true, explanation: "Cross-industry blueprint — partial credit." };
  }
  const hit = blueprint.industries.some((i) => i.toLowerCase() === ind);
  if (hit) {
    return { dimension: dim, awarded: WEIGHTS.INDUSTRY, maximum: WEIGHTS.INDUSTRY,
      matched: true, explanation: `Industry "${input.industry}" matched.` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.INDUSTRY, matched: false,
    explanation: `Industry "${input.industry}" not in blueprint list [${blueprint.industries.join(", ")}].` };
}

function scoreCategory(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Category";
  const target = input.category?.toLowerCase();
  const domain = input.domain?.toLowerCase();

  if (!target && !domain) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.CATEGORY, matched: false,
      explanation: "No category or domain provided." };
  }

  // Exact category match
  if (target && blueprint.category.toLowerCase() === target) {
    return { dimension: dim, awarded: WEIGHTS.CATEGORY, maximum: WEIGHTS.CATEGORY,
      matched: true, explanation: `Category "${blueprint.category}" matched exactly.` };
  }

  // Domain match
  if (domain && blueprint.domains.some((d) => d.toLowerCase() === domain)) {
    return { dimension: dim, awarded: Math.round(WEIGHTS.CATEGORY * 0.7), maximum: WEIGHTS.CATEGORY,
      matched: true, explanation: `Domain "${domain}" matched.` };
  }

  return { dimension: dim, awarded: 0, maximum: WEIGHTS.CATEGORY, matched: false,
    explanation: `No match for category "${target ?? "(none)"}" / domain "${domain ?? "(none)"}" in blueprint.` };
}

function scorePersonality(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Brand Personality";
  const dnaPersonalities = input.brandDna?.personalities ?? [];
  if (dnaPersonalities.length === 0) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.PERSONALITY, matched: false,
      explanation: "No brand personality provided in Brand DNA." };
  }

  const bpSet = new Set(blueprint.personalities.map((p) => p.toLowerCase()));
  const hits = dnaPersonalities.filter((p) => bpSet.has(p.toLowerCase()));

  if (hits.length === 0) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.PERSONALITY, matched: false,
      explanation: `No personality overlap. Blueprint: [${blueprint.personalities.join(", ")}].` };
  }

  // 3 pts per hit, capped at MAX_PERSONALITY_BONUS
  const awarded = Math.min(hits.length * 3, MAX_PERSONALITY_BONUS);
  return { dimension: dim, awarded, maximum: WEIGHTS.PERSONALITY, matched: true,
    explanation: `Personality matches: [${hits.join(", ")}] — ${hits.length} hit(s).` };
}

function scoreAudience(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Target Audience";
  const audience = input.audience ?? [];
  if (audience.length === 0) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.AUDIENCE, matched: false,
      explanation: "No target audience provided." };
  }

  const bpAudiences = new Set(blueprint.audiences.map((a) => a.toLowerCase()));
  const hits = audience.filter((a) => bpAudiences.has(a.toLowerCase()));

  if (hits.length > 0) {
    return { dimension: dim, awarded: WEIGHTS.AUDIENCE, maximum: WEIGHTS.AUDIENCE,
      matched: true, explanation: `Audience overlap: [${hits.join(", ")}].` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.AUDIENCE, matched: false,
    explanation: `No audience overlap. Blueprint: [${blueprint.audiences.join(", ")}].` };
}

function scoreVoiceStyle(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Voice & Writing Style";
  const voice = input.brandDna?.voice?.toLowerCase();
  const writingStyle = input.brandDna?.writingStyle?.toLowerCase();

  if (!voice && !writingStyle) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.VOICE_STYLE, matched: false,
      explanation: "No brand voice or writing style provided." };
  }

  const bpVoices = new Set(blueprint.voices.map((v) => v.toLowerCase()));
  const voiceHit = voice && bpVoices.has(voice);
  const styleHit = writingStyle && bpVoices.has(writingStyle);

  if (voiceHit || styleHit) {
    const matched = [voiceHit && voice, styleHit && writingStyle].filter(Boolean).join(", ");
    return { dimension: dim, awarded: WEIGHTS.VOICE_STYLE, maximum: WEIGHTS.VOICE_STYLE,
      matched: true, explanation: `Voice/style match: ${matched}.` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.VOICE_STYLE, matched: false,
    explanation: `Blueprint voices [${blueprint.voices.join(", ")}] did not match "${voice ?? writingStyle}".` };
}

function scoreOutputFormat(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Output Format";
  const required = input.output ?? [];
  if (required.length === 0) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.OUTPUT_FORMAT, matched: false,
      explanation: "No output format required." };
  }

  const bpFormats = new Set(blueprint.outputFormats.map((f) => f.toLowerCase()));
  const hits = required.filter((f) => bpFormats.has(f.toLowerCase()));
  const allMet = hits.length === required.length;

  if (allMet) {
    return { dimension: dim, awarded: WEIGHTS.OUTPUT_FORMAT, maximum: WEIGHTS.OUTPUT_FORMAT,
      matched: true, explanation: `All required formats [${required.join(", ")}] supported.` };
  }
  if (hits.length > 0) {
    return { dimension: dim, awarded: Math.round(WEIGHTS.OUTPUT_FORMAT * 0.5), maximum: WEIGHTS.OUTPUT_FORMAT,
      matched: true, explanation: `Partial format support — [${hits.join(", ")}] met, [${required.filter((f) => !bpFormats.has(f.toLowerCase())).join(", ")}] not.` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.OUTPUT_FORMAT, matched: false,
    explanation: `Blueprint does not support required formats [${required.join(", ")}].` };
}

function scorePackage(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Package Level";
  if (!input.package) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.PACKAGE, matched: false,
      explanation: "No package level provided." };
  }
  const pkg = input.package.toLowerCase();
  const supported = new Set(blueprint.supportedPackages.map((p) => p.toLowerCase()));
  if (supported.size === 0 || supported.has(pkg)) {
    return { dimension: dim, awarded: WEIGHTS.PACKAGE, maximum: WEIGHTS.PACKAGE,
      matched: true, explanation: supported.size === 0
        ? "Blueprint supports all package levels."
        : `Package "${input.package}" supported.` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.PACKAGE, matched: false,
    explanation: `Package "${input.package}" not in [${blueprint.supportedPackages.join(", ")}].` };
}

function scoreStylePreference(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Style Preference";
  const prefs = input.style ?? [];
  if (prefs.length === 0) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.STYLE_PREF, matched: false,
      explanation: "No style preference provided." };
  }

  const bpStyles = new Set(blueprint.styles.map((s) => s.toLowerCase()));
  const hits = prefs.filter((s) => bpStyles.has(s.toLowerCase()));

  if (hits.length > 0) {
    return { dimension: dim, awarded: WEIGHTS.STYLE_PREF, maximum: WEIGHTS.STYLE_PREF,
      matched: true, explanation: `Style preference overlap: [${hits.join(", ")}].` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.STYLE_PREF, matched: false,
    explanation: `Blueprint styles [${blueprint.styles.join(", ")}] do not include [${prefs.join(", ")}].` };
}

// ── Bonus Scorers ─────────────────────────────────────────────────────────────

function scoreBriefKeywords(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Brief Keyword Match";
  if (!input.brief) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.BRIEF_KEYWORDS, matched: false,
      explanation: "No brief provided." };
  }

  const briefTokens = new Set(tokeniseBrief(input.brief));
  if (briefTokens.size === 0) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.BRIEF_KEYWORDS, matched: false,
      explanation: "Brief contained no meaningful tokens after filtering." };
  }

  const bpKeywords = blueprint.keywords.map((k) => k.toLowerCase());
  const hits = bpKeywords.filter((k) => briefTokens.has(k));
  const ratio = hits.length / Math.max(bpKeywords.length, 1);
  const awarded = Math.round(ratio * WEIGHTS.BRIEF_KEYWORDS);

  if (hits.length === 0) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.BRIEF_KEYWORDS, matched: false,
      explanation: `No keyword overlap between brief and blueprint keywords [${bpKeywords.slice(0, 5).join(", ")}${bpKeywords.length > 5 ? ", …" : ""}].` };
  }
  return { dimension: dim, awarded, maximum: WEIGHTS.BRIEF_KEYWORDS, matched: true,
    explanation: `${hits.length} keyword(s) matched from brief: [${hits.slice(0, 4).join(", ")}${hits.length > 4 ? ", …" : ""}].` };
}

function scoreColorFamily(blueprint: Blueprint, input: MatchInput): ScoreDimension {
  const dim = "Color Family";
  const dnaHex = input.brandDna?.primaryColorHex;
  if (!dnaHex || !blueprint.primaryColorHex) {
    return { dimension: dim, awarded: 0, maximum: WEIGHTS.COLOR_FAMILY, matched: false,
      explanation: !dnaHex ? "No primary color in Brand DNA." : "Blueprint has no color preference." };
  }

  const dnaNorm = dnaHex.replace("#", "").toLowerCase().substring(0, 2);
  const bpNorm = blueprint.primaryColorHex.replace("#", "").toLowerCase().substring(0, 2);

  if (dnaNorm === bpNorm) {
    return { dimension: dim, awarded: WEIGHTS.COLOR_FAMILY, maximum: WEIGHTS.COLOR_FAMILY,
      matched: true, explanation: `Primary color family (hue prefix "${dnaNorm}") matched.` };
  }
  return { dimension: dim, awarded: 0, maximum: WEIGHTS.COLOR_FAMILY, matched: false,
    explanation: `Color families differ (DNA: "${dnaNorm}…", blueprint: "${bpNorm}…").` };
}

function scoreFeaturedPopularity(blueprint: Blueprint): { featured: ScoreDimension; popularity: ScoreDimension } {
  const featuredDim: ScoreDimension = {
    dimension: "Featured",
    awarded: blueprint.featured ? WEIGHTS.FEATURED : 0,
    maximum: WEIGHTS.FEATURED,
    matched: blueprint.featured,
    explanation: blueprint.featured ? "Admin-featured blueprint." : "Not featured.",
  };

  const popBonus = Math.min(Math.floor(blueprint.usageCount / 10), WEIGHTS.POPULARITY);
  const popularityDim: ScoreDimension = {
    dimension: "Popularity",
    awarded: popBonus,
    maximum: WEIGHTS.POPULARITY,
    matched: popBonus > 0,
    explanation: popBonus > 0
      ? `Usage bonus: ${blueprint.usageCount} uses → +${popBonus} pts.`
      : "Not enough usage data for bonus.",
  };

  return { featured: featuredDim, popularity: popularityDim };
}

// ── Confidence Calculator ─────────────────────────────────────────────────────

/**
 * Confidence reflects how trustworthy the score is.
 * = (input richness factor) × (score height factor)
 *
 * Input richness: 1.0 when all 10 input signals are provided, 0.1 minimum.
 * Score height: normalised top score / max possible.
 */
export function computeConfidence(
  input: MatchInput,
  topScore: number,
  maxPossibleScore: number,
): number {
  const signals = [
    input.serviceType,
    input.domain ?? input.category,
    input.industry,
    input.brief,
    input.brandDna?.personalities?.length,
    input.brandDna?.voice ?? input.brandDna?.writingStyle,
    input.audience?.length,
    input.output?.length,
    input.package,
    input.style?.length,
  ];
  const provided = signals.filter(Boolean).length;
  const richness = Math.max(0.1, provided / signals.length);

  const normalised = maxPossibleScore > 0 ? topScore / maxPossibleScore : 0;
  const confidence = parseFloat((richness * normalised).toFixed(3));
  return Math.min(1, confidence);
}

// ── Max Possible Score ────────────────────────────────────────────────────────

/**
 * Maximum score reachable given the inputs provided.
 * Used to normalise the 0–100 score and compute confidence.
 * Dimensions without input cannot contribute to max.
 */
export function computeMaxPossibleScore(input: MatchInput): number {
  let max = 0;
  if (input.serviceType)                           max += WEIGHTS.SERVICE_TYPE;
  if (input.industry)                              max += WEIGHTS.INDUSTRY;
  if (input.category || input.domain)              max += WEIGHTS.CATEGORY;
  if (input.brandDna?.personalities?.length)       max += WEIGHTS.PERSONALITY;
  if (input.audience?.length)                      max += WEIGHTS.AUDIENCE;
  if (input.brandDna?.voice || input.brandDna?.writingStyle) max += WEIGHTS.VOICE_STYLE;
  if (input.output?.length)                        max += WEIGHTS.OUTPUT_FORMAT;
  if (input.package)                               max += WEIGHTS.PACKAGE;
  if (input.style?.length)                         max += WEIGHTS.STYLE_PREF;
  // Bonus
  if (input.brief)                                 max += WEIGHTS.BRIEF_KEYWORDS;
  if (input.brandDna?.primaryColorHex)             max += WEIGHTS.COLOR_FAMILY;
  max += WEIGHTS.FEATURED;   // always possible
  max += WEIGHTS.POPULARITY; // always possible
  return max || 1; // guard against 0
}

// ── Signal Audit ──────────────────────────────────────────────────────────────

export function auditSignals(input: MatchInput): { used: string[]; missing: string[] } {
  const checks: Array<[string, boolean]> = [
    ["serviceType",        !!input.serviceType],
    ["domain/category",    !!(input.domain || input.category)],
    ["industry",           !!input.industry],
    ["brief",              !!input.brief],
    ["brandDna.personalities", !!(input.brandDna?.personalities?.length)],
    ["brandDna.voice",     !!(input.brandDna?.voice || input.brandDna?.writingStyle)],
    ["brandDna.primaryColorHex", !!input.brandDna?.primaryColorHex],
    ["audience",           !!(input.audience?.length)],
    ["output",             !!(input.output?.length)],
    ["package",            !!input.package],
    ["style",              !!(input.style?.length)],
    ["constraints",        !!(input.constraints?.length)],
  ];
  const used = checks.filter(([, v]) => v).map(([k]) => k);
  const missing = checks.filter(([, v]) => !v).map(([k]) => k);
  return { used, missing };
}

// ── Single Blueprint Scorer ───────────────────────────────────────────────────

/**
 * Score a single blueprint against the match input.
 * Returns a ScoreBreakdown with all dimension results.
 * Does NOT perform constraint checking (caller handles that).
 */
export function scoreBlueprint(blueprint: Blueprint, input: MatchInput): ScoreBreakdown {
  const dims: ScoreDimension[] = [
    scoreServiceType(blueprint, input),
    scoreIndustry(blueprint, input),
    scoreCategory(blueprint, input),
    scorePersonality(blueprint, input),
    scoreAudience(blueprint, input),
    scoreVoiceStyle(blueprint, input),
    scoreOutputFormat(blueprint, input),
    scorePackage(blueprint, input),
    scoreStylePreference(blueprint, input),
    scoreBriefKeywords(blueprint, input),
    scoreColorFamily(blueprint, input),
    ...Object.values(scoreFeaturedPopularity(blueprint)),
  ];

  const totalScore = dims.reduce((sum, d) => sum + d.awarded, 0);
  const maxPossibleScore = computeMaxPossibleScore(input);

  return { dimensions: dims, totalScore, maxPossibleScore };
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Normalise a raw score to 0–100 scale.
 * Uses the max possible score for the given inputs, not an absolute ceiling.
 */
export function normaliseScore(totalScore: number, maxPossibleScore: number): number {
  if (maxPossibleScore <= 0) return 0;
  return Math.min(100, Math.round((totalScore / maxPossibleScore) * 100));
}

// ── Stable Sort ───────────────────────────────────────────────────────────────

/**
 * Stable sort comparator for scored blueprints.
 * Primary: score DESC. Tie-break: featured DESC, usageCount DESC, id ASC.
 */
export function compareRecommendations(
  a: { score: number; blueprint: Blueprint },
  b: { score: number; blueprint: Blueprint },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.blueprint.featured !== a.blueprint.featured) return b.blueprint.featured ? 1 : -1;
  if (b.blueprint.usageCount !== a.blueprint.usageCount) return b.blueprint.usageCount - a.blueprint.usageCount;
  return a.blueprint.id.localeCompare(b.blueprint.id);
}

// ── Explanation Generator ─────────────────────────────────────────────────────

export function buildExplanation(result: {
  topRec: MatchRecommendation | null;
  totalCandidates: number;
  rejectedCount: number;
  signalsUsed: string[];
}): string {
  if (!result.topRec) {
    if (result.rejectedCount > 0) {
      return `All ${result.rejectedCount} evaluated blueprint(s) were rejected due to constraint violations. ` +
        "Consider relaxing the constraints or choosing a different service type.";
    }
    return "No compatible blueprints were found for the given input. " +
      "Try providing more signals (industry, category, service type) to improve matching.";
  }

  const signalSummary = result.signalsUsed.length > 0
    ? `using ${result.signalsUsed.length} input signal(s): [${result.signalsUsed.slice(0, 5).join(", ")}${result.signalsUsed.length > 5 ? ", …" : ""}]`
    : "with minimal input signals";

  const topReasons = result.topRec.reasons.slice(0, 3).join("; ");
  return `"${result.topRec.blueprintName}" scored ${result.topRec.score}/100 (confidence ${(result.topRec.confidence * 100).toFixed(0)}%) ` +
    `from ${result.totalCandidates} candidate(s) ${signalSummary}. ` +
    `Key factors: ${topReasons}.` +
    (result.rejectedCount > 0 ? ` ${result.rejectedCount} blueprint(s) rejected for constraint violations.` : "");
}

// ── Full Match Execution ──────────────────────────────────────────────────────

/**
 * Run the full matching pipeline over a list of blueprint candidates.
 * This is a pure function — all I/O is handled by the caller.
 *
 * @param blueprints  Published blueprint candidates (pre-fetched via BlueprintPort).
 * @param input       The match input from the API caller.
 * @returns           MatchResult with top recommendation, alternatives, rejections.
 */
export function runMatching(blueprints: Blueprint[], input: MatchInput): MatchResult {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const requiredConstraints = input.constraints ?? [];

  const { used: signalsUsed, missing: signalsMissing } = auditSignals(input);

  type ScoredItem = { blueprint: Blueprint; breakdown: ScoreBreakdown; score: number };
  const scored: ScoredItem[] = [];
  const rejected: RejectedBlueprint[] = [];

  for (const bp of blueprints) {
    const breakdown = scoreBlueprint(bp, input);

    // Constraint check before including in ranking
    const violation = checkConstraints(bp, requiredConstraints);
    if (violation) {
      rejected.push({
        blueprintId: bp.id,
        blueprintName: bp.name,
        rejectionReason: violation,
        rawScoreBeforeRejection: normaliseScore(breakdown.totalScore, breakdown.maxPossibleScore),
      });
      continue;
    }

    const score = normaliseScore(breakdown.totalScore, breakdown.maxPossibleScore);
    scored.push({ blueprint: bp, breakdown, score });
  }

  // Stable sort
  scored.sort((a, b) => compareRecommendations(a, b));

  // Build recommendations
  const recommendations: MatchRecommendation[] = scored.map(({ blueprint, breakdown, score }) => {
    const reasons = breakdown.dimensions
      .filter((d) => d.matched && d.awarded > 0)
      .sort((a, b) => b.awarded - a.awarded)
      .slice(0, 5)
      .map((d) => d.explanation);

    const confidence = computeConfidence(input, breakdown.totalScore, breakdown.maxPossibleScore);

    return {
      blueprintId: blueprint.id,
      blueprintName: blueprint.name,
      category: blueprint.category,
      score,
      confidence,
      reasons,
      breakdown,
      styles: blueprint.styles,
      outputFormats: blueprint.outputFormats,
      featured: blueprint.featured,
    };
  });

  const topRecommendation = recommendations[0] ?? null;
  const alternatives = recommendations.slice(1, limit);

  const overallConfidence = topRecommendation
    ? computeConfidence(input, scored[0]!.breakdown.totalScore, scored[0]!.breakdown.maxPossibleScore)
    : 0;

  const explanation = buildExplanation({
    topRec: topRecommendation,
    totalCandidates: blueprints.length,
    rejectedCount: rejected.length,
    signalsUsed,
  });

  return {
    topRecommendation,
    alternatives,
    rejected,
    confidence: overallConfidence,
    explanation,
    candidatesEvaluated: blueprints.length,
    signalsUsed,
    signalsMissing,
  };
}
