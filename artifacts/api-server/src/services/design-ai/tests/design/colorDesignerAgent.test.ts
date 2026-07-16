/**
 * Color Designer Agent — unit tests
 *
 * Covers: success, contrast fail warning, WCAG utilities, retry, exhaustion.
 */

import { describe, it, expect, vi } from "vitest";
import {
  runColorDesigner,
  relativeLuminance,
  wcagContrastRatio,
} from "../../agents/design/colorDesignerAgent.js";
import type { ModelConfig, LayoutSpec, TypographySpec } from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_MODEL: ModelConfig = {
  provider: { slug: "openai" },
  model: { modelId: "gpt-4o-mini", maxOutputTokens: 4096 },
  temperature: 0.3,
};

const MOCK_DISCOVERY: DiscoveryTeamOutput = {
  creativeBrief: { projectName: "Test", projectType: "instagram_portrait" },
  requirementAnalysis: {
    requiredSections: ["hero", "cta"],
    optionalSections: [],
    contentDensity: "low",
    layoutComplexity: "simple",
    hasHeroImage: true,
    hasCta: true,
    hasProductShowcase: false,
    estimatedSectionCount: 2,
  },
  brandStrategy: {
    brandName: "Brand",
    brandPersonality: ["bold"],
    styleDirection: "bold",
    mood: "energetic",
    existingBrandColors: { primary: "#FF5733" },
  },
};

const MOCK_LAYOUT: LayoutSpec = {
  canvas: { width: 1080, height: 1350 },
  grid: { columns: 12, gutter: 16, margin: { top: 48, right: 48, bottom: 48, left: 48 } },
  safeArea: { x: 48, y: 48, width: 984, height: 1254 },
  sections: [
    { id: "hero", name: "Hero", order: 0, region: { x: 48, y: 48, width: 984, height: 800 }, alignment: "center", priority: 10 },
    { id: "cta",  name: "CTA",  order: 1, region: { x: 48, y: 880, width: 984, height: 80  }, alignment: "center", priority: 9 },
  ],
  readingOrder: ["hero", "cta"],
  whitespaceRules: ["Center content"],
};

const MOCK_TYPOGRAPHY: TypographySpec = {
  fontPairing: { headingFont: "Noto Sans", bodyFont: "Arial" },
  styles: {
    display:    { fontFamily: "Noto Sans", fontSize: 72, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5 },
    heading:    { fontFamily: "Noto Sans", fontSize: 48, fontWeight: 700, lineHeight: 1.2, letterSpacing: -0.3 },
    subheading: { fontFamily: "Noto Sans", fontSize: 32, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0 },
    body:       { fontFamily: "Arial",     fontSize: 18, fontWeight: 400, lineHeight: 1.6, letterSpacing: 0 },
    caption:    { fontFamily: "Arial",     fontSize: 14, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0.2 },
    button:     { fontFamily: "Noto Sans", fontSize: 18, fontWeight: 700, lineHeight: 1,   letterSpacing: 0.5 },
  },
  fallbackFonts: ["Arial"],
  readabilityRules: ["Min 16px body", "WCAG AA contrast"],
};

const VALID_COLOR = {
  tokens: {
    background: "#FFFFFF",
    surface:    "#F5F5F5",
    primary:    "#FF5733",
    secondary:  "#2C3E50",
    accent:     "#F39C12",
    textPrimary:   "#1A1A1A",
    textSecondary: "#666666",
    border: "#E0E0E0",
  },
  gradients: [
    { id: "hero-grad", type: "linear" as const, colors: ["#FF5733", "#C0392B"], stops: [0, 1], angle: 135 },
  ],
  shadows: [
    { id: "card", offsetX: 0, offsetY: 4, blur: 12, opacity: 0.15 },
  ],
  contrastChecks: [
    { foreground: "#1A1A1A", background: "#FFFFFF", ratio: 18.1, passed: true },
  ],
};

function aiResponse(data: unknown) {
  return { content: JSON.stringify(data), promptTokens: 80, completionTokens: 160, tokensUsed: 240, latencyMs: 130 };
}

// ── WCAG utilities ────────────────────────────────────────────────────────────

