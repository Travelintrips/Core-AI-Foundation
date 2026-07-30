// ============================================================
// WP-03C — Collision Adapter
// Thin adapter that delegates overlap detection to WP-03B's
// canonical collision engine (collision-engine/aabb.ts).
//
// This file exists so WP-03C never duplicates AABB logic.
// WP-03C operates in pixel units with Rect ({x,y,width,height});
// WP-03B operates in cm units with positional args. The adapter
// maps between them — only the data format differs, not the algorithm.
// ============================================================

import { generateAABB, aabbOverlap } from "../collision-engine/aabb.js";
import type { AABB } from "../collision-engine/types.js";
import type { Rect } from "../../types/layout-composer/index.js";

/**
 * Converts a WP-03C axis-aligned Rect to a WP-03B AABB using the canonical
 * WP-03B generator. Rotation is fixed at 0 — the layout-composer solver
 * currently operates on axis-aligned bounding boxes only.
 *
 * Known Limitation: rotation is ignored here. See collisionDetection.ts for
 * the full limitation statement.
 */
export function rectToWP03BAABB(r: Rect): AABB {
  return generateAABB(r.x, r.y, r.width, r.height, 0);
}

/**
 * Delegates AABB overlap detection to WP-03B's canonical aabbOverlap.
 * Semantics are identical to WP-03C's original rectsOverlap:
 *   - touching edges (zero penetration depth) are NOT a collision
 *   - strict interior overlap is required
 *
 * This is the sole overlap predicate used by WP-03C collision logic.
 * Do NOT implement a second AABB check in WP-03C — extend this adapter instead.
 */
export function rectsOverlapViaWP03B(a: Rect, b: Rect): boolean {
  return aabbOverlap(rectToWP03BAABB(a), rectToWP03BAABB(b));
}
