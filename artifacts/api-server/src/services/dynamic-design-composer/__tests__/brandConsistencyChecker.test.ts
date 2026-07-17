/**
 * Team 13 — Dynamic Design Composition Engine
 * Tests: brandConsistencyChecker.ts
 */

import { describe, it, expect } from "vitest";
import { checkBrandConsistency } from "../brandConsistencyChecker.js";
import type {
  PaletteInput,
  TypographyInput,
  LayoutPlanInput,
  DecorationInput,
  MaterialInput,
  BrandDnaInput,
} from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALIGNED_PALETTE: PaletteInput = {
  name: "Corporate Blue",
  primary: "#1E3A5F",
  secondary: "#2D6A9F",
  accent: "#F4A261",
  background: "#FFFFFF",
  surface: "#F8F9FA",
  text: "#1A1A2E",
  textMuted: "#6C757D",
  mood: "neutral",
};

const ALIGNED_TYPOGRAPHY: TypographyInput = {
  name: "Inter",
  headingFont: "Inter",
  bodyFont: "Inter",
  headingWeight: "600",
  bodyWeight: "400",
  baseSize: 16,
  scaleRatio: 1.25,
  lineHeight: 1.6,
  letterSpacing: "normal",
  style: "sans-serif",
};

const ALIGNED_LAYOUT: LayoutPlanInput = {
  name: "Hero",
  strategy: "hero-content",
  flow: "vertical",
  heroWeight: 0.4,
  sectionCount: 4,
  hasSidebar: false,
  emphasis: "balanced",
};

const ALIGNED_DECORATION: DecorationInput = {
  name: "Clean",
  borderRadius: "small",
  borderStyle: "none",
  shadowDepth: "low",
  dividerStyle: "line",
  useGradients: false,
  overlayOpacity: 0,
};

const ALIGNED_MATERIAL: MaterialInput = {
  name: "Flat",
  surface: "flat",
  texture: "smooth",
  elevation: "low",
  opacity: "solid",
  blendMode: "normal",
};

const CORPORATE_BRAND_DNA: BrandDnaInput = {
  clientId: "client-001",
  brandPersonality: ["Professional", "Corporate", "Trustworthy"],
  brandVoice: "Formal",
  layoutStyle: "Corporate",
  visualDensity: "Balanced",
  detectedColors: {
    primary: "#1E3A5F",
    secondary: "#2D6A9F",
    accent: "#F4A261",
  },
  detectedTypography: {
    heading: "Inter",
    body: "Inter",
    style: "sans-serif",
  },
  industry: "finance",
  riskProfile: "Conservative",
};

