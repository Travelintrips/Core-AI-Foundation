/**
 * WP-03B — Collision Engine: Room Boundary Validation
 *
 * Validates that a placement's rotated corners lie within the room boundary.
 * Does NOT silently clamp — returns structured violations.
 *
 * Edge-touch policy: corners exactly on the boundary are NOT violations.
 */

import type { PlacementGeometry, RoomBounds, RoomBoundaryViolation } from "./types.js";
import { COLLISION_EPSILON } from "./types.js";
import { rotatedCorners } from "./geometry.js";

/**
 * Validates placement geometry before any boundary check.
 * Returns a violation if the placement has invalid dimensions or non-finite values.
 */
function validateGeometry(p: PlacementGeometry): RoomBoundaryViolation | null {
  if (
    !Number.isFinite(p.xCm) || !Number.isFinite(p.yCm) ||
    !Number.isFinite(p.widthCm) || !Number.isFinite(p.depthCm) ||
    !Number.isFinite(p.rotationDeg)
  ) {
    return {
      code:        "PLACEMENT_GEOMETRY_INVALID",
      placementId: p.id,
      message:     `Placement ${p.id} has non-finite geometry values (NaN or Infinity).`,
    };
  }
  if (p.widthCm <= 0 || p.depthCm <= 0) {
    return {
      code:        "PLACEMENT_DIMENSIONS_INVALID",
      placementId: p.id,
      message:     `Placement ${p.id} has invalid dimensions: widthCm=${p.widthCm}, depthCm=${p.depthCm}. Both must be positive.`,
    };
  }
  return null;
}

/**
 * Checks whether a placement is fully within the room boundary.
 *
 * Returns:
 * - null if the placement is fully inside the room
 * - RoomBoundaryViolation if any rotated corner lies outside the room
 *
 * "Outside" means strictly beyond the boundary edge minus epsilon.
 * Corners exactly on the edge are not violations.
 */
export function checkRoomBounds(p: PlacementGeometry, room: RoomBounds): RoomBoundaryViolation | null {
  const geomError = validateGeometry(p);
  if (geomError) return geomError;

  if (room.widthCm <= 0 || room.depthCm <= 0) {
    return {
      code:        "PLACEMENT_GEOMETRY_INVALID",
      placementId: p.id,
      message:     `Room dimensions are invalid: widthCm=${room.widthCm}, depthCm=${room.depthCm}.`,
    };
  }

  const corners = rotatedCorners(p.xCm, p.yCm, p.widthCm, p.depthCm, p.rotationDeg);
  const outsideCorners = corners.filter(c =>
    c.x < -COLLISION_EPSILON ||
    c.x > room.widthCm + COLLISION_EPSILON ||
    c.y < -COLLISION_EPSILON ||
    c.y > room.depthCm + COLLISION_EPSILON,
  );

  if (outsideCorners.length === 0) return null;

  return {
    code:        "PLACEMENT_OUTSIDE_ROOM",
    placementId: p.id,
    message:     `Placement ${p.id} has ${outsideCorners.length} corner(s) outside the room boundary.`,
    corners:     outsideCorners,
  };
}

/**
 * Validates all active placements in a session against the room boundary.
 * Archived placements are skipped.
 */
export function checkAllRoomBounds(
  placements: PlacementGeometry[],
  room:       RoomBounds,
): RoomBoundaryViolation[] {
  const violations: RoomBoundaryViolation[] = [];
  for (const p of placements) {
    if (p.isArchived) continue;
    const v = checkRoomBounds(p, room);
    if (v) violations.push(v);
  }
  return violations;
}
