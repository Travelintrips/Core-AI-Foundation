/**
 * Workspace Snap & Alignment (Team 19)
 *
 * Pure calculation module — no rendering, no domain-specific measurement engine.
 * Provides:
 * - Snap point generation from element bounds
 * - Snap threshold detection
 * - Alignment (left / center-h / right / top / center-v / bottom)
 * - Distribution (horizontal / vertical)
 * - Bounding box utilities
 */

import type {
  BoundingBox,
  SnapPoint,
  SnapGuide,
  AlignTarget,
  AlignDirection,
  DistributeAxis,
} from "./types";

// ── Bounding box helpers ───────────────────────────────────────────────────────

export function unionBounds(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function centerX(b: BoundingBox): number {
  return b.x + b.width / 2;
}

export function centerY(b: BoundingBox): number {
  return b.y + b.height / 2;
}

// ── Snap points ───────────────────────────────────────────────────────────────

/**
 * Generate snap points for an element's bounds:
 * left edge, right edge, center-x, top edge, bottom edge, center-y.
 */
export function getElementSnapPoints(
  id: string,
  bounds: BoundingBox,
): SnapPoint[] {
  return [
    { x: bounds.x, y: bounds.y, axis: "x", source: `${id}:left` },
    { x: bounds.x + bounds.width, y: bounds.y, axis: "x", source: `${id}:right` },
    { x: centerX(bounds), y: bounds.y, axis: "x", source: `${id}:center-x` },
    { x: bounds.x, y: bounds.y, axis: "y", source: `${id}:top` },
    { x: bounds.x, y: bounds.y + bounds.height, axis: "y", source: `${id}:bottom` },
    { x: bounds.x, y: centerY(bounds), axis: "y", source: `${id}:center-y` },
  ];
}

/**
 * Generate snap points from a SnapGuide (axis-parallel guide line).
 */
export function getGuideSnapPoints(guide: SnapGuide): SnapPoint[] {
  if (guide.axis === "horizontal") {
    return [{ x: 0, y: guide.position, axis: "y", source: `guide:h:${guide.position}` }];
  }
  return [{ x: guide.position, y: 0, axis: "x", source: `guide:v:${guide.position}` }];
}

export type SnapResult = {
  snapped: boolean;
  x: number;
  y: number;
  activeGuides: SnapPoint[];
};

/**
 * Snap a point (px, py) to the nearest candidate snap point within threshold.
 * Returns the adjusted position and any active snap guides.
 */
export function snapToPoints(
  px: number,
  py: number,
  candidates: SnapPoint[],
  threshold: number,
): SnapResult {
  let snapX = px;
  let snapY = py;
  let snappedX = false;
  let snappedY = false;
  const activeGuides: SnapPoint[] = [];

  let bestXDist = threshold + 1;
  let bestYDist = threshold + 1;

  for (const pt of candidates) {
    if (pt.axis === "x" || pt.axis === "both") {
      const dist = Math.abs(px - pt.x);
      if (dist <= threshold && dist < bestXDist) {
        snapX = pt.x;
        bestXDist = dist;
        snappedX = true;
        // Remove previous x snaps, add this one
        const filtered = activeGuides.filter((g) => g.axis !== "x" && g.axis !== "both");
        activeGuides.length = 0;
        activeGuides.push(...filtered, pt);
      }
    }
    if (pt.axis === "y" || pt.axis === "both") {
      const dist = Math.abs(py - pt.y);
      if (dist <= threshold && dist < bestYDist) {
        snapY = pt.y;
        bestYDist = dist;
        snappedY = true;
        const filtered = activeGuides.filter((g) => g.axis !== "y" && g.axis !== "both");
        activeGuides.length = 0;
        activeGuides.push(...filtered, pt);
      }
    }
  }

  return { snapped: snappedX || snappedY, x: snapX, y: snapY, activeGuides };
}

// ── Alignment ─────────────────────────────────────────────────────────────────

export type AlignResult = Map<string, Partial<BoundingBox>>;

/**
 * Compute alignment deltas for a set of targets along a direction.
 * Returns a map of id → patch (only the moved axis is included).
 */
export function computeAlignment(
  targets: AlignTarget[],
  direction: AlignDirection,
  containerBounds?: BoundingBox,
): AlignResult {
  if (targets.length === 0) return new Map();

  const result: AlignResult = new Map();
  const reference = containerBounds ?? unionBounds(targets.map((t) => t.bounds));

  for (const { id, bounds } of targets) {
    switch (direction) {
      case "left":
        result.set(id, { x: reference.x });
        break;
      case "center-h":
        result.set(id, { x: centerX(reference) - bounds.width / 2 });
        break;
      case "right":
        result.set(id, { x: reference.x + reference.width - bounds.width });
        break;
      case "top":
        result.set(id, { y: reference.y });
        break;
      case "center-v":
        result.set(id, { y: centerY(reference) - bounds.height / 2 });
        break;
      case "bottom":
        result.set(id, { y: reference.y + reference.height - bounds.height });
        break;
    }
  }

  return result;
}

// ── Distribution ──────────────────────────────────────────────────────────────

/**
 * Compute distribution positions for a set of targets along an axis.
 * Items are evenly spaced between the first and last item's positions.
 * Requires at least 3 items (nothing to distribute with fewer).
 */
export function computeDistribution(
  targets: AlignTarget[],
  axis: DistributeAxis,
): AlignResult {
  const result: AlignResult = new Map();
  if (targets.length < 3) return result;

  const sorted = [...targets].sort((a, b) =>
    axis === "horizontal"
      ? a.bounds.x - b.bounds.x
      : a.bounds.y - b.bounds.y,
  );

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  if (axis === "horizontal") {
    const totalWidth = sorted.reduce((sum, t) => sum + t.bounds.width, 0);
    const available = (last.bounds.x + last.bounds.width) - first.bounds.x - totalWidth;
    const gap = available / (sorted.length - 1);
    let cursor = first.bounds.x;
    for (const { id, bounds } of sorted) {
      result.set(id, { x: cursor });
      cursor += bounds.width + gap;
    }
  } else {
    const totalHeight = sorted.reduce((sum, t) => sum + t.bounds.height, 0);
    const available = (last.bounds.y + last.bounds.height) - first.bounds.y - totalHeight;
    const gap = available / (sorted.length - 1);
    let cursor = first.bounds.y;
    for (const { id, bounds } of sorted) {
      result.set(id, { y: cursor });
      cursor += bounds.height + gap;
    }
  }

  return result;
}

// ── Nudge ─────────────────────────────────────────────────────────────────────

export type NudgeDirection = "left" | "right" | "up" | "down";

/**
 * Compute nudge delta for a given direction and step size.
 */
export function computeNudge(
  direction: NudgeDirection,
  step: number,
): { dx: number; dy: number } {
  switch (direction) {
    case "left":  return { dx: -step, dy: 0 };
    case "right": return { dx: step,  dy: 0 };
    case "up":    return { dx: 0, dy: -step };
    case "down":  return { dx: 0, dy: step  };
  }
}
