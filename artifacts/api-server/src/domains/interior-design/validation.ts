/**
 * Team 17 — Interior Design — Validation layer
 * Tests: dimensions, impossible placement, clearance, circulation, safety disclaimers.
 *
 * IMPORTANT: This module intentionally contains no pricing / RAB logic.
 * Outputs must not be claimed as structural/construction drawings.
 */

export interface RoomGeometry {
  roomLengthM: number;
  roomWidthM: number;
  ceilingHeightM: number;
  roomType: string;
}

export interface DoorSpec {
  id: string;
  wall: "north" | "south" | "east" | "west";
  positionM: number;
  widthM: number;
  swingInward?: boolean;
}

export interface WindowSpec {
  id: string;
  wall: "north" | "south" | "east" | "west";
  positionM: number;
  widthM: number;
  sillHeightM?: number;
  headHeightM?: number;
}

export interface ColumnSpec {
  id: string;
  xM: number;
  yM: number;
  widthM: number;
  depthM: number;
}

export interface ImmutableZone {
  id: string;
  label: string;
  xM: number;
  yM: number;
  widthM: number;
  depthM: number;
}

export interface FurnitureItem {
  item: string;
  widthM: number;
  depthM: number;
  heightM?: number;
}

export interface ValidationResult {
  dimensionWarnings: string[];
  clearanceWarnings: string[];
  circulationWarnings: string[];
  placementWarnings: string[];
  passedChecks: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum door clearance (m) — building-code inspired */
export const MIN_DOOR_WIDTH_M = 0.8;
/** Minimum residential pathway width (m) */
export const MIN_RESIDENTIAL_PATHWAY_M = 0.9;
/** Minimum commercial/hospitality pathway width (m) */
export const MIN_COMMERCIAL_PATHWAY_M = 1.1;
/** Minimum clear furniture side clearance (m) */
export const MIN_FURNITURE_CLEARANCE_M = 0.45;
/** Minimum bed side clearance (m) */
export const MIN_BED_CLEARANCE_M = 0.6;
/** Minimum kitchen aisle width (m) */
export const MIN_KITCHEN_AISLE_M = 1.0;
/** Minimum restaurant inter-table clearance (m) */
export const MIN_RESTAURANT_TABLE_GAP_M = 1.2;
/** Absolute minimum room dimension (m) */
export const ABS_MIN_ROOM_DIM_M = 2.0;
/** Absolute maximum room dimension (m) — sanity cap */
export const ABS_MAX_ROOM_DIM_M = 100.0;
/** Minimum ceiling height (m) */
export const MIN_CEILING_HEIGHT_M = 2.0;
/** Maximum ceiling height (m) — sanity cap */
export const MAX_CEILING_HEIGHT_M = 12.0;

const COMMERCIAL_ROOM_TYPES = new Set(["cafe", "restaurant", "hotel", "lobby", "booth"]);

// ── Dimension validation ──────────────────────────────────────────────────────

/** Validate room geometry and return human-readable warnings. */
export function validateRoomDimensions(geo: RoomGeometry): {
  warnings: string[];
  passedChecks: string[];
} {
  const warnings: string[] = [];
  const passedChecks: string[] = [];

  const { roomLengthM: l, roomWidthM: w, ceilingHeightM: ch, roomType } = geo;

  // ── Length checks ────────────────────────────────────────────────────────
  if (!isFinite(l) || l <= 0) {
    warnings.push(`Room length must be a positive number (got ${l}).`);
  } else if (l < ABS_MIN_ROOM_DIM_M) {
    warnings.push(
      `Room length ${l}m is below the practical minimum (${ABS_MIN_ROOM_DIM_M}m). Furniture placement will be severely constrained.`,
    );
  } else if (l > ABS_MAX_ROOM_DIM_M) {
    warnings.push(`Room length ${l}m exceeds the supported maximum (${ABS_MAX_ROOM_DIM_M}m). Please verify input.`);
  } else {
    passedChecks.push(`Room length ${l}m is within acceptable range.`);
  }

  // ── Width checks ─────────────────────────────────────────────────────────
  if (!isFinite(w) || w <= 0) {
    warnings.push(`Room width must be a positive number (got ${w}).`);
  } else if (w < ABS_MIN_ROOM_DIM_M) {
    warnings.push(
      `Room width ${w}m is below the practical minimum (${ABS_MIN_ROOM_DIM_M}m). Furniture placement will be severely constrained.`,
    );
  } else if (w > ABS_MAX_ROOM_DIM_M) {
    warnings.push(`Room width ${w}m exceeds the supported maximum (${ABS_MAX_ROOM_DIM_M}m). Please verify input.`);
  } else {
    passedChecks.push(`Room width ${w}m is within acceptable range.`);
  }

  // ── Ceiling height ───────────────────────────────────────────────────────
  if (!isFinite(ch) || ch <= 0) {
    warnings.push(`Ceiling height must be a positive number (got ${ch}).`);
  } else if (ch < MIN_CEILING_HEIGHT_M) {
    warnings.push(
      `Ceiling height ${ch}m is below the minimum habitable standard (${MIN_CEILING_HEIGHT_M}m).`,
    );
  } else if (ch > MAX_CEILING_HEIGHT_M) {
    warnings.push(`Ceiling height ${ch}m is unusually high. Please confirm this is correct.`);
  } else {
    passedChecks.push(`Ceiling height ${ch}m is within acceptable range.`);
  }

  // ── Area checks ──────────────────────────────────────────────────────────
  if (isFinite(l) && isFinite(w) && l > 0 && w > 0) {
    const area = l * w;
    if (area < 4) {
      warnings.push(`Room area ${area.toFixed(1)}m² is extremely small. Most furniture will not fit.`);
    } else if (area < 9) {
      warnings.push(`Room area ${area.toFixed(1)}m² is very small. Layout options will be limited.`);
    } else {
      passedChecks.push(`Room area ${area.toFixed(1)}m² is workable.`);
    }

    // ── Room-type specific minimums ──────────────────────────────────────
    if (roomType === "kitchen" && Math.min(l, w) < 2.5) {
      warnings.push(
        `Kitchen width/depth ${Math.min(l, w)}m is below the 2.5m minimum for a functional parallel or single-wall layout.`,
      );
    }
    if (roomType === "restaurant" && area < 20) {
      warnings.push(`Restaurant area ${area.toFixed(1)}m² is very small for a seating layout with adequate circulation.`);
    }
    if (roomType === "hotel" && Math.min(l, w) < 3.0) {
      warnings.push(`Hotel room narrow dimension ${Math.min(l, w)}m may not accommodate a standard bed plus clearances.`);
    }
    if (roomType === "lobby" && Math.min(l, w) < 4.0) {
      warnings.push(`Lobby narrow dimension ${Math.min(l, w)}m is below the 4.0m recommendation for adequate reception and circulation.`);
    }
    if (roomType === "booth" && area > 25) {
      warnings.push(`Booth area ${area.toFixed(1)}m² is unusually large. If this is a full restaurant, use "restaurant" type instead.`);
    }
  }

  return { warnings, passedChecks };
}

// ── Door / window validation ──────────────────────────────────────────────────

export function validateOpenings(
  doors: DoorSpec[],
  geo: RoomGeometry,
): { warnings: string[]; passedChecks: string[] } {
  const warnings: string[] = [];
  const passedChecks: string[] = [];

  for (const door of doors) {
    if (door.widthM < MIN_DOOR_WIDTH_M) {
      warnings.push(
        `Door "${door.id}" width ${door.widthM}m is below the accessible minimum of ${MIN_DOOR_WIDTH_M}m.`,
      );
    } else {
      passedChecks.push(`Door "${door.id}" width ${door.widthM}m meets accessibility standards.`);
    }

    const wallLen = ["north", "south"].includes(door.wall) ? geo.roomWidthM : geo.roomLengthM;
    if (door.positionM + door.widthM > wallLen) {
      warnings.push(
        `Door "${door.id}" extends beyond wall boundary (wall: ${wallLen}m, door end: ${(door.positionM + door.widthM).toFixed(2)}m).`,
      );
    }
  }

  if (doors.length === 0) {
    warnings.push("No doors defined. At least one entry/exit must be planned for circulation and egress.");
  }

  return { warnings, passedChecks };
}

// ── Furniture clearance checks ────────────────────────────────────────────────

export interface PlacedFurniture extends FurnitureItem {
  xM: number;
  yM: number;
  rotation?: number; // degrees
}

/** Check that a single piece of furniture fits inside the room. */
export function checkFurnitureFitsRoom(
  furniture: PlacedFurniture,
  geo: RoomGeometry,
): string[] {
  const warnings: string[] = [];
  const { widthM, depthM, xM, yM, item } = furniture;

  if (widthM <= 0 || depthM <= 0) {
    warnings.push(`"${item}": dimensions must be positive (${widthM}×${depthM}m).`);
    return warnings;
  }
  if (widthM >= geo.roomLengthM && depthM >= geo.roomWidthM) {
    warnings.push(
      `"${item}" (${widthM}×${depthM}m) is larger than or equal to the room (${geo.roomLengthM}×${geo.roomWidthM}m) — impossible placement.`,
    );
    return warnings;
  }
  if (xM + widthM > geo.roomLengthM) {
    warnings.push(
      `"${item}" extends beyond room east wall (item end: ${(xM + widthM).toFixed(2)}m, room length: ${geo.roomLengthM}m).`,
    );
  }
  if (yM + depthM > geo.roomWidthM) {
    warnings.push(
      `"${item}" extends beyond room south wall (item end: ${(yM + depthM).toFixed(2)}m, room width: ${geo.roomWidthM}m).`,
    );
  }
  if (xM < 0) warnings.push(`"${item}" x-position is negative.`);
  if (yM < 0) warnings.push(`"${item}" y-position is negative.`);

  return warnings;
}

/** Check minimum clearance between two furniture items. */
export function checkClearanceBetween(a: PlacedFurniture, b: PlacedFurniture): string[] {
  const warnings: string[] = [];

  const aRight = a.xM + a.widthM;
  const aBottom = a.yM + a.depthM;
  const bRight = b.xM + b.widthM;
  const bBottom = b.yM + b.depthM;

  // Check overlap
  const overlapX = aRight > b.xM && bRight > a.xM;
  const overlapY = aBottom > b.yM && bBottom > a.yM;
  if (overlapX && overlapY) {
    warnings.push(`"${a.item}" and "${b.item}" overlap — impossible placement.`);
    return warnings;
  }

  // Closest gap in each axis
  const gapX = overlapX ? 0 : Math.min(Math.abs(b.xM - aRight), Math.abs(a.xM - bRight));
  const gapY = overlapY ? 0 : Math.min(Math.abs(b.yM - aBottom), Math.abs(a.yM - bBottom));
  const gap = Math.sqrt(gapX * gapX + gapY * gapY);

  if (gap < MIN_FURNITURE_CLEARANCE_M && gap > 0) {
    warnings.push(
      `"${a.item}" and "${b.item}" clearance ${gap.toFixed(2)}m is below the recommended minimum of ${MIN_FURNITURE_CLEARANCE_M}m.`,
    );
  }

  return warnings;
}

/** Run all clearance checks for a furniture list. */
export function checkAllClearances(
  items: PlacedFurniture[],
  geo: RoomGeometry,
  doors: DoorSpec[] = [],
): string[] {
  const warnings: string[] = [];

  // Each item fits in room
  for (const item of items) {
    warnings.push(...checkFurnitureFitsRoom(item, geo));
  }

  // Pairwise clearance
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      warnings.push(...checkClearanceBetween(items[i]!, items[j]!));
    }
  }

  // Door swing clearance (rough: 0.9m × 0.9m zone in front of door)
  for (const door of doors) {
    const swingZone = getDoorSwingZone(door, geo);
    for (const item of items) {
      if (zonesOverlap(swingZone, { x: item.xM, y: item.yM, w: item.widthM, d: item.depthM })) {
        warnings.push(
          `"${item.item}" may block the swing zone of door "${door.id}". Ensure ${door.widthM}m+ clearance.`,
        );
      }
    }
  }

  return warnings;
}

