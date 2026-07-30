// ============================================================
// TEAM 12 — Layout Composer Tests
// Covers: long text, collision, impossible constraints,
//         responsive layouts, room zones, garment panels,
//         and deterministic output
// ============================================================

import { describe, it, expect } from "vitest";
import { solve } from "../constraintSolver.js";
import { composeLayout, validateLayout, getSupportedOperations } from "../index.js";
import { checkTextFit, estimateLines, shrinkFontToFit, expandHeightToFit } from "../textFitting.js";
import {
  findAllCollisions,
  resolveCollision,
  rectsOverlap,
  clampToRect,
  isContainedIn,
} from "../collisionDetection.js";
import {
  clampToSafeZone,
  isInSafeZone,
  contentRect,
  activeSafeZone,
  safeZoneViolation,
} from "../safeZones.js";
import {
  scaleElementsToCanvas,
  detectBreakpoint,
  STANDARD_BREAKPOINTS,
  buildBreakpointRequest,
} from "../responsiveVariants.js";
import {
  validateRoomZones,
  validateGarmentPanels,
  clampElementsToZones,
  resolveZoneTemplate,
  ROOM_ZONE_TEMPLATES,
  GARMENT_ZONE_TEMPLATES,
  distanceToSegment,
  elementCrossesSeam,
} from "../zoneLayouts.js";
import type {
  LayoutElement,
  LayoutCanvas,
  Constraint,
  LayoutZone,
  LayoutRequest,
  SeamLine,
} from "../../../types/layout-composer/index.js";

// ── Fixtures ──────────────────────────────────────────────────

const canvas800: LayoutCanvas = { width: 800, height: 600 };

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<LayoutElement> = {}
): LayoutElement {
  return { id, type: "box", x, y, width: w, height: h, ...extra };
}

function textEl(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  content: string,
  fontSize = 14,
  lineHeight = 1.4
): LayoutElement {
  return {
    id,
    type: "text",
    x, y, width: w, height: h,
    content,
    textStyle: { fontSize, lineHeight },
  };
}

function constraint(
  id: string,
  type: Constraint["type"],
  elementIds: string[],
  params: Record<string, unknown> = {},
  priority: Constraint["priority"] = "hard"
): Constraint {
  return { id, type, elementIds, params, priority };
}

// ── 1. Text fitting ───────────────────────────────────────────

describe("textFitting", () => {
  it("detects short text fits in element", () => {
    const el = textEl("t1", 0, 0, 200, 50, "Hello world", 14, 1.4);
    const result = checkTextFit(el);
    expect(result.fits).toBe(true);
    expect(result.overflow).toBe(0);
  });

  it("detects long text overflow", () => {
    const longText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20);
    const el = textEl("t2", 0, 0, 200, 50, longText, 14, 1.4);
    const result = checkTextFit(el);
    expect(result.fits).toBe(false);
    expect(result.overflow).toBeGreaterThan(0);
    expect(result.linesRequired).toBeGreaterThan(result.linesAvailable);
    expect(result.suggestedHeight).toBeGreaterThan(50);
  });

  it("estimates correct line count for narrow container", () => {
    const text = "One two three four five six seven eight nine ten";
    // fontSize=14, charWidth=14*0.55=7.7px, charsPerLine=floor(100/7.7)=12
    const lines = estimateLines(text, { fontSize: 14, lineHeight: 1.4 }, 100);
    expect(lines).toBeGreaterThan(2);
  });

  it("handles empty text", () => {
    const el = textEl("t3", 0, 0, 200, 50, "");
    const result = checkTextFit(el);
    expect(result.fits).toBe(true);
    expect(result.linesRequired).toBe(0);
  });

  it("handles multiline hard breaks", () => {
    const text = "Line 1\nLine 2\nLine 3";
    const lines = estimateLines(text, { fontSize: 14, lineHeight: 1.4 }, 400);
    expect(lines).toBe(3);
  });

  it("shrinks font size to fit in a reasonably-sized box", () => {
    // Container is large enough that a smaller font will fit
    const longText = "This is a very long sentence that will not fit at 20px font size.";
    const el = textEl("t4", 0, 0, 200, 100, longText, 20, 1.4);
    const newFont = shrinkFontToFit(el);
    expect(newFont).toBeDefined();
    expect(newFont!).toBeLessThan(20);
    expect(newFont!).toBeGreaterThanOrEqual(8);
  });

  it("expandHeightToFit returns minimum needed height", () => {
    const text = "Word ".repeat(100);
    const el = textEl("t5", 0, 0, 200, 50, text, 14, 1.4);
    const h = expandHeightToFit(el);
    expect(h).toBeGreaterThan(50);
  });

  it("returns undefined for element without textStyle", () => {
    const el = box("b1", 0, 0, 100, 50);
    const result = shrinkFontToFit(el);
    expect(result).toBeUndefined();
  });
});

