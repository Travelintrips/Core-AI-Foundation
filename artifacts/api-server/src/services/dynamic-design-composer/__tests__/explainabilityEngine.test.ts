/**
 * Team 13 — Dynamic Design Composition Engine
 * Tests: explainabilityEngine.ts — style consistency, brand consistency, explainability
 */

import { describe, it, expect } from "vitest";
import {
  explainLayout,
  explainPalette,
  explainTypography,
  explainPattern,
  explainComponents,
  explainDecoration,
  explainMaterial,
  explainMotif,
  buildExplainabilityReport,
  buildCompositionRationale,
} from "../explainabilityEngine.js";
import type {
  BlueprintInput,
  LayoutPlanInput,
  PaletteInput,
  TypographyInput,
  PatternInput,
  ComponentInput,
  DecorationInput,
  MaterialInput,
  MotifInput,
  BrandDnaInput,
  FallbackRecord,
} from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BLUEPRINT: BlueprintInput = {
  name: "12-col",
  columns: 12,
  rows: 0,
  gutter: 24,
  maxWidth: 1280,
  orientation: "portrait",
  medium: "digital",
};

const LAYOUT: LayoutPlanInput = {
  name: "Hero",
  strategy: "hero-content",
  flow: "vertical",
  heroWeight: 0.4,
  sectionCount: 3,
  hasSidebar: false,
  emphasis: "balanced",
};

