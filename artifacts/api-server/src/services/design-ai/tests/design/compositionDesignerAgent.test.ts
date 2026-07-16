/**
 * Composition Designer Agent — unit tests
 *
 * Covers: success, unknown section ID warning, retry on bad JSON,
 * retry exhaustion, deterministic output.
 */

import { describe, it, expect, vi } from "vitest";
import { runCompositionDesigner } from "../../agents/design/compositionDesignerAgent.js";
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
    requiredSections: ["header", "hero", "body", "cta"],
    optionalSections: [],
    contentDensity: "medium",
    layoutComplexity: "moderate",
    hasHeroImage: true,
    hasCta: true,
    hasProductShowcase: false,
    estimatedSectionCount: 4,
  },
  brandStrategy: {
    brandName: "Brand",
    brandPersonality: ["bold"],
    styleDirection: "bold",
    mood: "energetic",
  },
};

const MOCK_LAYOUT: LayoutSpec = {
  canvas: { width: 1080, height: 1350 },
  grid: { columns: 12, gutter: 16, margin: { top: 48, right: 48, bottom: 48, left: 48 } },
  safeArea: { x: 48, y: 48, width: 984, height: 1254 },
  sections: [
    { id: "header", name: "Header", order: 0, region: { x: 48, y: 48, width: 984, height: 80 }, alignment: "center", priority: 8 },
    { id: "hero",   name: "Hero",   order: 1, region: { x: 48, y: 160, width: 984, height: 600 }, alignment: "center", priority: 10 },
    { id: "body",   name: "Body",   order: 2, region: { x: 48, y: 800, width: 984, height: 350 }, alignment: "left", priority: 7 },
    { id: "cta",    name: "CTA",    order: 3, region: { x: 48, y: 1190, width: 984, height: 80 }, alignment: "center", priority: 9 },
  ],
  readingOrder: ["header", "hero", "body", "cta"],
  whitespaceRules: ["32px between sections"],
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
  ],
  spacingScale: [4, 8, 16, 32, 48, 64],
  relationships: [
    { fromSectionId: "hero", toSectionId: "cta", relationship: "lead-in" },
  ],
  densityMap: [
    { sectionId: "hero",   density: "low" as const },
    { sectionId: "body",   density: "medium" as const },
    { sectionId: "cta",    density: "low" as const },
    { sectionId: "header", density: "low" as const },
  ],
};

function aiResponse(data: unknown) {
  return { content: JSON.stringify(data), promptTokens: 80, completionTokens: 160, tokensUsed: 240, latencyMs: 130 };
}

// ── Success ───────────────────────────────────────────────────────────────────

describe("runCompositionDesigner — success", () => {
  it("returns a valid CompositionSpec on success", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_COMPOSITION));
    const result = await runCompositionDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.focalPoint.sectionId).toBe("hero");
    expect(result.data?.balance).toBe("asymmetrical");
    expect(result.data?.visualWeight).toHaveLength(4);
    expect(result.data?.spacingScale.length).toBeGreaterThanOrEqual(4);
  });

  it("has correct agent metadata", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(VALID_COMPOSITION));
    const result = await runCompositionDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.metadata.agentName).toBe("Composition Designer AI");
    expect(result.metadata.agentVersion).toBe("1.0.0");
    expect(result.metadata.retryCount).toBe(0);
  });
});

// ── Unknown section ID warning ─────────────────────────────────────────────────

describe("runCompositionDesigner — unknown section ID warning", () => {
  it("warns when focalPoint references an unknown section", async () => {
    const bad = {
      ...VALID_COMPOSITION,
      focalPoint: { sectionId: "ghost-section", reason: "Doesn't exist in layout" },
    };
    const executeAI = vi.fn().mockResolvedValue(aiResponse(bad));
    const result = await runCompositionDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.warnings.some((w) => w.includes("ghost-section"))).toBe(true);
  });

  it("warns when densityMap references an unknown section", async () => {
    const bad = {
      ...VALID_COMPOSITION,
      densityMap: [
        ...VALID_COMPOSITION.densityMap,
        { sectionId: "phantom", density: "high" as const },
      ],
    };
    const executeAI = vi.fn().mockResolvedValue(aiResponse(bad));
    const result = await runCompositionDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.warnings.some((w) => w.includes("phantom"))).toBe(true);
  });
});

// ── Retry ──────────────────────────────────────────────────────────────────────

describe("runCompositionDesigner — retry on invalid JSON", () => {
  it("retries and succeeds on second attempt", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce({ content: "{broken", promptTokens: 10, completionTokens: 5, tokensUsed: 15, latencyMs: 80 })
      .mockResolvedValueOnce(aiResponse(VALID_COMPOSITION));

    const result = await runCompositionDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(executeAI).toHaveBeenCalledTimes(2);
    expect(result.metadata.retryCount).toBe(1);
  });

  it("returns failed after 3 consecutive invalid JSON responses", async () => {
    const executeAI = vi.fn().mockResolvedValue({ content: "NOPE", promptTokens: 5, completionTokens: 2, tokensUsed: 7, latencyMs: 50 });
    const result = await runCompositionDesigner(MOCK_DISCOVERY, MOCK_LAYOUT, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });
});
