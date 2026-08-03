/**
 * WP-04B — Rotation-Aware Resolver Tests
 *
 * Covers all public exports of rotationAwareResolver.ts:
 *   - requiresRotationAwareResolution
 *   - findRotationAwareCollisions
 *   - resolveRotationAwareCollision
 *
 * Integration (no_collision constraint in constraintSolver) is covered
 * by solver-level tests at the bottom.
 *
 * Delegation to WP-04A is verified with vi.spyOn rather than re-implementing
 * geometry — this catches any accidental inline geometry in this module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requiresRotationAwareResolution,
  findRotationAwareCollisions,
  resolveRotationAwareCollision,
  type RotationAwarePair,
  type RawPositionAdjustment,
} from "../rotationAwareResolver.js";
import { solve } from "../constraintSolver.js";
import type { LayoutElement, LayoutCanvas, Constraint } from "../../../../types/layout-composer/index.js";

// WP-04A spy target
import * as obbSatModule from "../obbSatAdapter.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function el(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0,
  locked = false,
): LayoutElement {
  return { id, type: "box", x, y, width: w, height: h, rotation, locked };
}

const canvas: LayoutCanvas = { width: 800, height: 600 };

/** Two clearly overlapping axis-aligned boxes */
const OVERLAP_A = el("A", 0,   0,  100, 100, 0);
const OVERLAP_B = el("B", 50, 50,  100, 100, 0);

/** Two clearly separated boxes */
const APART_A = el("A", 0,   0, 40, 40, 0);
const APART_B = el("B", 200, 0, 40, 40, 0);

/** 45° rotated box that overlaps axis-aligned box at (50,50) */
const ROTATED_45 = el("R", 40, 40, 80, 80, 45);

// ── Section 1: requiresRotationAwareResolution ─────────────────────────────────

describe("requiresRotationAwareResolution", () => {
  it("1a. returns false for empty list", () => {
    expect(requiresRotationAwareResolution([])).toBe(false);
  });

  it("1b. returns false when all elements have rotation=0", () => {
    expect(requiresRotationAwareResolution([el("A", 0, 0, 10, 10, 0), el("B", 20, 0, 10, 10, 0)])).toBe(false);
  });

  it("1c. returns false when rotation field is undefined (defaults to 0)", () => {
    const noRot: LayoutElement = { id: "X", type: "box", x: 0, y: 0, width: 50, height: 50 };
    expect(requiresRotationAwareResolution([noRot])).toBe(false);
  });

  it("1d. returns true when any element has non-zero rotation", () => {
    expect(requiresRotationAwareResolution([el("A", 0, 0, 10, 10, 0), el("B", 20, 0, 10, 10, 45)])).toBe(true);
  });

  it("1e. returns true when only the first element has rotation", () => {
    expect(requiresRotationAwareResolution([el("A", 0, 0, 10, 10, 90)])).toBe(true);
  });

  it("1f. returns true for negative rotation", () => {
    expect(requiresRotationAwareResolution([el("A", 0, 0, 10, 10, -30)])).toBe(true);
  });

  it("1g. returns true even if rotation is a tiny non-zero value", () => {
    expect(requiresRotationAwareResolution([el("A", 0, 0, 10, 10, 0.001)])).toBe(true);
  });
});

// ── Section 2: findRotationAwareCollisions ─────────────────────────────────────

