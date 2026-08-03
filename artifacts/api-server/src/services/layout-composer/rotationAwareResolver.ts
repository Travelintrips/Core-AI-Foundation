/**
 * WP-04B — Rotation-Aware Collision Resolver
 *
 * Upgrades the no_collision constraint handler from AABB-only (WP-03C) to
 * OBB/SAT with MTV-based resolution when any element carries a non-zero rotation.
 *
 * Design invariants:
 *   - ALL geometry delegates to WP-04A (obbSatAdapter). No inline geometry.
 *   - Position arithmetic uses raw floats — this module NEVER rounds.
 *     Rounding is the caller's responsibility (apply at op.after level only).
 *   - Locked elements are never moved.
 *   - MTV convention follows WP-04A owner decision:
 *       resolvedA = originalA + mtv
 *       resolvedB = originalB − mtv
 *   - Self-comparison is excluded (i < j loop).
 *   - Both-locked pairs: detection still runs, resolution is a no-op.
 *
 * @module rotationAwareResolver
 */

import { obbSatCollideElements, type ObbSatResult } from "./obbSatAdapter.js";
import type { LayoutElement } from "../../types/layout-composer/index.js";

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * A collision pair detected by the OBB/SAT broad + narrow phase.
 * `collisionResult` carries the MTV used for resolution.
 */
export interface RotationAwarePair {
  elementA: string;
  elementB: string;
  penetrationDepth: number;
  /** Full OBB/SAT result — passed directly to resolveRotationAwareCollision. */
  collisionResult: ObbSatResult;
}

/**
 * Raw (float) positional adjustment for a single element.
 * Values are never rounded — the caller decides when to round.
 */
export interface RawPositionAdjustment {
  dx: number;
  dy: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Normalises negative zero to positive zero.
 * JavaScript IEEE-754 distinguishes −0 from +0, causing deep-equality failures.
 * Applied to all dx/dy values before they leave this module — same convention
 * used in WP-03B geometry.ts.
 */
function nz(n: number): number {
  return n === 0 ? 0 : n;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns true if at least one element in the set has a non-zero rotation.
 *
 * When false, the caller SHOULD use the existing AABB resolver (unchanged
 * behaviour). When true, OBB/SAT is required for correct collision geometry.
 */
export function requiresRotationAwareResolution(elements: LayoutElement[]): boolean {
  return elements.some((el) => (el.rotation ?? 0) !== 0);
}

/**
 * Detects all colliding element pairs using OBB/SAT broad + narrow phase.
 *
 * Elements are read at their current positions as passed in — the caller is
 * responsible for supplying up-to-date float positions (see float-shadow
 * pattern in constraintSolver).
 *
 * @param elements    Elements at their current float positions.
 * @param clearancePx Uniform clearance added to each element's collision
 *                    envelope in pixels. Negative values are silently
 *                    normalised to 0 by obbSatAdapter.
 * @returns           All pairs where OBB/SAT narrow phase confirms overlap.
 */
export function findRotationAwareCollisions(
  elements: LayoutElement[],
  clearancePx = 0,
): RotationAwarePair[] {
  const pairs: RotationAwarePair[] = [];

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];

      const result = obbSatCollideElements(
        {
          id:       a.id,
          x:        a.x,
          y:        a.y,
          width:    a.width,
          height:   a.height,
          rotation: a.rotation ?? 0,
        },
        {
          id:       b.id,
          x:        b.x,
          y:        b.y,
          width:    b.width,
          height:   b.height,
          rotation: b.rotation ?? 0,
        },
        clearancePx,
      );

      if (result.collides) {
        pairs.push({
          elementA:         a.id,
          elementB:         b.id,
          penetrationDepth: result.penetrationDepth,
          collisionResult:  result,
        });
      }
    }
  }

  return pairs;
}

/**
 * Resolves a single collision pair using the OBB/SAT MTV.
 *
 * MTV distribution rules:
 *   - Both movable → each element receives ½ MTV (equal split).
 *   - A locked, B movable → B receives the full negated MTV.
 *   - B locked, A movable → A receives the full MTV.
 *   - Both locked → empty result (caller skips the op).
 *
 * IMPORTANT: returned dx/dy are raw floats.
 * The caller MUST update its float-position shadow with these raw values,
 * and MUST only pass Math.round(floatPos + raw) to op.after.
 *
 * @param a      Element A at its current float position.
 * @param b      Element B at its current float position.
 * @param result ObbSatResult for this pair (must satisfy result.collides === true).
 * @returns      Record keyed by element id; absent key = element does not move.
 */
export function resolveRotationAwareCollision(
  a: LayoutElement,
  b: LayoutElement,
  result: ObbSatResult,
): Record<string, RawPositionAdjustment> {
  const adjustments: Record<string, RawPositionAdjustment> = {};

  if (!result.collides || !result.minimumTranslationVector) return adjustments;

  const { x: mtvX, y: mtvY } = result.minimumTranslationVector;

  if (!a.locked && !b.locked) {
    // Both movable: split MTV evenly
    adjustments[a.id] = { dx: nz( mtvX * 0.5), dy: nz( mtvY * 0.5) };
    adjustments[b.id] = { dx: nz(-mtvX * 0.5), dy: nz(-mtvY * 0.5) };
  } else if (!a.locked) {
    // A is movable, B is locked → A takes full MTV
    adjustments[a.id] = { dx: nz(mtvX), dy: nz(mtvY) };
  } else if (!b.locked) {
    // B is movable, A is locked → B takes negated MTV
    adjustments[b.id] = { dx: nz(-mtvX), dy: nz(-mtvY) };
  }
  // Both locked → no adjustment (already empty)

  return adjustments;
}
