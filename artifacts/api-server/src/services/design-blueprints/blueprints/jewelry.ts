/**
 * Jewelry Design Domain Plugin — Team 30
 *
 * Covers concept → production specification metadata.
 * Does NOT claim gemological certification, validated CAD measurements,
 * or engineering-grade pricing. All dimensions and weights are ESTIMATED.
 *
 * Workflow stages:
 *   1.  Brief                    → z-brief
 *   2.  Reference Research       → z-moodboard
 *   3.  Style Direction          → z-moodboard
 *   4.  Concept Sketch           → z-concept-sketch
 *   5.  Form Development         → z-form-study
 *   6.  Material / Gem Direction → z-material-gem
 *   7.  Technical View           → z-technical-view
 *   8.  Visualization            → z-visualization
 *   9.  Production Specification → z-production-spec
 *   10. Review                   → (cross-zone review pass)
 *   11. Export                   → outputCapabilities
 *
 * Artifact types: jewelry_moodboard | jewelry_concept_sketch |
 *   jewelry_form_study | jewelry_material_gem_board |
 *   jewelry_technical_view | jewelry_visualization |
 *   jewelry_production_spec | jewelry_presentation
 *
 * Component contributions: band | setting | clasp | chain |
 *   pendant | stone-seat | decorative-element
 *
 * Material metadata (all values ESTIMATED unless explicitly noted):
 *   metalType · purityLabel · finish · stoneCategory ·
 *   settingType · estimatedDimensions · estimatedWeight
 */

import type { Blueprint } from "../types.js";

