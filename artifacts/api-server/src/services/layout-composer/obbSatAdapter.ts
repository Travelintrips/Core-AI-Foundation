/**
 * WP-04A — Layout Composer OBB/SAT Collision Adapter
 *
 * Upgrades Layout Composer collision detection from AABB-only (WP-03C)
 * to rotation-aware broad phase + OBB/SAT narrow phase.
 *
 * Design rules:
 *   - ALL geometry is delegated to WP-03B (collision-engine). No inline geometry.
 *   - Pixels are the internal unit. No cm/px conversion — geometry is unit-agnostic.
 *   - Clearance expands the collision envelope only; visual dimensions are never mutated.
 *   - legacyOverlapExtent preserves backward compatibility with WP-03C consumers.
 *   - WP-04B (iterative resolver) is explicitly out of scope here.
 *
 * Push-vector convention (owner decision):
 *   resolvedPositionA = { x: a.x + mtv.x, y: a.y + mtv.y }
 *
 * @module obbSatAdapter
 */

import { generateAABB, aabbOverlap } from "../collision-engine/aabb.js";
import { generateOBB } from "../collision-engine/obb.js";
import { satTest } from "../collision-engine/sat.js";
import type { OBB, Vector2D, PlacementGeometry } from "../collision-engine/types.js";
import type { Rect } from "../../types/layout-composer/index.js";

// ── Public types ───────────────────────────────────────────────────────────────

/** Identifies which algorithm produced the final collision verdict. */
export type CollisionAlgorithm = "aabb-miss" | "obb-sat";

/**
 * Typed collision result from the OBB/SAT adapter.
 *
 * Invariants:
 *   - All numeric fields are finite (never NaN, never Infinity).
 *   - penetrationDepth, collisionNormal, minimumTranslationVector are
 *     non-null only when collides = true.
 *   - legacyOverlapExtent is always populated (may be negative when no overlap).
 *   - Input objects are never mutated.
 */
export interface ObbSatResult {
  /** True when the OBBs physically overlap (SAT narrow phase confirmed). */
  collides: boolean;
  /**
   * True when rotation-aware AABBs overlap (broad phase passed).
   * False means SAT was skipped entirely.
   */
  broadPhasePassed: boolean;
  /** Which algorithm determined the final verdict. */
  algorithm: CollisionAlgorithm;
  /**
   * True when at least one element has non-zero rotation, so OBBs
   * (not just AABBs) were used as the definitive geometry.
   */
  rotationAware: boolean;
  /** Penetration depth along the axis of minimum overlap (0 when collides = false). */
  penetrationDepth: number;
  /**
   * Unit vector along the axis of minimum penetration.
   * null when collides = false.
   */
  collisionNormal: Vector2D | null;
  /**
   * Minimum translation vector that resolves the collision for element A.
   * Apply as: resolvedPositionA = { x: a.x + mtv.x, y: a.y + mtv.y }
   * null when collides = false.
   */
  minimumTranslationVector: Vector2D | null;
  /**
   * AABB-based overlap extents for backward-compatible consumers.
   * Computed from original visual rects (not clearance envelopes).
   * Negative values indicate no overlap on that axis.
   */
  legacyOverlapExtent: { overlapX: number; overlapY: number };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Maps a layout-composer Rect + rotation to a minimal WP-03B PlacementGeometry.
 * Pixels are passed directly as the "cm" fields — geometry is unit-agnostic.
 * Clearance fields are zeroed; clearance is applied externally via envelope expansion.
 */
function rectToPlacementGeometry(rect: Rect, rotationDeg: number, id: string): PlacementGeometry {
  return {
    id,
    xCm:               rect.x,
    yCm:               rect.y,
    widthCm:           rect.width,
    depthCm:           rect.height,
    rotationDeg,
    anchorX:           0,
    anchorY:           0,
    clearanceFrontCm:  0,
    clearanceSideCm:   0,
    clearanceBackCm:   0,
    isArchived:        false,
  };
}

/**
 * Returns a collision envelope rect expanded uniformly by clearancePx on all sides.
 * The original rect (visual dimensions) is never mutated.
 */
function applyEnvelopeClearance(rect: Rect, clearancePx: number): Rect {
  if (clearancePx <= 0) return rect;
  return {
    x:      rect.x      - clearancePx,
    y:      rect.y      - clearancePx,
    width:  rect.width  + clearancePx * 2,
    height: rect.height + clearancePx * 2,
  };
}

/**
 * Validates that a Rect has finite position and positive finite dimensions.
 * Throws a descriptive error on failure.
 */
function assertFiniteRect(rect: Rect, id: string): void {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
    throw new Error(
      `LAYOUT_ELEMENT_GEOMETRY_INVALID: element "${id}" has non-finite position`,
    );
  }
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    throw new Error(
      `LAYOUT_ELEMENT_GEOMETRY_INVALID: element "${id}" has non-finite dimensions`,
    );
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(
      `LAYOUT_ELEMENT_DIMENSIONS_INVALID: element "${id}" has non-positive dimensions`,
    );
  }
}

