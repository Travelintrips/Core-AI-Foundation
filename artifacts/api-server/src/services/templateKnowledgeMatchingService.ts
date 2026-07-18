/**
 * Template Knowledge Matching Service — Enterprise Template Knowledge Library V5.0
 *
 * Implements 10-dimension weighted semantic scoring per spec:
 *
 * Industry          20%
 * Audience          15%
 * Brand Personality 15%
 * Style             10%
 * Layout            10%
 * Business Position 10%
 * Color             5%
 * Typography        5%
 * Keywords          5%
 * Popularity        5%
 * + Output Support  5% (bonus)
 *
 * If no exact match (score < 70):
 *   1. Find nearest template
 *   2. Explain the GAP
 *   3. Offer hybrid template generation
 */

import { eq, desc, sql, and } from "drizzle-orm";
import { db, aiTemplatesTable } from "@workspace/db";
import type { AiTemplate } from "@workspace/db";
import { normalizeStyle, normalizeIndustry } from "../utils/canonicalNormalizer.js";

// ─────────────────────────────────────────────────────────────────────────────
// Weight table — sums to 100 base
// ─────────────────────────────────────────────────────────────────────────────

const WEIGHTS = {
  INDUSTRY:           20,
  AUDIENCE:           15,
  BRAND_PERSONALITY:  15,
  STYLE:              10,
  LAYOUT:             10,
  BUSINESS_POSITION:  10,
  COLOR:               5,
  TYPOGRAPHY:          5,
  KEYWORDS:            5,
  POPULARITY:          5,
  // Bonus (outside 100 base)
  OUTPUT_SUPPORT:      5,
} as const;

const MATCH_THRESHOLD = 70; // below this → offer hybrid generation

// ─────────────────────────────────────────────────────────────────────────────
// Input / Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeMatchInput {
  clientId?: string;
  industry?: string;
  targetAudience?: string;
  brandPersonalities?: string[];
  preferredStyle?: string;
  preferredLayout?: string;
  businessType?: string;      // B2B | B2C | D2C | Enterprise | SME | Startup
  pricePositioning?: string;  // budget | mid-market | premium | luxury
  primaryColor?: string;      // hex
  preferredFont?: string;     // heading font family
  keywords?: string[];
  requiredOutputFormats?: string[]; // pdf | pptx | png | svg | html | social_media
  category?: string;
  packageLevel?: string;
  limit?: number;
}

export interface ScoreDimension {
  dimension: string;
  weight: number;
  rawScore: number;      // 0-1
  weightedScore: number; // rawScore * weight
  reason: string;
}

export interface KnowledgeMatchResult {
  template: AiTemplate;
  totalScore: number;         // 0-100+
  confidence: "high" | "medium" | "low";
  dimensions: ScoreDimension[];
  gapExplanation?: string;    // only when score < threshold
  isNearestMatch?: boolean;
}

