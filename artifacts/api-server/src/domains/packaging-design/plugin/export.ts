/**
 * packaging-design/plugin/export.ts — Team 26
 *
 * Export preset registry for the Packaging Design Domain Plugin.
 *
 * Each preset declares what files are produced, their format requirements,
 * naming conventions, and compression rules. The renderer boundary reads
 * these presets to assemble the final delivery package.
 *
 * PURE module — no DB calls, no side effects.
 */

import type { PackagingArtifactTypeId } from "./artifacts.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export const EXPORT_PRESET_IDS = [
  "print_ready",          // Full production package for print vendor
  "client_preview",       // Client-facing low-res previews + compliance sheet
  "dieline_source",       // Dieline + overlay layers only (for CAD handoff)
  "digital_only",         // Screen-optimised assets (no bleed, RGB ok)
  "sustainability_pack",  // Material spec + compliance + eco certifications
  "full_package",         // Everything: all deliverables + source files
] as const;

export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export interface ExportFileSpec {
  /** Which artifact type this file comes from. */
  artifactTypeId:  PackagingArtifactTypeId;
  /** File format (e.g. pdf, png, ai, svg). */
  format:          string;
  /** Whether this file is required for the preset to be considered complete. */
  required:        boolean;
  /** Naming convention token — renderer substitutes {brand}, {product}, {date}. */
  fileNamePattern: string;
  /** Max output resolution in DPI (null = native). */
  maxResolutionDpi: number | null;
  /** Whether to include bleed in the exported file. */
  includeBleed:    boolean;
  /** Color space for the exported file. */
  colorSpace:      "cmyk" | "rgb" | "pantone" | "native";
  notes?:          string;
}

export interface ExportPreset {
  id:           ExportPresetId;
  label:        string;
  description:  string;
  /** Archive format for the final delivery bundle. */
  archiveFormat: "zip" | "folder" | "pdf_package";
  files:        ExportFileSpec[];
  /** Whether a cover sheet / delivery note PDF is generated. */
  includeCoverSheet: boolean;
  /** Whether the export bundle is password-protected. */
  passwordProtect: boolean;
}

// ── Presets ───────────────────────────────────────────────────────────────────

