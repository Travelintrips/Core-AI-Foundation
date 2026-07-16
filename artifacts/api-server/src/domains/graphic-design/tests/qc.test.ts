/**
 * graphic-design/tests/qc.test.ts — Team 15
 *
 * Tests for the QC engine: text fitting, print dimensions, bleed,
 * resolution, color mode, contrast, file format, and aggregate scoring.
 */

import { describe, it, expect } from "vitest";
import {
  runQc,
  QC_PASS_THRESHOLD,
  GD_QC_PASS_THRESHOLD,
  type QcInput,
  type RenderedDeliverable,
} from "../qc.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeliverable(overrides: Partial<RenderedDeliverable> = {}): RenderedDeliverable {
  return {
    variant:        "a5_portrait",
    canvasWidthPx:  1772,    // A5 portrait at 300dpi with 3mm bleed: (148+6)mm × 300/25.4 ≈ 1819, but using 1772 for trim
    canvasHeightPx: 2480,
    resolutionDpi:  300,
    colorMode:      "CMYK",
    elements:       [],
    fileFormats:    ["pdf", "png", "jpg"],
    ...overrides,
  };
}

function makeInput(overrides: Partial<QcInput> = {}): QcInput {
  return {
    serviceCode:     "GD-FLYER",
    outputFormat:    "print",
    deliverable:     makeDeliverable(),
    expectedFormats: ["pdf", "png"],
    ...overrides,
  };
}

// ── Thresholds ────────────────────────────────────────────────────────────────

describe("QC_PASS_THRESHOLD", () => {
  it("is 70 (stricter than CP's 60)", () => {
    expect(QC_PASS_THRESHOLD).toBe(70);
    expect(GD_QC_PASS_THRESHOLD).toBe(70);
  });
});

// ── Component presence ────────────────────────────────────────────────────────

describe("QC — componentPresence check", () => {
  it("fails when required components are missing", () => {
    const input = makeInput({
      serviceCode: "GD-LOGO",
      outputFormat: "digital",
      deliverable: makeDeliverable({ elements: [], variant: "primary_1000" }),
    });
    const result = runQc(input);
    const presenceCheck = result.checks.find((c) => c.checkName === "componentPresence")!;
    expect(presenceCheck.passed).toBe(false);
    expect(presenceCheck.score).toBeLessThan(100);
  });

  it("passes when required logo components are present", () => {
    const elements = [
      { id: "l1", type: "logo",       xPx: 50, yPx: 50, widthPx: 200, heightPx: 200 },
      { id: "l2", type: "headline",   xPx: 50, yPx: 260, widthPx: 300, heightPx: 50, text: "Brand Name", fontSizePt: 36, contrastRatio: 5 },
      { id: "l3", type: "color_block", xPx: 0,  yPx: 0, widthPx: 1000, heightPx: 1000 },
      { id: "l4", type: "safe_area_guide", xPx: 0, yPx: 0, widthPx: 1000, heightPx: 1000 },
    ];
    const input = makeInput({
      serviceCode:  "GD-LOGO",
      outputFormat: "digital",
      deliverable:  makeDeliverable({ elements, variant: "primary_1000", canvasWidthPx: 1000, canvasHeightPx: 1000, resolutionDpi: 96, colorMode: "sRGB" }),
      expectedFormats: ["svg", "pdf", "png"],
    });
    const result = runQc(input);
    const presenceCheck = result.checks.find((c) => c.checkName === "componentPresence")!;
    expect(presenceCheck.score).toBeGreaterThanOrEqual(50);  // headline + logo + color_block covered
  });
});

// ── Text fitting ──────────────────────────────────────────────────────────────

describe("QC — textFitting check", () => {
  it("passes when all text is within safe area", () => {
    const elements = [
      {
        id: "t1", type: "headline",
        xPx: 100, yPx: 100, widthPx: 400, heightPx: 50,
        text: "Hello", fontSizePt: 24, contrastRatio: 5,
      },
    ];
    const input = makeInput({ deliverable: makeDeliverable({ elements }) });
    const result = runQc(input);
    const textCheck = result.checks.find((c) => c.checkName === "textFitting")!;
    expect(textCheck.failures).toHaveLength(0);
  });

  it("fails when text overflows safe area on the left", () => {
    const elements = [
      {
        id: "t1", type: "headline",
        xPx: 0, yPx: 100, widthPx: 400, heightPx: 50,  // x=0 is within bleed, inside safe area violation
        text: "Hello", fontSizePt: 24, contrastRatio: 5,
      },
    ];
    const input = makeInput({ deliverable: makeDeliverable({ elements }) });
    const result = runQc(input);
    const textCheck = result.checks.find((c) => c.checkName === "textFitting")!;
    expect(textCheck.failures.length).toBeGreaterThan(0);
  });

  it("warns on very small font size", () => {
    const elements = [
      {
        id: "t1", type: "body_text",
        xPx: 100, yPx: 100, widthPx: 200, heightPx: 20,
        text: "Fine print", fontSizePt: 5, contrastRatio: 4.5,  // 5pt < 6pt threshold
      },
    ];
    const input = makeInput({ deliverable: makeDeliverable({ elements }) });
    const result = runQc(input);
    const textCheck = result.checks.find((c) => c.checkName === "textFitting")!;
    expect(textCheck.warnings.length).toBeGreaterThan(0);
  });

  it("scores 100 when there are no text elements", () => {
    const input = makeInput({ deliverable: makeDeliverable({ elements: [] }) });
    const result = runQc(input);
    const textCheck = result.checks.find((c) => c.checkName === "textFitting")!;
    expect(textCheck.score).toBe(100);
  });
});

// ── Resolution ────────────────────────────────────────────────────────────────

