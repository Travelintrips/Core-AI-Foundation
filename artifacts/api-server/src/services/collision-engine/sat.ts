/**
 * WP-03B — Collision Engine: SAT (Separating Axis Theorem)
 *
 * Narrow-phase collision detection for two OBBs.
 *
 * For two convex polygons A and B:
 * - If a separating axis exists, they do NOT overlap.
 * - The candidate axes are the face normals of both OBBs.
 * - For rectangles, each OBB contributes 2 unique face normal directions.
 */

import type { OBB, ProjectionInterval, Vector2D } from "./types.js";
import { COLLISION_EPSILON } from "./types.js";
import { dotProduct } from "./geometry.js";

// ── Projection ────────────────────────────────────────────────────────────────

/** Projects all four corners of an OBB onto a 1D axis. Returns [min, max]. */
export function projectOBBOnAxis(obb: OBB, axis: Vector2D): ProjectionInterval {
  let min = Infinity;
  let max = -Infinity;
  for (const corner of obb.corners) {
    const proj = dotProduct(corner, axis);
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }
  return { min, max };
}

/** Returns the overlap between two intervals, or 0 if they don't overlap. */
export function intervalOverlap(a: ProjectionInterval, b: ProjectionInterval): number {
  return Math.min(a.max, b.max) - Math.max(a.min, b.min);
}

/** Returns true if two intervals overlap by more than COLLISION_EPSILON. */
export function intervalsOverlap(a: ProjectionInterval, b: ProjectionInterval): boolean {
  return intervalOverlap(a, b) > COLLISION_EPSILON;
}

// ── SAT test ──────────────────────────────────────────────────────────────────

export interface SatResult {
  overlaps:        boolean;
  overlapDepth:    number;
  separatingAxis?: Vector2D;
  minOverlapAxis?: Vector2D;
}

/**
 * Runs the SAT test for two OBBs.
 *
 * Returns:
 * - overlaps = false + separatingAxis if a separating axis was found
 * - overlaps = true + overlapDepth + minOverlapAxis if all axes overlap
 *
 * Candidate axes: both axes from obbA + both axes from obbB (4 total for rectangles).
 * Touching edges (overlap ≤ COLLISION_EPSILON) count as separated.
 */
export function satTest(obbA: OBB, obbB: OBB): SatResult {
  const axes: Vector2D[] = [...obbA.axes, ...obbB.axes];

  let minDepth = Infinity;
  let minAxis: Vector2D | undefined;

  for (const axis of axes) {
    const projA = projectOBBOnAxis(obbA, axis);
    const projB = projectOBBOnAxis(obbB, axis);

    const overlap = intervalOverlap(projA, projB);

    if (overlap <= COLLISION_EPSILON) {
      // Separating axis found — no collision
      return {
        overlaps:       false,
        overlapDepth:   0,
        separatingAxis: axis,
      };
    }

    if (overlap < minDepth) {
      minDepth = overlap;
      minAxis  = axis;
    }
  }

  // No separating axis found — OBBs overlap
  return {
    overlaps:       true,
    overlapDepth:   minDepth,
    minOverlapAxis: minAxis,
  };
}
