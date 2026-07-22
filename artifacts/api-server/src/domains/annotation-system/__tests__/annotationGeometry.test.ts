/**
 * annotationGeometry.test.ts — Team 18 / Geometry utilities
 *
 * Required tests: 1 (normalizePoint), 2 (clamp), 3 (resize migration), 4 (invalid geometry)
 */
import { describe, it, expect } from "vitest";
import {
  normalizePoint,
  denormalizePoint,
  clampAnchor,
  transformAnchor,
  validateGeometry,
  calculateAnnotationBounds,
  migrateAnchorBetweenViewportSizes,
  detectOutsideContent,
} from "../geometry.js";
import type { AnnotationGeometry } from "../types.js";

// ─── Test 1: normalizePoint ───────────────────────────────────────────────────

describe("normalizePoint", () => {
  it("converts pixel point to normalized [0,1] coordinates", () => {
    const vp = { width: 1920, height: 1080 };
    const result = normalizePoint(960, 540, vp);
    expect(result.nx).toBeCloseTo(0.5);
    expect(result.ny).toBeCloseTo(0.5);
  });

  it("returns 0,0 for top-left origin", () => {
    const vp = { width: 800, height: 600 };
    expect(normalizePoint(0, 0, vp)).toEqual({ nx: 0, ny: 0 });
  });

  it("returns 1,1 for bottom-right corner", () => {
    const vp = { width: 800, height: 600 };
    const r = normalizePoint(800, 600, vp);
    expect(r.nx).toBeCloseTo(1);
    expect(r.ny).toBeCloseTo(1);
  });

  it("throws on zero-width viewport", () => {
    expect(() => normalizePoint(100, 100, { width: 0, height: 600 })).toThrow();
  });
});

describe("denormalizePoint", () => {
  it("round-trips through normalizePoint", () => {
    const vp = { width: 1920, height: 1080 };
    const norm = normalizePoint(400, 300, vp);
    const px   = denormalizePoint(norm, vp);
    expect(px.x).toBeCloseTo(400);
    expect(px.y).toBeCloseTo(300);
  });
});

// ─── Test 2: clampAnchor ─────────────────────────────────────────────────────

describe("clampAnchor", () => {
  it("clamps out-of-range coordinates to [0,1]", () => {
    const g: AnnotationGeometry = { type: "point_pin", nx: -0.5, ny: 1.8 };
    const result = clampAnchor(g);
    expect(result.nx).toBe(0);
    expect(result.ny).toBe(1);
  });

  it("does not change in-range coordinates", () => {
    const g: AnnotationGeometry = { type: "rectangle", nx: 0.2, ny: 0.3, nw: 0.4, nh: 0.3 };
    const result = clampAnchor(g);
    expect(result.nx).toBe(0.2);
    expect(result.ny).toBe(0.3);
    expect(result.nw).toBe(0.4);
    expect(result.nh).toBe(0.3);
  });

  it("clamps rectangle dimensions independently", () => {
    const g: AnnotationGeometry = { type: "rectangle", nx: 0.1, ny: 0.1, nw: 2.0, nh: -0.5 };
    const result = clampAnchor(g);
    expect(result.nw).toBe(1);
    expect(result.nh).toBe(0);
  });

  it("preserves optional fields that are absent", () => {
    const g: AnnotationGeometry = { type: "point_pin", nx: 0.5, ny: 0.5 };
    const result = clampAnchor(g);
    expect(result.nw).toBeUndefined();
    expect(result.nh).toBeUndefined();
  });
});

describe("transformAnchor", () => {
  it("scales coordinates by independent x and y factors", () => {
    const g: AnnotationGeometry = { type: "point_pin", nx: 0.5, ny: 0.4 };
    const result = transformAnchor(g, 0.5, 2.0);
    expect(result.nx).toBeCloseTo(0.25);
    expect(result.ny).toBeCloseTo(0.8);
  });

  it("clamps result to [0,1] after scaling", () => {
    const g: AnnotationGeometry = { type: "point_pin", nx: 0.9, ny: 0.9 };
    const result = transformAnchor(g, 2, 2);
    expect(result.nx).toBe(1);
    expect(result.ny).toBe(1);
  });
});

// ─── Test 3: migrateAnchorBetweenViewportSizes ───────────────────────────────

