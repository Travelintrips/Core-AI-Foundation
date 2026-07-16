/**
 * qcRules.test.ts — Team 15 Graphic Design
 *
 * Tests for QC scoring: print dimensions, bleed/safe area, text fitting,
 * deliverable count, and per-service pass/fail behaviour.
 */

import { describe, it, expect } from "vitest";
import {
  scoreGraphicDesignOutput,
  validatePrintDimensions,
  GD_QC_PASS_THRESHOLD,
  type GdGenerationReport,
} from "../qcRules.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function perfectBusinessCardReport(): GdGenerationReport {
  return {
    // 88.9 + 2×3.175 = 95.25 mm wide with bleed
    actualWidthMm: 95.25,
    actualHeightMm: 57.15,   // 50.8 + 2×3.175
    actualBleedMm: 3.175,
    actualSafeAreaMm: 3.175,
    actualDpi: 300,
    actualColorMode: "cmyk",
    textOverflowRatio: 0,
    overflowingTextElements: [],
    producedFiles: ["business-card-front.pdf", "business-card-preview.png", "manifest.json", "qc-report.json"],
    satisfiedBriefFields: ["gdCompanyName","gdIndustry","gdTargetAudience","gdStyle","gdPrimaryColor","gdBcFrontName","gdBcFrontTitle","gdBcFrontEmail","gdBcFrontPhone"],
    totalRequiredBriefFields: 9,
  };
}

function perfectLogoReport(): GdGenerationReport {
  return {
    // digital-only — no print dims
    actualWidthMm: null,
    actualHeightMm: null,
    actualBleedMm: null,
    actualSafeAreaMm: null,
    actualDpi: null,
    actualColorMode: null,
    textOverflowRatio: 0,
    producedFiles: ["logo-primary.svg", "logo-primary.png", "logo-icon.png", "brand-colors.json", "manifest.json", "qc-report.json"],
    satisfiedBriefFields: ["gdCompanyName","gdIndustry","gdTargetAudience","gdStyle","gdPrimaryColor","gdLogoSymbolIdea"],
    totalRequiredBriefFields: 6,
  };
}

function perfectLetterheadReport(): GdGenerationReport {
  return {
    actualWidthMm: 216,   // 210 + 2×3
    actualHeightMm: 303,  // 297 + 2×3
    actualBleedMm: 3,
    actualSafeAreaMm: 10,
    actualDpi: 300,
    actualColorMode: "cmyk",
    textOverflowRatio: 0,
    producedFiles: ["letterhead.pdf", "letterhead-preview.png", "manifest.json", "qc-report.json"],
    satisfiedBriefFields: ["gdCompanyName","gdIndustry","gdTargetAudience","gdStyle","gdPrimaryColor","gdLhAddress","gdLhEmail","gdLhPhone"],
    totalRequiredBriefFields: 8,
  };
}

// ── Pass/fail per service ─────────────────────────────────────────────────────

describe("scoreGraphicDesignOutput — business-card", () => {
  it("passes with a perfect report at starter tier", () => {
    const result = scoreGraphicDesignOutput(perfectBusinessCardReport(), "business-card", "starter");
    expect(result.passed).toBe(true);
    expect(result.qcScore).toBeGreaterThanOrEqual(GD_QC_PASS_THRESHOLD);
    expect(result.warnings).toHaveLength(0);
  });

  it("fails when DPI is below requirement", () => {
    const report = { ...perfectBusinessCardReport(), actualDpi: 72 };
    const result = scoreGraphicDesignOutput(report, "business-card", "starter");
    expect(result.dimensions.printSpecValid).toBeLessThan(100);
    expect(result.warnings.some((w) => w.includes("DPI"))).toBe(true);
  });

  it("fails when color mode is RGB instead of CMYK", () => {
    const report: GdGenerationReport = { ...perfectBusinessCardReport(), actualColorMode: "rgb" };
    const result = scoreGraphicDesignOutput(report, "business-card", "starter");
    expect(result.dimensions.printSpecValid).toBeLessThan(100);
    expect(result.warnings.some((w) => w.includes("color mode"))).toBe(true);
  });

  it("fails when bleed is too small", () => {
    const report = { ...perfectBusinessCardReport(), actualBleedMm: 1 };
    const result = scoreGraphicDesignOutput(report, "business-card", "starter");
    expect(result.dimensions.bleedSafeArea).toBeLessThan(100);
    expect(result.warnings.some((w) => w.includes("bleed"))).toBe(true);
  });

  it("fails when safe area is too small", () => {
    const report = { ...perfectBusinessCardReport(), actualSafeAreaMm: 1 };
    const result = scoreGraphicDesignOutput(report, "business-card", "starter");
    expect(result.dimensions.bleedSafeArea).toBeLessThan(100);
  });

  it("warns and docks score on text overflow", () => {
    const report = { ...perfectBusinessCardReport(), textOverflowRatio: 0.08, overflowingTextElements: ["tagline"] };
    const result = scoreGraphicDesignOutput(report, "business-card", "starter");
    expect(result.dimensions.textFitting).toBeLessThan(100);
    expect(result.warnings.some((w) => w.includes("overflow"))).toBe(true);
  });

  it("warns (but does not fail) on minor text overflow", () => {
    const report = { ...perfectBusinessCardReport(), textOverflowRatio: 0.03 };
    const result = scoreGraphicDesignOutput(report, "business-card", "starter");
    expect(result.dimensions.textFitting).toBeGreaterThan(80);
    expect(result.warnings.some((w) => w.includes("overflow"))).toBe(true);
  });
});