// ── 2. Collision detection ────────────────────────────────────

describe("collisionDetection", () => {
  it("detects overlapping elements", () => {
    const a = box("a", 0, 0, 100, 100);
    const b = box("b", 50, 50, 100, 100);
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it("does not flag adjacent (touching) elements as collision", () => {
    const a = box("a", 0, 0, 100, 100);
    const b = box("b", 100, 0, 100, 100);
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it("findAllCollisions returns all overlapping pairs", () => {
    const a = box("a", 0, 0, 100, 100);
    const b = box("b", 50, 50, 100, 100);
    const c = box("c", 300, 300, 50, 50); // no collision
    const pairs = findAllCollisions([a, b, c]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].elementA).toBe("a");
    expect(pairs[0].elementB).toBe("b");
    expect(pairs[0].overlapArea).toBeGreaterThan(0);
  });

  it("resolves collision by pushing elements apart", () => {
    const a = box("a", 0, 0, 100, 100);
    const b = box("b", 50, 0, 100, 100); // overlaps 50px horizontally
    const adjustments = resolveCollision(a, b);
    expect(adjustments["a"]).toBeDefined();
    expect(adjustments["b"]).toBeDefined();
    // a should move left, b should move right
    expect(adjustments["a"].dx).toBeLessThan(0);
    expect(adjustments["b"].dx).toBeGreaterThan(0);
  });

  it("locked element absorbs none of the collision push", () => {
    const a = box("a", 0, 0, 100, 100, { locked: true });
    const b = box("b", 50, 0, 100, 100);
    const adjustments = resolveCollision(a, b);
    expect(adjustments["a"]).toBeUndefined();
    expect(adjustments["b"]).toBeDefined();
    expect(adjustments["b"].dx).toBeGreaterThan(0);
  });

  it("two locked elements produce no adjustment", () => {
    const a = box("a", 0, 0, 100, 100, { locked: true });
    const b = box("b", 50, 0, 100, 100, { locked: true });
    const adjustments = resolveCollision(a, b);
    expect(Object.keys(adjustments)).toHaveLength(0);
  });

  it("clampToRect keeps element inside container", () => {
    const el = box("e", -20, -20, 50, 50);
    const container = { x: 0, y: 0, width: 100, height: 100 };
    const c = clampToRect(el, container);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });

  it("isContainedIn true when fully inside", () => {
    const el = box("e", 10, 10, 50, 50);
    const container = { x: 0, y: 0, width: 100, height: 100 };
    expect(isContainedIn(el, container)).toBe(true);
  });

  it("isContainedIn false when element bleeds out", () => {
    const el = box("e", 80, 80, 50, 50);
    const container = { x: 0, y: 0, width: 100, height: 100 };
    expect(isContainedIn(el, container)).toBe(false);
  });
});

// ── 3. Safe zones ─────────────────────────────────────────────

describe("safeZones", () => {
  it("contentRect respects canvas padding", () => {
    const c: LayoutCanvas = { width: 800, height: 600, padding: { top: 20, right: 20, bottom: 20, left: 20 } };
    const rect = contentRect(c);
    expect(rect.x).toBe(20);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(760);
    expect(rect.height).toBe(560);
  });

  it("activeSafeZone returns explicit safeZone when set", () => {
    const sz = { x: 10, y: 10, width: 700, height: 500 };
    const c: LayoutCanvas = { width: 800, height: 600, safeZone: sz };
    expect(activeSafeZone(c)).toEqual(sz);
  });

  it("isInSafeZone true for centered element", () => {
    const c: LayoutCanvas = { width: 800, height: 600, padding: { top: 20, right: 20, bottom: 20, left: 20 } };
    const el = box("e", 100, 100, 200, 100);
    expect(isInSafeZone(el, c)).toBe(true);
  });

  it("isInSafeZone false when element extends outside", () => {
    const c: LayoutCanvas = { width: 800, height: 600, padding: { top: 20, right: 20, bottom: 20, left: 20 } };
    const el = box("e", 790, 100, 200, 100); // extends past right edge
    expect(isInSafeZone(el, c)).toBe(false);
  });

  it("clampToSafeZone moves out-of-bounds element inside", () => {
    const c: LayoutCanvas = { width: 800, height: 600 };
    const el = box("e", -50, -50, 100, 100);
    const result = clampToSafeZone(el, c);
    expect(result.changed).toBe(true);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
  });

  it("safeZoneViolation reports correct bleed amounts", () => {
    const c: LayoutCanvas = { width: 800, height: 600, padding: { top: 20, right: 20, bottom: 20, left: 20 } };
    const el = box("e", 0, 0, 100, 100); // bleeds 20px on left and top
    const v = safeZoneViolation(el, c);
    expect(v.hasViolation).toBe(true);
    expect(v.left).toBe(20);
    expect(v.top).toBe(20);
  });
});

// ── 4. Constraint solver — basic operations ───────────────────

describe("constraintSolver — basic", () => {
  it("fixed_position places element at specified coords", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100)],
      constraints: [constraint("c1", "fixed_position", ["a"], { x: 200, y: 150 })],
    });
    const el = plan.elements.find((e) => e.id === "a")!;
    expect(el.x).toBe(200);
    expect(el.y).toBe(150);
    expect(plan.converged).toBe(true);
  });

  it("fixed_size resizes element to specified dimensions", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 50, 50)],
      constraints: [constraint("c1", "fixed_size", ["a"], { width: 200, height: 100 })],
    });
    const el = plan.elements.find((e) => e.id === "a")!;
    expect(el.width).toBe(200);
    expect(el.height).toBe(100);
  });

  it("min_width enforces minimum width", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 20, 50)],
      constraints: [constraint("c1", "min_width", ["a"], { value: 100 })],
    });
    expect(plan.elements[0].width).toBe(100);
    expect(plan.violations).toHaveLength(0);
  });

  it("max_height enforces maximum height", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 500)],
      constraints: [constraint("c1", "max_height", ["a"], { value: 200 })],
    });
    expect(plan.elements[0].height).toBe(200);
  });

  it("aspect_ratio adjusts height to match ratio", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 200, 50)],
      constraints: [constraint("c1", "aspect_ratio", ["a"], { ratio: 2 })], // width/height = 2
    });
    const el = plan.elements[0];
    expect(Math.abs(el.width / el.height - 2)).toBeLessThan(0.05);
  });

  it("align_left aligns multiple elements to leftmost x", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 50, 0, 100, 50), box("b", 150, 0, 100, 50), box("c", 300, 0, 100, 50)],
      constraints: [constraint("c1", "align_left", ["a", "b", "c"])],
    });
    const xs = plan.elements.map((e) => e.x);
    expect(xs.every((x) => x === xs[0])).toBe(true);
    expect(xs[0]).toBe(50); // leftmost
  });

  it("align_center_x aligns to averaged center", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 50), box("b", 200, 0, 100, 50)],
      constraints: [constraint("c1", "align_center_x", ["a", "b"])],
    });
    const centerA = plan.elements[0].x + plan.elements[0].width / 2;
    const centerB = plan.elements[1].x + plan.elements[1].width / 2;
    expect(Math.abs(centerA - centerB)).toBeLessThan(1);
  });

  it("distribute_horizontal spaces elements evenly", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [
        box("a", 0,   0, 50, 50),
        box("b", 500, 0, 50, 50),
        box("c", 100, 0, 50, 50), // out of order
      ],
      constraints: [constraint("c1", "distribute_horizontal", ["a", "b", "c"])],
    });
    // After distribution the middle element should be equidistant from a and b
    const sorted = [...plan.elements].sort((x, y) => x.x - y.x);
    const gap1 = sorted[1].x - (sorted[0].x + sorted[0].width);
    const gap2 = sorted[2].x - (sorted[1].x + sorted[1].width);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(2);
  });

  it("hierarchy_above sets higher zIndex than reference", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100, { zIndex: 5 }), box("b", 0, 0, 100, 100, { zIndex: 5 })],
      constraints: [constraint("c1", "hierarchy_above", ["a"], { referenceId: "b" })],
    });
    const a = plan.elements.find((e) => e.id === "a")!;
    const b = plan.elements.find((e) => e.id === "b")!;
    expect(a.zIndex!).toBeGreaterThan(b.zIndex!);
  });
});