describe("migrateAnchorBetweenViewportSizes", () => {
  it("is a no-op when aspect ratio is the same", () => {
    const g: AnnotationGeometry = { type: "point_pin", nx: 0.3, ny: 0.7 };
    const from = { width: 1920, height: 1080 };
    const to   = { width: 3840, height: 2160 }; // same 16:9
    const result = migrateAnchorBetweenViewportSizes(g, from, to);
    expect(result.nx).toBeCloseTo(0.3);
    expect(result.ny).toBeCloseTo(0.7);
  });

  it("re-projects correctly when aspect ratio changes (portrait→landscape)", () => {
    // Point at 50%, 50% of a 600×800 portrait viewport
    const g: AnnotationGeometry = { type: "point_pin", nx: 0.5, ny: 0.5 };
    const from = { width: 600,  height: 800 };
    const to   = { width: 1200, height: 400 };
    const result = migrateAnchorBetweenViewportSizes(g, from, to);
    // pixel coords: 300, 400 → normalized for 1200×400 = 0.25, 1.0
    expect(result.nx).toBeCloseTo(0.25);
    expect(result.ny).toBeCloseTo(1.0);
  });

  it("migrates rectangle dimensions proportionally", () => {
    const g: AnnotationGeometry = { type: "rectangle", nx: 0, ny: 0, nw: 0.5, nh: 0.5 };
    const from = { width: 800, height: 800 };
    const to   = { width: 400, height: 800 }; // halved width
    const result = migrateAnchorBetweenViewportSizes(g, from, to);
    expect(result.nw).toBeCloseTo(1.0); // 0.5 * 800 / 400 = 1.0 (clamped)
    expect(result.nh).toBeCloseTo(0.5);
  });

  it("throws on zero-dimension viewport", () => {
    const g: AnnotationGeometry = { type: "point_pin", nx: 0.5, ny: 0.5 };
    expect(() =>
      migrateAnchorBetweenViewportSizes(g, { width: 0, height: 100 }, { width: 100, height: 100 }),
    ).toThrow();
  });
});

// ─── Test 4: validateGeometry ─────────────────────────────────────────────────

describe("validateGeometry", () => {
  it("accepts a valid point_pin", () => {
    expect(validateGeometry({ type: "point_pin", nx: 0.5, ny: 0.5 })).toBe(true);
  });

  it("accepts a valid rectangle", () => {
    expect(validateGeometry({ type: "rectangle", nx: 0.1, ny: 0.1, nw: 0.5, nh: 0.3 })).toBe(true);
  });

  it("rejects out-of-range nx", () => {
    expect(validateGeometry({ type: "point_pin", nx: 1.5, ny: 0.5 })).toBe(false);
  });

  it("rejects rectangle with missing nw/nh", () => {
    expect(validateGeometry({ type: "rectangle", nx: 0.1, ny: 0.1 })).toBe(false);
  });

  it("rejects zero-area rectangle", () => {
    expect(validateGeometry({ type: "rectangle", nx: 0.1, ny: 0.1, nw: 0, nh: 0 })).toBe(false);
  });

  it("rejects rectangle that overflows content area", () => {
    expect(validateGeometry({ type: "rectangle", nx: 0.8, ny: 0.8, nw: 0.5, nh: 0.5 })).toBe(false);
  });

  it("rejects NaN coordinates", () => {
    expect(validateGeometry({ type: "point_pin", nx: NaN, ny: 0 })).toBe(false);
  });
});

describe("calculateAnnotationBounds", () => {
  it("returns nx2/ny2 for a rectangle", () => {
    const bounds = calculateAnnotationBounds({ type: "rectangle", nx: 0.1, ny: 0.2, nw: 0.4, nh: 0.3 });
    expect(bounds.nx2).toBeCloseTo(0.5);
    expect(bounds.ny2).toBeCloseTo(0.5);
  });

  it("returns zero-size bounds for a point_pin", () => {
    const bounds = calculateAnnotationBounds({ type: "point_pin", nx: 0.5, ny: 0.6 });
    expect(bounds.nw).toBe(0);
    expect(bounds.nh).toBe(0);
    expect(bounds.nx2).toBeCloseTo(0.5);
    expect(bounds.ny2).toBeCloseTo(0.6);
  });
});

describe("detectOutsideContent", () => {
  it("returns false when annotation is inside content area", () => {
    expect(detectOutsideContent({ type: "point_pin", nx: 0.5, ny: 0.5 })).toBe(false);
  });

  it("returns true when annotation origin is left of content", () => {
    expect(detectOutsideContent({ type: "point_pin", nx: -0.1, ny: 0.5 })).toBe(true);
  });

  it("returns true when annotation origin is below content", () => {
    expect(detectOutsideContent({ type: "point_pin", nx: 0.5, ny: 1.5 })).toBe(true);
  });
});