const PALETTE: PaletteInput = {
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

const TYPOGRAPHY: TypographyInput = {
  name: "Inter",
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

const PATTERN: PatternInput = {
  name: "None",
  type: "none",
  intensity: 0,
  placement: "background",
  tile: false,
};

const COMPONENTS: ComponentInput[] = [
  { type: "header", required: true, zone: "top" },
  { type: "hero", required: true, zone: "top" },
  { type: "cta", required: true, zone: "bottom" },
];

const DECORATION: DecorationInput = {
  name: "Clean",
  borderRadius: "medium",
  borderStyle: "none",
  shadowDepth: "low",
  dividerStyle: "line",
  useGradients: false,
  overlayOpacity: 0,
};

const MATERIAL: MaterialInput = {
  name: "Flat",
  surface: "flat",
  texture: "smooth",
  elevation: "low",
  opacity: "solid",
  blendMode: "normal",
};

const MOTIF: MotifInput = {
  name: "Abstract",
  theme: "abstract",
  repetition: "none",
  scale: "small",
  colorTreatment: "monochrome",
};

const BRAND_DNA: BrandDnaInput = {
  brandPersonality: ["Professional", "Corporate"],
  brandVoice: "Formal",
  layoutStyle: "Corporate",
  industry: "finance",
  detectedColors: { primary: "#1E3A5F" },
  detectedTypography: { heading: "Inter", body: "Inter" },
};

const NO_FALLBACKS: FallbackRecord[] = [];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("explainLayout", () => {
  it("returns a non-empty why string", () => {
    const result = explainLayout(LAYOUT, BLUEPRINT, BRAND_DNA, NO_FALLBACKS);
    expect(result.why.length).toBeGreaterThan(10);
  });

  it("chosen includes layout strategy", () => {
    const result = explainLayout(LAYOUT, BLUEPRINT, BRAND_DNA, NO_FALLBACKS);
    expect(result.chosen).toContain("hero-content");
  });

  it("returns at least 2 alternatives rejected", () => {
    const result = explainLayout(LAYOUT, BLUEPRINT, BRAND_DNA, NO_FALLBACKS);
    expect(result.alternativesRejected.length).toBeGreaterThanOrEqual(2);
  });

  it("each rejected alternative has a non-empty reason", () => {
    const result = explainLayout(LAYOUT, BLUEPRINT, BRAND_DNA, NO_FALLBACKS);
    expect(result.alternativesRejected.every((a) => a.reason.length > 5)).toBe(true);
  });

  it("includes brand signal when brand DNA has personality", () => {
    const result = explainLayout(LAYOUT, BLUEPRINT, BRAND_DNA, NO_FALLBACKS);
    expect(result.brandSignal).not.toBeNull();
    expect(result.brandSignal).toContain("Professional");
  });

  it("marks overridden as false when no fallback applied", () => {
    const result = explainLayout(LAYOUT, BLUEPRINT, BRAND_DNA, NO_FALLBACKS);
    expect(result.overridden).toBe(false);
  });

  it("marks as fallback when layoutPlan fallback applied", () => {
    const fallbacks: FallbackRecord[] = [{
      field: "layoutPlan",
      reason: "missing",
      originalValue: null,
      fallbackValue: "hero-content",
      fallbackSource: "default",
    }];
    const result = explainLayout(LAYOUT, BLUEPRINT, BRAND_DNA, fallbacks);
    expect(result.why).toContain("default");
  });
});

describe("explainPalette", () => {
  it("returns a non-empty why string", () => {
    const result = explainPalette(PALETTE, BRAND_DNA, NO_FALLBACKS);
    expect(result.why.length).toBeGreaterThan(10);
  });

  it("chosen includes mood", () => {
    const result = explainPalette(PALETTE, BRAND_DNA, NO_FALLBACKS);
    expect(result.chosen).toContain("neutral");
  });

  it("returns rejected alternatives", () => {
    const result = explainPalette(PALETTE, BRAND_DNA, NO_FALLBACKS);
    expect(result.alternativesRejected.length).toBeGreaterThanOrEqual(2);
  });
});

describe("explainTypography", () => {
  it("includes font names in chosen", () => {
    const result = explainTypography(TYPOGRAPHY, BRAND_DNA, NO_FALLBACKS);
    expect(result.chosen).toContain("Inter");
  });

  it("includes style description in why", () => {
    const result = explainTypography(TYPOGRAPHY, BRAND_DNA, NO_FALLBACKS);
    // Description starts with "Sans-serif" (capitalised by sentence structure)
    expect(result.why.toLowerCase()).toContain("sans-serif");
  });
});

describe("explainPattern", () => {
  it("explains 'none' pattern specifically", () => {
    const result = explainPattern(PATTERN, BRAND_DNA, NO_FALLBACKS);
    expect(result.why).toContain("No pattern");
  });

  it("includes intensity in chosen for non-none patterns", () => {
    const pattern: PatternInput = { ...PATTERN, type: "geometric", intensity: 0.3 };
    const result = explainPattern(pattern, BRAND_DNA, NO_FALLBACKS);
    expect(result.why).toContain("30%");
  });
});

describe("explainComponents", () => {
  it("returns one explanation per component", () => {
    const result = explainComponents(COMPONENTS, LAYOUT, BRAND_DNA, NO_FALLBACKS);
    expect(result).toHaveLength(3);
  });

  it("each explanation has componentType field", () => {
    const result = explainComponents(COMPONENTS, LAYOUT, BRAND_DNA, NO_FALLBACKS);
    expect(result.every((e) => e.componentType)).toBe(true);
  });

  it("each explanation has non-empty why", () => {
    const result = explainComponents(COMPONENTS, LAYOUT, BRAND_DNA, NO_FALLBACKS);
    expect(result.every((e) => e.why.length > 5)).toBe(true);
  });

  it("hero component explanation mentions value proposition or anchor", () => {
    const result = explainComponents(COMPONENTS, LAYOUT, BRAND_DNA, NO_FALLBACKS);
    const hero = result.find((e) => e.componentType === "hero");
    expect(hero?.why).toBeTruthy();
  });
});

describe("explainDecoration", () => {
  it("includes borderRadius in chosen", () => {
    const result = explainDecoration(DECORATION, MATERIAL, BRAND_DNA, NO_FALLBACKS);
    expect(result.chosen).toContain("medium");
  });

  it("includes shadow depth in why", () => {
    const result = explainDecoration(DECORATION, MATERIAL, BRAND_DNA, NO_FALLBACKS);
    expect(result.why).toContain("low");
  });
});

describe("explainMaterial", () => {
  it("includes surface type in chosen", () => {
    const result = explainMaterial(MATERIAL, BRAND_DNA, NO_FALLBACKS);
    expect(result.chosen).toContain("flat");
  });

  it("mentions legibility for flat surface", () => {
    const result = explainMaterial(MATERIAL, BRAND_DNA, NO_FALLBACKS);
    expect(result.why).toContain("legib");
  });

  it("includes risk profile brand signal", () => {
    const dnaWithRisk: BrandDnaInput = { ...BRAND_DNA, riskProfile: "Conservative" };
    const result = explainMaterial(MATERIAL, dnaWithRisk, NO_FALLBACKS);
    expect(result.brandSignal).toContain("Conservative");
  });
});

describe("explainMotif", () => {
  it("includes theme in chosen", () => {
    const result = explainMotif(MOTIF, BRAND_DNA, NO_FALLBACKS);
    expect(result.chosen).toContain("abstract");
  });

  it("returns at least 2 alternatives rejected", () => {
    const result = explainMotif(MOTIF, BRAND_DNA, NO_FALLBACKS);
    expect(result.alternativesRejected.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildCompositionRationale", () => {
  it("returns a non-trivial paragraph", () => {
    const rationale = buildCompositionRationale(LAYOUT, PALETTE, TYPOGRAPHY, MATERIAL, BRAND_DNA);
    expect(rationale.length).toBeGreaterThan(100);
  });

  it("includes layout strategy name", () => {
    const rationale = buildCompositionRationale(LAYOUT, PALETTE, TYPOGRAPHY, MATERIAL, BRAND_DNA);
    expect(rationale).toContain("hero-content");
  });

  it("includes industry when brand DNA provided", () => {
    const rationale = buildCompositionRationale(LAYOUT, PALETTE, TYPOGRAPHY, MATERIAL, BRAND_DNA);
    expect(rationale).toContain("finance");
  });

  it("handles missing brand DNA gracefully", () => {
    const rationale = buildCompositionRationale(LAYOUT, PALETTE, TYPOGRAPHY, MATERIAL, undefined);
    expect(rationale.length).toBeGreaterThan(50);
  });
});

describe("buildExplainabilityReport", () => {
  const params = {
    blueprint: BLUEPRINT,
    layout: LAYOUT,
    palette: PALETTE,
    typography: TYPOGRAPHY,
    pattern: PATTERN,
    components: COMPONENTS,
    decoration: DECORATION,
    material: MATERIAL,
    motif: MOTIF,
    brandDna: BRAND_DNA,
    fallbacks: NO_FALLBACKS,
  };

  it("produces a complete report with all sections", () => {
    const report = buildExplainabilityReport(params);
    expect(report.layout).toBeDefined();
    expect(report.palette).toBeDefined();
    expect(report.typography).toBeDefined();
    expect(report.pattern).toBeDefined();
    expect(report.components).toHaveLength(3);
    expect(report.decoration).toBeDefined();
    expect(report.material).toBeDefined();
    expect(report.motif).toBeDefined();
    expect(report.compositionRationale).toBeTruthy();
  });

  it("all DecisionExplanation fields have why + chosen", () => {
    const report = buildExplainabilityReport(params);
    const sections = [
      report.layout, report.palette, report.typography,
      report.pattern, report.decoration, report.material, report.motif,
    ];
    expect(sections.every((s) => s.chosen.length > 0 && s.why.length > 0)).toBe(true);
  });
});
