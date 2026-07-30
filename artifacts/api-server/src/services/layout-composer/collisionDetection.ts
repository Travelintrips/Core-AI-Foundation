// ============================================================
// TEAM 12 — Collision Detection: WP-03B Adapter
//
// Delegates all AABB overlap detection to WP-03B's canonical
// collision engine (services/collision-engine).
//
// No duplicate algorithm — layout-composer domain types are
// converted to WP-03B AABB format then delegated.
//
// Benefits over previous axis-aligned-only implementation:
// - WP-03B generateAABB handles rotation: LayoutElement.rotation
//   is now respected in AABB computation.
// - Single canonical source of truth for overlap semantics
//   (COLLISION_EPSILON, edge-touch policy).
// ============================================================

import { aabbOverlap, generateAABB } from "../collision-engine/aabb.js";
import type { AABB } from "../collision-engine/types.js";
import type { LayoutElement, CollisionPair, Rect } from "../../types/layout-composer/index.js";

// ── Domain conversion ─────────────────────────────────────────

/**
 * Convert a LayoutElement to WP-03B AABB.
 * Uses generateAABB so rotation (if set) correctly expands the bounding box.
 */
function elementToAABB(el: LayoutElement): AABB {
  return generateAABB(el.x, el.y, el.width, el.height, el.rotation ?? 0);
}

/** Convert an axis-aligned Rect to WP-03B AABB (no rotation). */
function rectToAABB(r: Rect): AABB {
  return { minX: r.x, maxX: r.x + r.width, minY: r.y, maxY: r.y + r.height };
}

// ── Public API ────────────────────────────────────────────────

/** Returns the bounding rect of an element (snapshot; ignores rotation). */
export function elementRect(el: LayoutElement): Rect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/**
 * True if two rects overlap (touching edges do NOT count as collision).
 * Delegates edge-touch policy to WP-03B aabbOverlap / COLLISION_EPSILON.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return aabbOverlap(rectToAABB(a), rectToAABB(b));
}

/** Returns overlap extents (> 0 means collision on that axis). */
export function overlapExtent(
  a: Rect,
  b: Rect
): { overlapX: number; overlapY: number } {
  const aabbA = rectToAABB(a);
  const aabbB = rectToAABB(b);
  return {
    overlapX: Math.min(aabbA.maxX, aabbB.maxX) - Math.max(aabbA.minX, aabbB.minX),
    overlapY: Math.min(aabbA.maxY, aabbB.maxY) - Math.max(aabbA.minY, aabbB.minY),
  };
}

/**
 * Find all colliding pairs among a list of elements.
 * Rotation-aware: AABB is computed via WP-03B generateAABB.
 */
export function findAllCollisions(elements: LayoutElement[]): CollisionPair[] {
  const pairs: CollisionPair[] = [];

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i]!;
      const b = elements[j]!;
      const aabbA = elementToAABB(a);
      const aabbB = elementToAABB(b);

      if (!aabbOverlap(aabbA, aabbB)) continue;

      const overlapX = Math.min(aabbA.maxX, aabbB.maxX) - Math.max(aabbA.minX, aabbB.minX);
      const overlapY = Math.min(aabbA.maxY, aabbB.maxY) - Math.max(aabbA.minY, aabbB.minY);

      if (overlapX > 0 && overlapY > 0) {
        pairs.push({
          elementA: a.id,
          elementB: b.id,
          overlapX,
          overlapY,
          overlapArea: overlapX * overlapY,
        });
      }
    }
  }

  return pairs;
}

/** Check if a single element collides with any other element. */
export function elementCollidesWith(
  target: LayoutElement,
  others: LayoutElement[]
): CollisionPair[] {
  return findAllCollisions([target, ...others]).filter(
    (p) => p.elementA === target.id || p.elementB === target.id
  );
}

/**
 * Resolve collision by pushing elements apart along the minimum penetration axis.
 * Returns a map of elementId => {dx, dy} adjustments.
 * Locked elements are not moved; the other element absorbs the full push.
 *
 * Known limitation: push vectors are axis-aligned (horizontal / vertical).
 * For rotated elements the push direction is not perpendicular to the rotated
 * face. See knownLimitations.rotation in integration/manifests/team-12.json.
 *
 * AABB centers are used for push direction — correct even for rotated elements.
 */
export function resolveCollision(
  a: LayoutElement,
  b: LayoutElement
): Record<string, { dx: number; dy: number }> {
  const aabbA = elementToAABB(a);
  const aabbB = elementToAABB(b);

  if (!aabbOverlap(aabbA, aabbB)) return {};

  const overlapX = Math.min(aabbA.maxX, aabbB.maxX) - Math.max(aabbA.minX, aabbB.minX);
  const overlapY = Math.min(aabbA.maxY, aabbB.maxY) - Math.max(aabbA.minY, aabbB.minY);
  const result: Record<string, { dx: number; dy: number }> = {};

  const aCenterX = (aabbA.minX + aabbA.maxX) / 2;
  const bCenterX = (aabbB.minX + aabbB.maxX) / 2;
  const aCenterY = (aabbA.minY + aabbA.maxY) / 2;
  const bCenterY = (aabbB.minY + aabbB.maxY) / 2;

  if (overlapX <= overlapY) {
    const push = overlapX / 2;
    const aIsLeft = aCenterX < bCenterX;
    if (a.locked && b.locked) return {};
    else if (a.locked) result[b.id] = { dx: aIsLeft ? push * 2 : -push * 2, dy: 0 };
    else if (b.locked) result[a.id] = { dx: aIsLeft ? -push * 2 : push * 2, dy: 0 };
    else {
      result[a.id] = { dx: aIsLeft ? -push : push, dy: 0 };
      result[b.id] = { dx: aIsLeft ? push : -push, dy: 0 };
    }
  } else {
    const push = overlapY / 2;
    const aIsAbove = aCenterY < bCenterY;
    if (a.locked && b.locked) return {};
    else if (a.locked) result[b.id] = { dx: 0, dy: aIsAbove ? push * 2 : -push * 2 };
    else if (b.locked) result[a.id] = { dx: 0, dy: aIsAbove ? -push * 2 : push * 2 };
    else {
      result[a.id] = { dx: 0, dy: aIsAbove ? -push : push };
      result[b.id] = { dx: 0, dy: aIsAbove ? push : -push };
    }
  }

  return result;
}

/** Check if an element is fully contained within a rect. */
export function isContainedIn(el: LayoutElement, container: Rect): boolean {
  const aabbEl = elementToAABB(el);
  const aabbC = rectToAABB(container);
  return (
    aabbEl.minX >= aabbC.minX &&
    aabbEl.minY >= aabbC.minY &&
    aabbEl.maxX <= aabbC.maxX &&
    aabbEl.maxY <= aabbC.maxY
  );
}

/**
 * Clamp element within container rect; returns clamped position/size.
 * Uses the element's unrotated x/y/width/height for clamping position.
 */
export function clampToRect(
  el: LayoutElement,
  container: Rect
): { x: number; y: number; width: number; height: number } {
  const maxW = container.width;
  const maxH = container.height;
  const width = Math.min(el.width, maxW);
  const height = Math.min(el.height, maxH);
  const x = Math.max(container.x, Math.min(el.x, container.x + maxW - width));
  const y = Math.max(container.y, Math.min(el.y, container.y + maxH - height));
  return { x, y, width, height };
}
