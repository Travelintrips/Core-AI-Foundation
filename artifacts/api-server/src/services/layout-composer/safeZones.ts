// ============================================================
// TEAM 12 — Safe Zone Enforcement
// Ensures elements stay within canvas and declared safe zone
// ============================================================

import type { LayoutElement, LayoutCanvas, Rect, Padding } from "../../types/layout-composer/index.js";
import { clampToRect } from "./collisionDetection.js";

/** Build the effective content rect after applying canvas padding */
export function contentRect(canvas: LayoutCanvas): Rect {
  const p = canvas.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    x: p.left,
    y: p.top,
    width: canvas.width - p.left - p.right,
    height: canvas.height - p.top - p.bottom,
  };
}

/** The operative safe zone (explicit safeZone beats padded contentRect) */
export function activeSafeZone(canvas: LayoutCanvas): Rect {
  if (canvas.safeZone) return canvas.safeZone;
  return contentRect(canvas);
}

/**
 * Clamp element to safe zone.
 * Returns {changed, x, y, width, height} — width/height may shrink if element
 * is larger than the safe zone.
 */
export function clampToSafeZone(
  el: LayoutElement,
  canvas: LayoutCanvas
): { changed: boolean; x: number; y: number; width: number; height: number } {
  const zone = activeSafeZone(canvas);
  const clamped = clampToRect(el, zone);

  const changed =
    clamped.x !== el.x ||
    clamped.y !== el.y ||
    clamped.width !== el.width ||
    clamped.height !== el.height;

  return { changed, ...clamped };
}

/** True if element is fully inside the safe zone */
export function isInSafeZone(el: LayoutElement, canvas: LayoutCanvas): boolean {
  const zone = activeSafeZone(canvas);
  return (
    el.x >= zone.x &&
    el.y >= zone.y &&
    el.x + el.width <= zone.x + zone.width &&
    el.y + el.height <= zone.y + zone.height
  );
}

/**
 * Describe how much an element violates the safe zone (px outside on each edge).
 * Positive values = violation.
 */
export function safeZoneViolation(
  el: LayoutElement,
  canvas: LayoutCanvas
): { top: number; right: number; bottom: number; left: number; hasViolation: boolean } {
  const zone = activeSafeZone(canvas);

  const left = zone.x - el.x;                              // how much el bleeds left
  const top = zone.y - el.y;                               // how much el bleeds above
  const right = (el.x + el.width) - (zone.x + zone.width); // how much el bleeds right
  const bottom = (el.y + el.height) - (zone.y + zone.height);

  return {
    top: Math.max(0, top),
    right: Math.max(0, right),
    bottom: Math.max(0, bottom),
    left: Math.max(0, left),
    hasViolation: left > 0 || top > 0 || right > 0 || bottom > 0,
  };
}

/** Apply inner padding to a group/container element — return child safe rect */
export function innerRect(container: LayoutElement, padding: Partial<Padding>): Rect {
  const t = padding.top ?? 0;
  const r = padding.right ?? 0;
  const b = padding.bottom ?? 0;
  const l = padding.left ?? 0;

  return {
    x: container.x + l,
    y: container.y + t,
    width: container.width - l - r,
    height: container.height - t - b,
  };
}
