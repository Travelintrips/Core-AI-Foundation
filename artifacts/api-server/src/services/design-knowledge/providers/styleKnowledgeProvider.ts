/**
 * styleKnowledgeProvider — Team 23
 *
 * Provides design principles, guidelines, and anti-patterns derived from the
 * canonical style knowledge system (canonicalNormalizer + styleKnowledgeSeed).
 *
 * Does NOT duplicate the style tables — it serves advisory knowledge derived
 * from the canonical style classification already present in the system.
 */

import type {
  KnowledgeAdapter,
  DesignKnowledgeQuery,
  DesignRecommendation,
  DesignKnowledgeCitation,
  KnowledgeCapability,
} from "../types.js";
import {
  normalizeStyle,
  normalizeIndustry,
  canonicalStyleKeys,
} from "../../../utils/canonicalNormalizer.js";

const SOURCE_ID   = "style-knowledge-system";
const SOURCE_NAME = "Canonical Style Knowledge System";

// ─── Inline style guidance (derived from existing seed data, not a second DB) ─

interface StyleGuidance {
  principles:   string[];
  antiPatterns: string[];
  guidelines:   string[];
}

const STYLE_GUIDANCE: Record<string, StyleGuidance> = {
  minimalist: {
    principles:   ["Use whitespace as a design element", "One focal point per composition", "Limit palette to 2–3 colours"],
    antiPatterns: ["Cluttering layout with decorative elements", "Using more than 2 typefaces"],
    guidelines:   ["Grid-based alignment is mandatory", "Prefer thin strokes and hairline weights"],
  },
  luxury: {
    principles:   ["Restraint signals exclusivity", "Material texture must be implied typographically", "Gold/dark contrast palette"],
    antiPatterns: ["Overcrowding with copy", "Using display fonts at body size"],
    guidelines:   ["Use serif display typefaces", "Generous tracking on all-caps headings"],
  },
  modern: {
    principles:   ["Clarity and hierarchy drive decisions", "Functional over decorative"],
    antiPatterns: ["Dated drop-shadows", "Skeuomorphic textures"],
    guidelines:   ["Use geometric sans-serifs", "Flat or subtle depth cues only"],
  },
  bold: {
    principles:   ["Contrast is the message", "Energy through weight and colour"],
    antiPatterns: ["Timid colour choices", "Small type sizes in primary CTA"],
    guidelines:   ["Use full-bleed imagery or solid colour blocks", "Headlines at 120%+ line-height"],
  },
  organic: {
    principles:   ["Natural curves over straight lines", "Earthy, muted palette"],
    antiPatterns: ["Hard geometric shapes as primary motifs", "Neon or saturated accent colours"],
    guidelines:   ["Textured or paper-like backgrounds add warmth", "Hand-drawn or irregular borders"],
  },
  corporate: {
    principles:   ["Trust through consistency", "Hierarchy signals authority"],
    antiPatterns: ["Inconsistent colour usage across touchpoints", "Informal typographic choices"],
    guidelines:   ["Stick to 2-colour primary palette", "Use grid-aligned photography"],
  },
  elegant: {
    principles:   ["Less is more — every element earns its place", "Refined details distinguish from luxury"],
    antiPatterns: ["Heavy use of decorative ornaments", "Bright saturated colours"],
    guidelines:   ["Prefer classic serif typefaces", "Subtle gradients over flat fills"],
  },
  tech_startup: {
    principles:   ["Speed and capability signal through visual rhythm", "Data visualisation is a first-class design asset"],
    antiPatterns: ["Decorative flourishes without function", "Overly formal serif typefaces"],
    guidelines:   ["Use geometric sans-serifs", "Dark-mode variants improve perceived sophistication"],
  },
};

function getGuidance(styleKey: string): StyleGuidance | null {
  return STYLE_GUIDANCE[styleKey] ?? null;
}