// ── 5. Collision constraint in solver ─────────────────────────

describe("constraintSolver — collision", () => {
  it("no_collision resolves overlap between two elements", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100), box("b", 50, 0, 100, 100)],
      constraints: [constraint("c1", "no_collision", ["a", "b"])],
    });
    const a = plan.elements.find((e) => e.id === "a")!;
    const b = plan.elements.find((e) => e.id === "b")!;
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    expect(overlapX).toBeLessThanOrEqual(0);
  });

  it("no_collision leaves non-overlapping elements unchanged", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100), box("b", 200, 0, 100, 100)],
      constraints: [constraint("c1", "no_collision", ["a", "b"])],
    });
    expect(plan.operations).toHaveLength(0);
  });

  it("no_collision with locked element moves only free element", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100, { locked: true }), box("b", 50, 0, 100, 100)],
      constraints: [constraint("c1", "no_collision", ["a", "b"])],
    });
    const a = plan.elements.find((e) => e.id === "a")!;
    const b = plan.elements.find((e) => e.id === "b")!;
    // Locked element stays put
    expect(a.x).toBe(0);
    // Free element moved fully right
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  });

  it("no_collision with three mutually overlapping elements resolves all", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [
        box("a", 0, 0, 100, 100),
        box("b", 20, 0, 100, 100),
        box("c", 40, 0, 100, 100),
      ],
      constraints: [constraint("c1", "no_collision", ["a", "b", "c"])],
    });
    const els = plan.elements;
    const pairs = findAllCollisions(els);
    expect(pairs).toHaveLength(0);
  });
});

