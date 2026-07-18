/**
 * Legacy Template Backfill Generator — Enterprise Template Knowledge Library V5.0
 *
 * Generates rich ai_template_knowledge payloads for pre-existing ai_templates rows
 * that were NOT seeded by the standard knowledge seed (i.e. they have no match in
 * ai_template_knowledge).
 *
 * Rules (from spec):
 *  - use template's existing metadata as much as possible (name, category, style, industry, tags)
 *  - never produce identical generic payloads for all templates
 *  - use canonical normalizer → STYLE_CONFIGS → INDUSTRY_CONTEXT for structured knowledge
 *  - deterministic fallback from canonical knowledge tables if style/industry is missing
 *  - ON CONFLICT DO NOTHING — never overwrite valid existing payloads
 *  - idempotent: re-running produces 0 new inserts if already backfilled
 */

import type { AiTemplate, InsertAiTemplateKnowledge } from "@workspace/db";
import {
  STYLE_CONFIGS,
  INDUSTRY_CONTEXT,
  CATEGORY_OUTPUT,
  CATEGORY_SECTIONS,
} from "./templateKnowledgeGenerator.js";
import { normalizeStyle, normalizeIndustry } from "../utils/canonicalNormalizer.js";

// ─────────────────────────────────────────────────────────────────────────────
// Category → output support fallback
// (for categories not in the seeder's CATEGORY_OUTPUT enum)
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_CATEGORY_OUTPUT: Record<string, string[]> = {
  "Company Profile":   ["pdf", "pptx"],
  "Pitch Deck":        ["pptx", "pdf"],
  "Landing Page":      ["html", "png"],
  "Social Media":      ["png", "social_media"],
  "Packaging":         ["png", "pdf"],
  "Infographic":       ["png", "svg"],
  "Brochure":          ["pdf", "png"],
  "Website":           ["html", "png"],
  "Website Hero":      ["html", "png"],
  "Interior":          ["png", "pdf"],
  "Fashion":           ["png", "pdf"],
  "Annual Report":     ["pdf", "pptx"],
  "Banner":            ["png", "svg"],
  "Business Card":     ["png", "pdf"],
  "Case Study":        ["pdf"],
  "Corporate Profile": ["pdf", "pptx"],
  "Email Signature":   ["html", "png"],
  "Letterhead":        ["pdf"],
  "LinkedIn Post":     ["png", "social_media"],
  "Logo":              ["svg", "png"],
  "Presentation":      ["pptx", "pdf"],
  "Product Catalog":   ["pdf"],
  "Proposal":          ["pdf"],
  "Whitepaper":        ["pdf"],
  "Report":            ["pdf"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Category → section order fallback
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_CATEGORY_SECTIONS: Record<string, string[]> = {
  "Company Profile":   ["executive_summary", "about_us", "services", "team", "portfolio", "contact"],
  "Corporate Profile": ["executive_summary", "about_us", "services", "team", "portfolio", "contact"],
  "Pitch Deck":        ["problem", "solution", "market_opportunity", "product", "business_model", "team", "ask"],
  "Landing Page":      ["hero", "features", "benefits", "social_proof", "cta"],
  "Social Media":      ["visual_hook", "message", "cta"],
  "Brochure":          ["cover", "overview", "services", "contact"],
  "Annual Report":     ["highlights", "financial_summary", "operations", "outlook"],
  "Whitepaper":        ["executive_summary", "background", "analysis", "recommendations", "conclusion"],
  "Proposal":          ["executive_summary", "scope", "methodology", "timeline", "pricing"],
  "Case Study":        ["challenge", "solution", "results", "testimonial"],
  "Product Catalog":   ["cover", "categories", "products", "specifications", "ordering"],
  "Presentation":      ["title", "agenda", "content", "summary", "cta"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Industry → keyword map for brand DNA keywords
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  technology:     ["innovation", "digital", "future", "tech", "solution"],
  finance:        ["trust", "wealth", "security", "investment", "growth"],
  healthcare:     ["health", "care", "wellness", "trust", "professional"],
  real_estate:    ["property", "location", "investment", "home", "development"],
  food_beverage:  ["food", "taste", "quality", "fresh", "experience"],
  logistics:      ["supply chain", "efficiency", "reliability", "delivery"],
  manufacturing:  ["precision", "quality", "production", "engineering"],
  construction:   ["build", "structure", "engineering", "quality"],
  education:      ["learning", "knowledge", "growth", "future"],
  retail:         ["shop", "brand", "product", "value", "customer"],
  consulting:     ["strategy", "expertise", "results", "advisory"],
  fashion:        ["style", "fashion", "collection", "trend"],
  beauty:         ["beauty", "skincare", "glow", "self-care"],
  entertainment:  ["entertainment", "experience", "culture", "creative"],
  media:          ["content", "story", "audience", "broadcast"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Default fallback configs when canonical style/industry not in maps
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_STYLE = STYLE_CONFIGS["modern"]!;
const FALLBACK_INDUSTRY: { businessType: string; market: string; persona: string; price: string } = {
  businessType: "B2B",
  market: "national",
  persona: "Business professional",
  price: "mid-market",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildOutputSupport(outputs: string[]) {
  return {
    pdf:         outputs.includes("pdf"),
    pptx:        outputs.includes("pptx"),
    png:         outputs.includes("png"),
    svg:         outputs.includes("svg"),
    html:        outputs.includes("html"),
    socialMedia: outputs.includes("social_media"),
  };
}

function getLegacySlug(templateCode: string): string {
  // Prefix with "legacy-" to guarantee no collision with seeded slugs
  return `legacy-${templateCode.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function getOutputs(category: string): string[] {
  // Try the seeder's CATEGORY_OUTPUT first, then legacy fallback
  const seedKey = category as keyof typeof CATEGORY_OUTPUT;
  if (CATEGORY_OUTPUT[seedKey]) return CATEGORY_OUTPUT[seedKey];
  return LEGACY_CATEGORY_OUTPUT[category] ?? ["pdf"];
}

function getSections(category: string): string[] {
  const seedKey = category as keyof typeof CATEGORY_SECTIONS;
  if (CATEGORY_SECTIONS[seedKey]) return CATEGORY_SECTIONS[seedKey];
  return LEGACY_CATEGORY_SECTIONS[category] ?? ["cover", "content", "contact"];
}

function extractKeywordsFromTemplate(template: AiTemplate): string[] {
  const industryKeywords = INDUSTRY_KEYWORDS[template.industry ?? ""] ?? [];
  const tagKeywords: string[] = Array.isArray(template.tags) ? (template.tags as string[]) : [];
  const combined = [...new Set([...industryKeywords, ...tagKeywords])];
  return combined.slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core payload builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build one InsertAiTemplateKnowledge from a legacy AiTemplate row.
 * Normalizes style and industry, looks up canonical configs, and derives
 * the rich payload from the template's existing metadata.
 */
export function generateLegacyPayload(template: AiTemplate): InsertAiTemplateKnowledge {
  // Normalize style and industry to canonical form
  const canonicalStyle    = template.style    ? (normalizeStyle(template.style)       ?? template.style)    : "modern";
  const canonicalIndustry = template.industry ? (normalizeIndustry(template.industry) ?? template.industry) : null;

  // Look up configs (with fallback)
  const sc = STYLE_CONFIGS[canonicalStyle] ?? FALLBACK_STYLE;
  const ic = canonicalIndustry
    ? (INDUSTRY_CONTEXT[canonicalIndustry] ?? FALLBACK_INDUSTRY)
    : FALLBACK_INDUSTRY;

  const outputs  = getOutputs(template.category);
  const sections = getSections(template.category);
  const keywords = extractKeywordsFromTemplate(template);

  // Derive additional context from template metadata
  const colorInfo = template.colorTheme?.primary
    ? `Primary color: ${template.colorTheme.primary}.`
    : "";
  const typographyInfo = template.typography?.heading
    ? `Heading font: ${template.typography.heading}.`
    : "";
  const brandTags: string[] = Array.isArray(template.brandDnaTags?.personalities)
    ? (template.brandDnaTags?.personalities as string[])
    : sc.personalities;

  return {
    templateCode: template.templateCode,
    slug:         getLegacySlug(template.templateCode),

    businessContext: {
      businessType:     ic.businessType,
      market:           ic.market,
      targetAudience:   ic.persona,
      customerPersona:  ic.persona,
      pricePositioning: ic.price,
    },

    brandDna: {
      personalities: brandTags.length > 0 ? brandTags : sc.personalities,
      emotions:      sc.emotions,
      archetypes:    sc.archetypes,
      voice:         sc.voice,
      tone:          sc.tone,
      keywords:      keywords.length > 0 ? keywords : sc.personalities,
    },

    visualDna: {
      designStyle:       canonicalStyle,
      layoutStyle:       template.layout ?? sc.layoutStyle,
      spacingStyle:      sc.spacingStyle,
      illustrationStyle: sc.illustrationStyle,
      photographyStyle:  sc.photographyStyle,
      iconStyle:         sc.iconStyle,
    },

    composition: {
      heroLayout:      sc.heroLayout,
      sectionOrder:    sections,
      gridSystem:      sc.gridSystem,
      whitespaceRules: sc.whitespaceRules,
    },

    outputSupport: buildOutputSupport(outputs),

    promptGuidance: {
      systemPrompt: [
        `You are a professional ${canonicalStyle} ${template.category} designer`,
        canonicalIndustry ? `specializing in the ${canonicalIndustry.replace(/_/g, " ")} industry` : null,
        "with expertise in creating compelling visual communications.",
      ].filter(Boolean).join(" "),
      designerPrompt: [
        `Apply ${canonicalStyle} design principles to "${template.name}".`,
        `Focus on ${sc.personalities.slice(0, 2).join(" and ")} brand values.`,
        typographyInfo,
        colorInfo,
      ].filter(Boolean).join(" "),
      artDirectionPrompt: sc.artDirectionPrompt,
      imagePrompt:        sc.imagePrompt,
      negativePrompt:     sc.negativePrompt,
    },

    qualityRules: {
      checklist:          sc.checklist,
      designRules:        sc.designRules,
      prohibitedPatterns: sc.prohibitedPatterns,
    },

    approvalStatus: "published",
    generatedByAi:  false,
  };
}

/**
 * Generate rich payloads for multiple legacy templates.
 * Skips any template that already has a valid templateCode
 * (deduplication is enforced at the DB level via ON CONFLICT DO NOTHING).
 */
export function generateLegacyPayloads(templates: AiTemplate[]): InsertAiTemplateKnowledge[] {
  const seen = new Set<string>();
  const payloads: InsertAiTemplateKnowledge[] = [];

  for (const template of templates) {
    if (seen.has(template.templateCode)) continue; // in-memory dedup
    seen.add(template.templateCode);
    payloads.push(generateLegacyPayload(template));
  }

  return payloads;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unresolved value reporter
// ─────────────────────────────────────────────────────────────────────────────

export interface UnresolvedValues {
  styles:     Array<{ templateCode: string; rawStyle: string }>;
  industries: Array<{ templateCode: string; rawIndustry: string }>;
}

/**
 * Report which templates have style/industry values that could NOT be mapped
 * to a canonical key. Used for audit and manual review.
 */
export function findUnresolvedValues(templates: AiTemplate[]): UnresolvedValues {
  const unresolved: UnresolvedValues = { styles: [], industries: [] };

  for (const t of templates) {
    if (t.style && !normalizeStyle(t.style)) {
      unresolved.styles.push({ templateCode: t.templateCode, rawStyle: t.style });
    }
    if (t.industry && !normalizeIndustry(t.industry)) {
      unresolved.industries.push({ templateCode: t.templateCode, rawIndustry: t.industry });
    }
  }

  return unresolved;
}