export const jewelryBlueprint: Blueprint = {
  id: "bp-jewelry-v1",
  slug: "jewelry-design-standard",
  schemaVersion: "1.0",
  domain: "jewelry",
  name: "Jewelry Design Standard",
  description:
    "Universal blueprint for jewelry design documentation: from initial brief through concept, material direction, technical views, and production specifications. All dimensions and weights are estimates and must not be used as engineering-grade or independently-validated values.",
  version: "1.0.0",
  status: "active",

  // A4 portrait — consistent with fashion / packaging blueprints
  dimensions: { width: 2480, height: 3508, unit: "px", dpi: 300, aspectRatio: "A4" },

  // ── Zones ─────────────────────────────────────────────────────────────────
  zones: [
    {
      id: "z-brief",
      name: "Brief & Requirements",
      description: "Client brief: jewelry type, target wearer, occasion, style, budget, production method, personalization, and safety constraints",
      x: 0, y: 0, width: 2480, height: 600,
      required: true,
      slotRefs: ["s-brief-text", "s-brief-specs"],
      zIndex: 1,
    },
    {
      id: "z-moodboard",
      name: "Moodboard & Style Direction",
      description: "Reference research: inspiration images, style direction notes, mood keywords",
      x: 0, y: 620, width: 1200, height: 900,
      required: true,
      slotRefs: ["s-reference-image", "s-style-note"],
      zIndex: 2,
    },
    {
      id: "z-concept-sketch",
      name: "Concept Sketch",
      description: "Initial concept sketches: hand-drawn or digital rough explorations",
      x: 1280, y: 620, width: 1200, height: 900,
      required: true,
      slotRefs: ["s-concept-sketch"],
      zIndex: 2,
    },
    {
      id: "z-form-study",
      name: "Form Development",
      description: "Refined form studies: front, side, top, and 3/4 views of the jewelry piece",
      x: 0, y: 1540, width: 1200, height: 700,
      required: true,
      slotRefs: ["s-form-view-front", "s-form-view-side", "s-form-view-top"],
      zIndex: 3,
    },
    {
      id: "z-material-gem",
      name: "Material & Gem Direction",
      description: "Metal swatches, gem/stone reference images, and estimated material specifications. Purity labels are advisory only.",
      x: 1280, y: 1540, width: 1200, height: 700,
      required: true,
      slotRefs: ["s-metal-swatch", "s-gem-image", "s-material-spec"],
      zIndex: 3,
    },
    {
      id: "z-technical-view",
      name: "Technical View",
      description: "Technical line drawings with estimated dimension annotations and component breakdown (band, setting, clasp, chain, pendant, stone seat, decorative elements)",
      x: 0, y: 2260, width: 1200, height: 800,
      required: true,
      slotRefs: ["s-technical-drawing", "s-dimension-annotation", "s-component-list"],
      zIndex: 4,
    },
    {
      id: "z-visualization",
      name: "Visualization",
      description: "Rendered or illustrated visualization of the final jewelry design concept",
      x: 1280, y: 2260, width: 1200, height: 800,
      required: false,
      slotRefs: ["s-rendered-view", "s-visualization-note"],
      zIndex: 4,
    },
    {
      id: "z-production-spec",
      name: "Production Specification",
      description: "Estimated production parameters: component weights, material quantities, setting details, and production method notes",
      x: 0, y: 3080, width: 2480, height: 428,
      required: true,
      slotRefs: ["s-production-table", "s-weight-spec", "s-setting-detail"],
      zIndex: 5,
    },
  ],

  // ── Slots ─────────────────────────────────────────────────────────────────
  slots: [
    // Brief zone
    {
      id: "s-brief-text",
      name: "Brief Description",
      description: "Narrative brief covering jewelry type, target wearer, occasion, style preferences, and any safety or sustainability constraints",
      type: "text",
      required: true,
      maxItems: 1,
      constraints: { maxChars: 800, minFontSize: 9, maxFontSize: 14 },
    },
    {
      id: "s-brief-specs",
      name: "Brief Specifications Table",
      description: "Structured brief data: dimensions, budget range, production method, personalization, metal preference, stone preference, finish",
      type: "data_table",
      required: false,
      maxItems: 1,
      constraints: { maxRows: 15, maxColumns: 3 },
    },

    // Moodboard zone
    {
      id: "s-reference-image",
      name: "Reference & Inspiration Image",
      description: "Inspiration imagery for moodboard and reference research stages",
      type: "image",
      required: true,
      maxItems: 12,
      constraints: { allowedFormats: ["jpg", "png", "webp"], maxFileSizeMb: 10 },
    },
    {
      id: "s-style-note",
      name: "Style Direction Note",
      description: "Style direction keywords and mood description",
      type: "text",
      required: false,
      maxItems: 3,
      constraints: { maxChars: 300, minFontSize: 8, maxFontSize: 12 },
    },

    // Concept sketch zone
    {
      id: "s-concept-sketch",
      name: "Concept Sketch",
      description: "Hand-drawn or digital concept sketch files",
      type: "image",
      required: true,
      maxItems: 6,
      constraints: { allowedFormats: ["png", "jpg", "svg", "ai", "webp"], maxFileSizeMb: 20 },
    },

    // Form study zone
    {
      id: "s-form-view-front",
      name: "Front View",
      description: "Front-facing form development drawing",
      type: "image",
      required: true,
      maxItems: 2,
      constraints: { allowedFormats: ["png", "svg", "jpg", "ai"], maxFileSizeMb: 20 },
    },
    {
      id: "s-form-view-side",
      name: "Side View",
      description: "Side profile form development drawing",
      type: "image",
      required: false,
      maxItems: 2,
      constraints: { allowedFormats: ["png", "svg", "jpg", "ai"], maxFileSizeMb: 20 },
    },
    {
      id: "s-form-view-top",
      name: "Top View",
      description: "Top-down form development drawing",
      type: "image",
      required: false,
      maxItems: 2,
      constraints: { allowedFormats: ["png", "svg", "jpg", "ai"], maxFileSizeMb: 20 },
    },

    // Material & gem zone
    {
      id: "s-metal-swatch",
      name: "Metal Color Swatch",
      description: "Color reference for metal type and finish (yellow gold, white gold, rose gold, platinum, silver, etc.)",
      type: "color_swatch",
      required: true,
      maxItems: 6,
      constraints: { maxWidth: 150, maxHeight: 150 },
    },
    {
      id: "s-gem-image",
      name: "Gem / Stone Reference",
      description: "Reference images for stones or gems. Does not constitute gemological certification.",
      type: "image",
      required: false,
      maxItems: 8,
      constraints: { allowedFormats: ["jpg", "png", "webp"], maxFileSizeMb: 8 },
    },
    {
      id: "s-material-spec",
      name: "Material Specification (Estimated)",
      description: "Estimated material metadata: metal type, purity label, finish, stone category, setting type. All values are ESTIMATED — not gemologically certified.",
      type: "text",
      required: true,
      maxItems: 4,
      constraints: { maxChars: 400, minFontSize: 8, maxFontSize: 11 },
    },

    // Technical view zone
    {
      id: "s-technical-drawing",
      name: "Technical Drawing",
      description: "Orthographic technical line drawings: front, side, top, or cross-section",
      type: "image",
      required: true,
      maxItems: 4,
      constraints: { allowedFormats: ["svg", "png", "ai", "dxf"], maxFileSizeMb: 20 },
    },
    {
      id: "s-dimension-annotation",
      name: "Estimated Dimension Annotation",
      description: "Estimated dimensions in mm annotated on technical drawings. All values are ESTIMATED.",
      type: "annotation",
      required: false,
      maxItems: 30,
      constraints: { maxChars: 20, unit: "mm" },
    },
    {
      id: "s-component-list",
      name: "Component Breakdown",
      description: "Component breakdown: band, setting, clasp, chain, pendant, stone seat, decorative element",
      type: "text",
      required: true,
      maxItems: 1,
      constraints: { maxChars: 600, minFontSize: 8, maxFontSize: 11 },
    },

    // Visualization zone
    {
      id: "s-rendered-view",
      name: "Rendered / Illustrated Visualization",
      description: "Rendered or hand-illustrated visualization of the jewelry design concept",
      type: "image",
      required: false,
      maxItems: 4,
      constraints: { allowedFormats: ["png", "jpg", "webp"], maxFileSizeMb: 25 },
    },
    {
      id: "s-visualization-note",
      name: "Visualization Note",
      description: "Context note for the visualization (rendering technique, lighting, scale reference)",
      type: "text",
      required: false,
      maxItems: 2,
      constraints: { maxChars: 250, minFontSize: 8, maxFontSize: 11 },
    },

    // Production spec zone
    {
      id: "s-production-table",
      name: "Production Specification Table",
      description: "Estimated production parameters: metal type, purity label, finish, estimated gram weight, stone category, setting type, estimated piece count",
      type: "data_table",
      required: true,
      maxItems: 1,
      constraints: { maxRows: 20, maxColumns: 4 },
    },
    {
      id: "s-weight-spec",
      name: "Estimated Weight & Material Notes",
      description: "Estimated metal weight and material summary. All weights are ESTIMATED — not validated by CAD/engineering.",
      type: "text",
      required: true,
      maxItems: 2,
      constraints: { maxChars: 400, minFontSize: 8, maxFontSize: 11 },
    },
    {
      id: "s-setting-detail",
      name: "Setting & Component Detail",
      description: "Close-up detail images of setting, clasp, or other critical components",
      type: "image",
      required: false,
      maxItems: 6,
      constraints: { allowedFormats: ["png", "jpg", "webp", "svg"], maxFileSizeMb: 10 },
    },
  ],

  // ── Constraints ───────────────────────────────────────────────────────────
  constraints: {
    maxZones: 12,
    maxSlots: 30,
    allowZoneOverlap: false,
    requiredZoneIds: [
      "z-brief",
      "z-moodboard",
      "z-concept-sketch",
      "z-form-study",
      "z-material-gem",
      "z-technical-view",
      "z-production-spec",
    ],
    domainSpecific: {
      // Team 30: Jewelry Design Domain Plugin metadata
      pluginTeam: "team-30",

      // All 8 artifact types defined in the plugin spec
      artifactTypes: [
        "jewelry_moodboard",
        "jewelry_concept_sketch",
        "jewelry_form_study",
        "jewelry_material_gem_board",
        "jewelry_technical_view",
        "jewelry_visualization",
        "jewelry_production_spec",
        "jewelry_presentation",
      ],

      // All 11 workflow stages
      workflowStages: [
        "brief",
        "reference_research",
        "style_direction",
        "concept_sketch",
        "form_development",
        "material_gem_direction",
        "technical_view",
        "visualization",
        "production_specification",
        "review",
        "export",
      ],

      // Component contributions within the plugin
      componentContributions: [
        "band",
        "setting",
        "clasp",
        "chain",
        "pendant",
        "stone-seat",
        "decorative-element",
      ],

      // Material metadata fields — all values are ESTIMATED
      materialFields: [
        "metalType",
        "purityLabel",
        "finish",
        "stoneCategory",
        "settingType",
        "estimatedDimensions",
        "estimatedWeight",
      ],

      // Estimation and certification rules
      allDimensionsEstimated: true,
      allWeightsEstimated: true,
      // MUST remain true — plugin must never claim gem certification or validated metal purity
      noCertificationClaims: true,
      estimationDisclaimer:
        "All dimensions, weights, purity labels, and material values shown in this blueprint are ESTIMATED for design direction purposes only. They are not validated by CAD, engineering analysis, or gemological certification. Do not use these values for manufacturing, commercial grading, or legal compliance.",

      // Default measurement unit for annotations
      defaultUnit: "mm",
    },
  },

  // ── Supported Components ──────────────────────────────────────────────────
  supportedComponents: [
    { type: "image-picker", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["image"] },
    { type: "color-picker", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["color_swatch"] },
    { type: "annotation-tool", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["annotation", "measurement"] },
    { type: "rich-text-editor", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["text"] },
    { type: "data-table-editor", versionRange: ">=1.0.0", required: false, fillsSlotTypes: ["data_table"] },
  ],

  // ── Required Data (Brief Fields) ──────────────────────────────────────────
  requiredData: [
    {
      key: "jewelryType",
      label: "Jewelry Type",
      type: "enum",
      required: true,
      description: "Primary type of jewelry piece",
      allowedValues: ["ring", "necklace", "bracelet", "earring", "brooch", "anklet", "pendant", "watch-band", "other"],
    },
    {
      key: "targetWearer",
      label: "Target Wearer",
      type: "string",
      required: true,
      description: "Description of intended wearer (age group, gender expression, lifestyle)",
      maxLength: 200,
    },
    {
      key: "occasion",
      label: "Occasion",
      type: "enum",
      required: true,
      allowedValues: ["everyday", "formal", "wedding", "anniversary", "gift", "ceremonial", "fashion", "sports", "other"],
    },
    {
      key: "style",
      label: "Style",
      type: "enum",
      required: true,
      allowedValues: ["classic", "modern", "minimalist", "ornate", "vintage", "bohemian", "geometric", "nature-inspired", "religious", "mixed", "other"],
    },
    {
      key: "estimatedWidthMm",
      label: "Estimated Width (mm)",
      type: "number",
      required: false,
      description: "Estimated width of the piece in millimetres — advisory only",
      min: 1,
      max: 500,
    },
    {
      key: "estimatedHeightMm",
      label: "Estimated Height (mm)",
      type: "number",
      required: false,
      description: "Estimated height of the piece in millimetres — advisory only",
      min: 1,
      max: 500,
    },
    {
      key: "metalPreference",
      label: "Metal Preference",
      type: "enum",
      required: true,
      allowedValues: [
        "yellow-gold", "white-gold", "rose-gold",
        "platinum", "silver", "palladium",
        "titanium", "stainless-steel", "mixed-metals", "other",
      ],
    },
    {
      key: "stonePreference",
      label: "Stone / Gem Preference",
      type: "string",
      required: false,
      description: "Optional stone or gem description (e.g. 'sapphire accent stones'). Does not constitute a purchase or certification specification.",
      maxLength: 300,
    },
    {
      key: "finish",
      label: "Finish",
      type: "enum",
      required: true,
      allowedValues: ["polished", "matte", "brushed", "hammered", "sandblasted", "oxidized", "satin", "mixed"],
    },
    {
      key: "budgetRange",
      label: "Budget Range",
      type: "string",
      required: false,
      description: "Indicative budget range for design direction (e.g. 'USD 500–1000'). Not a binding cost estimate.",
      maxLength: 100,
    },
    {
      key: "productionMethod",
      label: "Production Method",
      type: "enum",
      required: false,
      allowedValues: ["handcrafted", "cast", "die-struck", "laser-cut", "3d-printed", "electroformed", "mixed", "other"],
    },
    {
      key: "personalization",
      label: "Personalization",
      type: "string",
      required: false,
      description: "Engraving, initials, custom motif, or other personalization notes",
      maxLength: 300,
    },
    {
      key: "sustainabilityPreference",
      label: "Sustainability Preference",
      type: "boolean",
      required: false,
      description: "Whether sustainable/recycled materials are preferred",
      defaultValue: false,
    },
    {
      key: "safetyConstraints",
      label: "Safety Constraints",
      type: "string",
      required: false,
      description: "Allergy notes, children-safe requirements, or other safety constraints",
      maxLength: 300,
    },
  ],

  // ── Output Capabilities ───────────────────────────────────────────────────
  outputCapabilities: [
    { format: "pdf", maxDpi: 300, multiPage: true, colorSpace: "cmyk", bleedMm: 3 },
    { format: "png", maxDpi: 300, colorSpace: "rgb" },
    { format: "jpg", maxDpi: 300, colorSpace: "rgb" },
    { format: "svg", colorSpace: "rgb" },
  ],

  industryTags: [
    "jewelry", "fine-jewelry", "fashion-jewelry", "luxury",
    "accessories", "bridal", "haute-joaillerie",
  ],
  styleTags: [
    "classic", "modern", "minimalist", "ornate", "vintage",
    "geometric", "nature-inspired", "sustainable",
  ],

  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};
