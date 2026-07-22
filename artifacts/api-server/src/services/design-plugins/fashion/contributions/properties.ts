/**
 * properties.ts — Fashion Design Plugin
 *
 * Property section contributions for the fashion design canvas/property panel.
 *
 * Rules:
 *   - All sections live in the plugin contribution ONLY.
 *   - Canvas/core must not be forced to understand fashion semantics.
 *   - displayOrder drives rendering order in the property panel UI.
 */

import type { PropertySectionContribution } from "../types/pluginContracts.js";

export const fashionPropertySections: PropertySectionContribution[] = [
  {
    id: "fashion_prop_silhouette",
    displayName: "Silhouette",
    description: "Overall garment silhouette, volume distribution, and body proportion.",
    displayOrder: 10,
    fields: [
      {
        key: "silhouetteType",
        label: "Silhouette Type",
        type: "select",
        required: true,
        options: [
          "a_line", "straight", "fitted", "oversized", "boxy",
          "wrap", "empire", "column", "peplum", "asymmetric", "tiered", "balloon",
        ],
        description: "Primary silhouette shape of the garment.",
      },
      {
        key: "lengthCategory",
        label: "Garment Length",
        type: "select",
        required: true,
        options: ["micro", "mini", "above_knee", "knee", "midi", "maxi", "floor", "cropped", "hip_length", "waist_length"],
      },
      {
        key: "volumeDistribution",
        label: "Volume Distribution",
        type: "select",
        required: false,
        options: ["uniform", "top_heavy", "bottom_heavy", "waist_defined", "relaxed"],
      },
      {
        key: "fitType",
        label: "Fit Type",
        type: "select",
        required: true,
        options: ["slim", "regular", "relaxed", "oversize", "bodycon", "boxy", "oversized"],
      },
    ],
  },

  {
    id: "fashion_prop_garment_details",
    displayName: "Garment Details",
    description: "Key garment construction details: seaming, pleating, gathering, and darts.",
    displayOrder: 20,
    fields: [
      {
        key: "seamPlacement",
        label: "Seam Placement",
        type: "multiselect",
        required: false,
        options: [
          "centre_front", "centre_back", "side_seam", "shoulder", "princess",
          "yoke", "raglan", "empire_waist", "panel",
        ],
      },
      {
        key: "pleatType",
        label: "Pleat Type",
        type: "select",
        required: false,
        options: ["none", "knife_pleat", "box_pleat", "inverted_pleat", "released_pleat", "pintuck"],
      },
      {
        key: "gatheringDetail",
        label: "Gathering / Shirring",
        type: "select",
        required: false,
        options: ["none", "gathered_waist", "gathered_hem", "shirring", "smocking", "elasticated"],
      },
      {
        key: "dartUsage",
        label: "Dart Usage",
        type: "select",
        required: false,
        options: ["none", "bust_dart", "waist_dart", "princess_seam", "full_dart_set"],
      },
      {
        key: "liningType",
        label: "Lining",
        type: "select",
        required: false,
        options: ["none", "partial", "fully_lined", "bonded"],
      },
    ],
  },

  {
    id: "fashion_prop_dimensions",
    displayName: "Dimensions",
    description: "Measurement specifications and grading reference points.",
    displayOrder: 30,
    fields: [
      {
        key: "sizeSystem",
        label: "Size System",
        type: "select",
        required: true,
        options: ["EU", "US", "UK", "IT", "universal", "custom"],
      },
      {
        key: "sizeMin",
        label: "Size Range Min",
        type: "text",
        required: true,
        description: "Smallest size in the run (e.g. XS, 6, 34).",
      },
      {
        key: "sizeMax",
        label: "Size Range Max",
        type: "text",
        required: true,
        description: "Largest size in the run (e.g. 3XL, 20, 50).",
      },
      {
        key: "gradingInterval",
        label: "Grading Interval (cm)",
        type: "number",
        required: false,
        min: 1,
        max: 10,
        unit: "cm",
      },
      {
        key: "includesExtendedSizes",
        label: "Includes Extended Sizes",
        type: "boolean",
        required: false,
        description: "Whether the run includes plus or petite extended sizes.",
      },
    ],
  },

  {
    id: "fashion_prop_colorway",
    displayName: "Colorway",
    description: "Colour specification, Pantone references, and placement mapping.",
    displayOrder: 40,
    fields: [
      {
        key: "primaryColor",
        label: "Primary Colour",
        type: "color",
        required: true,
      },
      {
        key: "secondaryColor",
        label: "Secondary Colour",
        type: "color",
        required: false,
      },
      {
        key: "accentColor",
        label: "Accent / Trim Colour",
        type: "color",
        required: false,
      },
      {
        key: "pantoneRef",
        label: "Pantone Reference(s)",
        type: "text",
        required: false,
        description: "Comma-separated Pantone codes (e.g. 19-4052 TCX, 15-1520 TCX).",
      },
      {
        key: "colorMood",
        label: "Colour Mood",
        type: "select",
        required: false,
        options: ["bold", "muted", "monochrome", "pastel", "earthy", "neon", "neutral"],
      },
      {
        key: "printPattern",
        label: "Print / Pattern",
        type: "select",
        required: false,
        options: [
          "none", "solid", "stripe", "check", "plaid", "floral", "geometric",
          "abstract", "animal_print", "camouflage", "tie_dye", "digital_print",
        ],
      },
    ],
  },

  {
    id: "fashion_prop_material",
    displayName: "Material",
    description: "Primary and secondary fabric specifications and care.",
    displayOrder: 50,
    fields: [
      {
        key: "primaryFabric",
        label: "Primary Fabric",
        type: "text",
        required: true,
        description: "Main fabric name (e.g. 100% cotton jersey, TENCEL lyocell).",
      },
      {
        key: "fabricWeightGsm",
        label: "Fabric Weight",
        type: "number",
        required: false,
        min: 20,
        max: 800,
        unit: "gsm",
      },
      {
        key: "stretchProperty",
        label: "Stretch",
        type: "select",
        required: false,
        options: ["none", "two-way", "four-way", "mechanical"],
      },
      {
        key: "drapeQuality",
        label: "Drape",
        type: "select",
        required: false,
        options: ["stiff", "moderate", "fluid", "draped"],
      },
      {
        key: "fabricFinish",
        label: "Finish",
        type: "select",
        required: false,
        options: ["matte", "satin", "glossy", "brushed", "embossed", "printed", "plain"],
      },
      {
        key: "careInstructions",
        label: "Care Instructions",
        type: "text",
        required: false,
        description: "Comma-separated care symbols or instructions.",
      },
    ],
  },

  {
    id: "fashion_prop_construction",
    displayName: "Construction",
    description: "Stitching, seam finishing, interfacing, and construction techniques.",
    displayOrder: 60,
    fields: [
      {
        key: "seamFinish",
        label: "Seam Finish",
        type: "select",
        required: false,
        options: [
          "raw", "overlocked", "french_seam", "flat_felled", "bound", "hong_kong", "pinked",
        ],
      },
      {
        key: "stitchType",
        label: "Primary Stitch Type",
        type: "select",
        required: false,
        options: ["lockstitch", "chainstitch", "overlock", "coverstitch", "flatlock", "bartack"],
      },
      {
        key: "interfacing",
        label: "Interfacing",
        type: "select",
        required: false,
        options: ["none", "woven", "non_woven", "knit", "thermobond"],
      },
      {
        key: "bondingTechnique",
        label: "Special Bonding / Welding",
        type: "select",
        required: false,
        options: ["none", "ultrasonic_welding", "heat_bonding", "laser_cut_edge", "seamless_knit"],
      },
      {
        key: "constructionNotes",
        label: "Additional Construction Notes",
        type: "text",
        required: false,
        description: "Free text for pattern-maker and sample room.",
      },
    ],
  },

  {
    id: "fashion_prop_production_notes",
    displayName: "Production Notes",
    description: "Manufacturing instructions, MOQ, lead times, and quality standards.",
    displayOrder: 70,
    fields: [
      {
        key: "moq",
        label: "Minimum Order Quantity",
        type: "number",
        required: false,
        min: 1,
        unit: "units",
      },
      {
        key: "leadTimeWeeks",
        label: "Lead Time",
        type: "number",
        required: false,
        min: 1,
        max: 104,
        unit: "weeks",
      },
      {
        key: "targetCostUsd",
        label: "Target FOB Cost (USD)",
        type: "number",
        required: false,
        min: 0,
        unit: "USD",
      },
      {
        key: "sustainabilityFlag",
        label: "Sustainability Requirement",
        type: "select",
        required: false,
        options: [
          "none", "eco_fabrics", "recycled_materials", "organic_certified",
          "fair_trade", "zero_waste_pattern", "carbon_neutral", "fully_circular",
        ],
      },
      {
        key: "qualityStandard",
        label: "Quality Standard",
        type: "select",
        required: false,
        options: ["brand_internal", "ISO_9001", "OEKO_TEX", "GOTS", "Bluesign", "Fair_Trade_USA"],
      },
      {
        key: "productionNotes",
        label: "Additional Production Notes",
        type: "text",
        required: false,
        description: "Free text for the factory or sourcing team.",
      },
    ],
  },
];

/** Lookup property section by ID. */
export function getFashionPropertySection(
  id: string,
): PropertySectionContribution | undefined {
  return fashionPropertySections.find((s) => s.id === id);
}
