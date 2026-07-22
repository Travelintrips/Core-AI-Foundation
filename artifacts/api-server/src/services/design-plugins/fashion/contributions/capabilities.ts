/**
 * capabilities.ts — Fashion Design Plugin
 *
 * AI capability contributions for the fashion domain.
 *
 * Rules:
 *   - Describe prompt template BOUNDARIES only — no hard-coded model/provider.
 *   - The execution engine resolves the actual model at runtime via the capability registry.
 *   - jobType values must match worker cluster registrations; they are opaque strings here.
 *   - Never call an AI provider directly from this file.
 */

import type { CapabilityContribution } from "../types/pluginContracts.js";

export const fashionCapabilities: CapabilityContribution[] = [
  {
    id: "fashion.brief.validate",
    displayName: "Fashion Brief Validator",
    description:
      "Validates and enriches a submitted fashion brief. Checks for missing required " +
      "fields, infers missing context from domain knowledge, and returns a structured " +
      "brief ready for downstream workflow steps.",
    promptTemplateBoundary: {
      inputVariables: [
        "productCategory",
        "targetUser",
        "season",
        "styleDirection",
        "silhouette",
        "colorDirection",
        "materialPreference",
        "marketSegment",
        "additionalNotes",
      ],
      outputDescription:
        "Validated brief JSON with enrichedContext object containing inferred " +
        "design keywords, suggested references, and completeness score (0–100).",
      examplePrompt:
        "Given this fashion design brief for {productCategory} targeting {targetUser} " +
        "for {season}: validate completeness, flag any missing critical information, " +
        "and suggest up to 3 design direction keywords aligned with {styleDirection}.",
    },
    jobType: "fashion.brief.validate",
  },
  {
    id: "fashion.research.compile",
    displayName: "Fashion Research Compiler",
    description:
      "Compiles trend research, competitive references, and style precedents relevant " +
      "to the brief. Returns structured reference data for moodboard generation.",
    promptTemplateBoundary: {
      inputVariables: [
        "productCategory",
        "season",
        "styleDirection",
        "marketSegment",
        "colorDirection",
        "referenceAssetUrls",
      ],
      outputDescription:
        "Research package: trend keywords, reference image queries, " +
        "competitive landscape summary, and design vocabulary.",
    },
    jobType: "fashion.research.compile",
  },
  {
    id: "fashion.moodboard.generate",
    displayName: "Fashion Moodboard Generator",
    description:
      "Generates a curated moodboard layout specification from research output. " +
      "Returns a structured composition spec for the renderer — no images are " +
      "generated directly by this capability.",
    promptTemplateBoundary: {
      inputVariables: [
        "researchPackage",
        "colorDirection",
        "styleDirection",
        "targetUser",
        "season",
      ],
      outputDescription:
        "Moodboard composition spec: image slot assignments, colour palette, " +
        "typographic tone, and layout grid for the renderer.",
    },
    jobType: "fashion.moodboard.generate",
  },
  {
    id: "fashion.creative_direction.define",
    displayName: "Creative Direction Writer",
    description:
      "Synthesises brief and moodboard into a written creative direction document. " +
      "Establishes the style story, design principles, and visual language.",
    promptTemplateBoundary: {
      inputVariables: [
        "moodboardSummary",
        "briefSummary",
        "brandDna",
        "season",
        "marketSegment",
      ],
      outputDescription:
        "Creative direction document: style story (300–500 words), key design principles " +
        "(3–5 bullets), colour story, and visual language descriptors.",
    },
    jobType: "fashion.creative_direction.define",
  },
  {
    id: "fashion.concept_sketch.generate",
    displayName: "Fashion Concept Sketch Generator",
    description:
      "Generates a styled concept sketch prompt and composition spec for the " +
      "image renderer. Covers silhouette, key design details, and figure presentation.",
    promptTemplateBoundary: {
      inputVariables: [
        "silhouette",
        "styleDirection",
        "colorDirection",
        "creativeDirectionSummary",
        "garmentDetails",
        "targetUser",
      ],
      outputDescription:
        "Image generation prompt for a fashion croquis sketch showing the garment concept " +
        "with correct silhouette, key design features, and styling notes.",
    },
    jobType: "fashion.concept_sketch.generate",
  },
  {
    id: "fashion.technical_drawing.generate",
    displayName: "Technical Drawing Generator",
    description:
      "Generates front and back flat technical drawing specifications. " +
      "Outputs structured SVG construction data for the technical renderer.",
    promptTemplateBoundary: {
      inputVariables: [
        "garmentType",
        "silhouette",
        "constructionDetails",
        "componentSelections",
        "sizeRange",
      ],
      outputDescription:
        "Technical flat drawing spec: front view, back view, detail callouts, " +
        "construction notes, and seam/stitch placement annotations.",
    },
    jobType: "fashion.technical_drawing.generate",
  },
  {
    id: "fashion.colorway.define",
    displayName: "Colorway Definition Generator",
    description:
      "Derives specific colourways from the colour direction brief. " +
      "Returns Pantone/hex-referenced colour stories with placement guidance.",
    promptTemplateBoundary: {
      inputVariables: [
        "colorDirection",
        "fabricSelections",
        "marketSegment",
        "season",
        "mainColorCount",
      ],
      outputDescription:
        "Colorway definitions: array of colourway objects each containing name, " +
        "Pantone/hex codes, placement map, and mood description.",
    },
    jobType: "fashion.colorway.define",
  },
  {
    id: "fashion.material_assignment.compile",
    displayName: "Material Assignment Compiler",
    description:
      "Maps fabric preferences and production constraints to a concrete bill of " +
      "materials. Returns structured fabric specs for each garment component.",
    promptTemplateBoundary: {
      inputVariables: [
        "materialPreference",
        "productionConstraints",
        "sustainability",
        "colorwayDefinitions",
        "garmentComponents",
      ],
      outputDescription:
        "Bill of materials: per-component fabric specs with weight, composition, " +
        "care instructions, and sourcing notes.",
    },
    jobType: "fashion.material_assignment.compile",
  },
  {
    id: "fashion.visualization.render",
    displayName: "Fashion Visualization Renderer",
    description:
      "Generates a high-quality editorial visualization of the finalised design " +
      "concept. Returns an image generation prompt and render configuration.",
    promptTemplateBoundary: {
      inputVariables: [
        "technicalDrawingSummary",
        "colorwayDefinitions",
        "materialSummary",
        "targetUser",
        "marketSegment",
        "visualizationStyle",
      ],
      outputDescription:
        "Image generation prompt for a styled fashion visualization render " +
        "on a model/mannequin with contextual setting appropriate to the market segment.",
    },
    jobType: "fashion.visualization.render",
  },
  {
    id: "fashion.visualization.render_simplified",
    displayName: "Fashion Visualization Renderer (Simplified Fallback)",
    description:
      "Simplified fallback renderer for visualization. Produces a clean " +
      "flat-lay or ghost mannequin render when the full editorial render fails.",
    promptTemplateBoundary: {
      inputVariables: ["technicalDrawingSummary", "colorwayDefinitions", "materialSummary"],
      outputDescription:
        "Simplified image generation prompt for a flat-lay or ghost-mannequin product render.",
    },
    jobType: "fashion.visualization.render_simplified",
  },
  {
    id: "fashion.review.qa",
    displayName: "Fashion Design QA Reviewer",
    description:
      "Runs automated quality checks across all produced design artifacts. " +
      "Validates consistency between brief, colorway, materials, and visualization.",
    promptTemplateBoundary: {
      inputVariables: [
        "briefSummary",
        "artifactSummaries",
        "colorwayConsistency",
        "brandAlignment",
      ],
      outputDescription:
        "QA report: overall score (0–100), per-artifact pass/fail, consistency issues, " +
        "and recommended remediation actions.",
    },
    jobType: "fashion.review.qa",
  },
  {
    id: "fashion.export.package",
    displayName: "Fashion Export Packager",
    description:
      "Compiles all approved design artifacts into delivery packages " +
      "(production spec PDF, design ZIP, campaign assets).",
    promptTemplateBoundary: {
      inputVariables: [
        "approvedArtifactIds",
        "exportPresetId",
        "projectNumber",
        "clientDeliverables",
      ],
      outputDescription:
        "Export manifest: list of output files, their formats, storage paths, " +
        "and a customer-safe delivery ZIP.",
    },
    jobType: "fashion.export.package",
  },
];

/** Lookup capability by ID. Returns undefined for unsupported capability IDs. */
export function getFashionCapability(id: string): CapabilityContribution | undefined {
  return fashionCapabilities.find((c) => c.id === id);
}

/** Returns true only for capability IDs this plugin supports. */
export function isFashionCapabilitySupported(id: string): boolean {
  return fashionCapabilities.some((c) => c.id === id);
}
