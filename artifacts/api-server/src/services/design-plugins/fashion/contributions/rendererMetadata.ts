/**
 * rendererMetadata.ts — Fashion Design Plugin
 *
 * Renderer metadata contributions: hints that tell the rendering engine
 * how to handle each fashion artifact type without the engine needing to
 * understand fashion domain semantics directly.
 */

import type { RendererMetadataContribution } from "../types/pluginContracts.js";
import { FASHION_ARTIFACT_TYPE_IDS } from "../artifacts/fashionArtifactTypes.js";

export const fashionRendererMetadata: RendererMetadataContribution[] = [
  {
    id: "fashion_render_meta_editorial",
    artifactTypeIds: [
      "fashion_moodboard",
      "fashion_visualization",
      "fashion_campaign_asset",
    ],
    hints: {
      renderPipeline: "image_generation",
      outputColorSpace: "sRGB",
      resolutionDpi: 150,
      bleed: false,
      cropSafe: true,
      minWidthPx: 1024,
      minHeightPx: 1024,
      maxWidthPx: 4096,
      maxHeightPx: 4096,
      supportsWatermark: true,
      supportsTextOverlay: false,
      preferredAspectRatios: ["1:1", "4:5", "16:9"],
    },
  },
  {
    id: "fashion_render_meta_technical",
    artifactTypeIds: [
      "fashion_concept_sketch",
      "fashion_technical_drawing",
    ],
    hints: {
      renderPipeline: "svg_vector",
      outputColorSpace: "sRGB",
      resolutionDpi: 300,
      bleed: false,
      showConstructionLines: true,
      strokeWeightPt: 0.5,
      backgroundColor: "#FFFFFF",
      fontFamily: "monospace",
      calloutStyle: "arrow_leader",
      exportSvgInline: true,
    },
  },
  {
    id: "fashion_render_meta_spec_document",
    artifactTypeIds: [
      "fashion_colorway",
      "fashion_material_board",
      "fashion_creative_direction",
      "fashion_production_spec",
    ],
    hints: {
      renderPipeline: "pdf_document",
      outputColorSpace: "CMYK",
      resolutionDpi: 300,
      bleed: true,
      bleedMm: 3,
      paperSize: "A4",
      orientation: "portrait",
      marginsMm: { top: 15, right: 15, bottom: 15, left: 15 },
      pdfStandard: "PDF_X-1a",
      embedFonts: true,
      includeSlug: false,
    },
  },
];

/** Returns all artifact type IDs that have renderer metadata registered. */
export function getArtifactTypeIdsWithRendererMetadata(): string[] {
  const ids = new Set<string>();
  for (const meta of fashionRendererMetadata) {
    for (const id of meta.artifactTypeIds) ids.add(id);
  }
  return Array.from(ids);
}

/** Lookup renderer metadata by artifact type ID. Returns all matching blocks. */
export function getRendererMetadataForArtifactType(
  artifactTypeId: string,
): RendererMetadataContribution[] {
  return fashionRendererMetadata.filter((m) => m.artifactTypeIds.includes(artifactTypeId));
}

/** Verify all fashion artifact types have renderer metadata. Used in tests. */
export function validateRendererMetadataCoverage(): {
  covered: string[];
  missing: string[];
} {
  const covered = getArtifactTypeIdsWithRendererMetadata();
  const coveredSet = new Set(covered);
  const missing = FASHION_ARTIFACT_TYPE_IDS.filter((id) => !coveredSet.has(id));
  return { covered, missing };
}
