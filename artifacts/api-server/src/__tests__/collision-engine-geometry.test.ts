/**
 * WP-03B — Collision Engine Geometry Tests
 *
 * Covers:
 * - AABB overlap / separation / edge touch
 * - OBB generation at 0°, 45°, 90°, 180°, 270°
 * - Negative rotations and rotations > 360°
 * - Corner touch / edge touch
 * - Epsilon handling
 * - Invalid dimensions (zero, negative, NaN, Infinity)
 * - SAT: separating axis found, no separating axis, correct overlap depth
 * - Deterministic axis selection
 */

import { describe, it, expect } from "vitest";

// ── AABB Tests ─────────────────────────────────────────────────────────────────

describe("AABB — axis-aligned bounding box", () => {
  it("generates correct AABB for unrotated placement", async () => {
    const { generateAABB } = await import("../services/collision-engine/aabb.js");
    const aabb = generateAABB(10, 20, 100, 60, 0);
    expect(aabb.minX).toBeCloseTo(10);
    expect(aabb.maxX).toBeCloseTo(110);
    expect(aabb.minY).toBeCloseTo(20);
    expect(aabb.maxY).toBeCloseTo(80);
  });

  it("generates expanded AABB for 90° rotation (width/depth swap)", async () => {
    const { generateAABB } = await import("../services/collision-engine/aabb.js");
    // A 100×60 box rotated 90° around its center should have AABB of 60×100
    const aabb = generateAABB(0, 0, 100, 60, 90);
    const w = aabb.maxX - aabb.minX;
    const h = aabb.maxY - aabb.minY;
    expect(w).toBeCloseTo(60, 1);
    expect(h).toBeCloseTo(100, 1);
  });

  it("AABB overlaps for overlapping placements", async () => {
    const { generateAABB, aabbOverlap } = await import("../services/collision-engine/aabb.js");
    const a = generateAABB(0, 0, 100, 100, 0);
    const b = generateAABB(50, 50, 100, 100, 0);
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it("AABB does NOT overlap for separated placements", async () => {
    const { generateAABB, aabbOverlap } = await import("../services/collision-engine/aabb.js");
    const a = generateAABB(0, 0, 100, 100, 0);
    const b = generateAABB(200, 0, 100, 100, 0);
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it("AABB edge touch is NOT overlap (edge-touch policy)", async () => {
    const { generateAABB, aabbOverlap } = await import("../services/collision-engine/aabb.js");
    // a.maxX = 100, b.minX = 100 — touching
    const a = generateAABB(0, 0, 100, 100, 0);
    const b = generateAABB(100, 0, 100, 100, 0);
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it("AABB corner touch is NOT overlap", async () => {
    const { generateAABB, aabbOverlap } = await import("../services/collision-engine/aabb.js");
    // a = [0,100]×[0,100], b starts at corner (100,100)
    const a = generateAABB(0, 0, 100, 100, 0);
    const b = generateAABB(100, 100, 100, 100, 0);
    expect(aabbOverlap(a, b)).toBe(false);
  });
});

// ── OBB Tests ──────────────────────────────────────────────────────────────────

describe("OBB — oriented bounding box", () => {
  const base = {
    id: "test", xCm: 0, yCm: 0, widthCm: 100, depthCm: 60,
    rotationDeg: 0, anchorX: 0, anchorY: 0,
    clearanceFrontCm: 0, clearanceSideCm: 0, clearanceBackCm: 0, isArchived: false,
  };

  it("generates OBB at 0° — center is midpoint", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB(base);
    expect(obb.center.x).toBeCloseTo(50);
    expect(obb.center.y).toBeCloseTo(30);
    expect(obb.halfW).toBe(50);
    expect(obb.halfD).toBe(30);
    expect(obb.rotationDeg).toBe(0);
  });

  it("generates OBB at 90°", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB({ ...base, rotationDeg: 90 });
    expect(obb.rotationDeg).toBe(90);
    expect(obb.corners).toHaveLength(4);
  });

  it("generates OBB at 45°", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB({ ...base, rotationDeg: 45 });
    expect(obb.rotationDeg).toBe(45);
  });

  it("generates OBB at 180°", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB({ ...base, rotationDeg: 180 });
    expect(obb.rotationDeg).toBe(180);
    // Center stays the same regardless of rotation
    expect(obb.center.x).toBeCloseTo(50);
    expect(obb.center.y).toBeCloseTo(30);
  });

  it("generates OBB at 270°", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB({ ...base, rotationDeg: 270 });
    expect(obb.rotationDeg).toBe(270);
  });

  it("normalises negative rotation before OBB generation", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB({ ...base, rotationDeg: -90 });
    expect(obb.rotationDeg).toBe(270);
  });

  it("normalises rotation > 360° before OBB generation", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB({ ...base, rotationDeg: 450 });
    expect(obb.rotationDeg).toBe(90);
  });

  it("throws for zero width", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    expect(() => generateOBB({ ...base, widthCm: 0 })).toThrow();
  });

  it("throws for negative depth", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    expect(() => generateOBB({ ...base, depthCm: -1 })).toThrow();
  });

  it("throws for NaN position", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    expect(() => generateOBB({ ...base, xCm: NaN })).toThrow();
  });

  it("throws for Infinity rotation", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    expect(() => generateOBB({ ...base, rotationDeg: Infinity })).toThrow();
  });

  it("OBB has exactly 4 corners", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB(base);
    expect(obb.corners).toHaveLength(4);
  });

  it("OBB has exactly 2 axes", async () => {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    const obb = generateOBB(base);
    expect(obb.axes).toHaveLength(2);
  });
});