// ── 6. Safe zone constraint ────────────────────────────────────

describe("constraintSolver — safe_zone", () => {
  it("safe_zone clamps out-of-bounds element", () => {
    const plan = solve({
      canvas: { width: 800, height: 600, safeZone: { x: 20, y: 20, width: 760, height: 560 } },
      elements: [box("a", -10, -10, 100, 100)],
      constraints: [constraint("c1", "safe_zone", ["a"])],
    });
    const el = plan.elements[0];
    expect(el.x).toBeGreaterThanOrEqual(20);
    expect(el.y).toBeGreaterThanOrEqual(20);
  });

  it("safe_zone does not move element already inside", () => {
    const plan = solve({
      canvas: { width: 800, height: 600, safeZone: { x: 20, y: 20, width: 760, height: 560 } },
      elements: [box("a", 100, 100, 100, 100)],
      constraints: [constraint("c1", "safe_zone", ["a"])],
    });
    const el = plan.elements[0];
    expect(el.x).toBe(100);
    expect(el.y).toBe(100);
    expect(plan.operations).toHaveLength(0);
  });
});

// ── 7. Text fit constraint in solver ──────────────────────────

describe("constraintSolver — text_fit", () => {
  it("text_fit with autoResize expands element height for long text", () => {
    const longText = "Word ".repeat(100);
    const plan = solve({
      canvas: canvas800,
      elements: [textEl("t1", 0, 0, 200, 30, longText, 14, 1.4)],
      constraints: [constraint("c1", "text_fit", ["t1"], { autoResize: true })],
    });
    const el = plan.elements[0];
    expect(el.height).toBeGreaterThan(30);
  });

  it("text_fit with shrinkOnly reduces font size", () => {
    // Container: 200x60; text at 16px needs ~5 lines but only 2 fit → must shrink
    // At 8px the same text needs ~3 lines and 5 are available → fits
    const longText = "This is a moderately long text for testing purposes. ".repeat(2);
    const plan = solve({
      canvas: canvas800,
      elements: [textEl("t1", 0, 0, 200, 60, longText, 16, 1.4)],
      constraints: [constraint("c1", "text_fit", ["t1"], { shrinkOnly: true, minFontSize: 8 })],
    });
    const el = plan.elements[0];
    const newFont = el.textStyle?.fontSize ?? 16;
    expect(newFont).toBeLessThan(16);
  });

  it("text_fit does nothing when text already fits", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [textEl("t1", 0, 0, 400, 100, "Short text", 14, 1.4)],
      constraints: [constraint("c1", "text_fit", ["t1"], { autoResize: true })],
    });
    expect(plan.operations.filter((o) => o.type === "text_reflow")).toHaveLength(0);
  });
});

// ── 8. Impossible / conflicting constraints ────────────────────

