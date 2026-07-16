/**
 * Design Pipeline (runDesignPipeline) — unit tests
 *
 * Covers: full pipeline success, each agent failure propagates, pipeline
 * output is a new object (no mutation), correct agent sequence.
 */

import { describe, it, expect, vi } from "vitest";
import { runDesignPipeline } from "../../agents/design/index.js";
import type { ModelConfig } from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_MODEL: ModelConfig = {
  provider: { slug: "openai" },
  model: { modelId: "gpt-4o-mini", maxOutputTokens: 4096 },
  temperature: 0.3,
};

const MOCK_DISCOVERY: DiscoveryTeamOutput = {
  creativeBrief: {
    projectName: "Summer Campaign",
    projectType: "instagram_portrait",
    targetAudience: "Young adults 18–35",
    primaryObjective: "Drive product awareness",
    callToAction: "Shop Now",
  },
  requirementAnalysis: {
    requiredSections: ["header", "hero", "body", "cta"],
    optionalSections: ["footer"],
    contentDensity: "medium",
    layoutComplexity: "moderate",
    hasHeroImage: true,
    hasCta: true,
    hasProductShowcase: false,
    estimatedSectionCount: 5,
  },
  brandStrategy: {
    brandName: "StyleCo",
    brandPersonality: ["bold", "modern"],
    styleDirection: "bold",
    mood: "energetic",
    existingBrandColors: { primary: "#FF5733" },
  },
};

// ── Valid fixtures for each stage ─────────────────────────────────────────────

const VALID_LAYOUT = {
  canvas: { width: 1080, height: 1350 },
  grid: { columns: 12, gutter: 16, margin: { top: 48, right: 48, bottom: 48, left: 48 } },
  safeArea: { x: 48, y: 48, width: 984, height: 1254 },
  sections: [
    { id: "header", name: "Header", order: 0, region: { x: 48, y: 48,   width: 984, height: 80  }, alignment: "center" as const, priority: 8  },
    { id: "hero",   name: "Hero",   order: 1, region: { x: 48, y: 160,  width: 984, height: 600 }, alignment: "center" as const, priority: 10 },
    { id: "body",   name: "Body",   order: 2, region: { x: 48, y: 800,  width: 984, height: 350 }, alignment: "left"   as const, priority: 7  },
    { id: "cta",    name: "CTA",    order: 3, region: { x: 48, y: 1190, width: 984, height: 80  }, alignment: "center" as const, priority: 9  },
    { id: "footer", name: "Footer", order: 4, region: { x: 48, y: 1290, width: 984, height: 60  }, alignment: "center" as const, priority: 3  },
  ],
  readingOrder: ["header", "hero", "body", "cta", "footer"],
  whitespaceRules: ["32px between sections", "Hero fills its region"],
};

const VALID_COMPOSITION = {
  focalPoint: { sectionId: "hero", reason: "Primary visual anchor" },
  eyeFlow: ["header", "hero", "body", "cta"],
  balance: "asymmetrical" as const,
  visualWeight: [
    { sectionId: "hero",   weight: 80 },
    { sectionId: "cta",    weight: 70 },
    { sectionId: "body",   weight: 40 },
    { sectionId: "header", weight: 30 },
    { sectionId: "footer", weight: 10 },
  ],
  spacingScale: [4, 8, 16, 32, 48, 64],
  relationships: [{ fromSectionId: "hero", toSectionId: "cta", relationship: "lead-in" }],
  densityMap: [
    { sectionId: "hero",   density: "low"    as const },
    { sectionId: "body",   density: "medium" as const },
    { sectionId: "cta",    density: "low"    as const },
    { sectionId: "header", density: "low"    as const },
    { sectionId: "footer", density: "low"    as const },
  ],
};

const VALID_TYPOGRAPHY = {
  fontPairing: { headingFont: "Noto Sans", bodyFont: "Arial" },
  styles: {
    display:    { fontFamily: "Noto Sans", fontSize: 72, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5 },
    heading:    { fontFamily: "Noto Sans", fontSize: 48, fontWeight: 700, lineHeight: 1.2, letterSpacing: -0.3 },
    subheading: { fontFamily: "Noto Sans", fontSize: 32, fontWeight: 600, lineHeight: 1.3, letterSpacing:  0   },
    body:       { fontFamily: "Arial",     fontSize: 18, fontWeight: 400, lineHeight: 1.6, letterSpacing:  0   },
    caption:    { fontFamily: "Arial",     fontSize: 14, fontWeight: 400, lineHeight: 1.5, letterSpacing:  0.2 },
    button:     { fontFamily: "Noto Sans", fontSize: 18, fontWeight: 700, lineHeight: 1,   letterSpacing:  0.5, textTransform: "uppercase" },
  },
  fallbackFonts: ["Arial", "sans-serif"],
  readabilityRules: ["Min body 16px", "WCAG AA contrast"],
};

