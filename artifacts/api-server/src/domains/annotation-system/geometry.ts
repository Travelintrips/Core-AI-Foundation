/**
 * geometry.ts — Team 18 / Universal Annotation and Comment System
 *
 * Pure geometry utilities for annotation coordinate normalization and
 * transformation. All functions are stateless and dependency-free so they
 * can run in both server and (future) browser contexts.
 *
 * Normalized coordinates are in [0, 1] where:
 *   0,0 = top-left corner of the content area
 *   1,1 = bottom-right corner of the content area
 */
import type { AnnotationGeometry } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Viewport / size types
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewportSize {
  width:  number;
  height: number;
}

export interface NormalizedPoint {
  nx: number;
  ny: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface AnnotationBounds {
  nx:  number;
  ny:  number;
  nw:  number;
  nh:  number;
  /** nx + nw */
  nx2: number;
  /** ny + nh */
  ny2: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizePoint — convert pixel coordinates to [0,1] normalized space
// ─────────────────────────────────────────────────────────────────────────────

export function normalizePoint(
  x: number,
  y: number,
  viewport: ViewportSize,
): NormalizedPoint {
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("Viewport dimensions must be positive");
  }
  return {
    nx: x / viewport.width,
    ny: y / viewport.height,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// denormalizePoint — convert [0,1] normalized coordinates back to pixels
// ─────────────────────────────────────────────────────────────────────────────

export function denormalizePoint(
  point: NormalizedPoint,
  viewport: ViewportSize,
): PixelPoint {
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("Viewport dimensions must be positive");
  }
  return {
    x: point.nx * viewport.width,
    y: point.ny * viewport.height,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// clampAnchor — clamp all geometry coordinates to [0, 1]
// ─────────────────────────────────────────────────────────────────────────────

export function clampAnchor(geometry: AnnotationGeometry): AnnotationGeometry {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    ...geometry,
    nx: clamp(geometry.nx),
    ny: clamp(geometry.ny),
    ...(geometry.nw !== undefined ? { nw: clamp(geometry.nw) } : {}),
    ...(geometry.nh !== undefined ? { nh: clamp(geometry.nh) } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// transformAnchor — scale a geometry by independent x and y factors
// (useful for applying a zoom or aspect-ratio transformation)
// ─────────────────────────────────────────────────────────────────────────────

export function transformAnchor(
  geometry: AnnotationGeometry,
  scaleX: number,
  scaleY: number,
): AnnotationGeometry {
  return clampAnchor({
    ...geometry,
    nx: geometry.nx * scaleX,
    ny: geometry.ny * scaleY,
    ...(geometry.nw !== undefined ? { nw: geometry.nw * scaleX } : {}),
    ...(geometry.nh !== undefined ? { nh: geometry.nh * scaleY } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// validateGeometry — returns true if the geometry is well-formed
// ─────────────────────────────────────────────────────────────────────────────

export function validateGeometry(geometry: AnnotationGeometry): boolean {
  const inRange = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

  if (!inRange(geometry.nx) || !inRange(geometry.ny)) return false;

  if (geometry.type === "rectangle" || geometry.type === "region") {
    if (geometry.nw === undefined || geometry.nh === undefined) return false;
    if (!inRange(geometry.nw) || !inRange(geometry.nh)) return false;
    // Degenerate zero-area boxes are invalid
    if (geometry.nw === 0 && geometry.nh === 0) return false;
    // Must fit within the content area
    if (geometry.nx + geometry.nw > 1 + 1e-9) return false;
    if (geometry.ny + geometry.nh > 1 + 1e-9) return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateAnnotationBounds — returns the bounding box (for any type)
// ─────────────────────────────────────────────────────────────────────────────

export function calculateAnnotationBounds(
  geometry: AnnotationGeometry,
): AnnotationBounds {
  const nw = geometry.nw ?? 0;
  const nh = geometry.nh ?? 0;
  return {
    nx:  geometry.nx,
    ny:  geometry.ny,
    nw,
    nh,
    nx2: geometry.nx + nw,
    ny2: geometry.ny + nh,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// migrateAnchorBetweenViewportSizes — re-express normalized coordinates
// after the canonical content size changes (e.g. page reflow, DPI change).
//
// Because the coordinates are already normalized, the migration is a
// no-op for purely scale changes — the values remain valid. However when
// the aspect ratio of the content area changes (e.g. a portrait page is
// re-rendered as landscape), the relative positions of annotations shift.
// This function compensates by re-projecting through both pixel spaces.
// ─────────────────────────────────────────────────────────────────────────────

export function migrateAnchorBetweenViewportSizes(
  geometry: AnnotationGeometry,
  fromSize: ViewportSize,
  toSize: ViewportSize,
): AnnotationGeometry {
  if (fromSize.width <= 0 || fromSize.height <= 0 || toSize.width <= 0 || toSize.height <= 0) {
    throw new Error("Viewport dimensions must be positive for anchor migration");
  }
  // If aspect ratios match (within tolerance), coordinates are already valid.
  const fromRatio = fromSize.width / fromSize.height;
  const toRatio   = toSize.width  / toSize.height;
  if (Math.abs(fromRatio - toRatio) < 1e-6) return geometry;

  // Project to pixel space using fromSize, then back using toSize.
  const px = denormalizePoint({ nx: geometry.nx, ny: geometry.ny }, fromSize);
  const reprojected = normalizePoint(px.x, px.y, toSize);

  const result: AnnotationGeometry = { ...geometry, ...reprojected };

  if (geometry.nw !== undefined && geometry.nh !== undefined) {
    const pw = geometry.nw * fromSize.width;
    const ph = geometry.nh * fromSize.height;
    result.nw = pw / toSize.width;
    result.nh = ph / toSize.height;
  }

  return clampAnchor(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// detectOutsideContent — true if the annotation origin falls outside [0,1]
// ─────────────────────────────────────────────────────────────────────────────

export function detectOutsideContent(
  geometry: AnnotationGeometry,
  /** Optional content bounds; defaults to the full [0,1] space */
  contentBounds: AnnotationBounds = { nx: 0, ny: 0, nw: 1, nh: 1, nx2: 1, ny2: 1 },
): boolean {
  if (geometry.nx < contentBounds.nx || geometry.nx > contentBounds.nx2) return true;
  if (geometry.ny < contentBounds.ny || geometry.ny > contentBounds.ny2) return true;
  return false;
}
