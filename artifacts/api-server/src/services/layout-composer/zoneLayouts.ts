// ============================================================
// TEAM 12 — Zone Layouts
// Room/furniture zones and garment panel zones
// ============================================================

import type {
  LayoutElement,
  LayoutZone,
  Rect,
  SeamLine,
  Point,
  ConstraintViolation,
} from "../../types/layout-composer/index.js";
import { isContainedIn, clampToRect } from "./collisionDetection.js";

// ── Preset zone templates ────────────────────────────────────

/** Standard room zone template (percentages of canvas, resolved at runtime) */
export interface RoomTemplate {
  id: string;
  label: string;
  /** 0–1 fractions of canvas width/height */
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
  allowedTypes?: string[];
}

export const ROOM_ZONE_TEMPLATES: RoomTemplate[] = [
  { id: "living",    label: "Living Room",   xFrac: 0,    yFrac: 0,    wFrac: 0.5, hFrac: 0.6 },
  { id: "dining",    label: "Dining Room",   xFrac: 0.5,  yFrac: 0,    wFrac: 0.5, hFrac: 0.4 },
  { id: "kitchen",   label: "Kitchen",       xFrac: 0.5,  yFrac: 0.4,  wFrac: 0.5, hFrac: 0.3 },
  { id: "bedroom",   label: "Bedroom",       xFrac: 0,    yFrac: 0.6,  wFrac: 0.5, hFrac: 0.4 },
  { id: "bathroom",  label: "Bathroom",      xFrac: 0.5,  yFrac: 0.7,  wFrac: 0.5, hFrac: 0.3 },
  { id: "hallway",   label: "Hallway",       xFrac: 0,    yFrac: 0,    wFrac: 0.1, hFrac: 1.0 },
];

/** Standard garment panel zones (percentages of canvas) */
export const GARMENT_ZONE_TEMPLATES: RoomTemplate[] = [
  { id: "front-body",    label: "Front Body",    xFrac: 0.2,  yFrac: 0.05, wFrac: 0.6, hFrac: 0.55 },
  { id: "back-body",     label: "Back Body",     xFrac: 0.2,  yFrac: 0.6,  wFrac: 0.6, hFrac: 0.35 },
  { id: "left-sleeve",   label: "Left Sleeve",   xFrac: 0,    yFrac: 0.05, wFrac: 0.2, hFrac: 0.4  },
  { id: "right-sleeve",  label: "Right Sleeve",  xFrac: 0.8,  yFrac: 0.05, wFrac: 0.2, hFrac: 0.4  },
  { id: "collar",        label: "Collar",        xFrac: 0.35, yFrac: 0,    wFrac: 0.3, hFrac: 0.05 },
  { id: "left-pocket",   label: "Left Pocket",   xFrac: 0.22, yFrac: 0.3,  wFrac: 0.15, hFrac: 0.15 },
  { id: "right-pocket",  label: "Right Pocket",  xFrac: 0.63, yFrac: 0.3,  wFrac: 0.15, hFrac: 0.15 },
  { id: "hem",           label: "Hem",           xFrac: 0.1,  yFrac: 0.55, wFrac: 0.8, hFrac: 0.05 },
];

/** Resolve a RoomTemplate into an absolute LayoutZone given canvas dimensions */
export function resolveZoneTemplate(
  template: RoomTemplate,
  canvasWidth: number,
  canvasHeight: number,
  category: "room" | "garment" | "generic" = "generic"
): LayoutZone {
  return {
    id: template.id,
    label: template.label,
    category,
    rect: {
      x: Math.round(template.xFrac * canvasWidth),
      y: Math.round(template.yFrac * canvasHeight),
      width: Math.round(template.wFrac * canvasWidth),
      height: Math.round(template.hFrac * canvasHeight),
    },
  };
}

// ── Zone lookup ──────────────────────────────────────────────

export function findZoneById(zones: LayoutZone[], id: string): LayoutZone | undefined {
  return zones.find((z) => z.id === id);
}

/** Find which zone an element is assigned to (via el.zone) */
export function elementZone(
  el: LayoutElement,
  zones: LayoutZone[]
): LayoutZone | undefined {
  if (!el.zone) return undefined;
  return findZoneById(zones, el.zone);
}

// ── Room zone validation ─────────────────────────────────────

/**
 * Check that all elements with a zone assignment are within their zone rect.
 * Returns violations.
 */