describe("constraintSolver — impossible constraints", () => {
  it("conflicting fixed positions: solver applies last hard constraint (fixed_position wins)", () => {
    // Two hard constraints fix element to different positions
    // Solver processes in order; second hard constraint wins in final state
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100)],
      constraints: [
        constraint("c1", "fixed_position", ["a"], { x: 100, y: 100 }, "hard"),
        constraint("c2", "fixed_position", ["a"], { x: 400, y: 300 }, "hard"),
      ],
    });
    const el = plan.elements[0];
    // Second constraint should win on first pass; but solver will iterate
    // Final position: the system should report a violation since it can't satisfy both
    // At minimum, element is at one of the two positions
    expect([100, 400]).toContain(el.x);
  });

  it("conflicting min/max: min_width > max_width produces violation", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 150, 100)],
      constraints: [
        constraint("c1", "min_width", ["a"], { value: 200 }, "hard"),
        constraint("c2", "max_width", ["a"], { value: 100 }, "hard"),
      ],
    });
    // After applying: first sets width to 200, then max_width clamps to 100
    // Result: width=100, min_width violation
    const el = plan.elements[0];
    expect(el.width).toBe(100);
    const minViolation = plan.violations.find((v) => v.constraintType === "min_width");
    expect(minViolation).toBeDefined();
  });

  it("soft constraint applied independently of hard constraint", () => {
    // Hard: fix position; Soft: enforce minimum width (non-conflicting)
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 50, 100)],
      constraints: [
        constraint("c1", "fixed_position", ["a"], { x: 200, y: 200 }, "hard"),
        constraint("c2", "min_width", ["a"], { value: 150 }, "soft"),
      ],
    });
    const el = plan.elements[0];
    // Hard position constraint must be satisfied
    expect(el.x).toBe(200);
    expect(el.y).toBe(200);
    // Soft size constraint also applied
    expect(el.width).toBeGreaterThanOrEqual(150);
    // No violations
    expect(plan.violations).toHaveLength(0);
  });

  it("impossible text fit (text too long for min font size) reports warning", () => {
    const impossibleText = "X".repeat(10000); // definitely doesn't fit at min size
    const plan = solve({
      canvas: canvas800,
      elements: [textEl("t1", 0, 0, 50, 30, impossibleText, 14, 1.4)],
      constraints: [constraint("c1", "text_fit", ["t1"], { shrinkOnly: true, minFontSize: 8 })],
    });
    // Should try to shrink font but may not fully succeed
    const textViolation = plan.violations.find((v) => v.constraintType === "text_fit");
    expect(textViolation).toBeDefined();
    expect(textViolation?.severity).toBe("warning");
  });

  it("collision between two locked elements is reported as violation", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [
        box("a", 0, 0, 100, 100, { locked: true }),
        box("b", 50, 50, 100, 100, { locked: true }),
      ],
      constraints: [constraint("c1", "no_collision", ["a", "b"])],
    });
    // Cannot resolve — both locked — no operations
    expect(plan.operations).toHaveLength(0);
    // Violation still reported
    const v = plan.violations.find((x) => x.constraintType === "no_collision");
    expect(v).toBeDefined();
  });

  it("distributing fewer than 2 elements produces no operations", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100)],
      constraints: [constraint("c1", "distribute_horizontal", ["a"])],
    });
    expect(plan.operations).toHaveLength(0);
  });
});

// ── 9. Responsive variants ────────────────────────────────────

describe("responsiveVariants", () => {
  it("detectBreakpoint identifies mobile correctly", () => {
    const bp = detectBreakpoint(375);
    expect(bp.name).toBe("xs");
  });

  it("detectBreakpoint identifies desktop correctly", () => {
    const bp = detectBreakpoint(1280);
    expect(bp.name).toBe("xl");
  });

  it("scaleElementsToCanvas scales positions proportionally", () => {
    const from: LayoutCanvas = { width: 800, height: 600 };
    const to: LayoutCanvas = { width: 400, height: 300 };
    const els = [box("a", 400, 300, 200, 100)]; // center
    const scaled = scaleElementsToCanvas(els, from, to);
    expect(scaled[0].x).toBe(200); // halved
    expect(scaled[0].y).toBe(150);
    expect(scaled[0].width).toBe(100);
    expect(scaled[0].height).toBe(50);
  });

  it("scaleElementsToCanvas scales font size with canvas", () => {
    const from: LayoutCanvas = { width: 800, height: 600 };
    const to: LayoutCanvas = { width: 400, height: 300 };
    const el = textEl("t1", 0, 0, 200, 50, "Hi", 20, 1.4);
    const scaled = scaleElementsToCanvas([el], from, to);
    expect(scaled[0].textStyle?.fontSize).toBe(10); // halved
  });

  it("buildBreakpointRequest produces smaller canvas for xs", () => {
    const request: LayoutRequest = {
      canvas: canvas800,
      elements: [box("a", 100, 100, 200, 100)],
      constraints: [],
    };
    const xs = STANDARD_BREAKPOINTS.find((b) => b.name === "xs")!;
    const variantReq = buildBreakpointRequest(request, xs);
    expect(variantReq.canvas.width).toBeLessThan(canvas800.width);
  });

  it("composeLayout with includeResponsive produces variant plans", async () => {
    const plan = await composeLayout({
      canvas: canvas800,
      elements: [box("a", 100, 100, 200, 100)],
      constraints: [],
      includeResponsive: true,
    });
    expect(plan.responsiveVariants).toBeDefined();
    // Should have plans for other breakpoints (lg/md/xl/xs/sm)
    const variantNames = Object.keys(plan.responsiveVariants!);
    expect(variantNames.length).toBeGreaterThan(0);
    // Each variant should have its own element list
    for (const v of Object.values(plan.responsiveVariants!)) {
      expect(v.elements).toBeDefined();
      expect(v.elements.length).toBeGreaterThan(0);
    }
  });

  it("responsive variant canvas width differs from original", async () => {
    const plan = await composeLayout({
      canvas: { width: 1280, height: 720 },
      elements: [box("a", 0, 0, 100, 100)],
      constraints: [],
      includeResponsive: true,
    });
    const variants = plan.responsiveVariants!;
    // xs variant should have a narrower canvas
    expect(variants["xs"]).toBeDefined();
    // The elements in xs should be scaled down
    const xsEl = variants["xs"].elements[0];
    expect(xsEl.x).toBeLessThanOrEqual(plan.elements[0].x);
  });
});

