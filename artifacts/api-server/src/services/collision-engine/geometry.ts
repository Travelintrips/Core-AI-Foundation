/**
 * WP-03B — Collision Engine: Geometry Primitives
 *
 * Pure functions — no side effects, no DB access.
 * All angles in degrees. All distances in centimetres.
 */

import type { Point2D, Vector2D } from "./types.js";

// ── Vector operations ─────────────────────────────────────────────────────────

export function vecAdd(a: Vector2D, b: Vector2D): Vector2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vecSub(a: Vector2D, b: Vector2D): Vector2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vecScale(v: Vector2D, s: number): Vector2D {
  return { x: v.x * s, y: v.y * s };
}

export function dotProduct(a: Vector2D, b: Vector2D): number {
  return a.x * b.x + a.y * b.y;
}

export function vecLength(v: Vector2D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Returns zero vector if length is 0 — safe normalisation. */
export function normalize(v: Vector2D): Vector2D {
  const len = vecLength(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vecPerp(v: Vector2D): Vector2D {
  return { x: -v.y, y: v.x };
}

// ── Angle utilities ───────────────────────────────────────────────────────────

/** Normalise degrees to [0, 360). Handles negatives and values ≥ 360. */
export function normalizeDeg(deg: number): number {
  const mod = deg % 360;
  // Handle -0 (e.g. -360 % 360 = -0 in JS) — convert to +0
  const result = mod < 0 ? mod + 360 : mod;
  return result === 0 ? 0 : result;
}

const DEG_TO_RAD = Math.PI / 180;

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

// ── Rectangle helpers ─────────────────────────────────────────────────────────

/**
 * Returns the geometric center of a placement bounding box.
 * xCm, yCm = top-left corner of the un-rotated box.
 */
export function rectCenter(xCm: number, yCm: number, widthCm: number, depthCm: number): Point2D {
  return {
    x: xCm + widthCm / 2,
    y: yCm + depthCm / 2,
  };
}

/**
 * Rotate a point around a pivot by `deg` degrees (clockwise).
 * Returns the rotated point.
 */
export function rotatePoint(point: Point2D, pivot: Point2D, deg: number): Point2D {
  if (deg === 0) return point;
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

/**
 * Returns the four rotated corners of a placement bounding box.
 * Rotation is applied around the geometric center.
 *
 * Order: [topLeft, topRight, bottomRight, bottomLeft] (before rotation).
 * After rotation, corners retain this order but are in world space.
 */
export function rotatedCorners(
  xCm:         number,
  yCm:         number,
  widthCm:     number,
  depthCm:     number,
  rotationDeg: number,
): [Point2D, Point2D, Point2D, Point2D] {
  const center = rectCenter(xCm, yCm, widthCm, depthCm);
  const deg = normalizeDeg(rotationDeg);

  const tl: Point2D = { x: xCm,               y: yCm };
  const tr: Point2D = { x: xCm + widthCm,     y: yCm };
  const br: Point2D = { x: xCm + widthCm,     y: yCm + depthCm };
  const bl: Point2D = { x: xCm,               y: yCm + depthCm };

  return [
    rotatePoint(tl, center, deg),
    rotatePoint(tr, center, deg),
    rotatePoint(br, center, deg),
    rotatePoint(bl, center, deg),
  ];
}

/**
 * Returns the two face-normal axes of an OBB (unit vectors).
 * These are the local X axis and local Y axis after rotation.
 */
export function obbAxes(rotationDeg: number): [Vector2D, Vector2D] {
  const rad = degToRad(normalizeDeg(rotationDeg));
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const axisX: Vector2D = { x: cos, y: sin };
  const axisY: Vector2D = { x: -sin, y: cos };
  return [axisX, axisY];
}