const VALID_COLOR = {
  tokens: {
    background: "#FFFFFF", surface: "#F5F5F5", primary: "#FF5733",
    secondary: "#2C3E50", accent: "#F39C12", textPrimary: "#1A1A1A",
    textSecondary: "#666666", border: "#E0E0E0",
  },
  gradients: [{ id: "hero-grad", type: "linear" as const, colors: ["#FF5733", "#C0392B"], stops: [0, 1], angle: 135 }],
  shadows: [{ id: "card", offsetX: 0, offsetY: 4, blur: 12, opacity: 0.15 }],
  contrastChecks: [{ foreground: "#1A1A1A", background: "#FFFFFF", ratio: 18.1, passed: true }],
};

const VALID_DECORATION = {
  decorations: [
    {
      id: "bg-circle",
      type: "background-accent" as const,
      geometry: { shape: "circle", cx: 900, cy: 200, r: 150 },
      style: { fill: "#FF5733", opacity: 0.08 },
      purpose: "Visual depth",
      decorativeOnly: true,
    },
  ],
};

function stage(data: unknown) {
  return { content: JSON.stringify(data), promptTokens: 80, completionTokens: 160, tokensUsed: 240, latencyMs: 100 };
}

function makeFullPipelineMock() {
  return vi.fn()
    .mockResolvedValueOnce(stage(VALID_LAYOUT))
    .mockResolvedValueOnce(stage(VALID_COMPOSITION))
    .mockResolvedValueOnce(stage(VALID_TYPOGRAPHY))
    .mockResolvedValueOnce(stage(VALID_COLOR))
    .mockResolvedValueOnce(stage(VALID_DECORATION));
}

// ── Full pipeline success ─────────────────────────────────────────────────────

describe("runDesignPipeline — full success", () => {
  it("returns a complete DesignTeamOutput from all 5 agents", async () => {
    const executeAI = makeFullPipelineMock();
    const output = await runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } });

    expect(output.layout.canvas).toEqual({ width: 1080, height: 1350 });
    expect(output.composition.focalPoint.sectionId).toBe("hero");
    expect(output.typography.fontPairing.headingFont).toBe("Noto Sans");
    expect(output.colors.tokens.primary).toBe("#FF5733");
    expect(output.decorations.decorations).toHaveLength(1);
  });

  it("calls executeAI exactly 5 times (once per agent)", async () => {
    const executeAI = makeFullPipelineMock();
    await runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } });
    expect(executeAI).toHaveBeenCalledTimes(5);
  });

  it("output is a new object — agents do not mutate each other", async () => {
    const executeAI = makeFullPipelineMock();
    const output = await runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } });

    // Verify the layout is a separate copy, not the same object reference as the fixture
    expect(output.layout).not.toBe(VALID_LAYOUT);
    expect(output.colors).not.toBe(VALID_COLOR);
  });
});

// ── Individual agent failure propagates ───────────────────────────────────────

describe("runDesignPipeline — failure propagation", () => {
  it("throws when Layout Architect fails (all retries exhausted)", async () => {
    const executeAI = vi.fn().mockResolvedValue({
      content: "INVALID", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50,
    });

    await expect(
      runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } }),
    ).rejects.toThrow(/Layout Architect/);
  });

  it("throws when Composition Designer fails, and includes agent name", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce(stage(VALID_LAYOUT))      // layout OK
      .mockResolvedValue({ content: "INVALID", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 }); // composition fail

    await expect(
      runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } }),
    ).rejects.toThrow(/Composition Designer/);
  });

  it("throws when Typography Designer fails", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce(stage(VALID_LAYOUT))
      .mockResolvedValueOnce(stage(VALID_COMPOSITION))
      .mockResolvedValue({ content: "INVALID", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 });

    await expect(
      runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } }),
    ).rejects.toThrow(/Typography Designer/);
  });

  it("throws when Color Designer fails", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce(stage(VALID_LAYOUT))
      .mockResolvedValueOnce(stage(VALID_COMPOSITION))
      .mockResolvedValueOnce(stage(VALID_TYPOGRAPHY))
      .mockResolvedValue({ content: "INVALID", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 });

    await expect(
      runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } }),
    ).rejects.toThrow(/Color Designer/);
  });

  it("throws when Decoration Designer fails", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce(stage(VALID_LAYOUT))
      .mockResolvedValueOnce(stage(VALID_COMPOSITION))
      .mockResolvedValueOnce(stage(VALID_TYPOGRAPHY))
      .mockResolvedValueOnce(stage(VALID_COLOR))
      .mockResolvedValue({ content: "INVALID", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 });

    await expect(
      runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI } }),
    ).rejects.toThrow(/Decoration Designer/);
  });
});

// ── Deterministic schema ──────────────────────────────────────────────────────

describe("runDesignPipeline — deterministic schema", () => {
  it("produces identical structure on two runs with the same mocked AI", async () => {
    const [output1, output2] = await Promise.all([
      runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI: makeFullPipelineMock() } }),
      runDesignPipeline(MOCK_DISCOVERY, { modelConfig: MOCK_MODEL, deps: { executeAI: makeFullPipelineMock() } }),
    ]);

    expect(output1.layout.canvas).toEqual(output2.layout.canvas);
    expect(output1.typography.fontPairing).toEqual(output2.typography.fontPairing);
    expect(output1.colors.tokens.primary).toBe(output2.colors.tokens.primary);
    expect(output1.decorations.decorations.map((d) => d.id)).toEqual(
      output2.decorations.decorations.map((d) => d.id),
    );
  });
});
