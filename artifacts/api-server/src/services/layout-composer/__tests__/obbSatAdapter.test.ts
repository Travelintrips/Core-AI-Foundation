/**
 * WP-04A — OBB/SAT Collision Adapter Tests
 *
 * Covers all 22 required cases from the WP-04A spec plus a bounded
 * performance scenario (Phase 11).
 *
 * Delegation to WP-03B is verified with vi.spyOn rather than by
 * reimplementing geometry — this also catches any accidental duplication.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  obbSatCollide,
  obbSatCollideElements,
  type ObbSatResult,
} from "../obbSatAdapter.js";

// Import WP-03B modules so we can spy on them
import * as aabbModule from "../../collision-engine/aabb.js";
import * as obbModule  from "../../collision-engine/obb.js";
import * as satModule  from "../../collision-engine/sat.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const rect = (x: number, y: number, w: number, h: number) =>
  ({ x, y, width: w, height: h });

/** Two clearly overlapping axis-aligned rects */
const OVERLAP_A = rect(0,   0, 100, 100);
const OVERLAP_B = rect(50, 50, 100, 100);

/** Two clearly separated axis-aligned rects */
const APART_A = rect(0,   0, 40, 40);
const APART_B = rect(200, 0, 40, 40);

// ── Suite ──────────────────────────────────────────────────────────────────────

