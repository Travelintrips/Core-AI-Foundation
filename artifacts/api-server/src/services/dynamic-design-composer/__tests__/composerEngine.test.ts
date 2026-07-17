/**
 * Team 13 — Dynamic Design Composition Engine
 * Tests: composerEngine.ts — deterministic composition
 */

import { describe, it, expect } from "vitest";
import { compose } from "../composerEngine.js";
import type { CompositionRequest } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BLUEPRINT = {
  name: "Standard 12-column",
  columns: 12,
  rows: 0,
  gutter: 24,
  maxWidth: 1280,
  orientation: "portrait" as const,
  medium: "digital" as const,
};

const LAYOUT = {
  name: "Hero + Content",
  strategy: "hero-content" as const,
  flow: "vertical" as const,
  heroWeight: 0.4,
  sectionCount: 3,
  hasSidebar: false,
  emphasis: "balanced" as const,
};

const PALETTE = {
  name: "Corporate Blue",
  primary: "#1E3A5F",
  secondary: "#2D6A9F",
  accent: "#F4A261",
  background: "#FFFFFF",
  surface: "#F8F9FA",
  text: "#1A1A2E",
  textMuted: "#6C757D",
  mood: "neutral" as const,
};

const TYPOGRAPHY = {
  name: "Professional Sans",
  headingFont: "Inter",
  bodyFont: "Inter",
  headingWeight: "700" as const,
  bodyWeight: "400" as const,
  baseSize: 16,
  scaleRatio: 1.25,
  lineHeight: 1.6,
  letterSpacing: "normal" as const,
  style: "sans-serif" as const,
};

const PATTERN = {
  name: "No Pattern",
  type: "none" as const,
  intensity: 0,
  placement: "background" as const,
  tile: false,
};

const DECORATION = {
  name: "Clean",
  borderRadius: "medium" as const,
  borderStyle: "none" as const,
  shadowDepth: "low" as const,
  dividerStyle: "line" as const,
  useGradients: false,
  overlayOpacity: 0,
};

const MATERIAL = {
  name: "Flat",
  surface: "flat" as const,
  texture: "smooth" as const,
  elevation: "low" as const,
  opacity: "solid" as const,
  blendMode: "normal" as const,
};

const MOTIF = {
  name: "Abstract",
  theme: "abstract" as const,
  repetition: "none" as const,
  scale: "small" as const,
  colorTreatment: "monochrome" as const,
};

const COMPONENTS = [
  { type: "header" as const, required: true, zone: "top" as const },
  { type: "hero" as const, required: true, zone: "top" as const },
  { type: "cta" as const, required: true, zone: "bottom" as const },
  { type: "footer" as const, required: true, zone: "bottom" as const },
];

const BRAND_DNA = {
  clientId: "test-client-001",
  brandPersonality: ["Professional", "Corporate"],
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
  completenessScore: 85,
  confidenceScore: 0.9,
};