export interface MatchResponse {
  matches: KnowledgeMatchResult[];
  bestScore: number;
  meetsThreshold: boolean;
  offerGeneration: boolean;
  nearestMatch?: KnowledgeMatchResult;
  hybridSuggestion?: string;
  inputSummary: {
    industry: string;
    style: string;
    personalities: string[];
    audience: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

function scoreIndustry(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.INDUSTRY;
  if (!input.industry) return { dimension: "industry", weight, rawScore: 0.5, weightedScore: weight * 0.5, reason: "No industry specified — partial score" };

  const industryMatch = template.industry?.toLowerCase() === input.industry.toLowerCase();
  const crossIndustry = !template.industry;

  const rawScore = industryMatch ? 1 : crossIndustry ? 0.5 : 0;
  return {
    dimension: "industry",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: industryMatch
      ? `Exact industry match: ${input.industry}`
      : crossIndustry
      ? "Cross-industry template (partial match)"
      : `Industry mismatch: template is ${template.industry ?? "unset"}, looking for ${input.industry}`,
  };
}

function scoreAudience(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.AUDIENCE;
  if (!input.targetAudience) return { dimension: "audience", weight, rawScore: 0.4, weightedScore: weight * 0.4, reason: "No audience specified" };

  const templateAudiences = (template.brandDnaTags?.audiences ?? []).map((a) => a.toLowerCase());
  const inputAudience = input.targetAudience.toLowerCase();

  const exactMatch = templateAudiences.some((a) => a.includes(inputAudience) || inputAudience.includes(a));
  const partialMatch = !exactMatch && templateAudiences.some((a) => {
    const aWords = a.split(/\s+/);
    return aWords.some((w) => inputAudience.includes(w) && w.length > 3);
  });

  const rawScore = exactMatch ? 1 : partialMatch ? 0.5 : 0.1;
  return {
    dimension: "audience",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: exactMatch
      ? `Audience match: ${input.targetAudience}`
      : partialMatch
      ? `Partial audience overlap`
      : "Audience mismatch",
  };
}

function scoreBrandPersonality(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.BRAND_PERSONALITY;
  const inputPersonalities = input.brandPersonalities ?? [];
  if (inputPersonalities.length === 0) return { dimension: "brand_personality", weight, rawScore: 0.4, weightedScore: weight * 0.4, reason: "No personalities specified" };

  const templatePersonalities = (template.brandDnaTags?.personalities ?? []).map((p) => p.toLowerCase());
  const inputLower = inputPersonalities.map((p) => p.toLowerCase());

  const hits = inputLower.filter((p) => templatePersonalities.includes(p));
  const rawScore = Math.min(1, hits.length / Math.max(1, Math.min(inputLower.length, 3)));

  return {
    dimension: "brand_personality",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: hits.length > 0
      ? `Personality match: ${hits.join(", ")} (${hits.length}/${inputLower.length})`
      : "No personality overlap",
  };
}

function scoreStyle(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.STYLE;
  if (!input.preferredStyle) return { dimension: "style", weight, rawScore: 0.5, weightedScore: weight * 0.5, reason: "No style preference specified" };

  const exactMatch = template.style?.toLowerCase() === input.preferredStyle.toLowerCase();
  const sameFamily = !exactMatch && isSameStyleFamily(template.style ?? "", input.preferredStyle);

  const rawScore = exactMatch ? 1 : sameFamily ? 0.6 : 0.1;
  return {
    dimension: "style",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: exactMatch
      ? `Style exact match: ${input.preferredStyle}`
      : sameFamily
      ? `Similar style family`
      : `Style mismatch: ${template.style} ≠ ${input.preferredStyle}`,
  };
}

function scoreLayout(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.LAYOUT;
  if (!input.preferredLayout) return { dimension: "layout", weight, rawScore: 0.5, weightedScore: weight * 0.5, reason: "No layout preference" };

  const match = template.layout?.toLowerCase().includes(input.preferredLayout.toLowerCase());
  const rawScore = match ? 1 : 0.2;
  return {
    dimension: "layout",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: match ? `Layout match: ${input.preferredLayout}` : "Layout mismatch",
  };
}

function scoreBusinessPosition(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.BUSINESS_POSITION;
  const inputParts = [input.businessType, input.pricePositioning].filter(Boolean);
  if (inputParts.length === 0) return { dimension: "business_position", weight, rawScore: 0.4, weightedScore: weight * 0.4, reason: "No business context specified" };

  const tags = (template.brandDnaTags?.voices ?? []).join(" ").toLowerCase()
    + " " + (template.brandDnaTags?.audiences ?? []).join(" ").toLowerCase();

  let hits = 0;
  if (input.businessType && tags.includes(input.businessType.toLowerCase())) hits++;
  if (input.pricePositioning && tags.includes(input.pricePositioning.toLowerCase())) hits++;

  // Check price positioning vs isPremium
  const premiumMatch = input.pricePositioning === "luxury" || input.pricePositioning === "premium";
  if (premiumMatch && template.isPremium) hits++;

  const rawScore = Math.min(1, hits / Math.max(inputParts.length, 1));
  return {
    dimension: "business_position",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: hits > 0 ? `Business context partial match (${hits} signals)` : "No business context overlap",
  };
}

function scoreColor(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.COLOR;
  if (!input.primaryColor || !template.colorTheme?.primary) {
    return { dimension: "color", weight, rawScore: 0.4, weightedScore: weight * 0.4, reason: "No color preference or template has no color data" };
  }

  const inputHex = input.primaryColor.replace("#", "").toLowerCase();
  const templateHex = template.colorTheme.primary.replace("#", "").toLowerCase();

  // Compare first 2 chars of hex (hue family approximation)
  const sameFamily = inputHex.substring(0, 2) === templateHex.substring(0, 2);
  // More precise: compare first 3 chars
  const closeMatch = inputHex.substring(0, 3) === templateHex.substring(0, 3);

  const rawScore = closeMatch ? 1 : sameFamily ? 0.6 : 0.1;
  return {
    dimension: "color",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: closeMatch
      ? "Close color match"
      : sameFamily
      ? "Same color family"
      : "Color family mismatch",
  };
}

function scoreTypography(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.TYPOGRAPHY;
  if (!input.preferredFont) return { dimension: "typography", weight, rawScore: 0.4, weightedScore: weight * 0.4, reason: "No font preference" };

  const fontMatch
    = template.typography?.heading?.toLowerCase().includes(input.preferredFont.toLowerCase())
    || template.typography?.body?.toLowerCase().includes(input.preferredFont.toLowerCase());

  const rawScore = fontMatch ? 1 : 0.2;
  return {
    dimension: "typography",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: fontMatch ? `Font match: ${input.preferredFont}` : "Font mismatch",
  };
}

function scoreKeywords(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.KEYWORDS;
  const keywords = input.keywords ?? [];
  if (keywords.length === 0) return { dimension: "keywords", weight, rawScore: 0.3, weightedScore: weight * 0.3, reason: "No keywords provided" };

  const searchText = [
    template.name,
    template.description,
    ...(template.brandDnaTags?.personalities ?? []),
    ...(template.brandDnaTags?.voices ?? []),
  ].join(" ").toLowerCase();

  const kw = keywords.map((k) => k.toLowerCase());
  const hits = kw.filter((k) => searchText.includes(k));
  const rawScore = Math.min(1, hits.length / Math.max(keywords.length, 1));

  return {
    dimension: "keywords",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: hits.length > 0
      ? `Keyword hits: ${hits.join(", ")}`
      : "No keyword matches",
  };
}

function scorePopularity(template: AiTemplate): ScoreDimension {
  const weight = WEIGHTS.POPULARITY;
  // Normalize: 0 selections = 0.1, 100+ = 1.0
  const normalizedViews = Math.min(1, (template.views ?? 0) / 200);
  const normalizedSelections = Math.min(1, (template.selections ?? 0) / 50);
  const featuredBonus = template.featured ? 0.3 : 0;
  const rawScore = Math.min(1, normalizedViews * 0.3 + normalizedSelections * 0.5 + featuredBonus + 0.1);

  return {
    dimension: "popularity",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: template.featured
      ? "Featured template"
      : `Popularity: ${template.views ?? 0} views, ${template.selections ?? 0} selections`,
  };
}

function scoreOutputSupport(template: AiTemplate, input: KnowledgeMatchInput): ScoreDimension {
  const weight = WEIGHTS.OUTPUT_SUPPORT;
  const required = input.requiredOutputFormats ?? [];
  if (required.length === 0) return { dimension: "output_support", weight, rawScore: 0.5, weightedScore: weight * 0.5, reason: "No output format required" };

  // The supportedPackages field stores package levels; we check template name/description for format mentions
  const desc = ((template.description ?? "") + " " + (template.name ?? "")).toLowerCase();
  const hits = required.filter((fmt) => desc.includes(fmt.toLowerCase()));
  const rawScore = hits.length > 0 ? 1 : 0.2;

  return {
    dimension: "output_support",
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: hits.length > 0
      ? `Output format supported: ${hits.join(", ")}`
      : `Output format not explicitly confirmed`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Style family classification
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_FAMILIES: Record<string, string[]> = {
  luxury: ["luxury", "high_fashion", "modern_luxury", "elegant", "premium"],
  minimal: ["minimalist", "neo_minimalism", "japandi", "scandinavian"],
  bold: ["bold", "brutalism", "streetwear", "sportswear"],
  organic: ["organic", "scandinavian", "japandi", "vintage", "retro"],
  tech: ["tech_startup", "glassmorphism", "dark_mode", "light_mode", "claymorphism"],
  corporate: ["corporate", "modern", "premium", "classic"],
};

function isSameStyleFamily(a: string, b: string): boolean {
  for (const family of Object.values(STYLE_FAMILIES)) {
    if (family.includes(a.toLowerCase()) && family.includes(b.toLowerCase())) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence level
// ─────────────────────────────────────────────────────────────────────────────

function computeConfidence(score: number, inputRichness: number): "high" | "medium" | "low" {
  if (score >= 80 && inputRichness >= 0.7) return "high";
  if (score >= 60 || inputRichness >= 0.5) return "medium";
  return "low";
}

function computeInputRichness(input: KnowledgeMatchInput): number {
  let filled = 0;
  const fields = [
    input.industry, input.targetAudience, input.preferredStyle,
    input.businessType, input.pricePositioning, input.primaryColor,
    input.preferredFont, input.preferredLayout,
  ];
  filled += fields.filter(Boolean).length;
  filled += (input.brandPersonalities?.length ?? 0) > 0 ? 1 : 0;
  filled += (input.keywords?.length ?? 0) > 0 ? 1 : 0;
  return filled / (fields.length + 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// GAP explanation
// ─────────────────────────────────────────────────────────────────────────────

function explainGap(
  result: KnowledgeMatchResult,
  input: KnowledgeMatchInput,
): string {
  const weakDimensions = result.dimensions
    .filter((d) => d.rawScore < 0.5)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  if (weakDimensions.length === 0) return "Closest available template — minor differences in style preferences.";

  const gaps = weakDimensions.map((d) => {
    switch (d.dimension) {
      case "industry": return `No template exists specifically for the ${input.industry} industry`;
      case "style": return `No exact ${input.preferredStyle} style template available`;
      case "brand_personality": return `Brand personalities (${(input.brandPersonalities ?? []).join(", ")}) not fully matched`;
      case "audience": return `Target audience profile not precisely matched`;
      case "business_position": return `Business context (${input.businessType ?? ""} / ${input.pricePositioning ?? ""}) not aligned`;
      default: return d.reason;
    }
  });

  return `GAP identified: ${gaps.join("; ")}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main matching function
// ─────────────────────────────────────────────────────────────────────────────

export async function findBestTemplates(input: KnowledgeMatchInput): Promise<MatchResponse> {
  // ── Normalize input to canonical style/industry keys ──────────────────────
  // This ensures legacy values (Title Case, Bahasa Indonesia, abbreviations)
  // from the client are mapped to canonical keys before scoring, making all
  // templates—including legacy-normalized ones—correctly comparable.
  input = {
    ...input,
    industry:       input.industry
                      ? (normalizeIndustry(input.industry)    ?? input.industry)
                      : undefined,
    preferredStyle: input.preferredStyle
                      ? (normalizeStyle(input.preferredStyle) ?? input.preferredStyle)
                      : undefined,
  };

  const limit = input.limit ?? 5;

  // Fetch candidates: filter by category if given, else all published
  const candidates = await db
    .select()
    .from(aiTemplatesTable)
    .where(
      and(
        eq(aiTemplatesTable.status, "published"),
        ...(input.category ? [eq(aiTemplatesTable.category, input.category)] : []),
      ),
    )
    .limit(500); // fetch broad set, score in-process

  const inputRichness = computeInputRichness(input);

  // Score each candidate
  const scored: KnowledgeMatchResult[] = candidates.map((template) => {
    const dims: ScoreDimension[] = [
      scoreIndustry(template, input),
      scoreAudience(template, input),
      scoreBrandPersonality(template, input),
      scoreStyle(template, input),
      scoreLayout(template, input),
      scoreBusinessPosition(template, input),
      scoreColor(template, input),
      scoreTypography(template, input),
      scoreKeywords(template, input),
      scorePopularity(template),
      scoreOutputSupport(template, input),
    ];

    const totalScore = dims.reduce((sum, d) => sum + d.weightedScore, 0);
    const confidence = computeConfidence(totalScore, inputRichness);

    return { template, totalScore, confidence, dimensions: dims };
  });

  // Sort by score descending
  scored.sort((a, b) => b.totalScore - a.totalScore);

  const topMatches = scored.slice(0, limit);
  const bestScore = topMatches[0]?.totalScore ?? 0;
  const meetsThreshold = bestScore >= MATCH_THRESHOLD;

  // Add gap explanation to near-matches
  topMatches.forEach((match) => {
    if (match.totalScore < MATCH_THRESHOLD) {
      match.gapExplanation = explainGap(match, input);
      match.isNearestMatch = match === topMatches[0];
    }
  });

  // Hybrid suggestion when below threshold
  let hybridSuggestion: string | undefined;
  if (!meetsThreshold && topMatches[0]) {
    const nearest = topMatches[0];
    const weakest = nearest.dimensions.sort((a, b) => a.rawScore - b.rawScore)[0];
    hybridSuggestion = `Consider generating a hybrid template: start with "${nearest.template.name}" and customize the ${weakest?.dimension ?? "style"} to match your ${input.industry ?? "industry"} requirements. The AI can generate a full knowledge specification for this combination.`;
  }

  return {
    matches: topMatches,
    bestScore,
    meetsThreshold,
    offerGeneration: !meetsThreshold,
    nearestMatch: !meetsThreshold ? topMatches[0] : undefined,
    hybridSuggestion,
    inputSummary: {
      industry: input.industry ?? "unspecified",
      style: input.preferredStyle ?? "unspecified",
      personalities: input.brandPersonalities ?? [],
      audience: input.targetAudience ?? "unspecified",
    },
  };
}
