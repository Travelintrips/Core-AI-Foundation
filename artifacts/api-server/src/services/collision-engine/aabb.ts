/**
 * WP-03B — Collision Engine: AABB (Axis-Aligned Bounding Box)
 *
 * Broad-phase collision detection.
 * AABB must be computed before SAT — reject non-overlapping pairs early.
 */

import type { AABB, Point2D } from "./types.js";
import { COLLISION_EPSILON } from "./types.js";
import { rotatedCorners } from "./geometry.js";

/**
 * Generates the AABB for a (possibly rotated) placement by computing all four
 * rotated corners and taking min/max of X and Y.
 */
export function generateAABB(
  xCm:         number,
  yCm:         number,
  widthCm:     number,
  depthCm:     number,
  rotationDeg: number,
): AABB {
  const corners: Point2D[] = rotatedCorners(xCm, yCm, widthCm, depthCm, rotationDeg);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Returns true if two AABBs overlap (not just touch).
 * Touching edges (difference exactly 0) are treated as non-overlapping
 * per the edge-touch policy.
 */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  if (a.maxX - b.minX <= COLLISION_EPSILON) return false;
  if (b.maxX - a.minX <= COLLISION_EPSILON) return false;
  if (a.maxY - b.minY <= COLLISION_EPSILON) return false;
  if (b.maxY - a.minY <= COLLISION_EPSILON) return false;
  return true;
}