describe("WCAG contrast utilities", () => {
  it("relativeLuminance: pure white = 1.0", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1.0, 2);
  });

  it("relativeLuminance: pure black = 0.0", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0.0, 5);
  });

  it("wcagContrastRatio: black on white = 21:1", () => {
    expect(wcagContrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });

  it("wcagContrastRatio: white on white = 1:1", () => {
    expect(wcagContrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 2);
  });

  it("wcagContrastRatio is symmetric", () => {
    const r1 = wcagContrastRatio("#FF5733", "#FFFFFF");
    const r2 = wcagContrastRatio("#FFFFFF", "#FF5733");
    expect(r1).toBeCloseTo(r2, 2);
  });

  it("wcagContrastRatio for dark gray on white passes WCAG AA (≥4.5)", () => {
    // #1A1A1A on #FFFFFF
    const ratio = wcagContrastRatio("#1A1A1A", "#FFFFFF");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("wcagContrastRatio returns 0 gracefully for invalid hex", () => {
    expect(() => wcagContrastRatio("notahex", "#FFFFFF")).not.toThrow();
  });
});

// ── Success ───────────────────────────────────────────────────────────────────

describe("runColorDesigner — success", () => {
  it("returns valid ColorSpec", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_COLOR));
    const result = await runColorDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_TYPOGRAPHY, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.tokens.primary).toBe("#FF5733");
    expect(result.data?.tokens.background).toBe("#FFFFFF");
    expect(result.data?.gradients).toHaveLength(1);
    expect(result.data?.shadows).toHaveLength(1);
  });

  it("no contrast warnings when all checks pass", async () => {
    const allPass = {
      ...VALID_COLOR,
      contrastChecks: [
        { foreground: "#1A1A1A", background: "#FFFFFF", ratio: 18.1, passed: true },
        { foreground: "#FFFFFF", background: "#2C3E50", ratio: 7.4,  passed: true },
      ],
    };
    const executeAI = vi.fn().mockResolvedValue(aiResponse(allPass));
    const result = await runColorDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_TYPOGRAPHY, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    const contrastWarnings = result.warnings.filter((w) => w.includes("Contrast check failed"));
    expect(contrastWarnings).toHaveLength(0);
  });
});

// ── Contrast fail warning ─────────────────────────────────────────────────────

describe("runColorDesigner — contrast fail", () => {
  it("emits a warning for each failed contrast check", async () => {
    const failedColor = {
      ...VALID_COLOR,
      contrastChecks: [
        { foreground: "#FFFFFF", background: "#FF5733", ratio: 3.1, passed: false },
        { foreground: "#666666", background: "#F5F5F5", ratio: 2.8, passed: false },
      ],
    };
    const executeAI = vi.fn().mockResolvedValue(aiResponse(failedColor));
    const result = await runColorDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_TYPOGRAPHY, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    const contrastWarnings = result.warnings.filter((w) => w.includes("Contrast check failed"));
    expect(contrastWarnings).toHaveLength(2);
    expect(contrastWarnings[0]).toContain("4.5:1");
  });

  it("data is still returned even when contrast fails", async () => {
    const failedColor = {
      ...VALID_COLOR,
      contrastChecks: [{ foreground: "#CCCCCC", background: "#FFFFFF", ratio: 1.6, passed: false }],
    };
    const executeAI = vi.fn().mockResolvedValue(aiResponse(failedColor));
    const result = await runColorDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_TYPOGRAPHY, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();
  });
});

// ── Retry ──────────────────────────────────────────────────────────────────────

describe("runColorDesigner — retry", () => {
  it("retries on schema validation failure and succeeds", async () => {
    const missingHexToken = {
      ...VALID_COLOR,
      tokens: { ...VALID_COLOR.tokens, background: "white" }, // fails hex validation
    };
    const executeAI = vi.fn()
      .mockResolvedValueOnce(aiResponse(missingHexToken))
      .mockResolvedValueOnce(aiResponse(VALID_COLOR));

    const result = await runColorDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_TYPOGRAPHY, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(executeAI).toHaveBeenCalledTimes(2);
    expect(result.metadata.retryCount).toBe(1);
  });

  it("returns failed after 3 invalid responses", async () => {
    const executeAI = vi.fn().mockResolvedValue({ content: "[]", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 });
    const result = await runColorDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_TYPOGRAPHY, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });
});