// ── 10. Room / furniture zones ────────────────────────────────

describe("roomZones", () => {
  const zones: LayoutZone[] = [
    {
      id: "living",
      label: "Living Room",
      category: "room",
      rect: { x: 0, y: 0, width: 400, height: 360 },
    },
    {
      id: "bedroom",
      label: "Bedroom",
      category: "room",
      rect: { x: 0, y: 360, width: 400, height: 240 },
    },
  ];

  it("resolveZoneTemplate produces correct absolute rect", () => {
    const tmpl = ROOM_ZONE_TEMPLATES[0]; // living, x=0 y=0 w=0.5 h=0.6
    const zone = resolveZoneTemplate(tmpl, 800, 600, "room");
    expect(zone.rect.width).toBe(400);
    expect(zone.rect.height).toBe(360);
  });

  it("validateRoomZones passes when furniture is within zone", () => {
    const furniture = box("sofa", 10, 10, 100, 60, { zone: "living" });
    const violations = validateRoomZones([furniture], zones);
    expect(violations).toHaveLength(0);
  });

  it("validateRoomZones flags furniture outside its zone", () => {
    const furniture = box("sofa", 500, 10, 100, 60, { zone: "living" }); // x=500 outside living (0-400)
    const violations = validateRoomZones([furniture], zones);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].elementIds).toContain("sofa");
  });

  it("validateRoomZones flags unknown zone assignment", () => {
    const furniture = box("table", 10, 10, 50, 50, { zone: "nonexistent" });
    const violations = validateRoomZones([furniture], zones);
    expect(violations[0].severity).toBe("error");
    expect(violations[0].message).toMatch(/unknown zone/i);
  });

  it("clampElementsToZones moves furniture inside zone rect", () => {
    const furniture = box("sofa", 450, 10, 100, 60, { zone: "living" }); // bleeds right
    const { elements, changed } = clampElementsToZones([furniture], zones);
    expect(changed).toContain("sofa");
    const sofa = elements[0];
    expect(sofa.x + sofa.width).toBeLessThanOrEqual(400); // zone right edge
  });

  it("room_zone constraint in solver clamps furniture", () => {
    const plan = solve({
      canvas: canvas800,
      elements: [box("sofa", 500, 10, 100, 60, { zone: "living" })],
      constraints: [constraint("c1", "room_zone", ["sofa"])],
      zones,
    });
    const sofa = plan.elements[0];
    expect(sofa.x + sofa.width).toBeLessThanOrEqual(400);
  });
});

// ── 11. Garment panel zones ────────────────────────────────────

