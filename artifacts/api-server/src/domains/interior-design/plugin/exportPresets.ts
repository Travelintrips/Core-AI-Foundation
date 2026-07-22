/**
 * Team 25 — Interior Design Domain Plugin
 * exportPresets.ts
 *
 * Export presets define how the final delivery package is assembled.
 * Presets are pure data — no AI provider, no tenant, no service-type
 * hard-coding.  The actual rendering is delegated to the export runner.
 */

// ── Preset IDs ────────────────────────────────────────────────────────────────

export const INTERIOR_EXPORT_PRESET_IDS = [
  "client_presentation",
  "client_review",
  "technical_drawing",
  "specification_sheet",
] as const;

export type InteriorExportPresetId =
  (typeof INTERIOR_EXPORT_PRESET_IDS)[number];

// ── Preset descriptor ─────────────────────────────────────────────────────────

export interface ArtifactInclusion {
  artifactTypeId: string;
  required: boolean;
  /** Delivery format to use for this artifact in the package */
  format: string;
  /** Page order within a compiled PDF */
  pageOrder?: number;
}

export interface InteriorExportPreset {
  id: InteriorExportPresetId;
  label: string;
  description: string;
  /** Primary output MIME type */
  primaryOutputFormat: string;
  /** Whether all included artifacts are merged into a single output file */
  isMerged: boolean;
  /** Artifacts included in this preset */
  inclusions: ArtifactInclusion[];
  /** Paper size for PDF output */
  paperSize: "A4" | "A3" | "letter";
  /** Orientation for PDF output */
  orientation: "portrait" | "landscape";
  /** Cover page included */
  includesCoverPage: boolean;
  /** Table of contents included */
  includesTableOfContents: boolean;
  /** Safety disclaimers appended to the output */
  includesDisclaimers: boolean;
  /** Watermark applied to draft output */
  draftWatermark: boolean;
}

// ── Preset definitions ────────────────────────────────────────────────────────

export const INTERIOR_EXPORT_PRESETS: Record<
  InteriorExportPresetId,
  InteriorExportPreset
> = {
  // ── 1. Client Presentation ─────────────────────────────────────────────
  client_presentation: {
    id: "client_presentation",
    label: "Client Presentation Deck",
    description:
      "A polished, fully-compiled PDF presentation combining all major deliverables in presentation order. Intended for client sign-off meetings.",
    primaryOutputFormat: "application/pdf",
    isMerged: true,
    paperSize: "A4",
    orientation: "landscape",
    includesCoverPage: true,
    includesTableOfContents: true,
    includesDisclaimers: true,
    draftWatermark: false,
    inclusions: [
      { artifactTypeId: "interior_moodboard",       required: true,  format: "image/png",      pageOrder: 1 },
      { artifactTypeId: "interior_space_plan",       required: true,  format: "application/pdf", pageOrder: 2 },
      { artifactTypeId: "interior_material_board",   required: true,  format: "image/png",      pageOrder: 3 },
      { artifactTypeId: "interior_lighting_plan",    required: true,  format: "image/png",      pageOrder: 4 },
      { artifactTypeId: "interior_furniture_board",  required: true,  format: "image/png",      pageOrder: 5 },
      { artifactTypeId: "interior_visualization",    required: true,  format: "image/jpeg",     pageOrder: 6 },
      { artifactTypeId: "interior_elevation",        required: false, format: "image/png",      pageOrder: 7 },
      { artifactTypeId: "interior_specification",    required: true,  format: "application/pdf", pageOrder: 8 },
    ],
  },

  // ── 2. Client Review ───────────────────────────────────────────────────
  client_review: {
    id: "client_review",
    label: "Client Review Package",
    description:
      "A draft review package with watermark, suitable for sharing with the client before final sign-off. Includes all in-progress deliverables.",
    primaryOutputFormat: "application/pdf",
    isMerged: true,
    paperSize: "A4",
    orientation: "landscape",
    includesCoverPage: true,
    includesTableOfContents: false,
    includesDisclaimers: true,
    draftWatermark: true,
    inclusions: [
      { artifactTypeId: "interior_moodboard",       required: true,  format: "image/png",      pageOrder: 1 },
      { artifactTypeId: "interior_space_plan",       required: true,  format: "image/png",      pageOrder: 2 },
      { artifactTypeId: "interior_material_board",   required: false, format: "image/png",      pageOrder: 3 },
      { artifactTypeId: "interior_visualization",    required: false, format: "image/jpeg",     pageOrder: 4 },
    ],
  },

  // ── 3. Technical Drawing Set ───────────────────────────────────────────
  technical_drawing: {
    id: "technical_drawing",
    label: "Technical Drawing Set",
    description:
      "A set of scale drawings (space plan, elevations) exported at A3 size for use by contractors and trades. No renders or moodboards included.",
    primaryOutputFormat: "application/pdf",
    isMerged: true,
    paperSize: "A3",
    orientation: "landscape",
    includesCoverPage: false,
    includesTableOfContents: false,
    includesDisclaimers: true,
    draftWatermark: false,
    inclusions: [
      { artifactTypeId: "interior_space_plan",       required: true,  format: "image/svg+xml",  pageOrder: 1 },
      { artifactTypeId: "interior_elevation",        required: false, format: "application/pdf", pageOrder: 2 },
      { artifactTypeId: "interior_lighting_plan",    required: false, format: "image/png",      pageOrder: 3 },
    ],
  },

  // ── 4. Specification Sheet ─────────────────────────────────────────────
  specification_sheet: {
    id: "specification_sheet",
    label: "Interior Specification Sheet",
    description:
      "A standalone itemised specification document (CSV and PDF) listing all finishes, furniture, fixtures, and accessories with reference codes for procurement.",
    primaryOutputFormat: "application/pdf",
    isMerged: false,
    paperSize: "A4",
    orientation: "portrait",
    includesCoverPage: false,
    includesTableOfContents: false,
    includesDisclaimers: true,
    draftWatermark: false,
    inclusions: [
      { artifactTypeId: "interior_specification",    required: true,  format: "application/pdf", pageOrder: 1 },
      { artifactTypeId: "interior_specification",    required: true,  format: "text/csv" },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return required artifact type IDs for a given export preset. */
export function getRequiredArtifactsForPreset(
  presetId: InteriorExportPresetId,
): string[] {
  const preset = INTERIOR_EXPORT_PRESETS[presetId];
  if (!preset)
    throw new Error(`[interior-plugin] Unknown export preset: ${presetId}`);
  return preset.inclusions
    .filter((inc) => inc.required)
    .map((inc) => inc.artifactTypeId);
}

/** Return all presets as an array (for listing APIs). */
export function listExportPresets(): InteriorExportPreset[] {
  return INTERIOR_EXPORT_PRESET_IDS.map(
    (id) => INTERIOR_EXPORT_PRESETS[id],
  );
}
