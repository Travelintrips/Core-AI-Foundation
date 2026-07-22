/**
 * packaging-design/plugin/artifacts.ts — Team 26
 *
 * Registry of the 8 packaging design artifact types.
 *
 * Each artifact type declares:
 *   - id             stable snake_case identifier
 *   - label          human-readable name
 *   - description    what this artifact contains / represents
 *   - mimeTypes      accepted file MIME types
 *   - maxFileSizeMb  upload size cap enforced by the renderer boundary
 *   - requiredFields metadata fields that must be present on the artifact record
 *   - isDeliverable  whether this artifact is included in the final client export
 *
 * PURE module — no DB calls, no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export const PACKAGING_ARTIFACT_TYPE_IDS = [
  "packaging_moodboard",
  "packaging_structure_concept",
  "packaging_dieline",
  "packaging_artwork",
  "packaging_material_spec",
  "packaging_mockup",
  "packaging_compliance_sheet",
  "packaging_production_spec",
] as const;

export type PackagingArtifactTypeId = (typeof PACKAGING_ARTIFACT_TYPE_IDS)[number];

export interface PackagingArtifactType {
  id:             PackagingArtifactTypeId;
  label:          string;
  description:    string;
  /** MIME types accepted for this artifact. */
  mimeTypes:      string[];
  /** Maximum file size in MB. */
  maxFileSizeMb:  number;
  /** JSON keys that MUST be present in the artifact's metadata object. */
  requiredFields: string[];
  /** Whether this artifact is delivered to the client at export. */
  isDeliverable:  boolean;
  /** Workflow step at which this artifact is first produced. */
  producedAtStep: string;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const ARTIFACT_TYPES: PackagingArtifactType[] = [
  {
    id:             "packaging_moodboard",
    label:          "Packaging Moodboard",
    description:
      "Visual inspiration board combining reference images, color palettes, textures, " +
      "and typography samples that establish the visual direction for the packaging design.",
    mimeTypes:      ["application/pdf", "image/png", "image/jpeg", "image/webp"],
    maxFileSizeMb:  50,
    requiredFields: ["brandName", "productName", "colorPalette", "styleKeywords"],
    isDeliverable:  false,
    producedAtStep: "market_research",
  },
  {
    id:             "packaging_structure_concept",
    label:          "Packaging Structure Concept",
    description:
      "Structural metadata record declaring the packaging form: box style, closure type, " +
      "panel layout, and structural constraints. This is a renderer boundary metadata record " +
      "— no physical CAD drawing is produced by this plugin.",
    mimeTypes:      ["application/json", "application/pdf", "image/png"],
    maxFileSizeMb:  20,
    requiredFields: ["packagingType", "panels", "closureType", "structureNotes"],
    isDeliverable:  false,
    producedAtStep: "structure_direction",
  },
  {
    id:             "packaging_dieline",
    label:          "Packaging Dieline",
    description:
      "Dieline template reference with overlay zone metadata: bleed, trim, safe area, fold " +
      "lines, cut lines, glue zones, and barcode zones. The plugin declares zone boundaries " +
      "only — the physical dieline is produced by an external CAD/renderer system.",
    mimeTypes:      ["application/pdf", "image/svg+xml", "application/postscript", "image/png"],
    maxFileSizeMb:  100,
    requiredFields: ["dielineReference", "overlayZones", "widthMm", "heightMm", "bleedMm"],
    isDeliverable:  true,
    producedAtStep: "dieline_input",
  },
  {
    id:             "packaging_artwork",
    label:          "Packaging Artwork",
    description:
      "Print-ready artwork files for all declared panels, respecting overlay zone boundaries. " +
      "Must be in CMYK or Pantone color mode with bleed included.",
    mimeTypes:      [
      "application/pdf",
      "application/postscript",
      "image/svg+xml",
      "image/png",
      "image/jpeg",
    ],
    maxFileSizeMb:  500,
    requiredFields: ["panels", "colorMode", "resolutionDpi", "bleedIncluded"],
    isDeliverable:  true,
    producedAtStep: "artwork",
  },
  {
    id:             "packaging_material_spec",
    label:          "Packaging Material Specification",
    description:
      "Detailed material specification including substrate type, weight/thickness, coating, " +
      "food-safety compliance status, sustainability certifications, and supplier recommendation.",
    mimeTypes:      ["application/pdf", "application/json", "text/plain"],
    maxFileSizeMb:  10,
    requiredFields: ["materialName", "substrate", "weightOrThickness", "coatingType"],
    isDeliverable:  true,
    producedAtStep: "material",
  },
  {
    id:             "packaging_mockup",
    label:          "Packaging Mockup",
    description:
      "Photorealistic or 3D renders showing the approved artwork applied to the structural " +
      "packaging form. Used for client sign-off and marketing purposes.",
    mimeTypes:      ["image/png", "image/jpeg", "image/webp", "application/pdf"],
    maxFileSizeMb:  200,
    requiredFields: ["renderType", "viewAngles", "artworkVersion"],
    isDeliverable:  true,
    producedAtStep: "mockup",
  },
  {
    id:             "packaging_compliance_sheet",
    label:          "Packaging Compliance Sheet",
    description:
      "Document listing all regulatory requirements from the brief and whether each check " +
      "passed or failed: BPOM number, SNI badge, Halal certification, ingredients block, " +
      "legal block, nutrition facts, and other applicable standards.",
    mimeTypes:      ["application/pdf", "application/json"],
    maxFileSizeMb:  20,
    requiredFields: ["checks", "outcome", "regulatoryBodies", "reviewedBy", "reviewedAt"],
    isDeliverable:  true,
    producedAtStep: "compliance_review",
  },
  {
    id:             "packaging_production_spec",
    label:          "Packaging Production Specification",
    description:
      "Complete production metadata sheet for the print vendor: final dimensions, " +
      "dieline reference, material spec, color profile, print run quantity, finishing, " +
      "barcode data, compliance certificate references, and special handling instructions.",
    mimeTypes:      ["application/pdf", "application/json"],
    maxFileSizeMb:  20,
    requiredFields: [
      "dimensions",
      "dielineReference",
      "materialSpecReference",
      "colorProfile",
      "printQuantity",
      "finishType",
      "complianceSheetReference",
    ],
    isDeliverable:  true,
    producedAtStep: "production_spec",
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

const REGISTRY = new Map<PackagingArtifactTypeId, PackagingArtifactType>(
  ARTIFACT_TYPES.map((t) => [t.id, t]),
);

export function getArtifactType(id: PackagingArtifactTypeId): PackagingArtifactType {
  const t = REGISTRY.get(id);
  if (!t) throw new Error(`Unknown packaging artifact type: ${id}`);
  return t;
}

export function listArtifactTypes(): PackagingArtifactType[] {
  return [...ARTIFACT_TYPES];
}

/** Return only deliverable artifact types (included in client export). */
export function listDeliverableArtifactTypes(): PackagingArtifactType[] {
  return ARTIFACT_TYPES.filter((t) => t.isDeliverable);
}

/**
 * Validate a MIME type against an artifact type's accepted list.
 * Returns true if the MIME is accepted, false otherwise.
 */
export function isMimeAccepted(artifactTypeId: PackagingArtifactTypeId, mime: string): boolean {
  return getArtifactType(artifactTypeId).mimeTypes.includes(mime);
}