// ── SAT Tests ──────────────────────────────────────────────────────────────────

describe("SAT — separating axis theorem", () => {
  async function getOBB(x: number, y: number, w: number, d: number, rot: number) {
    const { generateOBB } = await import("../services/collision-engine/obb.js");
    return generateOBB({ id: "t", xCm: x, yCm: y, widthCm: w, depthCm: d, rotationDeg: rot, anchorX: 0, anchorY: 0, clearanceFrontCm: 0, clearanceSideCm: 0, clearanceBackCm: 0, isArchived: false });
  }

  it("finds separating axis for clearly separated OBBs", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    const a = await getOBB(0, 0, 50, 50, 0);
    const b = await getOBB(200, 0, 50, 50, 0);
    const result = satTest(a, b);
    expect(result.overlaps).toBe(false);
    expect(result.separatingAxis).toBeDefined();
    expect(result.overlapDepth).toBe(0);
  });

  it("finds no separating axis for overlapping OBBs", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    const a = await getOBB(0, 0, 100, 100, 0);
    const b = await getOBB(50, 50, 100, 100, 0);
    const result = satTest(a, b);
    expect(result.overlaps).toBe(true);
    expect(result.overlapDepth).toBeGreaterThan(0);
  });

  it("correct overlap depth for axis-aligned overlap", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    // a = [0,100]×[0,100], b = [60,160]×[0,100] → overlap of 40 on X axis
    const a = await getOBB(0, 0, 100, 100, 0);
    const b = await getOBB(60, 0, 100, 100, 0);
    const result = satTest(a, b);
    expect(result.overlaps).toBe(true);
    expect(result.overlapDepth).toBeCloseTo(40, 1);
  });

  it("edge touch is NOT overlap (epsilon)", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    const a = await getOBB(0, 0, 100, 100, 0);
    const b = await getOBB(100, 0, 100, 100, 0);
    const result = satTest(a, b);
    expect(result.overlaps).toBe(false);
  });

  it("OBBs overlap at 0°", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    const a = await getOBB(0, 0, 100, 100, 0);
    const b = await getOBB(30, 30, 100, 100, 0);
    expect(satTest(a, b).overlaps).toBe(true);
  });

  it("OBBs overlap at 45°", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    const a = await getOBB(0, 0, 100, 100, 45);
    const b = await getOBB(0, 0, 100, 100, 0);
    expect(satTest(a, b).overlaps).toBe(true);
  });

  it("OBBs do NOT overlap when far apart at 45°", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    const a = await getOBB(0, 0, 50, 50, 45);
    const b = await getOBB(300, 300, 50, 50, 45);
    expect(satTest(a, b).overlaps).toBe(false);
  });

  it("satTest is deterministic — same input same output", async () => {
    const { satTest } = await import("../services/collision-engine/sat.js");
    const a = await getOBB(10, 10, 80, 60, 30);
    const b = await getOBB(50, 40, 80, 60, 30);
    const r1 = satTest(a, b);
    const r2 = satTest(a, b);
    expect(r1.overlaps).toBe(r2.overlaps);
    expect(r1.overlapDepth).toBe(r2.overlapDepth);
  });
});

