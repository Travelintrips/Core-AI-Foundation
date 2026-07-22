/**
 * templateKnowledgeProvider — Team 23
 *
 * Bridges DesignKnowledgeQuery → KnowledgeMatchInput for the existing
 * templateKnowledgeMatchingService (V5.0 semantic scorer).
 *
 * Does NOT create a second knowledge system — it is a thin adapter over
 * the existing 10-dimension weighted scorer.
 */

import type {
  KnowledgeAdapter,
  DesignKnowledgeQuery,
  DesignRecommendation,
  DesignKnowledgeCitation,
  KnowledgeCapability,
  KnowledgeType,
} from "../types.js";
import { findBestTemplates, type KnowledgeMatchInput } from "../../templateKnowledgeMatchingService.js";
import { normalizeIndustry, normalizeStyle } from "../../../utils/canonicalNormalizer.js";

const SOURCE_ID = "template-knowledge-library";
const SOURCE_NAME = "Template Knowledge Library V5.0";

function buildSource() {
  return {
    providerId: SOURCE_ID,
    providerName: SOURCE_NAME,
    version: "5.0",
    retrievedAt: new Date().toISOString(),
  };
}

function confidenceMap(c: "high" | "medium" | "low") {
  return c;
}

function extractKeywords(query: string): string[] {
  // Extract meaningful words (>3 chars) from the free-text query as keyword hints
  return query
    .toLowerCase()
    .split(/[\s,;.!?]+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);
}

function buildMatchInput(q: DesignKnowledgeQuery): KnowledgeMatchInput {
  const filter = q.filter ?? {};
  const rawIndustry = filter.industry ?? extractIndustryFromQuery(q.query);
  const rawStyle = filter.style ?? extractStyleFromQuery(q.query);

  return {
    clientId:              q.clientId,
    industry:              rawIndustry ? (normalizeIndustry(rawIndustry) ?? rawIndustry) : undefined,
    preferredStyle:        rawStyle    ? (normalizeStyle(rawStyle)       ?? rawStyle)    : undefined,
    keywords:              extractKeywords(q.query),
    category:              q.scope?.domain,
    limit:                 Math.min(filter.limit ?? 5, 10),
  };
}

// Simple heuristics to extract signals from the free-text query
function extractIndustryFromQuery(query: string): string | undefined {
  const q = query.toLowerCase();
  const industries = [
    "fashion", "food", "beverage", "technology", "healthcare", "finance",
    "real_estate", "logistics", "education", "retail", "beauty", "hotel",
    "travel", "automotive", "construction", "manufacturing",
  ];
  return industries.find((ind) => q.includes(ind));
}

function extractStyleFromQuery(query: string): string | undefined {
  const q = query.toLowerCase();
  const styles = [
    "minimalist", "luxury", "modern", "bold", "elegant", "corporate",
    "organic", "playful", "vintage", "retro", "dark", "light",
  ];
  return styles.find((s) => q.includes(s));
}

// ─────────────────────────────────────────────────────────────────────────────

const CAPABILITY: KnowledgeCapability = {
  supportedTypes:         ["template", "blueprint", "pattern", "guideline"],
  supportsIndustryFilter: true,
  supportsStyleFilter:    true,
  supportsTenantScope:    false,
  supportsPlatformScope:  false,
  maxResultsPerQuery:     10,
};

export const templateKnowledgeProvider: KnowledgeAdapter = {
  id:         SOURCE_ID,
  name:       SOURCE_NAME,
  capability: CAPABILITY,

  async isAvailable(): Promise<boolean> {
    // The matching service uses the shared DB pool — consider it available
    // if we can import the function (no network check needed).
    return typeof findBestTemplates === "function";
  },

  async query(q: DesignKnowledgeQuery): Promise<DesignRecommendation[]> {
    const matchInput = buildMatchInput(q);
    const response   = await findBestTemplates(matchInput);

    const source = buildSource();
    const recs: DesignRecommendation[] = [];
    const matchThreshold = 70;

    for (const match of response.matches) {
      const tmpl           = match.template;
      const meetsThreshold = match.totalScore >= matchThreshold;

      const citation: DesignKnowledgeCitation = {
        source,
        referenceId:    String(tmpl.id),
        referenceLabel: tmpl.name ?? `Template #${tmpl.id}`,
        excerpt:        match.gapExplanation
          ?? `Score: ${match.totalScore.toFixed(1)} / 100 — ${match.confidence} confidence`,
      };

      // Determine knowledge type
      const type: KnowledgeType = tmpl.category === "blueprint" ? "blueprint" : "template";

      // Reason summary
      const topDim = [...match.dimensions]
        .sort((a, b) => b.weightedScore - a.weightedScore)
        .slice(0, 2)
        .map((d) => d.reason)
        .join("; ");

      const rec: DesignRecommendation = {
        id:           "",   // filled by registry
        type,
        title:        tmpl.name ?? "Unnamed template",
        body:         tmpl.description
          ?? `A ${tmpl.style ?? "general"} template${tmpl.industry ? ` for ${tmpl.industry}` : ""}.`,
        confidence:   confidenceMap(match.confidence),
        reason: {
          summary:   match.gapExplanation
            ? `Nearest available template — ${match.gapExplanation}`
            : `Best-match template (score ${match.totalScore.toFixed(1)}): ${topDim}`,
          citations: [citation],
        },
        applicability: [
          ...(tmpl.industry ? [`Industry: ${tmpl.industry}`] : []),
          ...(tmpl.style    ? [`Style: ${tmpl.style}`]       : []),
          ...(meetsThreshold ? ["Meets quality threshold (≥70)"] : ["Below threshold — hybrid recommended"]),
        ],
        limitations:   match.isNearestMatch && !meetsThreshold
          ? ["This is the nearest available template but does not fully match the specified requirements."]
          : undefined,
        alternatives:  response.hybridSuggestion ? [response.hybridSuggestion] : undefined,
        hasSource:     true,
        scope:         q.scope ?? {},
        isAdvisory:    true,
      };

      recs.push(rec);
    }

    // Also add a gap recommendation if hybrid generation is offered
    if (response.offerGeneration && response.hybridSuggestion) {
      recs.push({
        id:         "",
        type:       "workflow_hint",
        title:      "Hybrid Template Generation Available",
        body:       response.hybridSuggestion,
        confidence: "medium",
        reason: {
          summary:   "No exact template match found — hybrid generation is recommended.",
          citations: [],
        },
        applicability: ["When no template meets the 70-point threshold"],
        hasSource:     false,
        scope:         q.scope ?? {},
        isAdvisory:    true,
      });
    }

    return recs;
  },
};