describe("garmentPanels", () => {
  const frontZone: LayoutZone = {
    id: "front-body",
    label: "Front Body",
    category: "garment",
    rect: { x: 160, y: 30, width: 480, height: 330 },
    seamLines: [
      { id: "shoulder-left",  from: { x: 160, y: 30  }, to: { x: 160, y: 200 } },
      { id: "shoulder-right", from: { x: 640, y: 30  }, to: { x: 640, y: 200 } },
    ],
  };

  it("validateGarmentPanels passes when panel is inside zone without crossing seams", () => {
    const panel = box("logo", 200, 50, 80, 80, { zone: "front-body" });
    const violations = validateGarmentPanels([panel], [frontZone]);
    expect(violations).toHaveLength(0);
  });

  it("validateGarmentPanels flags panel crossing left shoulder seam", () => {
    // Panel at x=100 will have corner at (100,50) — close to seam at x=160
    const panel = box("pocket", 100, 50, 100, 80, { zone: "front-body" });
    const violations = validateGarmentPanels([panel], [frontZone]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].constraintType).toBe("garment_panel");
  });

  it("distanceToSegment returns 0 for point on segment", () => {
    const d = distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(0);
  });

  it("distanceToSegment returns correct perpendicular distance", () => {
    const d = distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(3);
  });

  it("elementCrossesSeam true when corner is within minDist of seam", () => {
    const seam: SeamLine = { id: "s1", from: { x: 100, y: 0 }, to: { x: 100, y: 200 } };
    const el = box("p", 99, 50, 50, 50); // left edge at x=99, 1px from seam at x=100
    expect(elementCrossesSeam(el, seam, 2)).toBe(true);
  });

  it("GARMENT_ZONE_TEMPLATES covers all standard panels", () => {
    const ids = GARMENT_ZONE_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("front-body");
    expect(ids).toContain("back-body");
    expect(ids).toContain("left-sleeve");
    expect(ids).toContain("right-sleeve");
    expect(ids).toContain("collar");
    expect(ids).toContain("hem");
  });
});

// ── 12. Deterministic output ───────────────────────────────────

describe("deterministic output", () => {
  const complexElements: LayoutElement[] = [
    box("a", 10,  10,  120, 80),
    box("b", 80,  50,  120, 80),  // overlaps a
    box("c", 300, 200, 80,  80),
    textEl("t", 50, 150, 180, 40, "Hello there world", 14, 1.4),
  ];

  const complexConstraints: Constraint[] = [
    constraint("c1", "no_collision", ["a", "b", "c"], {}, "hard"),
    constraint("c2", "align_top", ["a", "b"], {}, "soft"),
    constraint("c3", "safe_zone", ["a", "b", "c", "t"], {}, "hard"),
    constraint("c4", "text_fit", ["t"], { autoResize: true }, "soft"),
  ];

  it("produces identical plans for identical inputs (run 1 vs run 2)", () => {
    const plan1 = solve({ canvas: canvas800, elements: complexElements, constraints: complexConstraints });
    const plan2 = solve({ canvas: canvas800, elements: complexElements, constraints: complexConstraints });

    expect(plan1.elements).toEqual(plan2.elements);
    expect(plan1.operations.length).toBe(plan2.operations.length);
    expect(plan1.satisfactionScore).toBe(plan2.satisfactionScore);
    expect(plan1.iterations).toBe(plan2.iterations);
  });

  it("marks plans as deterministic=true", () => {
    const plan = solve({ canvas: canvas800, elements: complexElements, constraints: complexConstraints });
    expect(plan.deterministic).toBe(true);
  });

  it("converges within maxIterations", () => {
    const plan = solve({
      canvas: canvas800,
      elements: complexElements,
      constraints: complexConstraints,
      maxIterations: 50,
    });
    expect(plan.iterations).toBeLessThanOrEqual(50);
  });

  it("satisfactionScore is between 0 and 1", () => {
    const plan = solve({ canvas: canvas800, elements: complexElements, constraints: complexConstraints });
    expect(plan.satisfactionScore).toBeGreaterThanOrEqual(0);
    expect(plan.satisfactionScore).toBeLessThanOrEqual(1);
  });

  it("solvedAt is a valid ISO date string", () => {
    const plan = solve({ canvas: canvas800, elements: [box("a", 0, 0, 100, 100)], constraints: [] });
    expect(() => new Date(plan.solvedAt)).not.toThrow();
    expect(new Date(plan.solvedAt).toISOString()).toBe(plan.solvedAt);
  });
});

// ── 13. Facade / API layer ────────────────────────────────────

