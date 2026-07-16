/**
 * Visual QA Service — Unit Tests
 *
 * Coverage:
 *  1. WCAG colour math (hexToRgb, relativeLuminance, contrastRatio, bestTextColor)
 *  2. Effective background resolution (getEffectiveBg)
 *  3. Bounds checking and clamping (checkBounds, clampToBounds)
 *  4. Contrast auto-fix (autoFixContrast)
 *  5. QA score computation (computeQaScore)
 *  6. Full pipeline (runVisualQa)
 */

import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  bestTextColor,
  getEffectiveBg,
  checkBounds,
  clampToBounds,
  autoFixContrast,
  computeQaScore,
  runVisualQa,
} from "../visualQaService.js";
import type { AiTemplateProposal } from "../../../validators/designTemplateAiSchema.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<AiTemplateProposal["template"]> = {}): AiTemplateProposal {
  return {
    summary: "Test template",
    assumptions: [],
    warnings: [],
    variables: [],
    template: {
      name: "Test",
      canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
      elements: [],
      variables: [],
      ...overrides,
    },
  };
}

type AnyEl = AiTemplateProposal["template"]["elements"][number];

function textEl(overrides: Partial<{
  id: string; x: number; y: number; width: number; height: number;
  zIndex: number; color: string; fontSize: number; fontWeight: number | "bold" | "normal";
}>): AnyEl {
  return {
    id:      overrides.id      ?? "t1",
    type:    "text",
    x:       overrides.x      ?? 0,
    y:       overrides.y      ?? 0,
    width:   overrides.width  ?? 200,
    height:  overrides.height ?? 50,
    zIndex:  overrides.zIndex ?? 1,
    content: "Hello",
    color:   overrides.color  ?? "#000000",
    fontSize: overrides.fontSize ?? 16,
    ...(overrides.fontWeight !== undefined ? { fontWeight: overrides.fontWeight } : {}),
  } as AnyEl;
}

function shapeEl(overrides: Partial<{
  id: string; x: number; y: number; width: number; height: number;
  zIndex: number; fill: string;
}>): AnyEl {
  return {
    id:     overrides.id     ?? "s1",
    type:   "shape",
    shape:  "rectangle",
    x:      overrides.x     ?? 0,
    y:      overrides.y     ?? 0,
    width:  overrides.width ?? 1080,
    height: overrides.height ?? 1080,
    zIndex: overrides.zIndex ?? 0,
    fill:   overrides.fill  ?? "#1e40af",
  } as AnyEl;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. WCAG colour math
// ─────────────────────────────────────────────────────────────────────────────

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#1e40af")).toEqual([30, 64, 175]);
  });

  it("parses 3-digit hex (shorthand)", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#f00")).toEqual([255, 0, 0]);
  });

  it("returns null for invalid input", () => {
    expect(hexToRgb("red")).toBeNull();
    expect(hexToRgb("#zzzzzz")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("returns 1 for white", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 4);
  });

  it("returns 0 for black", () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 4);
  });

  it("returns mid-range for grey", () => {
    const l = relativeLuminance(128, 128, 128);
    expect(l).toBeGreaterThan(0.1);
    expect(l).toBeLessThan(0.3);
  });
});

describe("contrastRatio", () => {
  it("black on white = 21:1", () => {
    const r = contrastRatio("#000000", "#ffffff");
    expect(r).toBeCloseTo(21, 0);
  });

  it("white on white = 1:1", () => {
    const r = contrastRatio("#ffffff", "#ffffff");
    expect(r).toBeCloseTo(1, 4);
  });

  it("returns null for invalid hex", () => {
    expect(contrastRatio("red", "#ffffff")).toBeNull();
    expect(contrastRatio("#ffffff", "rgb(0,0,0)")).toBeNull();
  });

  it("ratio is symmetric", () => {
    const r1 = contrastRatio("#1e40af", "#ffffff");
    const r2 = contrastRatio("#ffffff", "#1e40af");
    expect(r1).toBeCloseTo(r2!, 4);
  });
});