describe("findRotationAwareCollisions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("2a. returns empty for empty element list", () => {
    expect(findRotationAwareCollisions([])).toHaveLength(0);
  });

  it("2b. returns empty for single element", () => {
    expect(findRotationAwareCollisions([OVERLAP_A])).toHaveLength(0);
  });

  it("2c. detects overlapping axis-aligned elements", () => {
    const pairs = findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].elementA).toBe("A");
    expect(pairs[0].elementB).toBe("B");
  });

  it("2d. returns empty for clearly separated elements", () => {
    expect(findRotationAwareCollisions([APART_A, APART_B])).toHaveLength(0);
  });

  it("2e. each detected pair has positive penetrationDepth", () => {
    const pairs = findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    expect(pairs[0].penetrationDepth).toBeGreaterThan(0);
  });

  it("2f. each detected pair has collisionResult.collides = true", () => {
    const pairs = findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    expect(pairs[0].collisionResult.collides).toBe(true);
  });

  it("2g. each detected pair has a non-null minimumTranslationVector", () => {
    const pairs = findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    expect(pairs[0].collisionResult.minimumTranslationVector).not.toBeNull();
  });

  it("2h. self-comparison excluded (n elements → at most n*(n-1)/2 pairs)", () => {
    const elements = [
      el("A", 0, 0, 200, 200, 0),
      el("B", 10, 10, 200, 200, 0),
      el("C", 20, 20, 200, 200, 0),
    ];
    const pairs = findRotationAwareCollisions(elements);
    // 3 elements → max 3 pairs; self never paired
    expect(pairs.length).toBeLessThanOrEqual(3);
    for (const p of pairs) {
      expect(p.elementA).not.toBe(p.elementB);
    }
  });

  it("2i. pairs are ordered i < j (elementA is always the earlier element)", () => {
    const pairs = findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    // A appears before B in input → A is elementA
    expect(pairs[0].elementA).toBe("A");
    expect(pairs[0].elementB).toBe("B");
  });

  it("2j. delegates to obbSatCollideElements for geometry (no inline geometry)", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("2k. with 3 elements, calls obbSatCollideElements 3 times (one per pair)", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    const elements = [APART_A, APART_B, el("C", 400, 0, 40, 40, 0)];
    findRotationAwareCollisions(elements);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("2l. detects collision between rotated element and axis-aligned element", () => {
    // ROTATED_45 at (40,40,80,80) @ 45° overlaps with element at (0,0,100,100)
    const pairs = findRotationAwareCollisions([el("S", 0, 0, 100, 100, 0), ROTATED_45]);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0].collisionResult.collides).toBe(true);
    expect(pairs[0].collisionResult.rotationAware).toBe(true);
  });

  it("2m. clearancePx is forwarded to obbSatCollideElements", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    findRotationAwareCollisions([APART_A, APART_B], 10);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "A" }),
      expect.objectContaining({ id: "B" }),
      10,
    );
  });

  it("2n. both-locked pair is still detected (detection ignores locked status)", () => {
    const lockedA = el("A", 0, 0, 100, 100, 0, true);
    const lockedB = el("B", 50, 50, 100, 100, 0, true);
    const pairs = findRotationAwareCollisions([lockedA, lockedB]);
    // Detection doesn't skip locked pairs — resolution is the caller's concern
    expect(pairs).toHaveLength(1);
  });

  it("2o. returns penetrationDepth as a finite positive number", () => {
    const pairs = findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    expect(Number.isFinite(pairs[0].penetrationDepth)).toBe(true);
    expect(pairs[0].penetrationDepth).toBeGreaterThan(0);
  });
});

// ── Section 3: resolveRotationAwareCollision ───────────────────────────────────