describe("obbSatAdapter — WP-04A", () => {

  // ── 1. AABB miss skips SAT ─────────────────────────────────────────────────
  it("1. AABB miss: broadPhasePassed=false, algorithm=aabb-miss, SAT not called", () => {
    const satSpy = vi.spyOn(satModule, "satTest");
    const result = obbSatCollide(APART_A, APART_B);

    expect(result.broadPhasePassed).toBe(false);
    expect(result.algorithm).toBe("aabb-miss");
    expect(result.collides).toBe(false);
    expect(satSpy).not.toHaveBeenCalled();
    satSpy.mockRestore();
  });

  // ── 2. AABB hit runs SAT ───────────────────────────────────────────────────
  it("2. AABB hit: SAT is called when broad phase passes", () => {
    const satSpy = vi.spyOn(satModule, "satTest");
    obbSatCollide(OVERLAP_A, OVERLAP_B);

    expect(satSpy).toHaveBeenCalledOnce();
    satSpy.mockRestore();
  });

  // ── 3. Zero-rotation collision matches legacy behavior ─────────────────────
  it("3. Zero-rotation collision: collides=true, legacyOverlapExtent positive on both axes", () => {
    const result = obbSatCollide(OVERLAP_A, OVERLAP_B, 0, 0);

    expect(result.collides).toBe(true);
    expect(result.legacyOverlapExtent.overlapX).toBeGreaterThan(0);
    expect(result.legacyOverlapExtent.overlapY).toBeGreaterThan(0);
  });

  // ── 4. Rotated rectangles collide ─────────────────────────────────────────
  it("4. Rotated rectangles that physically overlap are detected as colliding", () => {
    // Two squares with 45° rotation, centers close enough to overlap
    const a = rect(0, 0, 80, 80);
    const b = rect(50, 50, 80, 80);
    const result = obbSatCollide(a, b, 45, 45);

    expect(result.collides).toBe(true);
    expect(result.rotationAware).toBe(true);
    expect(result.algorithm).toBe("obb-sat");
  });

  // ── 5. Rotated rectangles do not collide ──────────────────────────────────
  it("5. Rotated rectangles that are well separated do not collide", () => {
    const a = rect(0,   0, 30, 30);
    const b = rect(300, 0, 30, 30);
    const result = obbSatCollide(a, b, 45, 45);

    expect(result.collides).toBe(false);
  });

  // ── 6. Touching edges ─────────────────────────────────────────────────────
  it("6. Touching edges (zero penetration) are NOT a collision", () => {
    // A occupies [0,100]×[0,100], B starts at x=100 — touching, not overlapping
    const a = rect(0,   0, 100, 100);
    const b = rect(100, 0, 100, 100);
    const result = obbSatCollide(a, b, 0, 0);

    expect(result.collides).toBe(false);
  });

  // ── 7. Positive clearance creates envelope overlap ─────────────────────────
  it("7. Positive clearance causes previously-separated elements to register as colliding", () => {
    // 10px gap between the two rects; clearance of 6 each → 12px envelope expansion → overlap
    const a = rect(0,  0, 90, 50);
    const b = rect(100, 0, 90, 50);
    const withoutClearance = obbSatCollide(a, b, 0, 0, 0);
    const withClearance    = obbSatCollide(a, b, 0, 0, 6);

    expect(withoutClearance.collides).toBe(false);
    expect(withClearance.collides).toBe(true);
  });

  // ── 8. Clearance does not mutate visual dimensions ─────────────────────────
  it("8. Clearance does not change legacyOverlapExtent (always uses original visual rects)", () => {
    const a = rect(0,  0, 90, 50);
    const b = rect(100, 0, 90, 50);

    const noClear   = obbSatCollide(a, b, 0, 0, 0);
    const withClear = obbSatCollide(a, b, 0, 0, 20);

    // legacyOverlapExtent is derived from original rects — must be identical
    expect(withClear.legacyOverlapExtent).toEqual(noClear.legacyOverlapExtent);
  });

  // ── 9. Negative clearance is normalised to zero ────────────────────────────
  it("9. Negative clearance is silently normalised to 0 (does not shrink envelope)", () => {
    const pos  = obbSatCollide(OVERLAP_A, OVERLAP_B, 0, 0, 0);
    const neg  = obbSatCollide(OVERLAP_A, OVERLAP_B, 0, 0, -99);

    expect(neg.collides).toBe(pos.collides);
    expect(neg.broadPhasePassed).toBe(pos.broadPhasePassed);
  });

  // ── 10. Non-finite input is rejected ──────────────────────────────────────
  it("10a. Non-finite position throws LAYOUT_ELEMENT_GEOMETRY_INVALID", () => {
    expect(() => obbSatCollide(rect(NaN, 0, 10, 10), OVERLAP_B))
      .toThrow("LAYOUT_ELEMENT_GEOMETRY_INVALID");
  });

  it("10b. Non-finite dimension throws LAYOUT_ELEMENT_GEOMETRY_INVALID", () => {
    expect(() => obbSatCollide(rect(0, 0, Infinity, 10), OVERLAP_B))
      .toThrow("LAYOUT_ELEMENT_GEOMETRY_INVALID");
  });

  it("10c. Non-positive dimension throws LAYOUT_ELEMENT_DIMENSIONS_INVALID", () => {
    expect(() => obbSatCollide(rect(0, 0, 0, 10), OVERLAP_B))
      .toThrow("LAYOUT_ELEMENT_DIMENSIONS_INVALID");
  });

  it("10d. Non-finite rotation throws LAYOUT_ELEMENT_GEOMETRY_INVALID", () => {
    expect(() => obbSatCollide(OVERLAP_A, OVERLAP_B, NaN, 0))
      .toThrow("LAYOUT_ELEMENT_GEOMETRY_INVALID");
  });

  // ── 11. MTV uses A + vector convention ────────────────────────────────────
  it("11. minimumTranslationVector resolves A when added to A's position", () => {
    const a = rect(0,  0, 100, 100);
    const b = rect(60, 0, 100, 100);
    const result = obbSatCollide(a, b);

    expect(result.collides).toBe(true);
    const mtv = result.minimumTranslationVector!;
    expect(Number.isFinite(mtv.x)).toBe(true);
    expect(Number.isFinite(mtv.y)).toBe(true);

    // After applying MTV, A should no longer overlap B on the resolved axis
    const resolvedA = rect(a.x + mtv.x, a.y + mtv.y, a.width, a.height);
    const afterResult = obbSatCollide(resolvedA, b);
    expect(afterResult.collides).toBe(false);
  });

  // ── 12. Reversing A and B yields consistent direction ─────────────────────
  it("12. MTV for (A,B) and (B,A) are opposite vectors", () => {
    const a = rect(0,  0, 100, 100);
    const b = rect(60, 0, 100, 100);

    const ab = obbSatCollide(a, b);
    const ba = obbSatCollide(b, a);

    expect(ab.collides).toBe(true);
    expect(ba.collides).toBe(true);

    const mtvAB = ab.minimumTranslationVector!;
    const mtvBA = ba.minimumTranslationVector!;

    expect(mtvAB.x).toBeCloseTo(-mtvBA.x, 6);
    expect(mtvAB.y).toBeCloseTo(-mtvBA.y, 6);
  });

  // ── 13. Repeated calls are deterministic ──────────────────────────────────
  it("13. Identical inputs always produce identical results", () => {
    const runs = Array.from({ length: 5 }, () =>
      obbSatCollide(OVERLAP_A, OVERLAP_B, 30, 15),
    );
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });

  // ── 14. Input objects remain unchanged ────────────────────────────────────
  it("14. Input rects are not mutated by the call", () => {
    const a = rect(10, 20, 80, 60);
    const b = rect(50, 50, 80, 60);
    const aSnapshot = { ...a };
    const bSnapshot = { ...b };

    obbSatCollide(a, b, 45, 0, 10);

    expect(a).toEqual(aSnapshot);
    expect(b).toEqual(bSnapshot);
  });

  // ── 15. Very small rectangles ─────────────────────────────────────────────
  it("15. Very small rectangles (1×1 px) collide when overlapping", () => {
    const a = rect(0, 0, 1, 1);
    const b = rect(0, 0, 1, 1);
    const result = obbSatCollide(a, b);

    expect(result.collides).toBe(true);
    expect(Number.isFinite(result.penetrationDepth)).toBe(true);
  });

  // ── 16. Very large rectangles ─────────────────────────────────────────────
  it("16. Very large rectangles (10 000×10 000) produce finite results", () => {
    const a = rect(0,    0, 10_000, 10_000);
    const b = rect(5000, 0, 10_000, 10_000);
    const result = obbSatCollide(a, b);

    expect(result.collides).toBe(true);
    expect(Number.isFinite(result.penetrationDepth)).toBe(true);
    const mtv = result.minimumTranslationVector!;
    expect(Number.isFinite(mtv.x)).toBe(true);
    expect(Number.isFinite(mtv.y)).toBe(true);
  });

  // ── 17. Rotation normalisation ────────────────────────────────────────────
  it("17. Rotation of 360° is equivalent to 0°", () => {
    const r0   = obbSatCollide(OVERLAP_A, OVERLAP_B, 0,   0);
    const r360 = obbSatCollide(OVERLAP_A, OVERLAP_B, 360, 360);

    expect(r360.collides).toBe(r0.collides);
    expect(r360.penetrationDepth).toBeCloseTo(r0.penetrationDepth, 6);
  });

  it("17b. Negative rotation (−90°) is equivalent to 270°", () => {
    const rNeg = obbSatCollide(OVERLAP_A, OVERLAP_B, -90, 0);
    const rPos = obbSatCollide(OVERLAP_A, OVERLAP_B, 270, 0);

    expect(rNeg.collides).toBe(rPos.collides);
    expect(rNeg.penetrationDepth).toBeCloseTo(rPos.penetrationDepth, 6);
  });

  // ── 18. Legacy overlapExtent compatibility ────────────────────────────────
  it("18. legacyOverlapExtent matches the WP-03C overlapExtent formula", () => {
    const a = OVERLAP_A;
    const b = OVERLAP_B;
    const expectedX = Math.min(a.x + a.width,  b.x + b.width)  - Math.max(a.x, b.x);
    const expectedY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

    const result = obbSatCollide(a, b, 0, 0);

    expect(result.legacyOverlapExtent.overlapX).toBeCloseTo(expectedX, 9);
    expect(result.legacyOverlapExtent.overlapY).toBeCloseTo(expectedY, 9);
  });

  // ── 19. WP-03B canonical functions are delegated to ───────────────────────
  it("19. generateAABB is called for broad phase (delegation to WP-03B)", () => {
    const aabbSpy = vi.spyOn(aabbModule, "generateAABB");
    obbSatCollide(OVERLAP_A, OVERLAP_B);

    expect(aabbSpy).toHaveBeenCalled();
    aabbSpy.mockRestore();
  });

  it("19b. generateOBB is called for narrow phase (delegation to WP-03B)", () => {
    const obbSpy = vi.spyOn(obbModule, "generateOBB");
    obbSatCollide(OVERLAP_A, OVERLAP_B);

    expect(obbSpy).toHaveBeenCalled();
    obbSpy.mockRestore();
  });

  it("19c. satTest is called for narrow phase (delegation to WP-03B)", () => {
    const satSpy = vi.spyOn(satModule, "satTest");
    obbSatCollide(OVERLAP_A, OVERLAP_B);

    expect(satSpy).toHaveBeenCalled();
    satSpy.mockRestore();
  });

  // ── 20. No SAT call on broad-phase miss ───────────────────────────────────
  it("20. satTest is NOT called when AABB broad phase misses", () => {
    const satSpy = vi.spyOn(satModule, "satTest");
    obbSatCollide(APART_A, APART_B);

    expect(satSpy).not.toHaveBeenCalled();
    satSpy.mockRestore();
  });

  // ── 21. No duplicate SAT helper in obbSatAdapter ──────────────────────────
  it("21. obbSatAdapter does not export any separating-axis or projection helper", async () => {
    const mod = await import("../obbSatAdapter.js");
    const exportedNames = Object.keys(mod);

    // These would indicate a re-implementation of SAT logic
    const forbidden = ["projectOBB", "satAxes", "intervalOverlap", "intervalsOverlap",
                       "separatingAxis", "projectOnAxis"];
    for (const name of forbidden) {
      expect(exportedNames, `unexpected export "${name}" suggests duplicate SAT logic`)
        .not.toContain(name);
    }
  });

  // ── 22. No duplicate OBB helper in obbSatAdapter ──────────────────────────
  it("22. obbSatAdapter does not export any OBB corner or axis helper", async () => {
    const mod = await import("../obbSatAdapter.js");
    const exportedNames = Object.keys(mod);

    const forbidden = ["rotatedCorners", "obbAxes", "obbCorners", "generateLocalOBB",
                       "buildOBB", "computeOBB"];
    for (const name of forbidden) {
      expect(exportedNames, `unexpected export "${name}" suggests duplicate OBB logic`)
        .not.toContain(name);
    }
  });

  // ── obbSatCollideElements convenience overload ─────────────────────────────
  it("obbSatCollideElements: accepts element-like objects and uses rotation field", () => {
    const a = { id: "el-a", x: 0,  y: 0,  width: 100, height: 100, rotation: 30 };
    const b = { id: "el-b", x: 60, y: 60, width: 100, height: 100, rotation: 15 };

    const result = obbSatCollideElements(a, b);

    expect(result.collides).toBe(true);
    expect(result.rotationAware).toBe(true);
  });

  it("obbSatCollideElements: defaults rotation to 0 when field is absent", () => {
    const a = { id: "el-a", x: 0,  y: 0,  width: 100, height: 100 };
    const b = { id: "el-b", x: 50, y: 50, width: 100, height: 100 };

    const result = obbSatCollideElements(a, b);

    expect(result.rotationAware).toBe(false);
    expect(result.collides).toBe(true);
  });

});