// ── Geometry utilities ────────────────────────────────────────────────────────

describe("Geometry primitives", () => {
  it("vecAdd", async () => {
    const { vecAdd } = await import("../services/collision-engine/geometry.js");
    expect(vecAdd({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  });

  it("vecSub", async () => {
    const { vecSub } = await import("../services/collision-engine/geometry.js");
    expect(vecSub({ x: 5, y: 3 }, { x: 2, y: 1 })).toEqual({ x: 3, y: 2 });
  });

  it("dotProduct", async () => {
    const { dotProduct } = await import("../services/collision-engine/geometry.js");
    expect(dotProduct({ x: 2, y: 3 }, { x: 4, y: 1 })).toBe(11);
  });

  it("normalize unit vector", async () => {
    const { normalize } = await import("../services/collision-engine/geometry.js");
    const v = normalize({ x: 3, y: 4 });
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
  });

  it("normalize zero vector returns zero", async () => {
    const { normalize } = await import("../services/collision-engine/geometry.js");
    const v = normalize({ x: 0, y: 0 });
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it("normalizeDeg maps -90 to 270", async () => {
    const { normalizeDeg } = await import("../services/collision-engine/geometry.js");
    expect(normalizeDeg(-90)).toBe(270);
  });

  it("normalizeDeg maps 450 to 90", async () => {
    const { normalizeDeg } = await import("../services/collision-engine/geometry.js");
    expect(normalizeDeg(450)).toBe(90);
  });

  it("rectCenter returns midpoint", async () => {
    const { rectCenter } = await import("../services/collision-engine/geometry.js");
    const c = rectCenter(0, 0, 100, 60);
    expect(c.x).toBe(50);
    expect(c.y).toBe(30);
  });

  it("rotatedCorners at 0° match un-rotated corners", async () => {
    const { rotatedCorners } = await import("../services/collision-engine/geometry.js");
    const corners = rotatedCorners(0, 0, 100, 60, 0);
    expect(corners[0].x).toBeCloseTo(0);    // TL
    expect(corners[0].y).toBeCloseTo(0);
    expect(corners[1].x).toBeCloseTo(100);  // TR
    expect(corners[1].y).toBeCloseTo(0);
    expect(corners[2].x).toBeCloseTo(100);  // BR
    expect(corners[2].y).toBeCloseTo(60);
    expect(corners[3].x).toBeCloseTo(0);    // BL
    expect(corners[3].y).toBeCloseTo(60);
  });

  it("rotatedCorners at 180° are flipped", async () => {
    const { rotatedCorners } = await import("../services/collision-engine/geometry.js");
    const corners = rotatedCorners(0, 0, 100, 60, 180);
    // After 180° rotation around center (50,30), TL→BR, TR→BL, etc.
    expect(corners[0].x).toBeCloseTo(100); // TL after 180° = original BR
    expect(corners[0].y).toBeCloseTo(60);
  });
});

// ── COLLISION_EPSILON ─────────────────────────────────────────────────────────

describe("COLLISION_EPSILON", () => {
  it("COLLISION_EPSILON is positive and small", async () => {
    const { COLLISION_EPSILON } = await import("../services/collision-engine/types.js");
    expect(COLLISION_EPSILON).toBeGreaterThan(0);
    expect(COLLISION_EPSILON).toBeLessThan(0.001);
  });

  it("COLLISION_EPSILON is exactly 1e-6", async () => {
    const { COLLISION_EPSILON } = await import("../services/collision-engine/types.js");
    expect(COLLISION_EPSILON).toBe(1e-6);
  });
});
