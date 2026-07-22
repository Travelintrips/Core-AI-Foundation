/**
 * packaging-design/plugin/overlays.ts — Team 26
 *
 * Packaging design overlay zone definitions.
 *
 * Team 26 declares the metadata / renderer boundary for each overlay zone.
 * This plugin does NOT draw the dieline — it provides zone specs that an
 * external renderer/CAD tool consumes.
 *
 * Seven overlay types are defined:
 *   bleed, trim, safe_area, fold, cut, glue_zone, barcode_zone
 *
 * PURE module — no DB calls, no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export const OVERLAY_TYPE_IDS = [
  "bleed",
  "trim",
  "safe_area",
  "fold",
  "cut",
  "glue_zone",
  "barcode_zone",
] as const;

export type OverlayTypeId = (typeof OVERLAY_TYPE_IDS)[number];

/** Visual rendering hint for the renderer. */
export interface OverlayRenderStyle {
  /** Stroke color (hex). */
  color:     string;
  /** Line style. "dashed" for guide lines, "solid" for cut/structural lines. */
  lineStyle: "solid" | "dashed" | "dotted";
  /** Stroke weight in points. */
  strokePt:  number;
  /** Fill opacity 0–1. 0 = no fill. */
  fillOpacity: number;
  /** Layer name inside the source file (e.g. Adobe Illustrator layer name). */
  layerName: string;
}

export interface OverlayZoneDefinition {
  id:           OverlayTypeId;
  label:        string;
  description:  string;
  /**
   * Default inset/outset from the trim box (mm).
   * Positive = inward (safe area), negative = outward (bleed).
   */
  defaultOffsetMm: number;
  renderStyle:  OverlayRenderStyle;
  /**
   * Whether this zone is structural (carries physical tooling instructions)
   * vs. a print guide (informational only).
   */
  isStructural: boolean;
  /**
   * Whether this overlay is mandatory for ALL packaging types.
   * If false, it is conditional (e.g. barcode_zone only when hasBarcodeZone=true).
   */
  mandatory:    boolean;
  /**
   * Rules that govern the overlap / proximity between this zone and others.
   * Renderer must enforce that content in `protectedZones` does not enter
   * within `minDistanceMm` of this zone boundary.
   */
  proximityRules: Array<{
    protectedZone: OverlayTypeId;
    minDistanceMm: number;
    description:   string;
  }>;
}

// ── Zone definitions ──────────────────────────────────────────────────────────

