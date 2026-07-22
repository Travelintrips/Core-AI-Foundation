/**
 * fashionArtifactTypes.ts — Fashion Design Plugin
 *
 * Registry of the 9 fashion design artifact types.
 * All IDs are stable, kebab-style, prefixed with "fashion_" to prevent
 * collision with core or other domain plugins.
 *
 * Rule: These types are registered by the fashion plugin only.
 *       The core canvas/renderer must not be forced to understand fashion semantics;
 *       it treats these as opaque artifact type IDs with renderer hints attached.
 */

import type { ArtifactTypeDefinition } from "../types/pluginContracts.js";

export const FASHION_ARTIFACT_TYPE_IDS = [
  "fashion_moodboard",
  "fashion_creative_direction",
  "fashion_concept_sketch",
  "fashion_technical_drawing",
  "fashion_colorway",
  "fashion_material_board",
  "fashion_visualization",
  "fashion_campaign_asset",
  "fashion_production_spec",
] as const;

export type FashionArtifactTypeId = (typeof FASHION_ARTIFACT_TYPE_IDS)[number];

export const fashionArtifactTypes: ArtifactTypeDefinition[] = [
  {
    id: "fashion_moodboard",
    displayName: "Fashion Moodboard",
    description:
      "A curated visual collage of inspiration images, textures, colour swatches, " +
      "and reference photography that establishes the overall aesthetic direction.",
    outputFormats: ["image", "pdf"],
    defaultAspectRatio: "16:9",
    workflowOrder: 3,
    rendererHints: {
      canvasLayout: "collage",
      bleed: false,
      maxImages: 16,
      captionStyle: "minimal",
    },
  },
  {
    id: "fashion_creative_direction",
    displayName: "Creative Direction Document",
    description:
      "A structured document defining the creative vision: style story, target mood, " +
      "key design principles, and visual language for the collection.",
    outputFormats: ["pdf", "json"],
    defaultAspectRatio: "A4",
    workflowOrder: 4,
    requiresPriorArtifactId: "fashion_moodboard",
    rendererHints: {
      canvasLayout: "editorial",
      bleed: false,
      fontStyle: "editorial",
    },
  },
  {
    id: "fashion_concept_sketch",
    displayName: "Concept Sketch",
    description:
      "Hand-drawn-style illustrative sketch of the garment concept showing " +
      "overall silhouette, proportion, and key design details on a croquis figure.",
    outputFormats: ["image", "svg"],
    defaultAspectRatio: "4:5",
    workflowOrder: 5,
    requiresPriorArtifactId: "fashion_creative_direction",
    rendererHints: {
      sketchStyle: "fashion_croquis",
      backgroundStyle: "clean_white",
      showCroquis: true,
    },
  },
  {
    id: "fashion_technical_drawing",
    displayName: "Technical Drawing (Flat Sketch)",
    description:
      "A precise, to-scale flat technical drawing (cad/flat) of the garment " +
      "showing front and back views with construction lines, seam placement, " +
      "and garment detail callouts.",
    outputFormats: ["svg", "pdf"],
    defaultAspectRatio: "A4",
    workflowOrder: 6,
    requiresPriorArtifactId: "fashion_concept_sketch",
    rendererHints: {
      drawingStyle: "technical_flat",
      showFrontBack: true,
      showCallouts: true,
      strokeWeight: "fine",
      backgroundColor: "white",
    },
  },
  {
    id: "fashion_colorway",
    displayName: "Colorway Sheet",
    description:
      "A colour specification sheet showing all colourways for the design, " +
      "including Pantone/hex references, placement, and fabric swatch previews.",
    outputFormats: ["pdf", "image"],
    defaultAspectRatio: "A4",
    workflowOrder: 7,
    requiresPriorArtifactId: "fashion_technical_drawing",
    rendererHints: {
      showSwatchGrid: true,
      showPantoneRef: true,
      swatchSize: "medium",
    },
  },
  {
    id: "fashion_material_board",
    displayName: "Material & Fabric Board",
    description:
      "A fabric and material specification board showing selected textiles, " +
      "trims, hardware, and their properties (weight, composition, care).",
    outputFormats: ["pdf", "image"],
    defaultAspectRatio: "A4",
    workflowOrder: 8,
    requiresPriorArtifactId: "fashion_colorway",
    rendererHints: {
      showFabricProperties: true,
      showCareIcons: true,
      swatchLayout: "grid",
    },
  },
  {
    id: "fashion_visualization",
    displayName: "Fashion Visualization",
    description:
      "A high-quality styled visualization render showing the final garment " +
      "concept on a model or mannequin in a contextual setting.",
    outputFormats: ["image"],
    defaultAspectRatio: "4:5",
    workflowOrder: 9,
    requiresPriorArtifactId: "fashion_material_board",
    rendererHints: {
      renderStyle: "editorial_photo",
      backgroundType: "studio_or_contextual",
      aspectRatio: "4:5",
      minResolutionPx: 1024,
    },
  },
  {
    id: "fashion_campaign_asset",
    displayName: "Campaign Asset",
    description:
      "Marketing and campaign-ready imagery derived from the visualization, " +
      "formatted for social media, lookbook, and press release use.",
    outputFormats: ["image", "zip"],
    defaultAspectRatio: "1:1",
    workflowOrder: 10,
    requiresPriorArtifactId: "fashion_visualization",
    rendererHints: {
      exportFormats: ["square_1x1", "portrait_4x5", "landscape_16x9"],
      includeTextOverlay: false,
      includeZip: true,
    },
  },
  {
    id: "fashion_production_spec",
    displayName: "Production Specification",
    description:
      "The complete production-ready specification package: technical drawing, " +
      "BOM (bill of materials), grading instructions, and QA standards.",
    outputFormats: ["pdf", "zip"],
    defaultAspectRatio: "A4",
    workflowOrder: 11,
    requiresPriorArtifactId: "fashion_technical_drawing",
    rendererHints: {
      includeGradingChart: true,
      includeBOM: true,
      includeQAChecklist: true,
      pdfProfile: "PDF_X-1a",
    },
  },
];

/** Convenience lookup: artifact type ID → definition. */
export const fashionArtifactTypeMap = new Map<string, ArtifactTypeDefinition>(
  fashionArtifactTypes.map((t) => [t.id, t]),
);