const FULL_REQUEST: CompositionRequest = {
  blueprint: BLUEPRINT,
  layoutPlan: LAYOUT,
  components: COMPONENTS,
  pattern: PATTERN,
  palette: PALETTE,
  typography: TYPOGRAPHY,
  decoration: DECORATION,
  material: MATERIAL,
  motif: MOTIF,
  brandDna: BRAND_DNA,
  allowOverrides: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("composerEngine", () => {
  describe("determinism", () => {
    it("produces the same compositionId for identical inputs", () => {
      const spec1 = compose(FULL_REQUEST);
      const spec2 = compose(FULL_REQUEST);
      expect(spec1.compositionId).toBe(spec2.compositionId);
    });

    it("produces different compositionIds for different layouts", () => {
      const spec1 = compose(FULL_REQUEST);
      const spec2 = compose({
        ...FULL_REQUEST,
        layoutPlan: { ...LAYOUT, strategy: "minimal" },
      });
      expect(spec1.compositionId).not.toBe(spec2.compositionId);
    });

    it("produces different compositionIds when palette changes", () => {
      const spec1 = compose(FULL_REQUEST);
      const spec2 = compose({
        ...FULL_REQUEST,
        palette: { ...PALETTE, primary: "#FF0000" },
      });
      expect(spec1.compositionId).not.toBe(spec2.compositionId);
    });

    it("returns exactly the same spec object shape on repeated calls", () => {
      const spec1 = compose(FULL_REQUEST);
      const spec2 = compose(FULL_REQUEST);
      expect(spec1.styleConsistencyScore).toBe(spec2.styleConsistencyScore);
      expect(spec1.brandConsistencyScore).toBe(spec2.brandConsistencyScore);
      expect(spec1.components.length).toBe(spec2.components.length);
    });
  });

  describe("output shape", () => {
    it("returns version 1.0", () => {
      const spec = compose(FULL_REQUEST);
      expect(spec.version).toBe("1.0");
    });

    it("includes composedAt ISO timestamp", () => {
      const spec = compose(FULL_REQUEST);
      expect(() => new Date(spec.composedAt)).not.toThrow();
      expect(new Date(spec.composedAt).getFullYear()).toBeGreaterThanOrEqual(2024);
    });

    it("resolves all 4 components", () => {
      const spec = compose(FULL_REQUEST);
      expect(spec.components).toHaveLength(4);
      expect(spec.components.every((c) => c.resolvedZone)).toBe(true);
      expect(spec.components.every((c) => c.resolvedVariant)).toBe(true);
    });

    it("includes derived tokens with all required keys", () => {
      const spec = compose(FULL_REQUEST);
      expect(spec.derivedTokens.spacingScale.length).toBeGreaterThan(0);
      expect(spec.derivedTokens.fontSizeScale["base"]).toBeDefined();
      expect(spec.derivedTokens.borderRadiusMap["md"]).toBeDefined();
      expect(spec.derivedTokens.shadowMap["md"]).toBeDefined();
      expect(spec.derivedTokens.breakpoints["lg"]).toBe(1024);
    });

    it("includes full explainability report", () => {
      const spec = compose(FULL_REQUEST);
      const { explainability } = spec;
      expect(explainability.layout.chosen).toBeTruthy();
      expect(explainability.layout.why).toBeTruthy();
      expect(explainability.layout.alternativesRejected.length).toBeGreaterThan(0);
      expect(explainability.palette.chosen).toBeTruthy();
      expect(explainability.typography.chosen).toBeTruthy();
      expect(explainability.pattern.chosen).toBeTruthy();
      expect(explainability.components).toHaveLength(4);
      expect(explainability.compositionRationale).toBeTruthy();
    });

    it("includes compatibility report", () => {
      const spec = compose(FULL_REQUEST);
      expect(spec.compatibility.score).toBeGreaterThanOrEqual(0);
      expect(spec.compatibility.score).toBeLessThanOrEqual(100);
      expect(typeof spec.compatibility.materialPatternCompatible).toBe("boolean");
      expect(typeof spec.compatibility.layoutComponentCompatible).toBe("boolean");
    });

    it("includes brand consistency report when brandDna provided", () => {
      const spec = compose(FULL_REQUEST);
      expect(spec.brandConsistency.score).toBeGreaterThanOrEqual(0);
      expect(spec.brandConsistency.score).toBeLessThanOrEqual(100);
      expect(spec.brandConsistency.colorAlignment).toBeDefined();
      expect(spec.brandConsistency.typographyAlignment).toBeDefined();
      expect(spec.brandConsistency.layoutAlignment).toBeDefined();
    });

    it("reports brandConsistencyScore of 100 when no brandDna provided", () => {
      const { brandDna, ...withoutDna } = FULL_REQUEST;
      const spec = compose(withoutDna as CompositionRequest);
      expect(spec.brandConsistencyScore).toBe(100);
    });
  });

  describe("score ranges", () => {
    it("styleConsistencyScore is in 0–100 range", () => {
      const spec = compose(FULL_REQUEST);
      expect(spec.styleConsistencyScore).toBeGreaterThanOrEqual(0);
      expect(spec.styleConsistencyScore).toBeLessThanOrEqual(100);
    });

    it("brandConsistencyScore is in 0–100 range", () => {
      const spec = compose(FULL_REQUEST);
      expect(spec.brandConsistencyScore).toBeGreaterThanOrEqual(0);
      expect(spec.brandConsistencyScore).toBeLessThanOrEqual(100);
    });
  });

  describe("component style tokens", () => {
    it("hero component gets primary background color", () => {
      const spec = compose(FULL_REQUEST);
      const hero = spec.components.find((c) => c.type === "hero");
      expect(hero).toBeDefined();
      expect(hero!.styleTokens.backgroundColor).toBe(PALETTE.primary);
    });

    it("hero component gets white text color", () => {
      const spec = compose(FULL_REQUEST);
      const hero = spec.components.find((c) => c.type === "hero");
      expect(hero!.styleTokens.textColor).toBe("#FFFFFF");
    });

    it("footer component gets text-color background", () => {
      const spec = compose(FULL_REQUEST);
      const footer = spec.components.find((c) => c.type === "footer");
      expect(footer!.styleTokens.backgroundColor).toBe(PALETTE.text);
    });
  });
});
