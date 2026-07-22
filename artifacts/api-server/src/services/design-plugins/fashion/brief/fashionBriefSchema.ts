/**
 * fashionBriefSchema.ts — Fashion Design Plugin
 *
 * Zod schema for fashion design briefs.
 * All fields live in this plugin — NONE are added to core brief types.
 *
 * Rule: Do not import this schema into any core service or core brief type.
 *       Only the fashion plugin and its tests should import from this file.
 */

import { z } from "zod";

// ── Enumerations ──────────────────────────────────────────────────────────────

export const FashionProductCategorySchema = z.enum([
  "womenswear",
  "menswear",
  "childrenswear",
  "unisex",
  "activewear",
  "swimwear",
  "outerwear",
  "accessories",
  "footwear",
  "lingerie",
  "eveningwear",
  "workwear",
  "streetwear",
  "couture",
]);

export const FashionSeasonSchema = z.enum([
  "ss",   // Spring/Summer
  "aw",   // Autumn/Winter
  "rs",   // Resort/Cruise
  "pre_fall",
  "pre_spring",
  "evergreen",
]);

export const FashionStyleDirectionSchema = z.enum([
  "minimalist",
  "maximalist",
  "classic",
  "avant_garde",
  "streetwear",
  "bohemian",
  "preppy",
  "romantic",
  "athletic",
  "futuristic",
  "sustainable",
  "cultural_fusion",
]);

export const FashionSilhouetteSchema = z.enum([
  "a_line",
  "straight",
  "fitted",
  "oversized",
  "boxy",
  "wrap",
  "empire",
  "column",
  "peplum",
  "asymmetric",
  "tiered",
  "balloon",
]);

export const FashionMarketSegmentSchema = z.enum([
  "luxury",
  "premium",
  "contemporary",
  "mass_market",
  "fast_fashion",
  "sustainable",
  "bespoke",
  "sportswear",
  "childrenswear_mass",
]);

export const FashionSustainabilitySchema = z.enum([
  "none",
  "eco_fabrics",
  "recycled_materials",
  "organic_certified",
  "fair_trade",
  "zero_waste_pattern",
  "carbon_neutral",
  "fully_circular",
]);

// ── Sub-schemas ───────────────────────────────────────────────────────────────

export const FashionSizeRangeSchema = z.object({
  system: z.enum(["EU", "US", "UK", "IT", "universal", "custom"]),
  min: z.string().min(1).max(20),
  max: z.string().min(1).max(20),
  includesExtended: z.boolean().default(false),
  notes: z.string().max(200).optional(),
});

export const FashionProductionConstraintsSchema = z.object({
  minimumOrderQuantity: z.number().int().min(1).optional(),
  leadTimeWeeks: z.number().int().min(1).max(104).optional(),
  targetCostUsd: z.number().positive().optional(),
  manufacturingCountry: z.string().max(60).optional(),
  certifications: z.array(z.string().max(60)).max(10).optional(),
  notes: z.string().max(500).optional(),
});

export const FashionColorDirectionSchema = z.object({
  primaryColors: z.array(z.string().max(60)).min(1).max(6),
  accentColors: z.array(z.string().max(60)).max(4).optional(),
  colorMood: z
    .enum(["bold", "muted", "monochrome", "pastel", "earthy", "neon", "neutral"])
    .optional(),
  pantoneReferences: z.array(z.string().max(30)).max(8).optional(),
  avoidColors: z.array(z.string().max(60)).max(6).optional(),
});

export const FashionMaterialPreferenceSchema = z.object({
  primaryFabrics: z.array(z.string().max(80)).min(1).max(8),
  avoidFabrics: z.array(z.string().max(80)).max(8).optional(),
  texturePreferences: z
    .array(
      z.enum([
        "smooth",
        "textured",
        "woven",
        "knit",
        "lace",
        "embroidered",
        "printed",
        "denim",
        "leather",
        "velvet",
        "chiffon",
        "technical",
      ]),
    )
    .max(6)
    .optional(),
  weightPreference: z.enum(["lightweight", "medium", "heavy", "mixed"]).optional(),
});

export const FashionReferenceAssetSchema = z.object({
  type: z.enum(["mood_image", "sketch", "fabric_swatch", "competitor_reference", "inspiration_brand"]),
  /** Storage URL or external URL — must be a valid URL string. */
  url: z.string().url(),
  caption: z.string().max(200).optional(),
});

// ── Main Brief Schema ─────────────────────────────────────────────────────────

export const FashionBriefSchema = z.object({
  // ── Required fields ────────────────────────────────────────────────────────
  productCategory: FashionProductCategorySchema,
  targetUser: z.string().min(2).max(200),
  season: FashionSeasonSchema,
  styleDirection: FashionStyleDirectionSchema,
  silhouette: FashionSilhouetteSchema,
  colorDirection: FashionColorDirectionSchema,
  materialPreference: FashionMaterialPreferenceSchema,
  marketSegment: FashionMarketSegmentSchema,

  // ── Optional fields ────────────────────────────────────────────────────────
  sizeRange: FashionSizeRangeSchema.optional(),
  productionConstraints: FashionProductionConstraintsSchema.optional(),
  sustainability: FashionSustainabilitySchema.optional().default("none"),

  /**
   * Conditional: required when productCategory is "activewear" or "swimwear".
   * Validated via .superRefine() below.
   */
  performanceRequirements: z
    .object({
      moistureWicking: z.boolean().default(false),
      uvProtection: z.boolean().default(false),
      quickDry: z.boolean().default(false),
      stretchRecovery: z.boolean().default(false),
      chlorineResistant: z.boolean().default(false),
    })
    .optional(),

  /**
   * Conditional: required when marketSegment is "luxury" or "bespoke".
   * Validated via .superRefine() below.
   */
  luxuryDetails: z
    .object({
      coutureTechniques: z.array(z.string().max(100)).max(10).optional(),
      exclusivityNotes: z.string().max(500).optional(),
      limitedEditionRun: z.number().int().positive().optional(),
    })
    .optional(),

  referenceAssets: z.array(FashionReferenceAssetSchema).max(20).optional(),
  additionalNotes: z.string().max(2000).optional(),
})
  .superRefine((data, ctx) => {
    // Conditional: activewear / swimwear requires performanceRequirements
    if (
      (data.productCategory === "activewear" || data.productCategory === "swimwear") &&
      !data.performanceRequirements
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "performanceRequirements is required for activewear and swimwear product categories",
        path: ["performanceRequirements"],
      });
    }
    // Conditional: luxury / bespoke segment should have luxuryDetails
    if (
      (data.marketSegment === "luxury" || data.marketSegment === "bespoke") &&
      !data.luxuryDetails
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "luxuryDetails is required for luxury and bespoke market segments",
        path: ["luxuryDetails"],
      });
    }
  });

export type FashionBrief = z.infer<typeof FashionBriefSchema>;
export type FashionProductCategory = z.infer<typeof FashionProductCategorySchema>;
export type FashionSeason = z.infer<typeof FashionSeasonSchema>;
export type FashionStyleDirection = z.infer<typeof FashionStyleDirectionSchema>;
export type FashionSilhouette = z.infer<typeof FashionSilhouetteSchema>;
export type FashionMarketSegment = z.infer<typeof FashionMarketSegmentSchema>;