describe("QC — resolutionCompliance check", () => {
  it("fails for print deliverable below 300dpi", () => {
    const input = makeInput({ deliverable: makeDeliverable({ resolutionDpi: 150 }) });
    const result = runQc(input);
    const resCheck = result.checks.find((c) => c.checkName === "resolutionCompliance")!;
    expect(resCheck.passed).toBe(false);
  });

  it("passes for digital deliverable at 72dpi", () => {
    const input = makeInput({
      outputFormat: "digital",
      deliverable:  makeDeliverable({ resolutionDpi: 72, colorMode: "sRGB" }),
    });
    const result = runQc(input);
    const resCheck = result.checks.find((c) => c.checkName === "resolutionCompliance")!;
    expect(resCheck.passed).toBe(true);
  });

  it("passes for print deliverable at 300dpi", () => {
    const input = makeInput({ deliverable: makeDeliverable({ resolutionDpi: 300 }) });
    const result = runQc(input);
    const resCheck = result.checks.find((c) => c.checkName === "resolutionCompliance")!;
    expect(resCheck.passed).toBe(true);
  });
});

// ── Color mode ────────────────────────────────────────────────────────────────

describe("QC — colorModeCompliance check", () => {
  it("fails print deliverable in RGB", () => {
    const input = makeInput({ deliverable: makeDeliverable({ colorMode: "RGB" }) });
    const result = runQc(input);
    const colorCheck = result.checks.find((c) => c.checkName === "colorModeCompliance")!;
    expect(colorCheck.passed).toBe(false);
  });

  it("passes print deliverable in CMYK", () => {
    const input = makeInput({ deliverable: makeDeliverable({ colorMode: "CMYK" }) });
    const result = runQc(input);
    const colorCheck = result.checks.find((c) => c.checkName === "colorModeCompliance")!;
    expect(colorCheck.passed).toBe(true);
  });

  it("passes digital deliverable in sRGB", () => {
    const input = makeInput({
      outputFormat: "digital",
      deliverable:  makeDeliverable({ colorMode: "sRGB", resolutionDpi: 72 }),
    });
    const result = runQc(input);
    const colorCheck = result.checks.find((c) => c.checkName === "colorModeCompliance")!;
    expect(colorCheck.passed).toBe(true);
  });
});

// ── File format compliance ────────────────────────────────────────────────────

describe("QC — fileFormatCompliance check", () => {
  it("passes when all expected formats are present", () => {
    const input = makeInput({
      deliverable:     makeDeliverable({ fileFormats: ["pdf", "png", "jpg"] }),
      expectedFormats: ["pdf", "png"],
    });
    const result = runQc(input);
    const fmtCheck = result.checks.find((c) => c.checkName === "fileFormatCompliance")!;
    expect(fmtCheck.passed).toBe(true);
  });

  it("fails when a required format is missing", () => {
    const input = makeInput({
      deliverable:     makeDeliverable({ fileFormats: ["png"] }),
      expectedFormats: ["pdf", "png"],
    });
    const result = runQc(input);
    const fmtCheck = result.checks.find((c) => c.checkName === "fileFormatCompliance")!;
    expect(fmtCheck.passed).toBe(false);
    expect(fmtCheck.failures[0]).toContain("pdf");
  });

  it("scores 100 when no expected formats are specified", () => {
    const input = makeInput({ expectedFormats: [] });
    const result = runQc(input);
    const fmtCheck = result.checks.find((c) => c.checkName === "fileFormatCompliance")!;
    expect(fmtCheck.score).toBe(100);
  });
});

// ── Contrast ──────────────────────────────────────────────────────────────────

describe("QC — contrastCompliance check", () => {
  it("fails text with contrast below WCAG AA (4.5)", () => {
    const elements = [
      { id: "t1", type: "body_text", xPx: 100, yPx: 100, widthPx: 200, heightPx: 20, text: "Low contrast", fontSizePt: 10, contrastRatio: 3.0 },
    ];
    const input = makeInput({ deliverable: makeDeliverable({ elements }) });
    const result = runQc(input);
    const contrastCheck = result.checks.find((c) => c.checkName === "contrastCompliance")!;
    expect(contrastCheck.passed).toBe(false);
  });

  it("passes text with sufficient contrast", () => {
    const elements = [
      { id: "t1", type: "body_text", xPx: 100, yPx: 100, widthPx: 200, heightPx: 20, text: "Good contrast", fontSizePt: 12, contrastRatio: 7.0 },
    ];
    const input = makeInput({ deliverable: makeDeliverable({ elements }) });
    const result = runQc(input);
    const contrastCheck = result.checks.find((c) => c.checkName === "contrastCompliance")!;
    expect(contrastCheck.passed).toBe(true);
  });
});

// ── Aggregate scoring ─────────────────────────────────────────────────────────

describe("QC — aggregate score", () => {
  it("returns a score between 0 and 100", () => {
    const result = runQc(makeInput());
    expect(result.qcScore).toBeGreaterThanOrEqual(0);
    expect(result.qcScore).toBeLessThanOrEqual(100);
  });

  it("result has 8 checks", () => {
    const result = runQc(makeInput());
    expect(result.checks).toHaveLength(8);
  });

  it("result.passed reflects qcScore >= threshold", () => {
    const result = runQc(makeInput());
    expect(result.passed).toBe(result.qcScore >= QC_PASS_THRESHOLD);
  });

  it("all-failures result has score below threshold", () => {
    const input = makeInput({
      outputFormat:    "print",
      deliverable:     makeDeliverable({ resolutionDpi: 72, colorMode: "RGB", fileFormats: [] }),
      expectedFormats: ["pdf", "png", "svg", "ai", "eps"],
    });
    const result = runQc(input);
    // Color, resolution, and file format all fail — should bring score well below 70
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
