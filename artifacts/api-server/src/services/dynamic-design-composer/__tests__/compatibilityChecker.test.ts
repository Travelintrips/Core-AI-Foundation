/**
 * Team 13 — Dynamic Design Composition Engine
 * Tests: compatibilityChecker.ts
 */

import { describe, it, expect } from "vitest";
import { checkCompatibility, hexLuminance, computeContrast } from "../compatibilityChecker.js";
import type { MaterialInput, PatternInput, PaletteInput, DecorationInput, LayoutPlanInput, ComponentInput, TypographyInput } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const goodMaterial: MaterialInput = {
  name: "Flat",
  surface: "flat",
  texture: "smooth",
  elevation: "low",
  opacity: "solid",
  blendMode: "normal",
};

const goodPattern: PatternInput = {
  name: "None",
  type: "none",
  intensity: 0,
  placement: "background",
  tile: false,
};

const goodPalette: PaletteInput = {
  name: "Corporate",
  primary: "#1E3A5F",
  secondary: "#2D6A9F",
  accent: "#F4A261",
  background: "#FFFFFF",
  surface: "#F8F9FA",
  text: "#1A1A2E",
  textMuted: "#6C757D",
  mood: "neutral",
};

const goodTypography: TypographyInput = {
  name: "Sans",
  headingFont: "Inter",
  bodyFont: "Inter",
  headingWeight: "700",
  bodyWeight: "400",
  baseSize: 16,
  scaleRatio: 1.25,
  lineHeight: 1.6,
  letterSpacing: "normal",
  style: "sans-serif",
};

const goodDecoration: DecorationInput = {
  name: "Clean",
  borderRadius: "medium",
  borderStyle: "none",
  shadowDepth: "low",
  dividerStyle: "line",
  useGradients: false,
  overlayOpacity: 0,
};

const goodLayout: LayoutPlanInput = {
  name: "Hero",
  strategy: "hero-content",
  flow: "vertical",
  heroWeight: 0.4,
  sectionCount: 3,
  hasSidebar: false,
  emphasis: "balanced",
};

const goodComponents: ComponentInput[] = [
  { type: "header", required: true, zone: "top" },
  { type: "hero", required: true, zone: "top" },
];