export function validateRoomZones(
  elements: LayoutElement[],
  zones: LayoutZone[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const el of elements) {
    if (!el.zone) continue;
    const zone = findZoneById(zones, el.zone);
    if (!zone) {
      violations.push({
        constraintId: "room_zone",
        constraintType: "room_zone",
        elementIds: [el.id],
        message: `Element "${el.id}" assigned to unknown zone "${el.zone}"`,
        severity: "error",
      });
      continue;
    }

    if (!isContainedIn(el, zone.rect)) {
      violations.push({
        constraintId: "room_zone",
        constraintType: "room_zone",
        elementIds: [el.id],
        message: `Element "${el.id}" (furniture) is outside zone "${zone.label}"`,
        severity: "error",
        detail: {
          elementRect: { x: el.x, y: el.y, w: el.width, h: el.height },
          zoneRect: zone.rect,
        },
      });
    }
  }

  return violations;
}

/**
 * Clamp elements to their assigned zones.
 * Returns modified elements with adjustments.
 */
export function clampElementsToZones(
  elements: LayoutElement[],
  zones: LayoutZone[]
): { elements: LayoutElement[]; changed: string[] } {
  const changed: string[] = [];
  const updated = elements.map((el) => {
    if (!el.zone || el.locked) return el;

    const zone = findZoneById(zones, el.zone);
    if (!zone) return el;

    const clamped = clampToRect(el, zone.rect);
    const didChange =
      clamped.x !== el.x ||
      clamped.y !== el.y ||
      clamped.width !== el.width ||
      clamped.height !== el.height;

    if (didChange) {
      changed.push(el.id);
      return { ...el, ...clamped };
    }
    return el;
  });

  return { elements: updated, changed };
}

// ── Garment panel seam detection ─────────────────────────────

/**
 * Returns the perpendicular distance from point P to a line segment AB.
 * Used to check if an element corner is too close to a seam line.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}

// ── Segment-AABB intersection helpers ─────────────────────────

function pointInElement(p: Point, el: LayoutElement): boolean {
  return (
    p.x >= el.x &&
    p.x <= el.x + el.width &&
    p.y >= el.y &&
    p.y <= el.y + el.height
  );
}

function cross2d(o: Point, u: Point, v: Point): number {
  return (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross2d(c, d, a);
  const d2 = cross2d(c, d, b);
  const d3 = cross2d(a, b, c);
  const d4 = cross2d(a, b, d);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;

  return false;
}

/**
 * True if segment AB passes through (intersects with) the element's bounding box.
 */
function segmentIntersectsElement(a: Point, b: Point, el: LayoutElement): boolean {
  if (pointInElement(a, el) || pointInElement(b, el)) return true;

  // Check segment against all 4 edges of the bounding box
  const tl: Point = { x: el.x, y: el.y };
  const tr: Point = { x: el.x + el.width, y: el.y };
  const bl: Point = { x: el.x, y: el.y + el.height };
  const br: Point = { x: el.x + el.width, y: el.y + el.height };

  return (
    segmentsIntersect(a, b, tl, tr) || // top edge
    segmentsIntersect(a, b, tr, br) || // right edge
    segmentsIntersect(a, b, bl, br) || // bottom edge
    segmentsIntersect(a, b, tl, bl)    // left edge
  );
}

/**
 * Check if an element is crossed by a seam line.
 * Returns true if the seam segment passes through the element's bounding box,
 * OR if any corner is within `minDist` pixels of the seam.
 */
export function elementCrossesSeam(
  el: LayoutElement,
  seam: SeamLine,
  minDist = 2
): boolean {
  // Primary: does the seam segment pass through the element rect?
  if (segmentIntersectsElement(seam.from, seam.to, el)) return true;

  // Secondary: is any corner very close to the seam (within tolerance)?
  const corners: Point[] = [
    { x: el.x, y: el.y },
    { x: el.x + el.width, y: el.y },
    { x: el.x, y: el.y + el.height },
    { x: el.x + el.width, y: el.y + el.height },
  ];

  return corners.some(
    (corner) => distanceToSegment(corner, seam.from, seam.to) < minDist
  );
}

/**
 * Validate garment panel zones: panels must not cross their zone's seam lines.
 */
export function validateGarmentPanels(
  elements: LayoutElement[],
  zones: LayoutZone[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const el of elements) {
    if (!el.zone) continue;
    const zone = findZoneById(zones, el.zone);
    if (!zone?.seamLines?.length) continue;

    for (const seam of zone.seamLines) {
      if (elementCrossesSeam(el, seam)) {
        violations.push({
          constraintId: "garment_panel",
          constraintType: "garment_panel",
          elementIds: [el.id],
          message: `Panel "${el.id}" crosses seam line "${seam.id}" in zone "${zone.label}"`,
          severity: "error",
          detail: { seam },
        });
      }
    }
  }

  return violations;
}
