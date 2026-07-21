/**
 * design-workspace/utils/transform.ts
 * Pure (no React, no DOM) viewport transform utilities.
 * All functions are deterministic and fully testable.
 */

import type { CanvasTransform } from '../types';

export const CANVAS_MIN_SCALE = 0.05;
export const CANVAS_MAX_SCALE = 16;
export const CANVAS_PAN_STEP = 20; // px per keyboard arrow step
export const DEFAULT_TRANSFORM: CanvasTransform = { scale: 1, offsetX: 0, offsetY: 0 };

// ── Scale ─────────────────────────────────────────────────────────────────────

/** Clamp scale to the allowed range. */
export function clampScale(scale: number): number {
  // Only NaN is truly invalid; Infinity/-Infinity and 0/negatives are clamped.
  if (Number.isNaN(scale)) return 1;
  return Math.max(CANVAS_MIN_SCALE, Math.min(CANVAS_MAX_SCALE, scale));
}

// ── Clamp transform ───────────────────────────────────────────────────────────

/**
 * Clamp pan offsets so at least `margin` px of content stays visible
 * inside the viewport.
 */
export function clampTransform(
  transform: CanvasTransform,
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
  margin = 40,
): CanvasTransform {
  if (viewportW <= 0 || viewportH <= 0 || contentW <= 0 || contentH <= 0) {
    return transform;
  }
  const scaledW = contentW * transform.scale;
  const scaledH = contentH * transform.scale;

  const minX = -(scaledW - margin);
  const maxX = viewportW - margin;
  const minY = -(scaledH - margin);
  const maxY = viewportH - margin;

  return {
    scale: transform.scale,
    offsetX: Math.max(minX, Math.min(maxX, transform.offsetX)),
    offsetY: Math.max(minY, Math.min(maxY, transform.offsetY)),
  };
}

// ── Fit ───────────────────────────────────────────────────────────────────────

/**
 * Calculate the transform that fits content inside the viewport with padding,
 * maintaining aspect ratio.
 */
export function calculateFitTransform(
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
  padding = 24,
): CanvasTransform {
  if (viewportW <= 0 || viewportH <= 0 || contentW <= 0 || contentH <= 0) {
    return DEFAULT_TRANSFORM;
  }
  const availW = Math.max(1, viewportW - padding * 2);
  const availH = Math.max(1, viewportH - padding * 2);
  const scale = clampScale(Math.min(availW / contentW, availH / contentH));
  const offsetX = (viewportW - contentW * scale) / 2;
  const offsetY = (viewportH - contentH * scale) / 2;
  return { scale, offsetX, offsetY };
}

/**
 * Center content at 1:1 scale.
 */
export function calculateCenterTransform(
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
): CanvasTransform {
  return {
    scale: 1,
    offsetX: (viewportW - contentW) / 2,
    offsetY: (viewportH - contentH) / 2,
  };
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetTransform(): CanvasTransform {
  return { ...DEFAULT_TRANSFORM };
}

// ── Zoom around focal point ───────────────────────────────────────────────────

/**
 * Zoom to `nextScale` keeping the point (focalX, focalY) stationary in the
 * viewport. Focal point is in viewport (screen) coordinates.
 */
export function zoomAroundPoint(
  transform: CanvasTransform,
  nextScale: number,
  focalX: number,
  focalY: number,
): CanvasTransform {
  const clamped = clampScale(nextScale);
  const ratio = clamped / transform.scale;
  return {
    scale: clamped,
    offsetX: focalX - ratio * (focalX - transform.offsetX),
    offsetY: focalY - ratio * (focalY - transform.offsetY),
  };
}

// ── Keyboard pan ──────────────────────────────────────────────────────────────

/**
 * Pan by (dx, dy) steps. dx/dy are in step units; multiply by CANVAS_PAN_STEP.
 */
export function panByKeyboard(
  transform: CanvasTransform,
  dx: number,
  dy: number,
): CanvasTransform {
  return {
    ...transform,
    offsetX: transform.offsetX + dx * CANVAS_PAN_STEP,
    offsetY: transform.offsetY + dy * CANVAS_PAN_STEP,
  };
}

// ── CSS transform string ──────────────────────────────────────────────────────

/**
 * Convert a CanvasTransform into a CSS transform string for use on the
 * content container element.
 */
export function transformToCss(t: CanvasTransform): string {
  return `translate(${t.offsetX}px, ${t.offsetY}px) scale(${t.scale})`;
}

// ── Serialization ─────────────────────────────────────────────────────────────

export function serializeTransform(t: CanvasTransform): string {
  return JSON.stringify(t);
}

export function deserializeTransform(s: string): CanvasTransform | null {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'scale' in parsed &&
      'offsetX' in parsed &&
      'offsetY' in parsed
    ) {
      const p = parsed as Record<string, unknown>;
      if (
        typeof p.scale === 'number' &&
        typeof p.offsetX === 'number' &&
        typeof p.offsetY === 'number'
      ) {
        return {
          scale: clampScale(p.scale),
          offsetX: p.offsetX,
          offsetY: p.offsetY,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