function buildSource(retrievedAt: string) {
  return {
    providerId:   SOURCE_ID,
    providerName: SOURCE_NAME,
    version:      "1.0",
    retrievedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const CAPABILITY: KnowledgeCapability = {
  supportedTypes:         ["principle", "style", "guideline", "anti_pattern", "compliance_rule"],
  supportsIndustryFilter: true,
  supportsStyleFilter:    true,
  supportsTenantScope:    false,
  supportsPlatformScope:  false,
  maxResultsPerQuery:     15,
};

export const styleKnowledgeProvider: KnowledgeAdapter = {
  id:         SOURCE_ID,
  name:       SOURCE_NAME,
  capability: CAPABILITY,

  async isAvailable(): Promise<boolean> {
    return canonicalStyleKeys().length > 0;
  },

  async query(q: DesignKnowledgeQuery): Promise<DesignRecommendation[]> {
    const now    = new Date().toISOString();
    const source = buildSource(now);
    const filter = q.filter ?? {};

    const rawStyle    = filter.style    ?? extractStyleSignal(q.query);
    const rawIndustry = filter.industry ?? extractIndustrySignal(q.query);

    const styleKey    = rawStyle    ? normalizeStyle(rawStyle)       : null;
    const industryKey = rawIndustry ? normalizeIndustry(rawIndustry) : null;

    const recs: DesignRecommendation[] = [];

    // ── Style principles ────────────────────────────────────────────────────
    if (styleKey) {
      const guidance = getGuidance(styleKey);
      if (guidance) {
        const citation: DesignKnowledgeCitation = {
          source,
          referenceId:    `style:${styleKey}`,
          referenceLabel: `Canonical style: ${styleKey}`,
        };

        for (const principle of guidance.principles) {
          recs.push({
            id:           "",
            type:         "principle",
            title:        `${styleKey} — Design Principle`,
            body:         principle,
            confidence:   "high",
            reason: {
              summary:   `Core principle for the "${styleKey}" canonical style.`,
              citations: [citation],
            },
            applicability: [`Style: ${styleKey}`],
            hasSource:     true,
            scope:         q.scope ?? {},
            isAdvisory:    true,
          });
        }

        for (const guideline of guidance.guidelines) {
          recs.push({
            id:           "",
            type:         "guideline",
            title:        `${styleKey} — Guideline`,
            body:         guideline,
            confidence:   "high",
            reason: {
              summary:   `Established guideline for "${styleKey}" style execution.`,
              citations: [citation],
            },
            applicability: [`Style: ${styleKey}`],
            hasSource:     true,
            scope:         q.scope ?? {},
            isAdvisory:    true,
          });
        }

        for (const ap of guidance.antiPatterns) {
          recs.push({
            id:           "",
            type:         "anti_pattern",
            title:        `${styleKey} — Anti-Pattern`,
            body:         ap,
            confidence:   "medium",
            reason: {
              summary:   `Known anti-pattern that weakens "${styleKey}" execution.`,
              citations: [citation],
            },
            applicability: [`Style: ${styleKey}`],
            hasSource:     true,
            scope:         q.scope ?? {},
            isAdvisory:    true,
          });
        }
      }
    }

    // ── Industry-style compatibility hint ────────────────────────────────────
    if (styleKey && industryKey) {
      recs.push({
        id:           "",
        type:         "compliance_rule",
        title:        `${styleKey} × ${industryKey} — Compatibility`,
        body:         `Combining "${styleKey}" style with "${industryKey}" industry context is a recognised pattern. Verify audience expectations before committing to this pairing.`,
        confidence:   "medium",
        reason: {
          summary:   "Industry-style pairing compatibility note from canonical classification.",
          citations: [{
            source,
            referenceId:    `compat:${styleKey}:${industryKey}`,
            referenceLabel: `Style-Industry pair: ${styleKey} × ${industryKey}`,
          }],
        },
        applicability: [`Style: ${styleKey}`, `Industry: ${industryKey}`],
        hasSource:     true,
        scope:         q.scope ?? {},
        isAdvisory:    true,
      });
    }

    // ── Generic advisory when no style is identified ──────────────────────
    if (!styleKey) {
      recs.push({
        id:           "",
        type:         "workflow_hint",
        title:        "Style Not Identified — Specify for Better Recommendations",
        body:         "No canonical style was detected in the query. Providing a style preference (e.g. minimalist, luxury, bold) will unlock targeted design principles and guidelines.",
        confidence:   "low",
        reason: {
          summary:   "Heuristic advisory — no source citation available without a style signal.",
          citations: [],
        },
        applicability: ["All queries without explicit style"],
        hasSource:     false,
        scope:         q.scope ?? {},
        isAdvisory:    true,
      });
    }

    const limit = filter.limit ?? 15;
    return recs.slice(0, limit);
  },
};

// ─── Query signal extractors ──────────────────────────────────────────────────

function extractStyleSignal(query: string): string | undefined {
  const q = query.toLowerCase();
  const keys = canonicalStyleKeys();
  return keys.find((k) => q.includes(k));
}

function extractIndustrySignal(query: string): string | undefined {
  const q = query.toLowerCase();
  const industries = [
    "fashion", "food", "beverage", "technology", "healthcare", "finance",
    "real_estate", "logistics", "education", "retail", "beauty", "hotel",
    "travel", "automotive", "construction", "manufacturing", "consulting",
  ];
  return industries.find((i) => q.includes(i));
}