describe("bestTextColor", () => {
  it("chooses white for dark backgrounds", () => {
    expect(bestTextColor("#000000")).toBe("#ffffff");
    expect(bestTextColor("#1e40af")).toBe("#ffffff");
  });

  it("chooses black for light backgrounds", () => {
    expect(bestTextColor("#ffffff")).toBe("#000000");
    expect(bestTextColor("#f9fafb")).toBe("#000000");
  });

  it("falls back to black for invalid input", () => {
    expect(bestTextColor("not-a-color")).toBe("#000000");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Effective background resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("getEffectiveBg", () => {
  it("returns canvas bg when no shapes overlap", () => {
    const el = textEl({ x: 100, y: 100, zIndex: 1 });
    // Shape does NOT overlap (different position)
    const shape = shapeEl({ x: 500, y: 500, width: 100, height: 100, zIndex: 0 });
    const result = getEffectiveBg(el, [el, shape], "#ffffff");
    expect(result.source).toBe("canvas");
    expect(result.color).toBe("#ffffff");
  });

  it("resolves the topmost overlapping shape", () => {
    const el = textEl({ x: 50, y: 50, width: 100, height: 50, zIndex: 5 });
    const bgLow  = shapeEl({ id: "bg1", x: 0, y: 0, width: 1080, height: 1080, zIndex: 1, fill: "#ff0000" });
    const bgHigh = shapeEl({ id: "bg2", x: 0, y: 0, width: 1080, height: 1080, zIndex: 3, fill: "#00ff00" });
    const result = getEffectiveBg(el, [el, bgLow, bgHigh], "#ffffff");
    expect(result.source).toBe("shape");
    expect(result.color).toBe("#00ff00"); // higher zIndex wins
  });

  it("falls through transparent shapes to canvas bg", () => {
    const el = textEl({ x: 50, y: 50, width: 100, height: 50, zIndex: 2 });
    // Shape with no fill (undefined) — should not match
    const transparentShape = {
      id: "s-transparent",
      type: "shape" as const,
      shape: "rectangle" as const,
      x: 0, y: 0, width: 1080, height: 1080,
      zIndex: 1,
    } as AnyEl;
    const result = getEffectiveBg(el, [el, transparentShape], "#1e40af");
    expect(result.source).toBe("canvas");
    expect(result.color).toBe("#1e40af");
  });

  it("returns fallback #ffffff when canvas bg is also invalid", () => {
    const el = textEl({ x: 0, y: 0, zIndex: 1 });
    const result = getEffectiveBg(el, [el], "not-a-hex");
    expect(result.source).toBe("fallback");
    expect(result.color).toBe("#ffffff");
  });

  it("signals gradientSkip for gradient-fill shapes", () => {
    const el = textEl({ x: 0, y: 0, width: 200, height: 100, zIndex: 2 });
    const gradBg = {
      id: "gb",
      type: "shape" as const,
      shape: "rectangle" as const,
      x: 0, y: 0, width: 1080, height: 1080,
      zIndex: 1,
      fill: { type: "linear" as const, angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] },
    } as AnyEl;
    const result = getEffectiveBg(el, [el, gradBg], "#ffffff");
    expect(result.gradientSkip).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Bounds checking and clamping
// ─────────────────────────────────────────────────────────────────────────────

describe("checkBounds", () => {
  const CW = 1080, CH = 1080;

  it("reports no issues for elements fully within canvas", () => {
    const el = textEl({ x: 60, y: 60, width: 960, height: 100, zIndex: 1 });
    expect(checkBounds([el], CW, CH)).toHaveLength(0);
  });

  it("reports negative x and y", () => {
    const el = textEl({ x: -10, y: -5, width: 200, height: 50, zIndex: 1 });
    const issues = checkBounds([el], CW, CH);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.description).toMatch(/x=-10/);
    expect(issues[0]!.description).toMatch(/y=-5/);
  });

  it("reports right edge exceeding canvas width", () => {
    // x=1000, width=200 → right edge = 1200 > 1080
    const el = textEl({ x: 1000, y: 0, width: 200, height: 50, zIndex: 1 });
    const issues = checkBounds([el], CW, CH);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.description).toMatch(/right edge 1200 > 1080/);
  });

  it("reports bottom edge exceeding canvas height", () => {
    const el = textEl({ x: 0, y: 1000, width: 200, height: 200, zIndex: 1 });
    const issues = checkBounds([el], CW, CH);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.description).toMatch(/bottom edge 1200 > 1080/);
  });

  it("catches element positioned exactly at right edge (x = canvasW)", () => {
    // This was the previous bug: x=1080, width=100 → right=1180 > 1080
    const el = textEl({ x: 1080, y: 0, width: 100, height: 50, zIndex: 1 });
    const issues = checkBounds([el], CW, CH);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("clampToBounds", () => {
  const CW = 1080, CH = 1080;

  it("leaves in-bounds elements unchanged", () => {
    const el = textEl({ x: 60, y: 60, width: 960, height: 100 });
    const out = clampToBounds(el, CW, CH);
    expect(out.x).toBe(60);
    expect(out.y).toBe(60);
    expect(out.width).toBe(960);
    expect(out.height).toBe(100);
  });

  it("clamps negative x/y to 0", () => {
    const el = textEl({ x: -50, y: -20, width: 200, height: 50 });
    const out = clampToBounds(el, CW, CH);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it("clamps right edge: x + width ≤ canvasW", () => {
    const el = textEl({ x: 1000, y: 0, width: 200, height: 50 });
    const out = clampToBounds(el, CW, CH);
    expect(out.x + out.width).toBeLessThanOrEqual(CW);
    expect(out.width).toBeGreaterThanOrEqual(1);
  });

  it("clamps bottom edge: y + height ≤ canvasH", () => {
    const el = textEl({ x: 0, y: 1000, width: 200, height: 200 });
    const out = clampToBounds(el, CW, CH);
    expect(out.y + out.height).toBeLessThanOrEqual(CH);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it("handles element that starts beyond canvas width", () => {
    // x = 1080 (== canvasW): should be clamped to canvasW-1 = 1079, width at least 1
    const el = textEl({ x: 1080, y: 0, width: 100, height: 50 });
    const out = clampToBounds(el, CW, CH);
    expect(out.x).toBeLessThan(CW);
    expect(out.x + out.width).toBeLessThanOrEqual(CW);
  });

  it("preserves element type and non-geometry fields", () => {
    const el = textEl({ x: 0, y: 0, color: "#ff0000" });
    const out = clampToBounds(el, CW, CH);
    expect(out.type).toBe("text");
    expect((out as any).color).toBe("#ff0000");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Contrast auto-fix
// ─────────────────────────────────────────────────────────────────────────────

describe("autoFixContrast", () => {
  const canvasBg = "#ffffff";

  it("leaves elements with sufficient contrast unchanged", () => {
    // Black text on white bg → 21:1 → passes
    const el = textEl({ color: "#000000" });
    const { elements, issues } = autoFixContrast([el], canvasBg);
    expect(issues).toHaveLength(0);
    expect((elements[0] as any).color).toBe("#000000");
  });

  it("auto-fixes white text on white canvas background", () => {
    const el = textEl({ color: "#ffffff", zIndex: 1 });
    const { elements, issues } = autoFixContrast([el], "#ffffff");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.autoFixed).toBe(true);
    // Best color against white is black
    expect((elements[0] as any).color).toBe("#000000");
    expect(issues[0]!.newColor).toBe("#000000");
  });

  it("auto-fixes white text on white shape background", () => {
    const bg = shapeEl({ x: 0, y: 0, width: 1080, height: 1080, zIndex: 0, fill: "#ffffff" });
    const el = textEl({ x: 0, y: 0, width: 200, height: 50, zIndex: 1, color: "#ffffff" });
    const { elements, issues } = autoFixContrast([bg, el], "#000000");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.bgSource).toBe("shape");
    expect(issues[0]!.bgColor).toBe("#ffffff");
    expect((elements.find(e => e.id === "t1") as any).color).toBe("#000000");
  });

  it("auto-fixes black text on dark blue background", () => {
    const bg = shapeEl({ x: 0, y: 0, width: 1080, height: 1080, zIndex: 0, fill: "#1e40af" });
    const el = textEl({ x: 0, y: 0, width: 200, height: 50, zIndex: 1, color: "#000000" });
    const { elements, issues } = autoFixContrast([bg, el], "#ffffff");
    expect(issues).toHaveLength(1);
    // Best color against dark blue should be white
    expect(issues[0]!.newColor).toBe("#ffffff");
    expect((elements.find(e => e.id === "t1") as any).color).toBe("#ffffff");
  });

  it("does not fix non-text elements", () => {
    const shape = shapeEl({ fill: "#ffffff" });
    const { elements, issues } = autoFixContrast([shape], "#ffffff");
    expect(issues).toHaveLength(0);
    expect(elements[0]).toBe(shape);
  });

  it("applies WCAG AA LARGE threshold (3:1) for big text", () => {
    // #767676 on white = ~4.54:1 (just above AA NORMAL 4.5:1) → passes both thresholds
    // Use a colour that is strictly between 3.0 and 4.5 against white.
    // #919191 ≈ 3.53:1 on white: passes AA LARGE (≥3.0) but fails AA NORMAL (<4.5).
    // At fontSize=24 (large text), threshold = 3.0 → should PASS → no issue emitted.
    const el = textEl({ color: "#919191", fontSize: 24 });
    const { issues } = autoFixContrast([el], "#ffffff");
    expect(issues).toHaveLength(0);
  });

  it("emits gradientSkip warning and does NOT change color for gradient background", () => {
    const gradBg = {
      id: "gb",
      type: "shape" as const,
      shape: "rectangle" as const,
      x: 0, y: 0, width: 1080, height: 1080,
      zIndex: 0,
      fill: { type: "linear" as const, angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] },
    } as AnyEl;
    const el = textEl({ x: 0, y: 0, width: 200, height: 50, zIndex: 1, color: "#ffffff" });
    const { elements, issues } = autoFixContrast([gradBg, el], "#ffffff");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.gradientSkip).toBe(true);
    expect(issues[0]!.autoFixed).toBe(false);
    // Color must NOT be changed
    expect((elements.find(e => e.id === "t1") as any).color).toBe("#ffffff");
  });

  it("handles multiple failing text elements independently", () => {
    const bg = shapeEl({ x: 0, y: 0, width: 1080, height: 1080, zIndex: 0, fill: "#1e40af" });
    const el1 = textEl({ id: "t1", x: 0, y: 0, width: 200, height: 50, zIndex: 1, color: "#000000" });
    const el2 = textEl({ id: "t2", x: 0, y: 100, width: 200, height: 50, zIndex: 1, color: "#0a0a0a" });
    const { issues } = autoFixContrast([bg, el1, el2], "#ffffff");
    expect(issues).toHaveLength(2);
    expect(issues.map(i => i.newColor)).toEqual(["#ffffff", "#ffffff"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. QA score computation
// ─────────────────────────────────────────────────────────────────────────────

describe("computeQaScore", () => {
  it("returns 100 for a perfect template", () => {
    expect(computeQaScore({ totalElements: 10, boundsIssueCount: 0, textElements: 5, contrastIssueCount: 0 })).toBe(100);
  });

  it("deducts proportionally for bounds issues", () => {
    // 5/10 elements OOB → 50% OOB → 20 pts deducted (50% of max 40)
    const score = computeQaScore({ totalElements: 10, boundsIssueCount: 5, textElements: 5, contrastIssueCount: 0 });
    expect(score).toBe(80);
  });

  it("deducts proportionally for contrast issues", () => {
    // 5/5 text elements fail → 100% fail → 40 pts contrast + 10 pts high-fix = 50 pts deducted
    const score = computeQaScore({ totalElements: 10, boundsIssueCount: 0, textElements: 5, contrastIssueCount: 5 });
    expect(score).toBe(50);
  });

  it("caps deductions at 0 minimum", () => {
    const score = computeQaScore({ totalElements: 1, boundsIssueCount: 1, textElements: 1, contrastIssueCount: 1 });
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("handles zero elements gracefully (no division by zero)", () => {
    const score = computeQaScore({ totalElements: 0, boundsIssueCount: 0, textElements: 0, contrastIssueCount: 0 });
    expect(score).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Full pipeline: runVisualQa
// ─────────────────────────────────────────────────────────────────────────────

describe("runVisualQa", () => {
  it("returns a perfect score for a well-formed template", () => {
    const proposal = makeProposal({
      canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#1e40af" },
      elements: [
        shapeEl({ x: 0, y: 0, width: 1080, height: 1080, zIndex: 0, fill: "#1e40af" }),
        textEl({ x: 60, y: 60, width: 960, height: 80, zIndex: 1, color: "#ffffff" }),
      ],
    });
    const { qa } = runVisualQa(proposal, 1080, 1080);
    expect(qa.boundsIssues).toHaveLength(0);
    expect(qa.contrastIssues).toHaveLength(0);
    expect(qa.visualQaScore).toBe(100);
    expect(qa.autoFixedBounds).toBe(0);
    expect(qa.autoFixedColors).toBe(0);
  });

  it("auto-fixes white text on white background and reflects in returned proposal", () => {
    const proposal = makeProposal({
      canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
      elements: [
        textEl({ id: "title", x: 60, y: 60, width: 960, height: 80, zIndex: 1, color: "#ffffff" }),
      ],
    });
    const { proposal: fixed, qa } = runVisualQa(proposal, 1080, 1080);
    expect(qa.autoFixedColors).toBe(1);
    const fixedEl = fixed.template.elements.find(e => e.id === "title");
    expect((fixedEl as any).color).toBe("#000000");
    // Warning must be in merged proposal.warnings
    expect(fixed.warnings.some(w => w.includes("[contrast]") && w.includes("title"))).toBe(true);
  });

  it("clamps OOB elements and reports bounds issues", () => {
    const proposal = makeProposal({
      canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
      elements: [
        // Element entirely off the right edge — x=1080, width=200
        textEl({ id: "badge", x: 1080, y: 100, width: 200, height: 60, zIndex: 1, color: "#000000" }),
      ],
    });
    const { proposal: fixed, qa } = runVisualQa(proposal, 1080, 1080);
    expect(qa.autoFixedBounds).toBe(1);
    const fixedEl = fixed.template.elements.find(e => e.id === "badge")!;
    expect(fixedEl.x + fixedEl.width).toBeLessThanOrEqual(1080);
    expect(fixed.warnings.some(w => w.includes("[bounds]") && w.includes("badge"))).toBe(true);
  });

  it("handles both bounds and contrast issues in one pass", () => {
    const proposal = makeProposal({
      canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
      elements: [
        // OOB
        textEl({ id: "oob", x: 1100, y: 0, width: 100, height: 50, zIndex: 1, color: "#ffffff" }),
        // In-bounds but white-on-white
        textEl({ id: "ww", x: 60, y: 60, width: 200, height: 50, zIndex: 1, color: "#ffffff" }),
      ],
    });
    const { qa } = runVisualQa(proposal, 1080, 1080);
    expect(qa.autoFixedBounds).toBe(1);
    expect(qa.autoFixedColors).toBe(2); // both text elements fail contrast after clamping
    expect(qa.visualQaScore).toBeLessThan(100);
  });

  it("caps proposal.warnings at 20 total entries", () => {
    // Start with 18 existing AI warnings, add 5 QA warnings → must cap at 20
    const existingWarnings = Array.from({ length: 18 }, (_, i) => `AI warning ${i}`);
    const elements: AnyEl[] = Array.from({ length: 5 }, (_, i) =>
      textEl({ id: `t${i}`, x: i * 100, y: 0, width: 100, height: 50, zIndex: 1, color: "#ffffff" }),
    );
    const proposal = makeProposal({
      canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
      elements,
    });
    (proposal as any).warnings = existingWarnings;

    const { proposal: fixed } = runVisualQa(proposal, 1080, 1080);
    expect(fixed.warnings.length).toBeLessThanOrEqual(20);
  });

  it("does not mutate the original proposal", () => {
    const proposal = makeProposal({
      elements: [
        textEl({ id: "t", color: "#ffffff", zIndex: 1 }),
      ],
    });
    const originalColor = (proposal.template.elements[0] as any).color;
    runVisualQa(proposal, 1080, 1080);
    // Original must be unchanged
    expect((proposal.template.elements[0] as any).color).toBe(originalColor);
  });
});
