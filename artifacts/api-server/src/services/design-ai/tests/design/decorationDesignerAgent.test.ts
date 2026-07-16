/**
 * Decoration Designer Agent — unit tests
 *
 * Covers: success, empty decoration list, unknown targetSectionId warning,
 * retry, exhaustion.
 */

import { describe, it, expect, vi } from "vitest";
import { runDecorationDesigner } from "../../agents/design/decorationDesignerAgent.js";
import type { ModelConfig, LayoutSpec, CompositionSpec, ColorSpec } from "../../types/design.types.js";
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
    brandPersonality: ["minimalist"],
    styleDirection: "minimalist",
    mood: "calm",
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

const MOCK_COMPOSITION: CompositionSpec = {
  focalPoint: { sectionId: "hero", reason: "Primary anchor" },
  eyeFlow: ["hero", "cta"],
  balance: "symmetrical",
  visualWeight: [{ sectionId: "hero", weight: 80 }, { sectionId: "cta", weight: 60 }],
  spacingScale: [8, 16, 32, 48],
  relationships: [{ fromSectionId: "hero", toSectionId: "cta", relationship: "lead-in" }],
  densityMap: [{ sectionId: "hero", density: "low" }, { sectionId: "cta", density: "low" }],
};

const MOCK_COLORS: ColorSpec = {
  tokens: {
    background: "#FFFFFF", surface: "#F5F5F5", primary: "#FF5733", secondary: "#2C3E50",
    accent: "#F39C12", textPrimary: "#1A1A1A", textSecondary: "#666666", border: "#E0E0E0",
  },
  gradients: [],
  shadows: [],
  contrastChecks: [{ foreground: "#1A1A1A", background: "#FFFFFF", ratio: 18.1, passed: true }],
};

const VALID_DECORATION = {
  decorations: [
    {
      id: "bg-circle-1",
      type: "background-accent",
      geometry: { shape: "circle", cx: 900, cy: 200, r: 150 },
      style: { fill: "#FF5733", opacity: 0.08 },
      purpose: "Visual depth",
      decorativeOnly: true,
    },
    {
      id: "divider-1",
      type: "divider",
      targetSectionId: "hero",
      geometry: { x: 48, y: 770, width: 984, height: 2 },
      style: { fill: "#E0E0E0" },
      purpose: "Section separator",
      decorativeOnly: true,
    },
  ],
};

const EMPTY_DECORATION = { decorations: [] };

function aiResponse(data: unknown) {
  return { content: JSON.stringify(data), promptTokens: 80, completionTokens: 160, tokensUsed: 240, latencyMs: 130 };
}

// ── Success ───────────────────────────────────────────────────────────────────

describe("runDecorationDesigner — success", () => {
  it("returns valid DecorationSpec with decorations", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_DECORATION));
    const result = await runDecorationDesigner(
      MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_COMPOSITION, MOCK_COLORS, MOCK_MODEL, { executeAI },
    );

    expect(result.status).toBe("success");
    expect(result.data?.decorations).toHaveLength(2);
    expect(result.data?.decorations[0].decorativeOnly).toBe(true);
  });

  it("has correct agent metadata", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_DECORATION));
    const result = await runDecorationDesigner(
      MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_COMPOSITION, MOCK_COLORS, MOCK_MODEL, { executeAI },
    );

    expect(result.metadata.agentName).toBe("Decoration Designer AI");
    expect(result.metadata.retryCount).toBe(0);
  });
});

// ── Empty decoration list ──────────────────────────────────────────────────────

describe("runDecorationDesigner — empty decoration list", () => {
  it("accepts an empty decorations array (minimalist design)", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(EMPTY_DECORATION));
    const result = await runDecorationDesigner(
      MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_COMPOSITION, MOCK_COLORS, MOCK_MODEL, { executeAI },
    );

    expect(result.status).toBe("success");
    expect(result.data?.decorations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ── Unknown targetSectionId warning ──────────────────────────────────────────

describe("runDecorationDesigner — unknown targetSectionId", () => {
  it("warns when a decoration references an unknown section ID", async () => {
    const badDecoration = {
      decorations: [
        {
          id: "bad-deco",
          type: "badge",
          targetSectionId: "non-existent-section",
          geometry: { x: 100, y: 100, width: 80, height: 30 },
          style: { fill: "#FF5733" },
          purpose: "Highlight feature",
          decorativeOnly: false,
        },
      ],
    };
    const executeAI = vi.fn().mockResolvedValue(aiResponse(badDecoration));
    const result = await runDecorationDesigner(
      MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_COMPOSITION, MOCK_COLORS, MOCK_MODEL, { executeAI },
    );

    expect(result.status).toBe("success");
    expect(result.warnings.some((w) => w.includes("non-existent-section"))).toBe(true);
  });

  it("does not warn when targetSectionId is omitted (canvas-level decoration)", async () => {
    const canvasDeco = {
      decorations: [{
        id: "canvas-bg",
        type: "background-accent",
        // no targetSectionId
        geometry: { x: 0, y: 0, width: 1080, height: 1350 },
        style: { fill: "#FAFAFA" },
        purpose: "Full canvas background tint",
        decorativeOnly: true,
      }],
    };
    const executeAI = vi.fn().mockResolvedValue(aiResponse(canvasDeco));
    const result = await runDecorationDesigner(
      MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_COMPOSITION, MOCK_COLORS, MOCK_MODEL, { executeAI },
    );

    expect(result.status).toBe("success");
    expect(result.warnings).toHaveLength(0);
  });
});

// ── Retry ──────────────────────────────────────────────────────────────────────

describe("runDecorationDesigner — retry", () => {
  it("retries and succeeds on second attempt", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce({ content: "not json", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 })
      .mockResolvedValueOnce(aiResponse(VALID_DECORATION));

    const result = await runDecorationDesigner(
      MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_COMPOSITION, MOCK_COLORS, MOCK_MODEL, { executeAI },
    );

    expect(result.status).toBe("success");
    expect(executeAI).toHaveBeenCalledTimes(2);
  });

  it("returns failed after 3 invalid responses", async () => {
    const executeAI = vi.fn().mockResolvedValue({ content: "null", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 });
    const result = await runDecorationDesigner(
      MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_COMPOSITION, MOCK_COLORS, MOCK_MODEL, { executeAI },
    );

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });
});