function getDoorSwingZone(door: DoorSpec, geo: RoomGeometry) {
  const sw = door.widthM;
  const swingDepth = door.widthM; // approximate arc depth
  switch (door.wall) {
    case "north": return { x: door.positionM, y: 0, w: sw, d: swingDepth };
    case "south": return { x: door.positionM, y: geo.roomWidthM - swingDepth, w: sw, d: swingDepth };
    case "west":  return { x: 0, y: door.positionM, w: swingDepth, d: sw };
    case "east":  return { x: geo.roomLengthM - swingDepth, y: door.positionM, w: swingDepth, d: sw };
  }
}

function zonesOverlap(
  a: { x: number; y: number; w: number; d: number },
  b: { x: number; y: number; w: number; d: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y;
}

// ── Circulation validation ────────────────────────────────────────────────────

export interface CirculationResult {
  warnings: string[];
  passedChecks: string[];
  minPathwayWidth: number;
  isCommercial: boolean;
}

/**
 * Estimates available circulation width by subtracting placed furniture area
 * from the room's shortest dimension. Heuristic — not a full pathfinding check.
 */
export function validateCirculation(
  items: PlacedFurniture[],
  geo: RoomGeometry,
  doors: DoorSpec[] = [],
): CirculationResult {
  const warnings: string[] = [];
  const passedChecks: string[] = [];
  const isCommercial = COMMERCIAL_ROOM_TYPES.has(geo.roomType);
  const minRequired = isCommercial ? MIN_COMMERCIAL_PATHWAY_M : MIN_RESIDENTIAL_PATHWAY_M;

  const roomArea = geo.roomLengthM * geo.roomWidthM;
  const furnitureArea = items.reduce((sum, it) => sum + it.widthM * it.depthM, 0);
  const occupancyRatio = furnitureArea / roomArea;

  if (occupancyRatio > 0.65) {
    warnings.push(
      `Furniture occupies ${(occupancyRatio * 100).toFixed(0)}% of floor area — circulation will be severely restricted. Target ≤60%.`,
    );
  } else if (occupancyRatio > 0.50) {
    warnings.push(
      `Furniture occupies ${(occupancyRatio * 100).toFixed(0)}% of floor area — consider reducing items to improve circulation.`,
    );
  } else {
    passedChecks.push(
      `Furniture occupancy ${(occupancyRatio * 100).toFixed(0)}% allows adequate circulation space.`,
    );
  }

  // Shortest dimension clearance (simplified)
  const shortDim = Math.min(geo.roomLengthM, geo.roomWidthM);
  const maxFurnitureDepthOnShortAxis = items.reduce((max, it) => Math.max(max, it.depthM), 0);
  const estimatedPathway = shortDim - maxFurnitureDepthOnShortAxis;

  if (estimatedPathway < minRequired) {
    warnings.push(
      `Estimated main pathway ~${estimatedPathway.toFixed(2)}m may fall below the ${isCommercial ? "commercial" : "residential"} minimum of ${minRequired}m.`,
    );
  } else {
    passedChecks.push(
      `Estimated main pathway ~${estimatedPathway.toFixed(2)}m meets the ${minRequired}m minimum.`,
    );
  }

  // Kitchen: aisle check
  if (geo.roomType === "kitchen") {
    if (geo.roomWidthM < MIN_KITCHEN_AISLE_M * 2 + 0.6) {
      warnings.push(
        `Kitchen width ${geo.roomWidthM}m may not support a functional galley aisle (≥${MIN_KITCHEN_AISLE_M}m) with counter on both sides.`,
      );
    } else {
      passedChecks.push(`Kitchen width supports a functional aisle width.`);
    }
  }

  // Restaurant: inter-table spacing
  if (geo.roomType === "restaurant") {
    const tables = items.filter((it) =>
      it.item.toLowerCase().includes("table") || it.item.toLowerCase().includes("meja"),
    );
    for (let i = 0; i < tables.length - 1; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const gap = Math.abs(tables[i]!.xM - tables[j]!.xM) - tables[i]!.widthM;
        if (gap < MIN_RESTAURANT_TABLE_GAP_M && gap > 0) {
          warnings.push(
            `Tables "${tables[i]!.item}" and "${tables[j]!.item}" spacing ~${gap.toFixed(2)}m is below the recommended ${MIN_RESTAURANT_TABLE_GAP_M}m for comfortable service circulation.`,
          );
        }
      }
    }
  }

  // Door egress check
  for (const door of doors) {
    const swingFront = door.widthM;
    if (swingFront < minRequired) {
      warnings.push(
        `Door "${door.id}" width ${door.widthM}m is narrower than the recommended ${minRequired}m egress corridor for ${isCommercial ? "commercial" : "residential"} use.`,
      );
    }
  }

  return { warnings, passedChecks, minPathwayWidth: minRequired, isCommercial };
}

