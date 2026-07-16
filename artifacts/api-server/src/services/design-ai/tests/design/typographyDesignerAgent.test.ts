/**
 * Typography Designer Agent — unit tests
 *
 * Covers: success, invalid font registry warning, retry on bad JSON,
 * retry exhaustion.
 */

import { describe, it, expect, vi } from "vitest";
import { runTypographyDesigner } from "../../agents/design/typographyDesignerAgent.js";
import type { ModelConfig, LayoutSpec } from "../../types/design.types.js";
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
    requiredSections: ["header", "hero"],
    optionalSections: [],
    contentDensity: "medium",
    layoutComplexity: "simple",
    hasHeroImage: true,
    hasCta: true,
    hasProductShowcase: false,
    estimatedSectionCount: 2,
  },
  brandStrategy: {
    brandName: "Brand",
    brandPersonality: ["modern"],
    styleDirection: "minimalist",
    mood: "calm",
    preferredFonts: ["Noto Sans"],
  },
};

const MOCK_LAYOUT: LayoutSpec = {
  canvas: { width: 1080, height: 1350 },
  grid: { columns: 12, gutter: 16, margin: { top: 48, right: 48, bottom: 48, left: 48 } },
  safeArea: { x: 48, y: 48, width: 984, height: 1254 },
  sections: [
    { id: "header", name: "Header", order: 0, region: { x: 48, y: 48, width: 984, height: 80 }, alignment: "center", priority: 8 },
    { id: "hero",   name: "Hero",   order: 1, region: { x: 48, y: 160, width: 984, height: 600 }, alignment: "center", priority: 10 },
  ],
  readingOrder: ["header", "hero"],
  whitespaceRules: ["32px between sections"],
};

const VALID_TYPOGRAPHY = {
  fontPairing: { headingFont: "Noto Sans", bodyFont: "Arial" },
  styles: {
    display:    { fontFamily: "Noto Sans", fontSize: 72, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5 },
    heading:    { fontFamily: "Noto Sans", fontSize: 48, fontWeight: 700, lineHeight: 1.2, letterSpacing: -0.3 },
    subheading: { fontFamily: "Noto Sans", fontSize: 32, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0 },
    body:       { fontFamily: "Arial",     fontSize: 18, fontWeight: 400, lineHeight: 1.6, letterSpacing: 0 },
    caption:    { fontFamily: "Arial",     fontSize: 14, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0.2 },
    button:     { fontFamily: "Noto Sans", fontSize: 18, fontWeight: 700, lineHeight: 1,   letterSpacing: 0.5, textTransform: "uppercase" },
  },
  fallbackFonts: ["Arial", "sans-serif"],
  readabilityRules: ["Minimum body font size 16px", "Heading contrast ≥ 4.5:1"],
};

function aiResponse(data: unknown) {
  return { content: JSON.stringify(data), promptTokens: 80, completionTokens: 160, tokensUsed: 240, latencyMs: 130 };
}

// ── Success ───────────────────────────────────────────────────────────────────

describe("runTypographyDesigner — success (registered fonts)", () => {
  it("returns success with no warnings for registry fonts", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_TYPOGRAPHY));
    const result = await runTypographyDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.fontPairing.headingFont).toBe("Noto Sans");
    expect(result.data?.fontPairing.bodyFont).toBe("Arial");
    // No unregistered-font warnings expected
    const fontWarnings = result.warnings.filter((w) => w.includes("not in the platform registry"));
    expect(fontWarnings).toHaveLength(0);
  });

  it("returns styles with correct structure", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_TYPOGRAPHY));
    const result = await runTypographyDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.data?.styles.display.fontSize).toBe(72);
    expect(result.data?.styles.body.lineHeight).toBe(1.6);
    expect(result.data?.fallbackFonts).toContain("Arial");
    expect(result.data?.readabilityRules.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Invalid font registry warning ─────────────────────────────────────────────

describe("runTypographyDesigner — invalid font registry", () => {
  it("warns when headingFont is not in registry", async () => {
    const badTypography = {
      ...VALID_TYPOGRAPHY,
      fontPairing: { headingFont: "Roboto", bodyFont: "Arial" }, // Roboto not in registry
      styles: {
        ...VALID_TYPOGRAPHY.styles,
        display:    { ...VALID_TYPOGRAPHY.styles.display, fontFamily: "Roboto" },
        heading:    { ...VALID_TYPOGRAPHY.styles.heading, fontFamily: "Roboto" },
        subheading: { ...VALID_TYPOGRAPHY.styles.subheading, fontFamily: "Roboto" },
        button:     { ...VALID_TYPOGRAPHY.styles.button, fontFamily: "Roboto" },
      },
    };

    const executeAI = vi.fn().mockResolvedValue(aiResponse(badTypography));
    const result = await runTypographyDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.warnings.some((w) => w.includes("Roboto") && w.includes("not in the platform registry"))).toBe(true);
  });

  it("warns for both headingFont and bodyFont when both are unregistered", async () => {
    const badTypography = {
      ...VALID_TYPOGRAPHY,
      fontPairing: { headingFont: "Montserrat", bodyFont: "Open Sans" },
      styles: {
        ...VALID_TYPOGRAPHY.styles,
        display: { ...VALID_TYPOGRAPHY.styles.display, fontFamily: "Montserrat" },
        body:    { ...VALID_TYPOGRAPHY.styles.body, fontFamily: "Open Sans" },
      },
    };

    const executeAI = vi.fn().mockResolvedValue(aiResponse(badTypography));
    const result = await runTypographyDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.warnings.some((w) => w.includes("Montserrat"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Open Sans"))).toBe(true);
  });

  it("does not warn for known registry fonts", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_TYPOGRAPHY));
    const result = await runTypographyDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    const registryWarnings = result.warnings.filter((w) => w.includes("not in the platform registry"));
    expect(registryWarnings).toHaveLength(0);
  });
});

// ── Retry ──────────────────────────────────────────────────────────────────────

describe("runTypographyDesigner — retry on bad JSON", () => {
  it("retries and succeeds on the second attempt", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce({ content: "```\nbad json\n```", promptTokens: 10, completionTokens: 5, tokensUsed: 15, latencyMs: 80 })
      .mockResolvedValueOnce(aiResponse(VALID_TYPOGRAPHY));

    const result = await runTypographyDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(executeAI).toHaveBeenCalledTimes(2);
  });

  it("returns failed after 3 invalid responses", async () => {
    const executeAI = vi.fn().mockResolvedValue({ content: "INVALID", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 });
    const result = await runTypographyDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
