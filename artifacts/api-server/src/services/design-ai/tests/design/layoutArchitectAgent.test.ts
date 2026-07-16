/**
 * Layout Architect Agent — unit tests
 *
 * Covers: Instagram portrait, square post, landscape banner, many sections,
 * small canvas, section overflow warning, invalid JSON retry, retry exhaustion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLayoutArchitect, resolveCanvasDimensions } from "../../agents/design/layoutArchitectAgent.js";
import type { ModelConfig } from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_MODEL: ModelConfig = {
  provider: { slug: "openai" },
  model: { modelId: "gpt-4o-mini", maxOutputTokens: 4096 },
  temperature: 0.3,
};

function makeDiscovery(projectType: string): DiscoveryTeamOutput {
  return {
    creativeBrief: {
      projectName: "Test Project",
      projectType,
      targetAudience: "General audience",
      primaryObjective: "Brand awareness",
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
      brandName: "TestBrand",
      brandPersonality: ["bold"],
      styleDirection: "bold",
      mood: "energetic",
    },
  };
}

const PORTRAIT_LAYOUT = {
  canvas: { width: 1080, height: 1350 },
  grid: { columns: 12, gutter: 16, margin: { top: 48, right: 48, bottom: 48, left: 48 } },
  safeArea: { x: 48, y: 48, width: 984, height: 1254 },
  sections: [
    { id: "header", name: "Header", order: 0, region: { x: 48, y: 48, width: 984, height: 80 }, alignment: "center" as const, priority: 8 },
    { id: "hero",   name: "Hero",   order: 1, region: { x: 48, y: 160, width: 984, height: 600 }, alignment: "center" as const, priority: 10 },
    { id: "body",   name: "Body",   order: 2, region: { x: 48, y: 800, width: 984, height: 350 }, alignment: "left" as const, priority: 7 },
    { id: "cta",    name: "CTA",    order: 3, region: { x: 48, y: 1190, width: 984, height: 80 }, alignment: "center" as const, priority: 9 },
    { id: "footer", name: "Footer", order: 4, region: { x: 48, y: 1290, width: 984, height: 60 }, alignment: "center" as const, priority: 3 },
  ],
  readingOrder: ["header", "hero", "body", "cta", "footer"],
  whitespaceRules: ["Maintain 32px between sections", "Hero fills its region"],
};

const SQUARE_LAYOUT = {
  ...PORTRAIT_LAYOUT,
  canvas: { width: 1080, height: 1080 },
  sections: PORTRAIT_LAYOUT.sections.map((s) => ({
    ...s,
    region: { ...s.region, y: Math.min(s.region.y, 980) },
  })),
};

const LANDSCAPE_LAYOUT = {
  ...PORTRAIT_LAYOUT,
  canvas: { width: 1200, height: 628 },
  sections: [
    { id: "header", name: "Header", order: 0, region: { x: 48, y: 32, width: 1104, height: 60 }, alignment: "center" as const, priority: 8 },
    { id: "hero",   name: "Hero",   order: 1, region: { x: 48, y: 120, width: 600, height: 380 }, alignment: "left" as const, priority: 10 },
    { id: "body",   name: "Body",   order: 2, region: { x: 680, y: 120, width: 472, height: 280 }, alignment: "left" as const, priority: 7 },
    { id: "cta",    name: "CTA",    order: 3, region: { x: 680, y: 430, width: 472, height: 80 }, alignment: "center" as const, priority: 9 },
    { id: "footer", name: "Footer", order: 4, region: { x: 48, y: 558, width: 1104, height: 38 }, alignment: "center" as const, priority: 3 },
  ],
};

function aiResponse(data: unknown) {
  return {
    content: JSON.stringify(data),
    promptTokens: 100,
    completionTokens: 200,
    tokensUsed: 300,
    latencyMs: 150,
  };
}

// ── Canvas resolution ─────────────────────────────────────────────────────────

describe("resolveCanvasDimensions", () => {
  it("returns explicit dimensions when provided", () => {
    const discovery = makeDiscovery("instagram_portrait");
    discovery.creativeBrief.dimensions = { width: 800, height: 600 };
    expect(resolveCanvasDimensions(discovery)).toEqual({ width: 800, height: 600 });
  });

  it("resolves instagram_portrait to 1080×1350", () => {
    expect(resolveCanvasDimensions(makeDiscovery("instagram_portrait"))).toEqual({ width: 1080, height: 1350 });
  });

  it("resolves square_post to 1080×1080", () => {
    expect(resolveCanvasDimensions(makeDiscovery("square_post"))).toEqual({ width: 1080, height: 1080 });
  });

  it("resolves banner_landscape to 1200×628", () => {
    expect(resolveCanvasDimensions(makeDiscovery("banner_landscape"))).toEqual({ width: 1200, height: 628 });
  });

  it("falls back to 1080×1080 for unknown type", () => {
    expect(resolveCanvasDimensions(makeDiscovery("custom_format"))).toEqual({ width: 1080, height: 1080 });
  });
});

// ── Agent: Instagram portrait ─────────────────────────────────────────────────

describe("runLayoutArchitect — Instagram portrait", () => {
  it("returns success with correct canvas from AI response", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(PORTRAIT_LAYOUT));
    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.canvas).toEqual({ width: 1080, height: 1350 });
    expect(result.data?.sections).toHaveLength(5);
    expect(result.data?.readingOrder).toContain("hero");
    expect(executeAI).toHaveBeenCalledOnce();
  });

  it("metadata is fully populated", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(PORTRAIT_LAYOUT));
    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });

    expect(result.metadata.agentId).toBe("design-ai-layout-architect-v1");
    expect(result.metadata.agentName).toBe("Layout Architect AI");
    expect(result.metadata.retryCount).toBe(0);
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.totalTokens).toBe(300);
  });
});

// ── Agent: Square post ────────────────────────────────────────────────────────

describe("runLayoutArchitect — square post", () => {
  it("returns success for square canvas", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(SQUARE_LAYOUT));
    const result = await runLayoutArchitect(makeDiscovery("square_post"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.canvas).toEqual({ width: 1080, height: 1080 });
  });
});

// ── Agent: Landscape banner ───────────────────────────────────────────────────

describe("runLayoutArchitect — landscape banner", () => {
  it("returns success for landscape canvas", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(LANDSCAPE_LAYOUT));
    const result = await runLayoutArchitect(makeDiscovery("banner_landscape"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.canvas).toEqual({ width: 1200, height: 628 });
  });
});

// ── Agent: Many sections ──────────────────────────────────────────────────────

describe("runLayoutArchitect — many sections", () => {
  it("handles 9 sections without error", async () => {
    const manySections = {
      ...PORTRAIT_LAYOUT,
      sections: Array.from({ length: 9 }, (_, i) => ({
        id: `section-${i}`,
        name: `Section ${i}`,
        order: i,
        region: { x: 48, y: 48 + i * 130, width: 984, height: 110 },
        alignment: "left" as const,
        priority: Math.max(1, 10 - i),
      })),
      readingOrder: Array.from({ length: 9 }, (_, i) => `section-${i}`),
    };

    const executeAI = vi.fn().mockResolvedValue(aiResponse(manySections));
    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.sections).toHaveLength(9);
  });
});

// ── Agent: Small canvas ───────────────────────────────────────────────────────

describe("runLayoutArchitect — small canvas", () => {
  it("succeeds with a 400×300 canvas when AI returns fitting sections", async () => {
    const smallLayout = {
      ...PORTRAIT_LAYOUT,
      canvas: { width: 400, height: 300 },
      safeArea: { x: 16, y: 16, width: 368, height: 268 },
      sections: [
        { id: "hero", name: "Hero", order: 0, region: { x: 16, y: 16, width: 368, height: 200 }, alignment: "center" as const, priority: 10 },
        { id: "cta",  name: "CTA",  order: 1, region: { x: 16, y: 240, width: 368, height: 44  }, alignment: "center" as const, priority: 9 },
      ],
      readingOrder: ["hero", "cta"],
    };
    const discovery = makeDiscovery("custom_format");
    discovery.creativeBrief.dimensions = { width: 400, height: 300 };

    const executeAI = vi.fn().mockResolvedValue(aiResponse(smallLayout));
    const result = await runLayoutArchitect(discovery, MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.data?.canvas).toEqual({ width: 400, height: 300 });
  });
});

// ── Agent: Section overflow warning ──────────────────────────────────────────

describe("runLayoutArchitect — section overflow", () => {
  it("adds a warning when a section overflows the canvas", async () => {
    const overflowLayout = {
      ...PORTRAIT_LAYOUT,
      sections: [
        ...PORTRAIT_LAYOUT.sections.slice(0, 4),
        {
          id: "overflow",
          name: "Overflow Section",
          order: 4,
          region: { x: 48, y: 1300, width: 984, height: 200 }, // y+h = 1500 > 1350
          alignment: "center" as const,
          priority: 2,
        },
      ],
      readingOrder: [...PORTRAIT_LAYOUT.readingOrder, "overflow"],
    };

    const executeAI = vi.fn().mockResolvedValue(aiResponse(overflowLayout));
    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(result.warnings.some((w) => w.includes("overflow"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("overflow"))).toBe(true);
  });
});

// ── Agent: Invalid JSON → retry ───────────────────────────────────────────────

describe("runLayoutArchitect — invalid JSON retry", () => {
  it("retries on invalid JSON and succeeds on the second attempt", async () => {
    const executeAI = vi.fn()
      .mockResolvedValueOnce({ content: "not valid json {{{", promptTokens: 10, completionTokens: 5, tokensUsed: 15, latencyMs: 100 })
      .mockResolvedValueOnce(aiResponse(PORTRAIT_LAYOUT));

    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("success");
    expect(executeAI).toHaveBeenCalledTimes(2);
    expect(result.metadata.retryCount).toBe(1);
    expect(result.warnings.some((w) => w.includes("Retrying"))).toBe(true);
  });

  it("retries on markdown-wrapped JSON and extracts correctly", async () => {
    const executeAI = vi.fn().mockResolvedValue({
      content: `\`\`\`json\n${JSON.stringify(PORTRAIT_LAYOUT)}\n\`\`\``,
      promptTokens: 50,
      completionTokens: 100,
      tokensUsed: 150,
      latencyMs: 120,
    });

    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });
    expect(result.status).toBe("success");
  });
});

// ── Agent: Retry exhaustion → failed ─────────────────────────────────────────

describe("runLayoutArchitect — retry exhaustion", () => {
  it("returns failed status after 3 invalid JSON responses", async () => {
    const executeAI = vi.fn().mockResolvedValue({
      content: "INVALID JSON {{{{",
      promptTokens: 10, completionTokens: 5, tokensUsed: 15, latencyMs: 80,
    });

    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(executeAI).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("returns failed when executeAI always throws", async () => {
    const executeAI = vi.fn().mockRejectedValue(new Error("No API key configured"));

    const result = await runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI });

    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.includes("No API key"))).toBe(true);
  });
});

// ── Deterministic schema ──────────────────────────────────────────────────────

describe("runLayoutArchitect — deterministic schema", () => {
  it("produces identical output structure on two identical calls", async () => {
    const executeAI = vi.fn().mockResolvedValue(aiResponse(PORTRAIT_LAYOUT));

    const [r1, r2] = await Promise.all([
      runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI: vi.fn().mockResolvedValue(aiResponse(PORTRAIT_LAYOUT)) }),
      runLayoutArchitect(makeDiscovery("instagram_portrait"), MOCK_MODEL, { executeAI: vi.fn().mockResolvedValue(aiResponse(PORTRAIT_LAYOUT)) }),
    ]);

    expect(r1.status).toBe("success");
    expect(r2.status).toBe("success");
    expect(r1.data?.canvas).toEqual(r2.data?.canvas);
    expect(r1.data?.sections.map((s) => s.id)).toEqual(r2.data?.sections.map((s) => s.id));
  });
});