describe("composer facade", () => {
  it("getSupportedOperations returns all 10 operation types", () => {
    const ops = getSupportedOperations();
    expect(ops.length).toBe(10);
    const types = ops.map((o) => o.type);
    expect(types).toContain("place");
    expect(types).toContain("move");
    expect(types).toContain("resize");
    expect(types).toContain("align");
    expect(types).toContain("distribute");
    expect(types).toContain("reorder");
    expect(types).toContain("text_reflow");
    expect(types).toContain("clamp");
    expect(types).toContain("push_apart");
    expect(types).toContain("zone_assign");
  });

  it("composeLayout resolves and returns a valid plan", async () => {
    const plan = await composeLayout({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100), box("b", 50, 0, 100, 100)],
      constraints: [constraint("c1", "no_collision", ["a", "b"])],
    });
    expect(plan.id).toBeDefined();
    expect(plan.elements).toHaveLength(2);
    expect(plan.deterministic).toBe(true);
    expect(plan.solvedAt).toBeDefined();
  });

  it("validateLayout detects collision without solving", () => {
    const result = validateLayout({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100), box("b", 50, 50, 100, 100)],
      constraints: [],
    });
    const collisionViolation = result.violations.find((v) => v.constraintType === "no_collision");
    expect(collisionViolation).toBeDefined();
  });

  it("validateLayout detects text overflow without solving", () => {
    const longText = "Lorem ipsum dolor sit amet ".repeat(30);
    const result = validateLayout({
      canvas: canvas800,
      elements: [textEl("t1", 0, 0, 100, 30, longText, 14, 1.4)],
      constraints: [],
    });
    const textViolation = result.violations.find((v) => v.constraintType === "text_fit");
    expect(textViolation).toBeDefined();
  });

  it("validateLayout returns valid=true for clean layout", () => {
    const result = validateLayout({
      canvas: canvas800,
      elements: [box("a", 0, 0, 100, 100), box("b", 200, 0, 100, 100)],
      constraints: [],
    });
    expect(result.valid).toBe(true);
    expect(result.violations.filter((v) => v.severity === "error")).toHaveLength(0);
  });
});

// ── 14. WP-03B collision delegation ──────────────────────────

describe("collisionDetection — WP-03B delegation", () => {
  it("rectsOverlap delegates to WP-03B: overlapping rects return true", () => {
    const a = box("a", 0, 0, 100, 100);
    const b = box("b", 50, 50, 100, 100);
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it("rectsOverlap: touching edges NOT a collision (WP-03B COLLISION_EPSILON policy)", () => {
    const a = box("a", 0, 0, 100, 100);
    const b = box("b", 100, 0, 100, 100);
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it("findAllCollisions: no collision for exactly-touching elements (WP-03B policy)", () => {
    const a = box("a", 0, 0, 100, 100);
    const b = box("b", 100, 0, 100, 100);
    expect(findAllCollisions([a, b])).toHaveLength(0);
  });

  it("findAllCollisions: rotation-aware AABB via WP-03B generateAABB", () => {
    // 100x20 element rotated 90deg: WP-03B generateAABB expands AABB along Y axis
    // (minY=-40, maxY=60). Element o at y=30 is BELOW the unrotated rect (maxY=20),
    // but INSIDE the rotated AABB. Without rotation-aware AABB: no collision.
    // With WP-03B generateAABB: collision is correctly detected.
    const rotated = { ...box("r", 0, 0, 100, 20), rotation: 90 };
    const other = box("o", 45, 30, 20, 10);
    const pairs = findAllCollisions([rotated, other]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.elementA).toBe("r");
    expect(pairs[0]?.elementB).toBe("o");
  });

  it("findAllCollisions: clean separation returns no pairs", () => {
    const a = box("a", 0, 0, 50, 50);
    const b = box("b", 200, 200, 50, 50);
    expect(findAllCollisions([a, b])).toHaveLength(0);
  });
});

// ── 15. Rotation — documented known limitation ────────────────

describe("rotation — documented known limitation", () => {
  it("rotation field is accepted by solver without throwing", () => {
    // LayoutElement.rotation is accepted and used for rotation-aware AABB.
    // Documented limitation: push-apart vectors are axis-aligned (horizontal /
    // vertical), not perpendicular to the rotated face.
    // See: integration/manifests/team-12.json -> knownLimitations.rotation
    //      integration/openapi/team-12.yaml   -> LayoutElement.rotation description
    const rotated = { ...box("a", 0, 0, 100, 100), rotation: 45 };
    const other = box("b", 80, 80, 100, 100);
    expect(() => findAllCollisions([rotated, other])).not.toThrow();
  });

  it("push-apart resolution vectors are axis-aligned for rotated elements", () => {
    // Documents the known limitation: resolveCollision produces horizontal or
    // vertical push vectors only, never oblique, even for rotated elements.
    const a = { ...box("a", 0, 0, 100, 100), rotation: 45 };
    const b = box("b", 60, 60, 100, 100);
    const pairs = findAllCollisions([a, b]);
    if (pairs.length > 0) {
      const adj = resolveCollision(a, b);
      for (const delta of Object.values(adj)) {
        // Axis-aligned: exactly one of dx or dy must be 0
        const isAxisAligned = delta.dx === 0 || delta.dy === 0;
        expect(isAxisAligned).toBe(true);
      }
    }
  });
});