// ── Safety disclaimers ────────────────────────────────────────────────────────

/** Generate mandatory safety and scope disclaimers for interior design output. */
export function generateSafetyDisclaimers(roomType: string): string[] {
  const base: string[] = [
    "⚠️ Concept only — these recommendations are interior design concepts and must not be used as construction or engineering drawings.",
    "⚠️ Structural changes (removing walls, altering beams, modifying columns) require a licensed structural engineer's approval.",
    "⚠️ Electrical and plumbing work must be performed by licensed contractors and must comply with local building codes.",
    "⚠️ All dimensions shown are approximate. A professional site survey is recommended before purchasing furniture or beginning works.",
    "⚠️ Furniture clearances shown are minimum recommended values. Local building codes and accessibility standards may impose stricter requirements.",
    "⚠️ No pricing (RAB) is included in this output. Material and furniture costs must be obtained from vendors directly.",
  ];

  const commercial: string[] = [
    "⚠️ Commercial spaces require compliance with fire safety regulations, including emergency exit width, signage, and sprinkler clearances — consult a fire safety engineer.",
    "⚠️ Occupancy load calculations and fire egress planning must comply with the applicable building code (e.g., IBC, SNI) and local authority requirements.",
    "⚠️ Accessibility compliance (ramps, turning radius, counter heights) must be verified against applicable disability access standards.",
  ];

  const kitchen: string[] = [
    "⚠️ Kitchen hood and ventilation sizing must be verified by a mechanical engineer to comply with fire codes.",
    "⚠️ Gas line routing and appliance connections must be performed by a licensed plumber or gas fitter.",
  ];

  const restaurant: string[] = [
    "⚠️ Restaurant food-service layouts must comply with local health department regulations regarding food handling zones, hand-washing stations, and waste management.",
  ];

  const disclaimers = [...base];
  if (COMMERCIAL_ROOM_TYPES.has(roomType)) disclaimers.push(...commercial);
  if (roomType === "kitchen" || roomType === "cafe" || roomType === "restaurant") disclaimers.push(...kitchen);
  if (roomType === "restaurant" || roomType === "cafe") disclaimers.push(...restaurant);

  return disclaimers;
}

// ── Full validation pipeline ──────────────────────────────────────────────────

export interface FullValidationInput {
  geo: RoomGeometry;
  doors?: DoorSpec[];
  windows?: WindowSpec[];
  columns?: ColumnSpec[];
  furniture?: PlacedFurniture[];
}

export function runFullValidation(input: FullValidationInput): ValidationResult {
  const { geo, doors = [], windows = [], columns = [], furniture = [] } = input;

  const dimResult = validateRoomDimensions(geo);
  const openingResult = validateOpenings(doors, geo);
  const clearanceWarnings = furniture.length > 0 ? checkAllClearances(furniture, geo, doors) : [];
  const circResult = validateCirculation(furniture, geo, doors);

  return {
    dimensionWarnings: dimResult.warnings,
    clearanceWarnings,
    circulationWarnings: circResult.warnings,
    placementWarnings: openingResult.warnings,
    passedChecks: [
      ...dimResult.passedChecks,
      ...openingResult.passedChecks,
      ...circResult.passedChecks,
    ],
  };
}