const baseParams = {
  palette: ALIGNED_PALETTE,
  typography: ALIGNED_TYPOGRAPHY,
  layout: ALIGNED_LAYOUT,
  decoration: ALIGNED_DECORATION,
  material: ALIGNED_MATERIAL,
  brandDna: CORPORATE_BRAND_DNA,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkBrandConsistency", () => {
  describe("aligned brand — high scores", () => {
    it("returns high overall score when design fully aligns with brand DNA", () => {
      const report = checkBrandConsistency(baseParams);
      expect(report.score).toBeGreaterThanOrEqual(70);
    });

    it("returns high color alignment when palette matches brand DNA colors", () => {
      const report = checkBrandConsistency(baseParams);
      expect(report.colorAlignment.score).toBeGreaterThanOrEqual(70);
    });

    it("returns high typography alignment when fonts match brand DNA", () => {
      const report = checkBrandConsistency(baseParams);
      expect(report.typographyAlignment.score).toBeGreaterThanOrEqual(70);
    });

    it("returns no personality mismatches for aligned design", () => {
      const report = checkBrandConsistency(baseParams);
      expect(report.personalityAlignment.mismatches).toHaveLength(0);
    });
  });

  describe("color misalignment", () => {
    it("deducts score when primary color differs significantly from brand DNA", () => {
      const alignedReport = checkBrandConsistency(baseParams);
      const misalignedReport = checkBrandConsistency({
        ...baseParams,
        palette: { ...ALIGNED_PALETTE, primary: "#FF0000" }, // red — far from brand navy
      });
      expect(misalignedReport.colorAlignment.score).toBeLessThan(alignedReport.colorAlignment.score);
    });

    it("records color alignment issues when palette diverges", () => {
      const report = checkBrandConsistency({
        ...baseParams,
        palette: { ...ALIGNED_PALETTE, primary: "#FF0000" },
      });
      expect(report.colorAlignment.issues.length).toBeGreaterThan(0);
    });

    it("provides color suggestions when misaligned", () => {
      const report = checkBrandConsistency({
        ...baseParams,
        palette: { ...ALIGNED_PALETTE, primary: "#FF0000" },
      });
      expect(report.colorAlignment.suggestions.length).toBeGreaterThan(0);
    });

    it("deducts score when palette mood conflicts with brand personality", () => {
      const report = checkBrandConsistency({
        ...baseParams,
        palette: { ...ALIGNED_PALETTE, mood: "vibrant" }, // vibrant ≠ Professional/Corporate
      });
      expect(report.colorAlignment.score).toBeLessThan(100);
    });
  });

  describe("typography misalignment", () => {
    it("deducts score when heading font differs from brand DNA", () => {
      const alignedReport = checkBrandConsistency(baseParams);
      const misalignedReport = checkBrandConsistency({
        ...baseParams,
        typography: { ...ALIGNED_TYPOGRAPHY, headingFont: "Comic Sans MS" },
      });
      expect(misalignedReport.typographyAlignment.score).toBeLessThan(alignedReport.typographyAlignment.score);
    });

    it("records typography issues", () => {
      const report = checkBrandConsistency({
        ...baseParams,
        typography: { ...ALIGNED_TYPOGRAPHY, headingFont: "Papyrus" },
      });
      expect(report.typographyAlignment.issues.length).toBeGreaterThan(0);
    });

    it("penalises bold heading weight for minimalist brand", () => {
      const minimalistDna: BrandDnaInput = {
        brandPersonality: ["Minimalist"],
      };
      const report = checkBrandConsistency({
        ...baseParams,
        brandDna: minimalistDna,
        typography: { ...ALIGNED_TYPOGRAPHY, headingWeight: "800" },
      });
      expect(report.typographyAlignment.score).toBeLessThan(100);
    });

    it("penalises light heading weight for bold brand", () => {
      const boldDna: BrandDnaInput = {
        brandPersonality: ["Bold"],
      };
      const report = checkBrandConsistency({
        ...baseParams,
        brandDna: boldDna,
        typography: { ...ALIGNED_TYPOGRAPHY, headingWeight: "400" },
      });
      expect(report.typographyAlignment.score).toBeLessThan(100);
    });
  });

  describe("layout misalignment", () => {
    it("deducts score when layout strategy conflicts with brand personality", () => {
      const report = checkBrandConsistency({
        ...baseParams,
        layout: { ...ALIGNED_LAYOUT, strategy: "asymmetric" }, // asymmetric ≠ Corporate
      });
      expect(report.layoutAlignment.score).toBeLessThan(100);
    });

    it("penalises dense layout for airy brand", () => {
      const airyDna: BrandDnaInput = {
        ...CORPORATE_BRAND_DNA,
        visualDensity: "Airy",
      };
      const report = checkBrandConsistency({
        ...baseParams,
        brandDna: airyDna,
        layout: { ...ALIGNED_LAYOUT, sectionCount: 10 },
      });
      expect(report.layoutAlignment.score).toBeLessThan(100);
    });

    it("penalises experimental material for conservative brand", () => {
      const report = checkBrandConsistency({
        ...baseParams,
        material: { ...ALIGNED_MATERIAL, surface: "glass" },
      });
      expect(report.layoutAlignment.score).toBeLessThan(100);
    });
  });

  describe("personality alignment", () => {
    it("identifies personality mismatches for luxury brand with vibrant palette", () => {
      const luxuryDna: BrandDnaInput = {
        brandPersonality: ["Luxury"],
      };
      const report = checkBrandConsistency({
        ...baseParams,
        brandDna: luxuryDna,
        palette: { ...ALIGNED_PALETTE, mood: "vibrant" },
      });
      expect(report.personalityAlignment.mismatches.length).toBeGreaterThan(0);
    });

    it("populates traits list from brand DNA personality", () => {
      const report = checkBrandConsistency(baseParams);
      expect(report.personalityAlignment.traits).toContain("professional");
      expect(report.personalityAlignment.traits).toContain("corporate");
    });
  });

  describe("overall score", () => {
    it("score is always 0–100", () => {
      const report = checkBrandConsistency({
        ...baseParams,
        palette: { ...ALIGNED_PALETTE, primary: "#FF0000", mood: "vibrant" },
        typography: { ...ALIGNED_TYPOGRAPHY, headingFont: "Papyrus", style: "display" },
        layout: { ...ALIGNED_LAYOUT, strategy: "asymmetric", sectionCount: 12 },
        material: { ...ALIGNED_MATERIAL, surface: "glass" },
      });
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });

    it("misaligned design scores lower than aligned design", () => {
      const alignedReport = checkBrandConsistency(baseParams);
      const misalignedReport = checkBrandConsistency({
        ...baseParams,
        palette: { ...ALIGNED_PALETTE, primary: "#FF0000", mood: "vibrant" },
        typography: { ...ALIGNED_TYPOGRAPHY, headingFont: "Papyrus" },
      });
      expect(misalignedReport.score).toBeLessThan(alignedReport.score);
    });
  });
});