const OVERLAY_DEFINITIONS: OverlayZoneDefinition[] = [
  {
    id:              "bleed",
    label:           "Bleed",
    description:
      "Extension of artwork beyond the trim line to prevent white edges after cutting. " +
      "Industry minimum: 3 mm. Recommended for commercial packaging: 5 mm.",
    defaultOffsetMm: -3,          // 3 mm outward from trim
    renderStyle: {
      color:        "#FF0000",
      lineStyle:    "dashed",
      strokePt:     0.5,
      fillOpacity:  0.05,
      layerName:    "Bleed",
    },
    isStructural: false,
    mandatory:    true,
    proximityRules: [],
  },
  {
    id:              "trim",
    label:           "Trim / Cut Line",
    description:
      "The final cut boundary of the packaging. All structural dimensions are measured " +
      "to this line. Artwork must extend to the bleed line beyond this boundary.",
    defaultOffsetMm: 0,
    renderStyle: {
      color:        "#000000",
      lineStyle:    "solid",
      strokePt:     1.0,
      fillOpacity:  0,
      layerName:    "Trim",
    },
    isStructural: true,
    mandatory:    true,
    proximityRules: [
      {
        protectedZone: "safe_area",
        minDistanceMm: 3,
        description:   "Safe area inset must be at least 3 mm from the trim line.",
      },
    ],
  },
  {
    id:              "safe_area",
    label:           "Safe Area",
    description:
      "Inner boundary within which all critical content (text, logos, legal block) must " +
      "reside to avoid being cut or obscured. Minimum inset: 3 mm from trim. " +
      "Recommended: 5 mm.",
    defaultOffsetMm: 5,           // 5 mm inward from trim
    renderStyle: {
      color:        "#00CC00",
      lineStyle:    "dashed",
      strokePt:     0.5,
      fillOpacity:  0.03,
      layerName:    "Safe Area",
    },
    isStructural: false,
    mandatory:    true,
    proximityRules: [
      {
        protectedZone: "trim",
        minDistanceMm: 3,
        description:   "Safe area must be at least 3 mm inward from trim.",
      },
      {
        protectedZone: "glue_zone",
        minDistanceMm: 2,
        description:   "Content must not enter within 2 mm of a glue zone.",
      },
    ],
  },
  {
    id:              "fold",
    label:           "Fold Line",
    description:
      "Score / crease line where the substrate is folded to form the box structure. " +
      "Artwork may cross fold lines but critical content (barcodes, regulatory text) " +
      "must not straddle a fold line.",
    defaultOffsetMm: 0,
    renderStyle: {
      color:        "#0000FF",
      lineStyle:    "dashed",
      strokePt:     0.75,
      fillOpacity:  0,
      layerName:    "Fold Lines",
    },
    isStructural: true,
    mandatory:    false,
    proximityRules: [
      {
        protectedZone: "barcode_zone",
        minDistanceMm: 5,
        description:   "Barcode zones must not straddle a fold line — minimum 5 mm clear on both sides.",
      },
    ],
  },
  {
    id:              "cut",
    label:           "Cut Line (Internal)",
    description:
      "Internal cut or perforation line, such as for a window cut-out, tear strip, " +
      "or carrying handle. Distinct from the outer trim line.",
    defaultOffsetMm: 0,
    renderStyle: {
      color:        "#FF6600",
      lineStyle:    "solid",
      strokePt:     0.75,
      fillOpacity:  0,
      layerName:    "Cut Lines",
    },
    isStructural: true,
    mandatory:    false,
    proximityRules: [
      {
        protectedZone: "safe_area",
        minDistanceMm: 3,
        description:   "Internal cut lines must not encroach within 3 mm of the safe area boundary.",
      },
    ],
  },
  {
    id:              "glue_zone",
    label:           "Glue Zone",
    description:
      "Area where adhesive is applied during box assembly. This zone must remain ink-free " +
      "or use compatible inks to ensure proper adhesion. Artwork must not print critical " +
      "content here.",
    defaultOffsetMm: 0,
    renderStyle: {
      color:        "#FFCC00",
      lineStyle:    "solid",
      strokePt:     0.5,
      fillOpacity:  0.15,
      layerName:    "Glue Zones",
    },
    isStructural: true,
    mandatory:    false,
    proximityRules: [
      {
        protectedZone: "safe_area",
        minDistanceMm: 2,
        description:   "No critical content within 2 mm of a glue zone.",
      },
    ],
  },
  {
    id:              "barcode_zone",
    label:           "Barcode Zone",
    description:
      "Reserved area for barcode or QR code placement. Must have a white (or light-colored) " +
      "background with sufficient quiet zone (minimum 2.5× the narrowest bar width on each " +
      "side). Zone must not overlap fold lines, cut lines, or glue zones.",
    defaultOffsetMm: 0,
    renderStyle: {
      color:        "#CC00CC",
      lineStyle:    "solid",
      strokePt:     0.5,
      fillOpacity:  0.08,
      layerName:    "Barcode Zone",
    },
    isStructural: false,
    mandatory:    false,    // conditional: only when hasBarcodeZone=true
    proximityRules: [
      {
        protectedZone: "fold",
        minDistanceMm: 5,
        description:   "Barcode zone must not straddle a fold line — 5 mm clear on both sides.",
      },
      {
        protectedZone: "cut",
        minDistanceMm: 5,
        description:   "Barcode zone must not intersect any internal cut line.",
      },
      {
        protectedZone: "glue_zone",
        minDistanceMm: 3,
        description:   "Barcode zone must not overlap a glue zone.",
      },
    ],
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

const REGISTRY = new Map<OverlayTypeId, OverlayZoneDefinition>(
  OVERLAY_DEFINITIONS.map((o) => [o.id, o]),
);

export function getOverlayDefinition(id: OverlayTypeId): OverlayZoneDefinition {
  const def = REGISTRY.get(id);
  if (!def) throw new Error(`Unknown overlay type: ${id}`);
  return def;
}

export function listOverlayDefinitions(): OverlayZoneDefinition[] {
  return [...OVERLAY_DEFINITIONS];
}

export function listMandatoryOverlays(): OverlayZoneDefinition[] {
  return OVERLAY_DEFINITIONS.filter((o) => o.mandatory);
}

export function listStructuralOverlays(): OverlayZoneDefinition[] {
  return OVERLAY_DEFINITIONS.filter((o) => o.isStructural);
}

/**
 * Given a set of order flags, return the overlay zone IDs that apply.
 * Callers should pass the relevant boolean flags from the packaging order.
 */
export function resolveActiveOverlays(opts: {
  hasBarcodeZone:    boolean;
  hasFoldLines:      boolean;
  hasInternalCuts:   boolean;
  hasGlueZone:       boolean;
}): OverlayTypeId[] {
  const active: OverlayTypeId[] = ["bleed", "trim", "safe_area"];

  if (opts.hasFoldLines)    active.push("fold");
  if (opts.hasInternalCuts) active.push("cut");
  if (opts.hasGlueZone)     active.push("glue_zone");
  if (opts.hasBarcodeZone)  active.push("barcode_zone");

  return active;
}