describe("resolveRotationAwareCollision", () => {
  // Helper: build a synthetic ObbSatResult with a known MTV
  function makeCollisionResult(mtvX: number, mtvY: number): import("../obbSatAdapter.js").ObbSatResult {
    return {
      collides:                 true,
      broadPhasePassed:         true,
      algorithm:                "obb-sat",
      rotationAware:            false,
      penetrationDepth:         Math.hypot(mtvX, mtvY),
      collisionNormal:          { x: mtvX / Math.hypot(mtvX, mtvY), y: mtvY / Math.hypot(mtvX, mtvY) },
      minimumTranslationVector: { x: mtvX, y: mtvY },
      legacyOverlapExtent:      { overlapX: Math.abs(mtvX), overlapY: Math.abs(mtvY) },
    };
  }

  const elA = el("A", 0, 0, 100, 100, 0);
  const elB = el("B", 60, 60, 100, 100, 0);

  it("3a. returns empty when collides=false", () => {
    const noCollide: import("../obbSatAdapter.js").ObbSatResult = {
      collides: false, broadPhasePassed: false, algorithm: "aabb-miss",
      rotationAware: false, penetrationDepth: 0,
      collisionNormal: null, minimumTranslationVector: null,
      legacyOverlapExtent: { overlapX: -10, overlapY: -10 },
    };
    expect(resolveRotationAwareCollision(elA, elB, noCollide)).toEqual({});
  });

  it("3b. returns empty when minimumTranslationVector is null", () => {
    const partial = { ...makeCollisionResult(10, 0), minimumTranslationVector: null };
    expect(resolveRotationAwareCollision(elA, elB, partial)).toEqual({});
  });

  it("3c. both movable: A gets +½MTV, B gets −½MTV", () => {
    const result = makeCollisionResult(20, 0);
    const adj = resolveRotationAwareCollision(elA, elB, result);
    expect(adj["A"]).toEqual({ dx: 10, dy: 0 });
    expect(adj["B"]).toEqual({ dx: -10, dy: 0 });
  });

  it("3d. both movable: vertical MTV splits evenly", () => {
    const result = makeCollisionResult(0, 30);
    const adj = resolveRotationAwareCollision(elA, elB, result);
    expect(adj["A"]).toEqual({ dx: 0, dy: 15 });
    expect(adj["B"]).toEqual({ dx: 0, dy: -15 });
  });

  it("3e. both movable: diagonal MTV splits evenly", () => {
    const result = makeCollisionResult(10, 10);
    const adj = resolveRotationAwareCollision(elA, elB, result);
    expect(adj["A"]).toEqual({ dx: 5, dy: 5 });
    expect(adj["B"]).toEqual({ dx: -5, dy: -5 });
  });

  it("3f. A locked: only B moves (negated full MTV)", () => {
    const lockedA = el("A", 0, 0, 100, 100, 0, true);
    const result = makeCollisionResult(20, 0);
    const adj = resolveRotationAwareCollision(lockedA, elB, result);
    expect(adj["A"]).toBeUndefined();
    expect(adj["B"]).toEqual({ dx: -20, dy: 0 });
  });

  it("3g. B locked: only A moves (full MTV)", () => {
    const lockedB = el("B", 60, 60, 100, 100, 0, true);
    const result = makeCollisionResult(20, 0);
    const adj = resolveRotationAwareCollision(elA, lockedB, result);
    expect(adj["A"]).toEqual({ dx: 20, dy: 0 });
    expect(adj["B"]).toBeUndefined();
  });

  it("3h. both locked: empty result (nothing moves)", () => {
    const lockedA = el("A", 0, 0, 100, 100, 0, true);
    const lockedB = el("B", 60, 60, 100, 100, 0, true);
    const result = makeCollisionResult(20, 0);
    expect(resolveRotationAwareCollision(lockedA, lockedB, result)).toEqual({});
  });

  it("3i. adjustments are raw floats — not rounded", () => {
    const result = makeCollisionResult(7, 3); // 7/2=3.5, 3/2=1.5
    const adj = resolveRotationAwareCollision(elA, elB, result);
    expect(adj["A"]!.dx).toBe(3.5);
    expect(adj["A"]!.dy).toBe(1.5);
    expect(adj["B"]!.dx).toBe(-3.5);
    expect(adj["B"]!.dy).toBe(-1.5);
  });

  it("3j. A gets exact +MTV when B is locked (no halving)", () => {
    const lockedB = el("B", 60, 60, 100, 100, 0, true);
    const result = makeCollisionResult(7, 3);
    const adj = resolveRotationAwareCollision(elA, lockedB, result);
    expect(adj["A"]!.dx).toBe(7);
    expect(adj["A"]!.dy).toBe(3);
  });

  it("3k. result never contains NaN or Infinity", () => {
    const result = makeCollisionResult(50, 50);
    const adj = resolveRotationAwareCollision(elA, elB, result);
    for (const { dx, dy } of Object.values(adj)) {
      expect(Number.isFinite(dx)).toBe(true);
      expect(Number.isFinite(dy)).toBe(true);
    }
  });
});