// ── Phase 11 — Bounded Performance Scenario ───────────────────────────────────

describe("obbSatAdapter — performance (Phase 11)", () => {

  it("500 elements, all pairs checked: broad phase skips reduce SAT calls, finishes in bounded time", () => {
    const N = 500;
    // Grid of 500 elements with varied rotation; most are far apart
    const elements = Array.from({ length: N }, (_, i) => ({
      id:       `el-${i}`,
      x:        (i % 25) * 80,
      y:        Math.floor(i / 25) * 80,
      width:    40,
      height:   40,
      rotation: (i * 17) % 360,
    }));

    let totalPairs     = 0;
    let satCalls       = 0;
    let broadPhaseMiss = 0;

    const satSpy = vi.spyOn(satModule, "satTest");

    const t0 = Date.now();

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        totalPairs++;
        const a = elements[i];
        const b = elements[j];
        const result = obbSatCollideElements(a, b);
        if (!result.broadPhasePassed) broadPhaseMiss++;
      }
    }

    satCalls = satSpy.mock.calls.length;
    satSpy.mockRestore();

    const durationMs = Date.now() - t0;

    // Assertions: logic correctness only; timing is reported, not asserted
    expect(totalPairs).toBe((N * (N - 1)) / 2);
    expect(broadPhaseMiss).toBeGreaterThan(0);      // broad phase skips some
    expect(satCalls).toBeLessThanOrEqual(totalPairs); // SAT never called more than pairs

    // Report (not a flaky assertion)
    console.info(
      `[WP-04A perf] pairs=${totalPairs} satCalls=${satCalls} ` +
      `broadPhaseMiss=${broadPhaseMiss} durationMs=${durationMs}`,
    );
  });

});