const PRESETS: ExportPreset[] = [
  {
    id:            "print_ready",
    label:         "Print-Ready Package",
    description:
      "Complete production-ready bundle for the print vendor: CMYK artwork with bleed, " +
      "dieline PDF, material spec, production spec, and compliance sheet.",
    archiveFormat: "zip",
    includeCoverSheet: true,
    passwordProtect: false,
    files: [
      {
        artifactTypeId:  "packaging_artwork",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_artwork_print-ready_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    true,
        colorSpace:      "cmyk",
        notes:           "Must include all declared panels with bleed and colour profiles embedded.",
      },
      {
        artifactTypeId:  "packaging_dieline",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_dieline_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    true,
        colorSpace:      "native",
        notes:           "Dieline with overlay zones shown on separate layers.",
      },
      {
        artifactTypeId:  "packaging_material_spec",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_material-spec_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_production_spec",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_production-spec_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_compliance_sheet",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_compliance-sheet_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
    ],
  },
  {
    id:            "client_preview",
    label:         "Client Preview Package",
    description:
      "Low-resolution previews and mockups suitable for client sign-off. " +
      "Does NOT include production-ready artwork or source files.",
    archiveFormat: "zip",
    includeCoverSheet: true,
    passwordProtect: false,
    files: [
      {
        artifactTypeId:  "packaging_mockup",
        format:          "png",
        required:        true,
        fileNamePattern: "{brand}_{product}_mockup_{date}.png",
        maxResolutionDpi: 150,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_artwork",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_artwork_preview_{date}.pdf",
        maxResolutionDpi: 150,
        includeBleed:    false,
        colorSpace:      "rgb",
        notes:           "Screen PDF — low-res, RGB, no bleed.",
      },
      {
        artifactTypeId:  "packaging_compliance_sheet",
        format:          "pdf",
        required:        false,
        fileNamePattern: "{brand}_{product}_compliance-sheet_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
    ],
  },
  {
    id:            "dieline_source",
    label:         "Dieline Source (CAD Handoff)",
    description:
      "Dieline template with all overlay zone layers exported for handoff to a CAD or " +
      "structural engineer. Includes overlay metadata JSON.",
    archiveFormat: "zip",
    includeCoverSheet: false,
    passwordProtect: false,
    files: [
      {
        artifactTypeId:  "packaging_dieline",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_dieline_layers_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    true,
        colorSpace:      "native",
        notes:           "All overlay zones on separate visible layers.",
      },
      {
        artifactTypeId:  "packaging_dieline",
        format:          "svg",
        required:        false,
        fileNamePattern: "{brand}_{product}_dieline_{date}.svg",
        maxResolutionDpi: null,
        includeBleed:    true,
        colorSpace:      "native",
      },
      {
        artifactTypeId:  "packaging_structure_concept",
        format:          "json",
        required:        true,
        fileNamePattern: "{brand}_{product}_structure-metadata_{date}.json",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "native",
        notes:           "Overlay zone metadata JSON for renderer consumption.",
      },
    ],
  },
  {
    id:            "digital_only",
    label:         "Digital / E-Commerce Package",
    description:
      "Screen-optimised assets for digital use (e-commerce, social media, presentation). " +
      "RGB colour space, no bleed, maximum 150 dpi.",
    archiveFormat: "zip",
    includeCoverSheet: false,
    passwordProtect: false,
    files: [
      {
        artifactTypeId:  "packaging_mockup",
        format:          "png",
        required:        true,
        fileNamePattern: "{brand}_{product}_mockup_digital_{date}.png",
        maxResolutionDpi: 150,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_artwork",
        format:          "png",
        required:        false,
        fileNamePattern: "{brand}_{product}_artwork_flat_{date}.png",
        maxResolutionDpi: 150,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
    ],
  },
  {
    id:            "sustainability_pack",
    label:         "Sustainability Documentation Package",
    description:
      "Material specification, sustainability certifications, and compliance sheet " +
      "bundled for ESG reporting or certification submission.",
    archiveFormat: "pdf_package",
    includeCoverSheet: true,
    passwordProtect: false,
    files: [
      {
        artifactTypeId:  "packaging_material_spec",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_material-spec_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_compliance_sheet",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_compliance-sheet_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
    ],
  },
  {
    id:            "full_package",
    label:         "Full Delivery Package",
    description:
      "All deliverable artifacts in a single archive: print-ready artwork, dieline, " +
      "material spec, mockups, compliance sheet, and production spec.",
    archiveFormat: "zip",
    includeCoverSheet: true,
    passwordProtect: true,
    files: [
      {
        artifactTypeId:  "packaging_artwork",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_artwork_print-ready_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    true,
        colorSpace:      "cmyk",
      },
      {
        artifactTypeId:  "packaging_dieline",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_dieline_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    true,
        colorSpace:      "native",
      },
      {
        artifactTypeId:  "packaging_material_spec",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_material-spec_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_mockup",
        format:          "png",
        required:        true,
        fileNamePattern: "{brand}_{product}_mockup_{date}.png",
        maxResolutionDpi: 300,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_compliance_sheet",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_compliance-sheet_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
      {
        artifactTypeId:  "packaging_production_spec",
        format:          "pdf",
        required:        true,
        fileNamePattern: "{brand}_{product}_production-spec_{date}.pdf",
        maxResolutionDpi: null,
        includeBleed:    false,
        colorSpace:      "rgb",
      },
    ],
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

const REGISTRY = new Map<ExportPresetId, ExportPreset>(
  PRESETS.map((p) => [p.id, p]),
);

export function getExportPreset(id: ExportPresetId): ExportPreset {
  const p = REGISTRY.get(id);
  if (!p) throw new Error(`Unknown export preset: ${id}`);
  return p;
}

export function listExportPresets(): ExportPreset[] {
  return [...PRESETS];
}

/** Return required file specs for a preset (required=true only). */
export function getRequiredFiles(presetId: ExportPresetId): ExportFileSpec[] {
  return getExportPreset(presetId).files.filter((f) => f.required);
}
