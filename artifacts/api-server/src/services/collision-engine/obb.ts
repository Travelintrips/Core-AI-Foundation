/**
 * WP-03B — Collision Engine: OBB (Oriented Bounding Box) Generation
 *
 * Builds OBBs from placement geometry.
 * OBBs are used in the SAT narrow phase.
 */

import type { OBB, PlacementGeometry } from "./types.js";
import { normalizeDeg, rectCenter, rotatedCorners, obbAxes } from "./geometry.js";

/**
 * Generates an OBB for a placement.
 * Throws if placement has invalid geometry (zero/negative dimensions, NaN/Infinity).
 */
export function generateOBB(p: PlacementGeometry): OBB {
  if (!Number.isFinite(p.xCm) || !Number.isFinite(p.yCm)) {
    throw new Error(`PLACEMENT_GEOMETRY_INVALID: placement ${p.id} has non-finite position`);
  }
  if (!Number.isFinite(p.widthCm) || !Number.isFinite(p.depthCm)) {
    throw new Error(`PLACEMENT_GEOMETRY_INVALID: placement ${p.id} has non-finite dimensions`);
  }
  if (p.widthCm <= 0 || p.depthCm <= 0) {
    throw new Error(`PLACEMENT_DIMENSIONS_INVALID: placement ${p.id} has non-positive dimensions`);
  }
  if (!Number.isFinite(p.rotationDeg)) {
    throw new Error(`PLACEMENT_GEOMETRY_INVALID: placement ${p.id} has non-finite rotation`);
  }

  const rotDeg = normalizeDeg(p.rotationDeg);
  const center = rectCenter(p.xCm, p.yCm, p.widthCm, p.depthCm);
  const corners = rotatedCorners(p.xCm, p.yCm, p.widthCm, p.depthCm, rotDeg);
  const axes    = obbAxes(rotDeg);

  return {
    center,
    halfW:       p.widthCm / 2,
    halfD:       p.depthCm / 2,
    rotationDeg: rotDeg,
    corners,
    axes,
  };
}

/**
 * Generates an expanded OBB for clearance checking.
 * Expands each side by the corresponding clearance distance before rotation.
 */
export function generateClearanceOBB(p: PlacementGeometry, side: "front" | "side" | "back"): OBB | null {
  let frontExp = 0, sideExp = 0, backExp = 0;

  switch (side) {
    case "front": frontExp = p.clearanceFrontCm; break;
    case "side":  sideExp  = p.clearanceSideCm;  break;
    case "back":  backExp  = p.clearanceBackCm;  break;
  }

  if (frontExp <= 0 && sideExp <= 0 && backExp <= 0) return null;

  // Expand the placement box:
  //   front → expand minY (subtract frontExp from top)
  //   back  → expand maxY (add backExp to bottom)
  //   side  → expand both sides of X
  const expandedX  = p.xCm - sideExp;
  const expandedY  = p.yCm - frontExp;
  const expandedW  = p.widthCm + sideExp * 2;
  const expandedD  = p.depthCm + frontExp + backExp;

  if (expandedW <= 0 || expandedD <= 0) return null;

  const rotDeg = normalizeDeg(p.rotationDeg);
  const center = rectCenter(expandedX, expandedY, expandedW, expandedD);
  const corners = rotatedCorners(expandedX, expandedY, expandedW, expandedD, rotDeg);
  const axes    = obbAxes(rotDeg);

  return {
    center,
    halfW:       expandedW / 2,
    halfD:       expandedD / 2,
    rotationDeg: rotDeg,
    corners,
    axes,
  };
}
