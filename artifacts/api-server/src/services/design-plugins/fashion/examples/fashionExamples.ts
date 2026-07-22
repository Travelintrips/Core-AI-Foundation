/**
 * fashionExamples.ts — Fashion Design Plugin
 *
 * Domain examples: complete, valid, serializable/parseable FashionBrief instances
 * covering the full range of product categories and market segments.
 *
 * Rules:
 *   - Every example must pass FashionBriefSchema.parse() without error.
 *   - Examples must be self-contained — no database IDs, no external URLs that
 *     could change, no hard-coded tenant or provider values.
 *   - These are for tests, documentation, and onboarding only.
 *     They must NEVER be displayed as production data.
 */

import type { FashionBrief } from "../brief/fashionBriefSchema.js";

/** Example 1: Contemporary womenswear — SS collection, sustainable, mid-market. */
export const exampleWomenswearSS: FashionBrief = {
  productCategory: "womenswear",
  targetUser:
    "Women aged 28–42, urban professional, eco-conscious, values quality and " +
    "understated elegance over trend-driven fashion.",
  season: "ss",
  styleDirection: "minimalist",
  silhouette: "a_line",
  colorDirection: {
    primaryColors: ["ivory", "sage green", "warm sand"],
    accentColors: ["terracotta"],
    colorMood: "muted",
    pantoneReferences: ["11-0601 TCX", "15-0318 TCX", "13-1015 TCX"],
    avoidColors: ["neon", "black"],
  },
  materialPreference: {
    primaryFabrics: ["TENCEL lyocell", "organic cotton poplin", "linen blend"],
    texturePreferences: ["smooth", "woven"],
    weightPreference: "lightweight",
  },
  marketSegment: "contemporary",
  sizeRange: {
    system: "EU",
    min: "34",
    max: "46",
    includesExtended: false,
    notes: "Standard EU grading, no petite or tall variants in this run.",
  },
  productionConstraints: {
    minimumOrderQuantity: 200,
    leadTimeWeeks: 16,
    targetCostUsd: 28,
    manufacturingCountry: "Portugal",
    certifications: ["GOTS", "OEKO-TEX 100"],
  },
  sustainability: "organic_certified",
  referenceAssets: [
    {
      type: "inspiration_brand",
      url: "https://example.com/ref/brand-a",
      caption: "Clean minimalist editorial — tone reference only",
    },
  ],
  additionalNotes:
    "The collection narrative is 'slow dressing' — investment pieces designed to last " +
    "multiple seasons. Avoid fast-fashion silhouettes.",
};

/** Example 2: Activewear — AW, performance, mass-market. */
export const exampleActivewearAW: FashionBrief = {
  productCategory: "activewear",
  targetUser:
    "Men and women aged 20–35, gym-goers and casual athletes who want " +
    "performance fabrics at an accessible price point.",
  season: "aw",
  styleDirection: "athletic",
  silhouette: "fitted",
  colorDirection: {
    primaryColors: ["charcoal", "midnight navy"],
    accentColors: ["electric blue", "neon lime"],
    colorMood: "bold",
    avoidColors: ["pastels"],
  },
  materialPreference: {
    primaryFabrics: ["four-way stretch nylon", "recycled polyester jersey"],
    texturePreferences: ["smooth", "technical"],
    weightPreference: "medium",
  },
  marketSegment: "mass_market",
  sizeRange: {
    system: "US",
    min: "XS",
    max: "XXL",
    includesExtended: true,
    notes: "Must include women's XS–3XL and men's S–3XL.",
  },
  productionConstraints: {
    minimumOrderQuantity: 1000,
    leadTimeWeeks: 20,
    targetCostUsd: 12,
    manufacturingCountry: "Bangladesh",
    certifications: ["Bluesign"],
  },
  sustainability: "recycled_materials",
  performanceRequirements: {
    moistureWicking: true,
    uvProtection: false,
    quickDry: true,
    stretchRecovery: true,
    chlorineResistant: false,
  },
  additionalNotes: "Focus on flatlock seams to reduce chafing. No exposed elastic waistbands.",
};

/** Example 3: Eveningwear — luxury, couture-adjacent, bespoke. */
export const exampleEveningwearLuxury: FashionBrief = {
  productCategory: "eveningwear",
  targetUser:
    "High-net-worth women aged 35–65 attending formal galas, award ceremonies, " +
    "and private events. Client expects exclusivity and hand finishing.",
  season: "aw",
  styleDirection: "classic",
  silhouette: "column",
  colorDirection: {
    primaryColors: ["midnight black", "deep burgundy"],
    accentColors: ["champagne gold"],
    colorMood: "neutral",
    pantoneReferences: ["19-3911 TCX", "19-1617 TCX", "14-0846 TCX"],
  },
  materialPreference: {
    primaryFabrics: ["duchess satin", "silk crepe", "French lace"],
    texturePreferences: ["smooth", "lace", "embroidered"],
    weightPreference: "medium",
  },
  marketSegment: "luxury",
  sizeRange: {
    system: "IT",
    min: "38",
    max: "48",
    includesExtended: false,
  },
  productionConstraints: {
    minimumOrderQuantity: 25,
    leadTimeWeeks: 24,
    targetCostUsd: 480,
    manufacturingCountry: "Italy",
    certifications: ["CCMI Made in Italy"],
  },
  sustainability: "none",
  luxuryDetails: {
    coutureTechniques: [
      "hand-sewn beading",
      "hand-rolled hems",
      "French seams throughout",
      "boning and internal structure",
    ],
    exclusivityNotes: "Maximum 50 units per colourway globally. Each piece individually numbered.",
    limitedEditionRun: 50,
  },
  additionalNotes:
    "Client has an established atelier relationship. All samples must be hand-finished. " +
    "Deliveries in branded garment bags.",
};

/** Example 4: Menswear streetwear — SS, premium, contemporary. */
export const exampleMenswearStreetwear: FashionBrief = {
  productCategory: "menswear",
  targetUser:
    "Young men aged 18–30, fashion-forward, influenced by streetwear culture " +
    "and luxury collaborations. Follows key drops and limited releases.",
  season: "ss",
  styleDirection: "streetwear",
  silhouette: "oversized",
  colorDirection: {
    primaryColors: ["washed white", "stone"],
    accentColors: ["rust orange"],
    colorMood: "muted",
    avoidColors: ["bright primary colours"],
  },
  materialPreference: {
    primaryFabrics: ["heavyweight garment-dyed cotton fleece", "pigment-dyed cotton twill"],
    texturePreferences: ["woven", "printed"],
    weightPreference: "heavy",
  },
  marketSegment: "premium",
  sizeRange: {
    system: "US",
    min: "S",
    max: "3XL",
    includesExtended: false,
  },
  productionConstraints: {
    minimumOrderQuantity: 300,
    leadTimeWeeks: 18,
    targetCostUsd: 45,
    manufacturingCountry: "Turkey",
    certifications: ["OEKO-TEX 100"],
  },
  sustainability: "eco_fabrics",
  additionalNotes:
    "Drop-model release. All pieces must photograph well on social media. " +
    "Prioritise clean, graphic-led aesthetic over ornamentation.",
};

/** All examples as a keyed record for iteration in tests. */
export const fashionExamples: Record<string, FashionBrief> = {
  womenswear_ss_contemporary: exampleWomenswearSS,
  activewear_aw_mass_market: exampleActivewearAW,
  eveningwear_luxury_bespoke: exampleEveningwearLuxury,
  menswear_streetwear_premium: exampleMenswearStreetwear,
};