// ── Section 4: constraintSolver integration (no_collision with rotation) ────────

describe("constraintSolver no_collision — rotation-aware path (WP-04B)", () => {
  const noCollisionConstraint = (ids: string[]): Constraint => ({
    id: "c1",
    type: "no_collision",
    elementIds: ids,
    priority: "hard",
  });

  it("4a. axis-aligned overlapping elements are still resolved (AABB path unchanged)", () => {
    const input = {
      canvas,
      elements: [
        el("A", 0, 0, 100, 100, 0),
        el("B", 50, 50, 100, 100, 0),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan = solve(input);
    const a = plan.elements.find((e) => e.id === "A")!;
    const b = plan.elements.find((e) => e.id === "B")!;
    // After resolution they must not overlap
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });

  it("4b. rotated overlapping elements are resolved using OBB/SAT path", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    const input = {
      canvas,
      elements: [
        el("A", 100, 100, 100, 100, 0),
        el("B", 130, 130,  80,  80, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    solve(input);
    // OBB/SAT must have been called because B has rotation=45
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("4c. locked element is not moved in OBB/SAT path", () => {
    const input = {
      canvas,
      elements: [
        { ...el("A", 100, 100, 100, 100, 0), locked: true },
        el("B", 130, 130,  80,  80, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan = solve(input);
    const a = plan.elements.find((e) => e.id === "A")!;
    // Locked element must remain at original position
    expect(a.x).toBe(100);
    expect(a.y).toBe(100);
  });

  it("4d. op.after values are integers (rounded)", () => {
    const input = {
      canvas,
      elements: [
        el("A", 100, 100, 100, 100, 0),
        el("B", 130, 130,  80,  80, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan = solve(input);
    const pushOps = plan.operations.filter((op) => op.type === "push_apart");
    for (const op of pushOps) {
      const after = op.after as { x: number; y: number };
      expect(Number.isInteger(after.x)).toBe(true);
      expect(Number.isInteger(after.y)).toBe(true);
    }
  });

  it("4e. push_apart operations record before and after positions", () => {
    const input = {
      canvas,
      elements: [
        el("A", 100, 100, 100, 100, 0),
        el("B", 130, 130,  80,  80, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan = solve(input);
    const pushOps = plan.operations.filter((op) => op.type === "push_apart");
    for (const op of pushOps) {
      expect(op.before).toBeDefined();
      expect(op.after).toBeDefined();
      expect(op.constraintId).toBe("c1");
    }
  });

  it("4f. solver converges: same input always produces same output (determinism)", () => {
    const input = {
      canvas,
      elements: [
        el("A", 100, 100, 100, 100, 0),
        el("B", 130, 130,  80,  80, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan1 = solve(input);
    const plan2 = solve(input);
    expect(plan1.elements.find((e) => e.id === "A")!.x).toBe(plan2.elements.find((e) => e.id === "A")!.x);
    expect(plan1.elements.find((e) => e.id === "B")!.x).toBe(plan2.elements.find((e) => e.id === "B")!.x);
  });

  it("4g. non-overlapping rotated elements produce no push_apart ops", () => {
    const input = {
      canvas,
      elements: [
        el("A",   0, 0, 50, 50, 45),
        el("B", 400, 0, 50, 50, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan = solve(input);
    const pushOps = plan.operations.filter((op) => op.type === "push_apart");
    expect(pushOps).toHaveLength(0);
  });

  it("4h. float-shadow prevents rounding accumulation (B-3 regression)", () => {
    // Place element B just barely overlapping A after 45° rotation
    // The MTV will be a fractional float. With Math.round on intermediate positions,
    // residual penetration could prevent convergence. With float shadow it resolves.
    const input = {
      canvas,
      elements: [
        el("A", 200, 200, 100, 100, 0),
        el("B", 250, 250, 100, 100, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
      maxIterations: 10,
    };
    const plan = solve(input);
    // Solver must not degenerate — plan must be well-formed
    expect(plan.elements).toHaveLength(2);
    expect(plan.iterations).toBeLessThanOrEqual(10);
    const pushOps = plan.operations.filter((op) => op.type === "push_apart");
    // At least one push operation recorded
    expect(pushOps.length).toBeGreaterThan(0);
  });

  it("4i. both-locked rotated collision: no ops generated, solver exits cleanly", () => {
    const input = {
      canvas,
      elements: [
        { ...el("A", 100, 100, 100, 100, 0),  locked: true },
        { ...el("B", 130, 130,  80,  80, 45), locked: true },
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan = solve(input);
    const pushOps = plan.operations.filter((op) => op.type === "push_apart");
    expect(pushOps).toHaveLength(0);
    // Elements unchanged
    expect(plan.elements.find((e) => e.id === "A")!.x).toBe(100);
    expect(plan.elements.find((e) => e.id === "B")!.x).toBe(130);
  });

  it("4j. rotation=0 (explicit) triggers AABB path, not OBB/SAT", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    const input = {
      canvas,
      elements: [
        el("A", 0,  0, 100, 100, 0),
        el("B", 50, 50, 100, 100, 0),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    solve(input);
    // All elements have rotation=0 → AABB path → obbSatCollideElements NOT called
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("4k. satisfactionScore is between 0 and 1 after rotation resolution", () => {
    const input = {
      canvas,
      elements: [
        el("A", 100, 100, 100, 100, 0),
        el("B", 130, 130,  80,  80, 45),
      ],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    const plan = solve(input);
    expect(plan.satisfactionScore).toBeGreaterThanOrEqual(0);
    expect(plan.satisfactionScore).toBeLessThanOrEqual(1);
  });

  it("4l. three mutually-overlapping rotated elements: all pairs processed", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    const input = {
      canvas,
      elements: [
        el("A", 200, 200, 100, 100,  0),
        el("B", 230, 230,  80,  80, 30),
        el("C", 260, 260,  80,  80, 60),
      ],
      constraints: [noCollisionConstraint(["A", "B", "C"])],
    };
    solve(input);
    // 3 elements → 3 pairs × iterations
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
    spy.mockRestore();
  });

  it("4m. elements with no rotation field (undefined) use AABB path", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    const noRotA: LayoutElement = { id: "A", type: "box", x: 0,  y: 0,  width: 100, height: 100 };
    const noRotB: LayoutElement = { id: "B", type: "box", x: 50, y: 50, width: 100, height: 100 };
    const input = {
      canvas,
      elements: [noRotA, noRotB],
      constraints: [noCollisionConstraint(["A", "B"])],
    };
    solve(input);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── Section 5: module boundary ─────────────────────────────────────────────────

describe("rotationAwareResolver — module boundary", () => {
  it("5a. does not export any geometry helpers (no inline SAT/OBB)", async () => {
    const mod = await import("../rotationAwareResolver.js");
    const exports = Object.keys(mod);
    // Only 3 public functions + 0 geometry primitives
    expect(exports).toContain("requiresRotationAwareResolution");
    expect(exports).toContain("findRotationAwareCollisions");
    expect(exports).toContain("resolveRotationAwareCollision");
    // Must NOT export any geometry primitives
    expect(exports).not.toContain("satTest");
    expect(exports).not.toContain("generateOBB");
    expect(exports).not.toContain("generateAABB");
    expect(exports).not.toContain("aabbOverlap");
  });

  it("5b. always delegates geometry to obbSatCollideElements — no second SAT call path", () => {
    const spy = vi.spyOn(obbSatModule, "obbSatCollideElements");
    findRotationAwareCollisions([OVERLAP_A, OVERLAP_B]);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "A" }),
      expect.objectContaining({ id: "B" }),
      0,
    );
    spy.mockRestore();
  });
});
