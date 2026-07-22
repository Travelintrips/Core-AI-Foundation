/**
 * exportPresets.ts — Fashion Design Plugin
 *
 * Export presets for fashion design deliverables.
 * Each preset specifies format, colour space, resolution, and bleed
 * for a named delivery scenario.
 */

import type { ExportPreset } from "../types/pluginContracts.js";

export const fashionExportPresets: ExportPreset[] = [
  {
    id: "fashion_export_screen_preview",
    displayName: "Screen Preview",
    description:
      "Low-resolution RGB preview for client approval and digital review. " +
      "Suitable for email, Slack, and web embedding.",
    format: "image",
    colorSpace: "sRGB",
    resolutionDpi: 72,
    includeBleed: false,
    recommendedForArtifactTypes: [
      "fashion_moodboard",
      "fashion_concept_sketch",
      "fashion_visualization",
      "fashion_campaign_asset",
    ],
  },
  {
    id: "fashion_export_print_spec",
    displayName: "Print Specification (A4 PDF)",
    description:
      "High-resolution CMYK PDF for printing spec sheets, look books, and production packages. " +
      "Includes 3 mm bleed and embedded fonts. PDF/X-1a compliant.",
    format: "pdf",
    colorSpace: "CMYK",
    resolutionDpi: 300,
    includeBleed: true,
    bleedMm: 3,
    recommendedForArtifactTypes: [
      "fashion_technical_drawing",
      "fashion_colorway",
      "fashion_material_board",
      "fashion_creative_direction",
      "fashion_production_spec",
    ],
  },
  {
    id: "fashion_export_social_media",
    displayName: "Social Media Pack",
    description:
      "Multi-format image ZIP for Instagram, Pinterest, and campaign use. " +
      "Includes square (1:1), portrait (4:5), and landscape (16:9) crops at 150 dpi sRGB.",
    format: "zip",
    colorSpace: "sRGB",
    resolutionDpi: 150,
    includeBleed: false,
    recommendedForArtifactTypes: [
      "fashion_visualization",
      "fashion_campaign_asset",
      "fashion_moodboard",
    ],
  },
  {
    id: "fashion_export_editorial_highres",
    displayName: "Editorial High-Resolution",
    description:
      "High-resolution sRGB image export for editorial, press, and lookbook use. " +
      "Minimum 3000 px on the long side at 300 dpi.",
    format: "image",
    colorSpace: "sRGB",
    resolutionDpi: 300,
    includeBleed: false,
    recommendedForArtifactTypes: [
      "fashion_visualization",
      "fashion_campaign_asset",
      "fashion_concept_sketch",
    ],
  },
  {
    id: "fashion_export_technical_svg",
    displayName: "Technical Drawing SVG",
    description:
      "Scalable vector SVG export of technical flat drawings for pattern-making, " +
      "PLM systems, and vendor communication.",
    format: "svg",
    colorSpace: "sRGB",
    resolutionDpi: 300,
    includeBleed: false,
    recommendedForArtifactTypes: [
      "fashion_technical_drawing",
      "fashion_concept_sketch",
    ],
  },
  {
    id: "fashion_export_production_package",
    displayName: "Production Package (ZIP)",
    description:
      "Complete delivery ZIP for the factory: technical drawings (SVG + PDF), " +
      "colourway sheet, BOM, and QA checklist. All files at 300 dpi CMYK.",
    format: "zip",
    colorSpace: "CMYK",
    resolutionDpi: 300,
    includeBleed: true,
    bleedMm: 3,
    recommendedForArtifactTypes: [
      "fashion_production_spec",
      "fashion_technical_drawing",
      "fashion_colorway",
      "fashion_material_board",
    ],
  },
  {
    id: "fashion_export_p3_digital",
    displayName: "Wide Gamut Digital (Display P3)",
    description:
      "Display P3 colour space export for high-end digital screens, OLED devices, " +
      "and HDR campaign assets.",
    format: "image",
    colorSpace: "P3",
    resolutionDpi: 150,
    includeBleed: false,
    recommendedForArtifactTypes: [
      "fashion_visualization",
      "fashion_campaign_asset",
    ],
  },
];

/** Lookup export preset by ID. */
export function getFashionExportPreset(id: string): ExportPreset | undefined {
  return fashionExportPresets.find((p) => p.id === id);
}

/** Return all preset IDs recommended for a given artifact type. */
export function getExportPresetsForArtifactType(artifactTypeId: string): ExportPreset[] {
  return fashionExportPresets.filter((p) =>
    p.recommendedForArtifactTypes.includes(artifactTypeId),
  );
}