const baseParams = {
  material: goodMaterial,
  pattern: goodPattern,
  palette: goodPalette,
  decoration: goodDecoration,
  layout: goodLayout,
  components: goodComponents,
  typography: goodTypography,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkCompatibility", () => {
  describe("material + pattern", () => {
    it("flags neumorphic + geometric pattern as error", () => {
      const report = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "neumorphic" },
        pattern: { ...goodPattern, type: "geometric" },
      });
      const errors = report.issues.filter((i) => i.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(report.materialPatternCompatible).toBe(false);
    });

    it("flags glass + circuit pattern as warning", () => {
      const report = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "glass" },
        pattern: { ...goodPattern, type: "circuit" },
      });
      const warnings = report.issues.filter((i) => i.severity === "warning");
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("accepts flat + stripe pattern as compatible", () => {
      const report = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "flat" },
        pattern: { ...goodPattern, type: "stripe" },
      });
      expect(report.materialPatternCompatible).toBe(true);
    });

    it("accepts any material with pattern type none", () => {
      const surfaces: MaterialInput["surface"][] = [
        "flat", "glass", "neumorphic", "material", "frosted",
        "metallic", "matte", "paper", "fabric",
      ];
      for (const surface of surfaces) {
        const report = checkCompatibility({
          ...baseParams,
          material: { ...goodMaterial, surface },
          pattern: { ...goodPattern, type: "none" },
        });
        expect(report.materialPatternCompatible).toBe(true);
      }
    });
  });

  describe("layout + components", () => {
    it("flags minimal layout + pricing-table as warning", () => {
      const report = checkCompatibility({
        ...baseParams,
        layout: { ...goodLayout, strategy: "minimal" },
        components: [{ type: "pricing-table", required: false }],
      });
      expect(report.issues.some((i) => i.field.includes("pricing-table"))).toBe(true);
    });

    it("flags full-bleed layout + hero as NOT an issue", () => {
      const report = checkCompatibility({
        ...baseParams,
        layout: { ...goodLayout, strategy: "full-bleed" },
        components: [{ type: "hero", required: true }],
      });
      expect(report.issues.some((i) => i.field.includes("hero"))).toBe(false);
    });

    it("flags full-bleed layout + accordion as error", () => {
      const report = checkCompatibility({
        ...baseParams,
        layout: { ...goodLayout, strategy: "full-bleed" },
        components: [{ type: "accordion", required: false }],
      });
      const errors = report.issues.filter((i) => i.severity === "error" && i.field.includes("accordion"));
      expect(errors.length).toBeGreaterThan(0);
      expect(report.layoutComponentCompatible).toBe(false);
    });

    it("accepts hero-content + header + hero as compatible", () => {
      const report = checkCompatibility(baseParams);
      expect(report.layoutComponentCompatible).toBe(true);
    });
  });

  describe("palette + typography WCAG", () => {
    it("flags insufficient contrast between background and text as error", () => {
      const report = checkCompatibility({
        ...baseParams,
        palette: {
          ...goodPalette,
          background: "#CCCCCC",
          text: "#AAAAAA", // low contrast
        },
      });
      // field is "palette.background + palette.text", conflict mentions "contrast"
      const contrastErrors = report.issues.filter(
        (i) => i.severity === "error" && i.conflict.toLowerCase().includes("contrast"),
      );
      expect(contrastErrors.length).toBeGreaterThan(0);
    });

    it("accepts high-contrast black on white as compatible", () => {
      const report = checkCompatibility({
        ...baseParams,
        palette: {
          ...goodPalette,
          background: "#FFFFFF",
          text: "#000000",
        },
      });
      const contrastErrors = report.issues.filter(
        (i) => i.field.includes("contrast") && i.severity === "error",
      );
      expect(contrastErrors.length).toBe(0);
    });
  });

  describe("decoration + material", () => {
    it("flags neumorphic + dramatic shadows as error", () => {
      const report = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "neumorphic" },
        decoration: { ...goodDecoration, shadowDepth: "dramatic" },
      });
      const errors = report.issues.filter((i) => i.severity === "error" && i.field.includes("shadow"));
      expect(errors.length).toBeGreaterThan(0);
      expect(report.decorationMaterialCompatible).toBe(false);
    });

    it("accepts flat material + low shadow as compatible", () => {
      const report = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "flat", elevation: "flat" },
        decoration: { ...goodDecoration, shadowDepth: "low" },
      });
      expect(report.decorationMaterialCompatible).toBe(true);
    });

    it("flags paper material + gradients as warning", () => {
      const report = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "paper" },
        decoration: { ...goodDecoration, useGradients: true },
      });
      // field is "material.surface + decoration.useGradients", conflict mentions "gradient"
      const warnings = report.issues.filter(
        (i) => i.severity === "warning" && i.conflict.toLowerCase().includes("gradient"),
      );
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("overall score", () => {
    it("returns score 100 for fully compatible inputs", () => {
      const report = checkCompatibility(baseParams);
      expect(report.score).toBe(100);
    });

    it("score decreases with each error", () => {
      const cleanReport = checkCompatibility(baseParams);
      const conflictedReport = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "neumorphic" },
        pattern: { ...goodPattern, type: "geometric" },
        decoration: { ...goodDecoration, shadowDepth: "dramatic" },
      });
      expect(conflictedReport.score).toBeLessThan(cleanReport.score);
    });

    it("score is always in 0–100 range", () => {
      const report = checkCompatibility({
        ...baseParams,
        material: { ...goodMaterial, surface: "neumorphic" },
        pattern: { ...goodPattern, type: "geometric" },
        decoration: { ...goodDecoration, shadowDepth: "dramatic" },
        layout: { ...goodLayout, strategy: "full-bleed" },
        components: [
          { type: "accordion", required: false },
          { type: "sidebar" as any, required: false },
        ],
      });
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });
  });
});

describe("WCAG utilities", () => {
  it("hexLuminance of #FFFFFF is ~1", () => {
    expect(hexLuminance("#FFFFFF")).toBeCloseTo(1, 2);
  });

  it("hexLuminance of #000000 is 0", () => {
    expect(hexLuminance("#000000")).toBe(0);
  });

  it("hexLuminance returns 0.5 for invalid hex", () => {
    expect(hexLuminance("invalid")).toBe(0.5);
    expect(hexLuminance("#FFF")).toBe(0.5);
  });

  it("computeContrast black-on-white is 21", () => {
    expect(computeContrast(1, 0)).toBe(21);
  });

  it("computeContrast same-colour is 1", () => {
    expect(computeContrast(0.5, 0.5)).toBe(1);
  });
});
