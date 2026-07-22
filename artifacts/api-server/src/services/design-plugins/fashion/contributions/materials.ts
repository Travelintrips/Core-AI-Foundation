/**
 * materials.ts — Fashion Design Plugin
 *
 * Fashion-specific material category contributions.
 *
 * Rules:
 *   - These categories and their FashionMaterialMetadata fields (stretch, weight,
 *     drape, opacity, composition, care, finish) are fashion-domain ONLY.
 *   - They must NOT be added to MaterialInput in dynamic-design-composer/types.ts.
 *   - The core design engine's MaterialInput (surface, texture, elevation, etc.) is
 *     preserved unchanged — fashion metadata is an additive plugin contribution.
 *   - If Team 21 publishes a canonical material contract, these categories should be
 *     registered through that system. See Team 39 notes in pluginContracts.ts.
 */

import type { MaterialCategoryContribution } from "../types/pluginContracts.js";

export const fashionMaterialCategories: MaterialCategoryContribution[] = [
  {
    id: "fashion_material_woven_natural",
    displayName: "Woven Natural Fibres",
    description:
      "Natural-fibre woven fabrics: cotton, linen, silk, wool, and blends. " +
      "Classic choices offering breathability and drape.",
    examples: ["cotton poplin", "linen canvas", "silk charmeuse", "wool crepe", "cotton voile"],
    fashionMetadataTemplate: {
      stretch: "none",
      weightGsm: 120,
      drape: "moderate",
      opacity: "opaque",
      composition: "100% cotton",
      care: ["machine wash 30°C", "iron medium"],
      finish: "plain",
    },
  },
  {
    id: "fashion_material_woven_synthetic",
    displayName: "Woven Synthetic Fibres",
    description:
      "Synthetic-fibre woven fabrics: polyester, nylon, viscose, and technical weaves. " +
      "High durability and wide finish options.",
    examples: ["polyester satin", "nylon taffeta", "viscose challis", "microfibre twill"],
    fashionMetadataTemplate: {
      stretch: "none",
      weightGsm: 100,
      drape: "fluid",
      opacity: "opaque",
      composition: "100% polyester",
      care: ["machine wash cold", "tumble dry low"],
      finish: "satin",
    },
  },
  {
    id: "fashion_material_knit_stretch",
    displayName: "Knit & Stretch Fabrics",
    description:
      "Knit constructions offering stretch and comfort: jersey, rib, ponte, " +
      "interlock, and technical performance knits.",
    examples: ["single jersey", "ribbed knit", "ponte roma", "interlock", "bamboo jersey"],
    fashionMetadataTemplate: {
      stretch: "four-way",
      weightGsm: 180,
      drape: "moderate",
      opacity: "opaque",
      composition: "95% cotton, 5% elastane",
      care: ["machine wash 40°C", "do not tumble dry"],
      finish: "plain",
    },
  },
  {
    id: "fashion_material_denim",
    displayName: "Denim & Chambray",
    description:
      "Woven denim, chambray, and denim-look fabrics ranging from lightweight " +
      "chambray to heavy selvedge denim.",
    examples: ["12oz selvedge denim", "chambray", "stretch denim", "raw denim", "acid-wash denim"],
    fashionMetadataTemplate: {
      stretch: "none",
      weightGsm: 340,
      drape: "stiff",
      opacity: "opaque",
      composition: "98% cotton, 2% elastane",
      care: ["machine wash cold", "wash inside out", "line dry"],
      finish: "plain",
    },
  },
  {
    id: "fashion_material_leather_faux",
    displayName: "Leather & Faux Leather",
    description:
      "Genuine leather, suede, and vegan/faux leather alternatives. " +
      "Premium texture with strong structural properties.",
    examples: ["lambskin leather", "suede", "PU faux leather", "vegan leather", "nappa leather"],
    fashionMetadataTemplate: {
      stretch: "none",
      drape: "stiff",
      opacity: "opaque",
      composition: "genuine bovine leather",
      care: ["leather conditioner", "do not machine wash", "store away from direct sunlight"],
      finish: "matte",
    },
  },
  {
    id: "fashion_material_sheer_delicate",
    displayName: "Sheer & Delicate Fabrics",
    description:
      "Lightweight, sheer, and delicate fabrics: organza, chiffon, tulle, " +
      "georgette, and lace. Common in eveningwear and layering.",
    examples: ["silk organza", "chiffon", "tulle", "georgette", "stretch lace", "voile"],
    fashionMetadataTemplate: {
      stretch: "none",
      weightGsm: 35,
      drape: "fluid",
      opacity: "sheer",
      composition: "100% silk",
      care: ["hand wash cold", "dry clean recommended", "iron on silk setting"],
      finish: "plain",
    },
  },
  {
    id: "fashion_material_technical_performance",
    displayName: "Technical & Performance Fabrics",
    description:
      "High-performance technical textiles for activewear, sportswear, and " +
      "functional fashion: moisture-wicking, UV-protective, quick-dry.",
    examples: [
      "recycled nylon performance knit",
      "moisture-wicking polyester",
      "UV50+ supplex",
      "four-way stretch technical jersey",
    ],
    fashionMetadataTemplate: {
      stretch: "four-way",
      weightGsm: 150,
      drape: "moderate",
      opacity: "opaque",
      composition: "88% nylon, 12% spandex",
      care: ["machine wash cold", "do not use fabric softener", "hang dry"],
      finish: "matte",
    },
  },
  {
    id: "fashion_material_sustainable",
    displayName: "Sustainable & Eco Fabrics",
    description:
      "Eco-certified, recycled, or regenerative textiles: GOTS organic cotton, " +
      "TENCEL, recycled polyester (rPET), bamboo, and hemp.",
    examples: [
      "GOTS organic cotton",
      "TENCEL lyocell",
      "rPET jersey",
      "bamboo viscose",
      "hemp linen",
      "deadstock silk",
    ],
    fashionMetadataTemplate: {
      stretch: "none",
      weightGsm: 130,
      drape: "fluid",
      opacity: "opaque",
      composition: "100% TENCEL lyocell",
      care: ["machine wash 30°C", "OEKO-TEX certified"],
      finish: "plain",
    },
  },
];

/** Lookup material category by ID. */
export function getFashionMaterialCategory(
  id: string,
): MaterialCategoryContribution | undefined {
  return fashionMaterialCategories.find((m) => m.id === id);
}