describe("scoreGraphicDesignOutput — logo (digital-only)", () => {
  it("passes with a perfect logo report", () => {
    const result = scoreGraphicDesignOutput(perfectLogoReport(), "logo", "starter");
    expect(result.passed).toBe(true);
    expect(result.dimensions.printSpecValid).toBe(100);
    expect(result.dimensions.bleedSafeArea).toBe(100);
  });

  it("does not penalise logo for missing print dimensions", () => {
    const report: GdGenerationReport = { ...perfectLogoReport(), actualWidthMm: undefined };
    const result = scoreGraphicDesignOutput(report, "logo", "starter");
    expect(result.dimensions.printSpecValid).toBe(100);
  });
});

describe("scoreGraphicDesignOutput — letterhead", () => {
  it("passes with a perfect letterhead report", () => {
    const result = scoreGraphicDesignOutput(perfectLetterheadReport(), "letterhead", "starter");
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when output width is wrong", () => {
    const report = { ...perfectLetterheadReport(), actualWidthMm: 200 }; // wrong — too narrow
    const result = scoreGraphicDesignOutput(report, "letterhead", "starter");
    expect(result.warnings.some((w) => w.includes("width"))).toBe(true);
    expect(result.dimensions.printSpecValid).toBeLessThan(100);
  });
});

describe("scoreGraphicDesignOutput — deliverable count", () => {
  it("docks score when too few files produced at professional tier", () => {
    const report: GdGenerationReport = {
      ...perfectBusinessCardReport(),
      producedFiles: ["business-card-front.pdf"], // only 1, need 3
    };
    const result = scoreGraphicDesignOutput(report, "business-card", "professional");
    expect(result.dimensions.deliverableCount).toBeLessThan(100);
    expect(result.warnings.some((w) => w.includes("file"))).toBe(true);
  });

  it("does not dock for sufficient files at starter tier", () => {
    const result = scoreGraphicDesignOutput(perfectBusinessCardReport(), "business-card", "starter");
    expect(result.dimensions.deliverableCount).toBe(100);
  });
});

describe("scoreGraphicDesignOutput — all 10 services pass with minimal valid report", () => {
  const services = [
    "logo", "business-card", "letterhead", "flyer", "poster",
    "banner", "brochure", "social-media", "certificate", "stationery",
  ] as const;

  it.each(services)("%s: partial report should not crash", (code) => {
    const result = scoreGraphicDesignOutput(
      { textOverflowRatio: 0, producedFiles: ["manifest.json","qc-report.json"], satisfiedBriefFields: [], totalRequiredBriefFields: 0 },
      code,
      "starter",
    );
    expect(result.qcScore).toBeGreaterThanOrEqual(0);
    expect(result.qcScore).toBeLessThanOrEqual(100);
    expect(typeof result.passed).toBe("boolean");
  });
});

// ── Print dimension validator ─────────────────────────────────────────────────

describe("validatePrintDimensions", () => {
  it("passes standard dimensions for business-card", () => {
    const result = validatePrintDimensions("business-card", {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes for digital-only logo with any overrides", () => {
    const result = validatePrintDimensions("logo", { widthMm: 9999 });
    expect(result.valid).toBe(true);
  });

  it("rejects out-of-bound width", () => {
    const result = validatePrintDimensions("poster", { widthMm: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("widthMm"))).toBe(true);
  });

  it("rejects negative bleed", () => {
    const result = validatePrintDimensions("flyer", { bleedMm: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("bleedMm"))).toBe(true);
  });

  it("rejects banner with width but no height", () => {
    const result = validatePrintDimensions("banner", { widthMm: 1000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Banner"))).toBe(true);
  });

  it("accepts valid banner custom dimensions", () => {
    const result = validatePrintDimensions("banner", { widthMm: 1000, heightMm: 2000 });
    expect(result.valid).toBe(true);
    expect(result.spec.widthMm).toBe(1000);
    expect(result.spec.heightMm).toBe(2000);
  });
});
