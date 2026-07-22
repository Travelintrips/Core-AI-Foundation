/**
 * Team 25 — Interior Design Domain Plugin
 * artifactTypes.ts
 *
 * Defines the 9 interior-design artifact types registered by this plugin.
 * All keys use the "interior_" prefix namespace — they must NEVER be
 * registered or re-used in the core platform directly.
 *
 * Opaque IDs are plain stable string literals — no runtime dependency on
 * any core type registry.
 */

// ── Artifact type ID literals ─────────────────────────────────────────────────

export const INTERIOR_ARTIFACT_TYPE_IDS = [
  "interior_moodboard",
  "interior_space_plan",
  "interior_material_board",
  "interior_furniture_board",
  "interior_lighting_plan",
  "interior_elevation",
  "interior_visualization",
  "interior_specification",
  "interior_presentation",
] as const;

export type InteriorArtifactTypeId = (typeof INTERIOR_ARTIFACT_TYPE_IDS)[number];

// ── Artifact type descriptor ──────────────────────────────────────────────────

export interface InteriorArtifactType {
  /** Stable opaque identifier — never changes once published. */
  id: InteriorArtifactTypeId;
  /** Human-readable label for UI / reports. */
  label: string;
  /** Short description of what this artifact contains. */
  description: string;
  /**
   * Workflow stage that produces this artifact (matches InteriorWorkflowStepId).
   * Read-only reference — the plugin does not own the workflow runner.
   */
  producedAtStage: string;
  /** MIME type(s) the artifact can be delivered as. */
  deliveryFormats: string[];
  /** Whether this artifact is required to complete the project. */
  required: boolean;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const INTERIOR_ARTIFACT_TYPES: Record<
  InteriorArtifactTypeId,
  InteriorArtifactType
> = {
  interior_moodboard: {
    id: "interior_moodboard",
    label: "Interior Moodboard",
    description:
      "Visual direction board: colour palette, texture swatches, style references, and mood words that establish the project's aesthetic language.",
    producedAtStage: "moodboard",
    deliveryFormats: ["image/png", "application/pdf"],
    required: true,
  },
  interior_space_plan: {
    id: "interior_space_plan",
    label: "Space Plan",
    description:
      "2-D overhead layout showing zone boundaries, furniture footprints, circulation paths, and door/window positions at scale.",
    producedAtStage: "space_planning",
    deliveryFormats: ["image/png", "application/pdf", "image/svg+xml"],
    required: true,
  },
  interior_material_board: {
    id: "interior_material_board",
    label: "Material Direction Board",
    description:
      "Curated material selections for flooring, walls, ceiling, and textiles with finish specifications and supplier categories.",
    producedAtStage: "material_direction",
    deliveryFormats: ["image/png", "application/pdf"],
    required: true,
  },
  interior_furniture_board: {
    id: "interior_furniture_board",
    label: "Furniture Selection Board",
    description:
      "Furniture references grouped by component category with dimensions, placement notes, and vendor suggestions.",
    producedAtStage: "furniture_selection",
    deliveryFormats: ["image/png", "application/pdf"],
    required: true,
  },
  interior_lighting_plan: {
    id: "interior_lighting_plan",
    label: "Lighting Plan",
    description:
      "Ambient, task, and accent lighting layout with fixture types, colour temperatures, and control zone recommendations.",
    producedAtStage: "lighting_direction",
    deliveryFormats: ["image/png", "application/pdf"],
    required: true,
  },
  interior_elevation: {
    id: "interior_elevation",
    label: "Interior Elevation",
    description:
      "Vertical wall elevation drawing showing surface treatments, heights, openings, and feature wall compositions.",
    producedAtStage: "visualization",
    deliveryFormats: ["image/png", "application/pdf"],
    required: false,
  },
  interior_visualization: {
    id: "interior_visualization",
    label: "3D Visualization / Render",
    description:
      "Perspective render or illustrated view of the completed space, conveying materials, lighting, and atmosphere.",
    producedAtStage: "visualization",
    deliveryFormats: ["image/jpeg", "image/png", "application/pdf"],
    required: true,
  },
  interior_specification: {
    id: "interior_specification",
    label: "Interior Specification Sheet",
    description:
      "Itemised specification document listing finishes, furniture, fixtures, and accessories with reference codes and notes.",
    producedAtStage: "documentation",
    deliveryFormats: ["application/pdf", "text/csv"],
    required: true,
  },
  interior_presentation: {
    id: "interior_presentation",
    label: "Client Presentation Deck",
    description:
      "Compiled presentation combining moodboard, space plan, material direction, lighting, furniture, and visualization into a single client-ready document.",
    producedAtStage: "export",
    deliveryFormats: ["application/pdf"],
    required: true,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return all required artifact types for a completed interior project. */
export function getRequiredArtifactTypes(): InteriorArtifactType[] {
  return INTERIOR_ARTIFACT_TYPE_IDS.map((id) => INTERIOR_ARTIFACT_TYPES[id]).filter(
    (t): t is InteriorArtifactType => t.required,
  );
}

/** Lookup by id — throws if not found (programming error, not user input). */
export function getArtifactType(id: InteriorArtifactTypeId): InteriorArtifactType {
  const t = INTERIOR_ARTIFACT_TYPES[id];
  if (!t) throw new Error(`[interior-plugin] Unknown artifact type: ${id}`);
  return t;
}
