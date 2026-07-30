// ============================================================
// TEAM 12 — Collision Detection
// AABB overlap detection and resolution
//
// Overlap detection delegates to WP-03B (collision-engine) via
// collisionAdapter.ts. Do NOT add a second AABB implementation here.
//
// ── Known Limitations ────────────────────────────────────────
// 1. Axis-aligned only: collision detection uses each element's
//    axis-aligned bounding box (AABB). The `rotation` field on
//    LayoutElement is stored but does NOT affect collision geometry.
//    Two rotated elements are tested as if rotation = 0.
//
// 2. Consequence: a rotated element may appear to collide when
//    its corners do not actually overlap, or may not collide when
//    its rotated corners do. This is a known, documented gap.
//
// 3. Planned fix: full OBB (Oriented Bounding Box) support using
//    WP-03B's SAT engine will be added in a future work package.
//    WP-03B already provides `generateOBB` + `satTest` for this.
// ============================================================

import type { LayoutElement, CollisionPair, Rect } from "../../types/layout-composer/index.js";
import { rectsOverlapViaWP03B } from "./collisionAdapter.js";

/**
 * Returns the axis-aligned bounding rect of an element.
 *
 * Known Limitation: `rotation` is intentionally ignored. Collision
 * detection is axis-aligned only. See module header for full details.
 */
export function elementRect(el: LayoutElement): Rect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/**
 * True if two rects overlap (touching edges do NOT count as collision).
 * Delegates to WP-03B's canonical AABB overlap via collisionAdapter.
 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return rectsOverlapViaWP03B(a, b);
}

/** Returns overlap extents (> 0 means collision on that axis) */
export function overlapExtent(
  a: Rect,
  b: Rect
): { overlapX: number; overlapY: number } {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { overlapX, overlapY };
}

/** Find all colliding pairs among a list of elements */
export function findAllCollisions(elements: LayoutElement[]): CollisionPair[] {
  const pairs: CollisionPair[] = [];

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];

      // Skip locked-vs-locked: we'll still report but won't resolve
      const rectA = elementRect(a);
      const rectB = elementRect(b);

      if (!rectsOverlap(rectA, rectB)) continue;

      const { overlapX, overlapY } = overlapExtent(rectA, rectB);

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

/** Check if a single element collides with any other element */
export function elementCollidesWith(
  target: LayoutElement,
  others: LayoutElement[]
): CollisionPair[] {
  return findAllCollisions([target, ...others]).filter(
    (p) => p.elementA === target.id || p.elementB === target.id
  );
}

/**
 * Resolve collisions by pushing elements apart along the minimum penetration axis.
 * Returns a map of elementId → {dx, dy} adjustments.
 * Locked elements are not moved (the other element absorbs the full push).
 */
export function resolveCollision(
  a: LayoutElement,
  b: LayoutElement
): Record<string, { dx: number; dy: number }> {
  const rectA = elementRect(a);
  const rectB = elementRect(b);

  if (!rectsOverlap(rectA, rectB)) return {};

  const { overlapX, overlapY } = overlapExtent(rectA, rectB);
  const result: Record<string, { dx: number; dy: number }> = {};

  // Push along minimum penetration axis
  if (overlapX <= overlapY) {
    // Resolve horizontally
    const push = overlapX / 2;
    const aIsLeft = a.x + a.width / 2 < b.x + b.width / 2;

    if (a.locked && b.locked) {
      // Both locked — cannot resolve
      return {};
    } else if (a.locked) {
      result[b.id] = { dx: aIsLeft ? push * 2 : -push * 2, dy: 0 };
    } else if (b.locked) {
      result[a.id] = { dx: aIsLeft ? -push * 2 : push * 2, dy: 0 };
    } else {
      result[a.id] = { dx: aIsLeft ? -push : push, dy: 0 };
      result[b.id] = { dx: aIsLeft ? push : -push, dy: 0 };
    }
  } else {
    // Resolve vertically
    const push = overlapY / 2;
    const aIsAbove = a.y + a.height / 2 < b.y + b.height / 2;

    if (a.locked && b.locked) {
      return {};
    } else if (a.locked) {
      result[b.id] = { dx: 0, dy: aIsAbove ? push * 2 : -push * 2 };
    } else if (b.locked) {
      result[a.id] = { dx: 0, dy: aIsAbove ? -push * 2 : push * 2 };
    } else {
      result[a.id] = { dx: 0, dy: aIsAbove ? -push : push };
      result[b.id] = { dx: 0, dy: aIsAbove ? push : -push };
    }
  }

  return result;
}

/** Check if an element is fully contained within a rect */
export function isContainedIn(el: LayoutElement, container: Rect): boolean {
  return (
    el.x >= container.x &&
    el.y >= container.y &&
    el.x + el.width <= container.x + container.width &&
    el.y + el.height <= container.y + container.height
  );
}

/** Clamp element within container rect; returns clamped position/size */
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