/**
 * Computes AABB-based overlap extents for legacy consumers.
 * Always derived from original visual rects (never from clearance envelopes).
 * Negative values mean no overlap on that axis.
 */
function computeLegacyOverlapExtent(
  a: Rect,
  b: Rect,
): { overlapX: number; overlapY: number } {
  return {
    overlapX: Math.min(a.x + a.width,  b.x + b.width)  - Math.max(a.x, b.x),
    overlapY: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Derives the minimum translation vector from a SAT axis and depth.
 * The sign is determined by the direction from B's center to A's center:
 * pushing A in that direction moves it away from B.
 *
 * Convention: resolvedPositionA = originalPositionA + MTV
 */
function deriveMTV(obbA: OBB, obbB: OBB, axis: Vector2D, depth: number): Vector2D {
  const dx  = obbA.center.x - obbB.center.x;
  const dy  = obbA.center.y - obbB.center.y;
  const dot = dx * axis.x + dy * axis.y;
  const sign = dot >= 0 ? 1 : -1;
  return { x: axis.x * depth * sign, y: axis.y * depth * sign };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Tests collision between two layout elements using:
 *   1. Rotation-aware AABB broad phase (via WP-03B generateAABB + aabbOverlap)
 *   2. OBB/SAT narrow phase (via WP-03B generateOBB + satTest)
 *
 * When broad phase misses, SAT is skipped entirely (broadPhasePassed = false).
 *
 * @param aRect        Bounding rect of element A (pixels, top-left origin)
 * @param bRect        Bounding rect of element B (pixels, top-left origin)
 * @param aRotationDeg Rotation of element A in degrees (default 0)
 * @param bRotationDeg Rotation of element B in degrees (default 0)
 * @param clearancePx  Uniform clearance added to each element's collision
 *                     envelope in pixels (default 0). Does not affect visual size.
 *                     Invalid or negative values are silently normalised to 0.
 * @param aId          Identifier used in error messages (default "A")
 * @param bId          Identifier used in error messages (default "B")
 *
 * @throws {Error} LAYOUT_ELEMENT_GEOMETRY_INVALID  — non-finite position/dimension/rotation
 * @throws {Error} LAYOUT_ELEMENT_DIMENSIONS_INVALID — non-positive width or height
 */
export function obbSatCollide(
  aRect:        Rect,
  bRect:        Rect,
  aRotationDeg = 0,
  bRotationDeg = 0,
  clearancePx  = 0,
  aId          = "A",
  bId          = "B",
): ObbSatResult {
  // ── 1. Validate inputs ────────────────────────────────────────────────────
  assertFiniteRect(aRect, aId);
  assertFiniteRect(bRect, bId);

  if (!Number.isFinite(aRotationDeg)) {
    throw new Error(
      `LAYOUT_ELEMENT_GEOMETRY_INVALID: element "${aId}" has non-finite rotation`,
    );
  }
  if (!Number.isFinite(bRotationDeg)) {
    throw new Error(
      `LAYOUT_ELEMENT_GEOMETRY_INVALID: element "${bId}" has non-finite rotation`,
    );
  }

  // Negative / non-finite clearance is silently normalised to 0 (per owner decision)
  const safeClearance = Number.isFinite(clearancePx) && clearancePx >= 0 ? clearancePx : 0;

  // ── 2. Preserve visual dimensions; build collision envelopes ──────────────
  const envA = applyEnvelopeClearance(aRect, safeClearance);
  const envB = applyEnvelopeClearance(bRect, safeClearance);

  // Legacy output always uses original visual rects (never envelopes)
  const legacy = computeLegacyOverlapExtent(aRect, bRect);

  const rotationAware = aRotationDeg !== 0 || bRotationDeg !== 0;

  // ── 3. Rotation-aware AABB broad phase (WP-03B canonical) ─────────────────
  const aabbA = generateAABB(envA.x, envA.y, envA.width, envA.height, aRotationDeg);
  const aabbB = generateAABB(envB.x, envB.y, envB.width, envB.height, bRotationDeg);

  if (!aabbOverlap(aabbA, aabbB)) {
    // Broad-phase miss — SAT is not called
    return {
      collides:                 false,
      broadPhasePassed:         false,
      algorithm:                "aabb-miss",
      rotationAware,
      penetrationDepth:         0,
      collisionNormal:          null,
      minimumTranslationVector: null,
      legacyOverlapExtent:      legacy,
    };
  }

  // ── 4. OBB generation (WP-03B canonical) ──────────────────────────────────
  const pgA  = rectToPlacementGeometry(envA, aRotationDeg, aId);
  const pgB  = rectToPlacementGeometry(envB, bRotationDeg, bId);
  const obbA = generateOBB(pgA);
  const obbB = generateOBB(pgB);

  // ── 5. SAT narrow phase (WP-03B canonical) ────────────────────────────────
  const sat = satTest(obbA, obbB);

  if (!sat.overlaps) {
    // Broad phase passed but SAT found a separating axis
    return {
      collides:                 false,
      broadPhasePassed:         true,
      algorithm:                "obb-sat",
      rotationAware,
      penetrationDepth:         0,
      collisionNormal:          sat.separatingAxis ?? null,
      minimumTranslationVector: null,
      legacyOverlapExtent:      legacy,
    };
  }

  // ── 6. Derive MTV ─────────────────────────────────────────────────────────
  // sat.minOverlapAxis is guaranteed non-null when sat.overlaps = true
  const axis  = sat.minOverlapAxis!;
  const depth = sat.overlapDepth;
  const mtv   = deriveMTV(obbA, obbB, axis, depth);

  return {
    collides:                 true,
    broadPhasePassed:         true,
    algorithm:                "obb-sat",
    rotationAware,
    penetrationDepth:         depth,
    collisionNormal:          axis,
    minimumTranslationVector: mtv,
    legacyOverlapExtent:      legacy,
  };
}

/**
 * Convenience overload accepting LayoutElement-like objects directly.
 * Uses `element.rotation ?? 0` for each element's rotation.
 *
 * @param a           Element A (must have id, x, y, width, height; rotation optional)
 * @param b           Element B
 * @param clearancePx Uniform clearance in pixels (default 0)
 */
export function obbSatCollideElements(
  a: { id: string; x: number; y: number; width: number; height: number; rotation?: number },
  b: { id: string; x: number; y: number; width: number; height: number; rotation?: number },
  clearancePx = 0,
): ObbSatResult {
  return obbSatCollide(
    { x: a.x, y: a.y, width: a.width, height: a.height },
    { x: b.x, y: b.y, width: b.width, height: b.height },
    a.rotation ?? 0,
    b.rotation ?? 0,
    clearancePx,
    a.id,
    b.id,
  );
}
