/**
 * Template Knowledge Payload Generator — Enterprise Template Knowledge Library V5.0
 *
 * Generates rich `ai_template_knowledge` entries (Brand DNA, Visual DNA, Composition,
 * Prompt Guidance, Quality Rules) for every template in `ai_templates`.
 *
 * Works by re-deriving the same specs used by templateKnowledgeGenerator, then
 * mapping each spec through the shared STYLE_CONFIGS / INDUSTRY_CONTEXT maps.
 */

import type { InsertAiTemplateKnowledge } from "@workspace/db";
import {
  generateAllSpecs,
  generateCode,
  generateSlug,
  STYLE_CONFIGS,
  INDUSTRY_CONTEXT,
  CATEGORY_OUTPUT,
  CATEGORY_SECTIONS,
} from "./templateKnowledgeGenerator.js";

// ─────────────────────────────────────────────────────────────────────────────
// Industry keyword map for Brand DNA keywords
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  fashion:          ["style", "fashion", "collection", "trend", "apparel"],
  luxury_fashion:   ["luxury", "haute couture", "exclusivity", "heritage", "prestige"],
  modest_fashion:   ["modest", "elegant", "hijab", "faith", "refined"],
  streetwear_brand: ["street", "urban", "hype", "culture", "drop"],
  fast_fashion:     ["trend", "affordable", "new arrivals", "seasonal", "accessible"],
  sportswear:       ["performance", "athletic", "active", "sport", "fitness"],
  kids_fashion:     ["kids", "children", "playful", "safe", "family"],
  boutique:         ["curated", "exclusive", "artisan", "personal", "limited"],
  jewelry:          ["precious", "gold", "diamond", "craftsmanship", "timeless"],
  shoes:            ["footwear", "sneakers", "collection", "design", "comfort"],
  bag:              ["leather", "handbag", "accessories", "designer", "luxury"],
  beauty:           ["beauty", "skincare", "glow", "self-care", "wellness"],
  cosmetics:        ["makeup", "color", "expression", "beauty", "cosmetics"],
  lifestyle:        ["wellness", "balance", "quality", "mindful", "living"],
  food_beverage:    ["food", "taste", "quality", "fresh", "experience"],
  beverage:         ["drink", "refreshing", "flavor", "social", "hydration"],
  coffee:           ["coffee", "specialty", "artisan", "brew", "origin"],
  restaurant:       ["dining", "cuisine", "flavor", "experience", "chef"],
  hotel:            ["hospitality", "comfort", "luxury stay", "service", "experience"],
  travel:           ["adventure", "explore", "destination", "journey", "discovery"],
  healthcare:       ["health", "care", "wellness", "trust", "professional"],
  education:        ["learning", "knowledge", "growth", "future", "excellence"],
  finance:          ["trust", "wealth", "security", "investment", "growth"],
  fintech:          ["innovation", "digital finance", "seamless", "smart", "secure"],
  technology:       ["innovation", "digital", "future", "tech", "solution"],
  saas:             ["platform", "efficiency", "scale", "automation", "data"],
  real_estate:      ["property", "premium location", "investment", "home", "development"],
  logistics:        ["supply chain", "efficiency", "reliability", "global", "delivery"],
  manufacturing:    ["precision", "quality", "industrial", "production", "engineering"],
  construction:     ["build", "structure", "engineering", "quality", "project"],
  automotive:       ["performance", "engineering", "drive", "design", "power"],
  mining:           ["resources", "extraction", "industrial", "global", "engineering"],
  energy:           ["sustainable", "power", "future", "renewable", "innovation"],
  agriculture:      ["natural", "sustainable", "harvest", "organic", "growth"],
  government:       ["public service", "trust", "transparency", "community", "nation"],
  ngo:              ["impact", "social change", "community", "mission", "people"],
  entertainment:    ["entertainment", "experience", "culture", "creative", "audience"],
  sports:           ["champion", "performance", "team", "competition", "victory"],
  interior_design:  ["space", "aesthetic", "design", "atmosphere", "concept"],
  consulting:       ["strategy", "expertise", "transformation", "results", "advisory"],
  retail:           ["shop", "brand", "product", "value", "customer"],
  wedding:          ["love", "celebration", "romantic", "ceremony", "forever"],
  media:            ["content", "story", "audience", "broadcast", "publish"],
  cosmetics_beauty: ["beauty", "makeup", "skincare", "color", "glow"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Build output support flags from the category's output format list
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

// ─────────────────────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────────────────────

export function generateTemplateKnowledgePayloads(): InsertAiTemplateKnowledge[] {
  const specs = generateAllSpecs();

  return specs.map((spec, idx) => {
    const i = idx + 1;
    const sc = STYLE_CONFIGS[spec.style] ?? STYLE_CONFIGS["modern"]!;
    const ic = INDUSTRY_CONTEXT[spec.industry] ?? { businessType: "B2C", market: "national", persona: "General audience", price: "mid-market" };
    const outputs = CATEGORY_OUTPUT[spec.category as keyof typeof CATEGORY_OUTPUT] ?? ["pdf"];
    const sections = CATEGORY_SECTIONS[spec.category as keyof typeof CATEGORY_SECTIONS] ?? [];
    const keywords = INDUSTRY_KEYWORDS[spec.industry] ?? ["brand", "quality", "professional"];

    return {
      templateCode: generateCode(spec.category, spec.industry, spec.style, i),
      slug:         generateSlug(spec.category, spec.industry, spec.style, i),

      businessContext: {
        businessType:     ic.businessType,
        market:           ic.market,
        targetAudience:   ic.persona,
        customerPersona:  ic.persona,
        pricePositioning: ic.price,
      },

      brandDna: {
        personalities: sc.personalities,
        emotions:      sc.emotions,
        archetypes:    sc.archetypes,
        voice:         sc.voice,
        tone:          sc.tone,
        keywords,
      },

      visualDna: {
        designStyle:       sc.designStyle,
        layoutStyle:       sc.layoutStyle,
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
        systemPrompt:        `You are a professional ${spec.style} ${spec.category} designer specializing in the ${spec.industry.replace(/_/g, " ")} industry.`,
        designerPrompt:      `Apply ${spec.style} design principles. Focus on ${sc.personalities.join(", ")} brand values. Industry: ${spec.industry.replace(/_/g, " ")}.`,
        artDirectionPrompt:  sc.artDirectionPrompt,
        imagePrompt:         sc.imagePrompt,
        negativePrompt:      sc.negativePrompt,
      },

      qualityRules: {
        checklist:           sc.checklist,
        designRules:         sc.designRules,
        prohibitedPatterns:  sc.prohibitedPatterns,
      },

      approvalStatus: "published",
      generatedByAi:  false,
    };
  });
}
