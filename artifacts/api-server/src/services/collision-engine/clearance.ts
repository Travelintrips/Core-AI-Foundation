/**
 * WP-03B — Collision Engine: Clearance Zone Checks
 *
 * Generates clearance warnings when a placement's clearance zone
 * overlaps another placement or the room boundary.
 *
 * Physical collisions and clearance warnings are strictly separate.
 */

import type { ClearanceWarning, ClearanceSide, OBB, PlacementGeometry, RoomBounds } from "./types.js";
import { COLLISION_EPSILON } from "./types.js";
import { generateClearanceOBB } from "./obb.js";
import { satTest } from "./sat.js";
import { generateOBB } from "./obb.js";
import { aabbOverlap, generateAABB } from "./aabb.js";

const CLEARANCE_SIDES: ClearanceSide[] = ["front", "side", "back"];

/**
 * Checks clearance zones of `placement` against all other active placements.
 * Returns warnings for each side that is violated.
 */
export function checkPlacementClearance(
  placement:  PlacementGeometry,
  others:     PlacementGeometry[],
  room:       RoomBounds,
): ClearanceWarning[] {
  const warnings: ClearanceWarning[] = [];

  for (const side of CLEARANCE_SIDES) {
    const clearanceOBB = generateClearanceOBB(placement, side);
    if (!clearanceOBB) continue;

    // Check against other placements
    for (const other of others) {
      if (other.id === placement.id) continue;
      if (other.isArchived) continue;

      // Broad phase
      const clearAABB = generateAABB(
        placement.xCm - (side === "side" ? placement.clearanceSideCm : 0),
        placement.yCm - (side === "front" ? placement.clearanceFrontCm : 0),
        placement.widthCm + (side === "side" ? placement.clearanceSideCm * 2 : 0),
        placement.depthCm + (side === "front" ? placement.clearanceFrontCm : 0) + (side === "back" ? placement.clearanceBackCm : 0),
        placement.rotationDeg,
      );
      const otherAABB = generateAABB(other.xCm, other.yCm, other.widthCm, other.depthCm, other.rotationDeg);
      if (!aabbOverlap(clearAABB, otherAABB)) continue;

      // Narrow phase
      const otherOBB = generateOBB(other);
      const result = satTest(clearanceOBB, otherOBB);
      if (result.overlaps && result.overlapDepth > COLLISION_EPSILON) {
        warnings.push({
          type:              "CLEARANCE_OVERLAP",
          placementId:       placement.id,
          otherPlacementId:  other.id,
          side,
          overlapDepth:      result.overlapDepth,
        });
      }
    }

    // Check against room boundary (OBB corners outside room)
    const cx = clearanceOBB.center.x;
    const cy = clearanceOBB.center.y;
    const halfW = clearanceOBB.halfW;
    const halfD = clearanceOBB.halfD;

    for (const corner of clearanceOBB.corners) {
      if (
        corner.x < -COLLISION_EPSILON ||
        corner.x > room.widthCm + COLLISION_EPSILON ||
        corner.y < -COLLISION_EPSILON ||
        corner.y > room.depthCm + COLLISION_EPSILON
      ) {
        warnings.push({
          type:         "CLEARANCE_BOUNDARY",
          placementId:  placement.id,
          side,
          overlapDepth: Math.max(
            Math.max(0, -corner.x),
            Math.max(0, corner.x - room.widthCm),
            Math.max(0, -corner.y),
            Math.max(0, corner.y - room.depthCm),
          ),
        });
        break; // One warning per side per boundary
      }
    }
    void cx; void cy; void halfW; void halfD;
  }

  return warnings;
}
