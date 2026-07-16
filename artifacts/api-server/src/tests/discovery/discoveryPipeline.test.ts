/**
 * Discovery Pipeline — Unit Tests (Team 1)
 *
 * All AI provider calls are mocked — no real API calls, no billing.
 *
 * Test cases:
 *  1.  Simple prompt (baseline happy path)
 *  2.  Prompt with explicit canvas size
 *  3.  Multilingual prompt (non-English)
 *  4.  Prompt without any CTA
 *  5.  Prompt with brand colour keywords
 *  6.  Prompt with conflicting requirements
 *  7.  Prompt missing critical information
 *  8.  Schema validation (each agent validates output shape)
 *  9.  AI provider error → agent returns "failed"
 * 10.  AI returns invalid JSON → agent returns "failed"
 * 11.  Retry behaviour (fails once, succeeds on second attempt)
 * 12.  Full pipeline — runDiscoveryPipeline happy path
 * 13.  Full pipeline — fails fast when Creative Director fails
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";

// ── Mock the AI execution layer ───────────────────────────────────────────────
vi.mock("../../services/aiExecutionService.js", () => ({
  executeAI: vi.fn(),
}));

import { executeAI } from "../../services/aiExecutionService.js";
import { runCreativeDirectorAgent } from "../../services/design-ai/agents/discovery/creativeDirectorAgent.js";
import { runRequirementAnalystAgent } from "../../services/design-ai/agents/discovery/requirementAnalystAgent.js";
import { runBrandStrategistAgent } from "../../services/design-ai/agents/discovery/brandStrategistAgent.js";
import {
  runDiscoveryPipeline,
  DiscoveryPipelineError,
} from "../../services/design-ai/agents/discovery/index.js";
import type {
  CreativeBrief,
  RequirementAnalysis,
  BrandStrategy,
  AgentModelConfig,
} from "../../services/design-ai/types/discovery.types.js";

// ── Typed mock ────────────────────────────────────────────────────────────────
const mockExecuteAI = executeAI as MockedFunction<typeof executeAI>;

function makeAIResponse(json: unknown) {
  return {
    content: JSON.stringify(json),
    promptTokens: 100,
    completionTokens: 200,
    tokensUsed: 300,
    latencyMs: 250,
  };
}

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeCreativeBrief(overrides: Partial<CreativeBrief> = {}): CreativeBrief {
  return {
    designGoal: "Promote a new product launch",
    communicationObjective: "Drive awareness and purchase intent",
    targetAudience: {
      primary: "Young professionals 25-35",
      characteristics: ["tech-savvy", "urban"],
    },
    coreMessage: "Introducing the future of productivity",
    tone: ["professional", "inspiring"],
    desiredEmotion: ["excitement", "trust"],
    visualDirection: ["modern", "clean"],
    styleKeywords: ["minimal", "bold"],
    contentPriority: ["headline", "product image", "CTA"],
    assumptions: [],
    missingInformation: [],
    ...overrides,
  };
}

function makeRequirementAnalysis(overrides: Partial<RequirementAnalysis> = {}): RequirementAnalysis {
  return {
    platform: "instagram-square",
    language: "en",
    canvas: { width: 1080, height: 1080, unit: "px", orientation: "square", preset: "instagram-square" },
    sections: [{ id: "hero", name: "Hero", required: true, contentPurpose: "Primary message" }],
    callsToAction: [{ label: "Shop Now", purpose: "Drive conversion", priority: "primary" }],
    requestedVariables: [],
    requiredContent: ["headline", "product image"],
    optionalContent: [],
    contentConstraints: [],
    visualConstraints: [],
    exportFormats: ["png"],
    explicitRequirements: ["Instagram square format"],
    inferredRequirements: ["High visual impact"],
    conflicts: [],
    missingInformation: [],
    ...overrides,
  };
}

function makeBrandStrategy(overrides: Partial<BrandStrategy> = {}): BrandStrategy {
  return {
    brandPersonality: ["innovative", "trustworthy"],
    brandStyle: ["modern", "minimal"],
    mood: ["energetic", "professional"],
    visualKeywords: ["clean", "bold", "dynamic"],
    colorDirection: {
      primaryMood: "cool",
      supportingMood: ["neutral"],
      avoid: ["neon", "clashing"],
      useExistingBrandPalette: false,
    },
    typographyDirection: {
      category: ["sans-serif"],
      personality: ["clean", "modern"],
      readabilityPriority: "high",
    },
    imageryDirection: ["product-focused", "lifestyle"],
    logoRules: ["place in top-left corner", "maintain clear space"],
    brandingRules: ["consistent use of brand colours"],
    forbiddenStyles: ["skeuomorphic", "overly decorative"],
    assumptions: ["Brand palette not provided — using mood-based direction"],
    ...overrides,
  };
}

const TEST_MODEL: AgentModelConfig = {
  provider: { slug: "openai" },
  model: { modelId: "gpt-4o-mini", maxOutputTokens: 1024 },
  temperature: 0.3,
  maxRetries: 1,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// 1. Simple prompt
describe("Creative Director Agent", () => {
  it("returns success on a simple prompt", async () => {
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(makeCreativeBrief()));

    const result = await runCreativeDirectorAgent({
      userPrompt: "Create an Instagram post for a new running shoe launch",
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();
    expect(result.data?.designGoal).toBeTruthy();
    expect(result.metadata.agentId).toBe("discovery-creative-director");
    expect(result.metadata.retryCount).toBe(0);
  });

  // 3. Multilingual prompt
  it("handles multilingual prompt — returns success regardless of language", async () => {
    const brief = makeCreativeBrief({ coreMessage: "Perkenalkan produk terbaru kami" });
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(brief));

    const result = await runCreativeDirectorAgent({
      userPrompt: "Buat poster Instagram untuk peluncuran sepatu lari baru kami",
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.data?.coreMessage).toBe("Perkenalkan produk terbaru kami");
  });

  // 7. Missing information
  it("surfaces missing information in the brief", async () => {
    const brief = makeCreativeBrief({
      missingInformation: ["Target price point not specified", "Brand name not mentioned"],
      assumptions: ["Assuming B2C market"],
    });
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(brief));

    const result = await runCreativeDirectorAgent({
      userPrompt: "Make a poster",
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.data?.missingInformation.length).toBeGreaterThan(0);
  });

  // 8. Schema validation — missing required field
  it("fails schema validation when AI omits a required field", async () => {
    const badOutput = { designGoal: "Something" }; // missing most required fields
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(badOutput));

    const result = await runCreativeDirectorAgent({
      userPrompt: "Design a banner",
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.includes("Schema validation failed"))).toBe(true);
  });

  // 9. AI provider error
  it("returns failed status when AI provider throws", async () => {
    mockExecuteAI.mockRejectedValueOnce(new Error("Rate limit exceeded"));
    mockExecuteAI.mockRejectedValueOnce(new Error("Rate limit exceeded")); // second attempt (maxRetries=1)

    const result = await runCreativeDirectorAgent({
      userPrompt: "Design a banner",
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.includes("AI provider failed"))).toBe(true);
  });

  // 10. Invalid JSON response
  it("returns failed when AI returns non-JSON text", async () => {
    mockExecuteAI.mockResolvedValueOnce({
      content: "Sorry, I cannot help with that.",
      promptTokens: 50,
      completionTokens: 10,
      tokensUsed: 60,
      latencyMs: 100,
    });

    const result = await runCreativeDirectorAgent({
      userPrompt: "Design a banner",
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.includes("invalid JSON"))).toBe(true);
  });

  // 11. Retry behaviour
  it("retries on transient error and succeeds on second attempt", async () => {
    mockExecuteAI
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValueOnce(makeAIResponse(makeCreativeBrief()));

    const result = await runCreativeDirectorAgent({
      userPrompt: "Create a flyer for a tech event",
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.metadata.retryCount).toBe(1);
    expect(result.warnings.some(w => w.includes("Retry"))).toBe(true);
  });
});

// 2. Prompt with explicit canvas size
describe("Requirement Analyst Agent", () => {
  it("extracts explicit canvas dimensions from prompt", async () => {
    const analysis = makeRequirementAnalysis({
      canvas: { width: 1920, height: 1080, unit: "px", orientation: "landscape", preset: "presentation-16-9" },
      explicitRequirements: ["1920x1080 landscape canvas"],
    });
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(analysis));

    const result = await runRequirementAnalystAgent({
      userPrompt: "Create a 1920x1080 landscape presentation slide",
      creativeBrief: makeCreativeBrief(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.data?.canvas.width).toBe(1920);
    expect(result.data?.canvas.orientation).toBe("landscape");
  });

  // 4. No CTA
  it("returns empty callsToAction when prompt has no CTA", async () => {
    const analysis = makeRequirementAnalysis({ callsToAction: [] });
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(analysis));

    const result = await runRequirementAnalystAgent({
      userPrompt: "Create a mood board for internal use",
      creativeBrief: makeCreativeBrief(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.data?.callsToAction).toHaveLength(0);
  });

  // 6. Conflicting requirements
  it("surfaces conflicts in warnings when requirements conflict", async () => {
    const analysis = makeRequirementAnalysis({
      conflicts: [
        {
          requirementA: "Minimal text",
          requirementB: "Include full product specs",
          resolution: "Use QR code to link to specs page",
        },
      ],
    });
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(analysis));

    const result = await runRequirementAnalystAgent({
      userPrompt: "Minimal poster with full product specs for A4",
      creativeBrief: makeCreativeBrief(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.warnings.some(w => w.includes("Requirement conflict"))).toBe(true);
  });

  // 8. Schema validation
  it("fails when canvas unit is not px", async () => {
    const bad = { ...makeRequirementAnalysis(), canvas: { width: 100, height: 100, unit: "cm", orientation: "square" } };
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(bad));

    const result = await runRequirementAnalystAgent({
      userPrompt: "Make something",
      creativeBrief: makeCreativeBrief(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.includes("Schema validation failed"))).toBe(true);
  });

  // 9. AI provider error
  it("returns failed when AI provider throws", async () => {
    mockExecuteAI.mockRejectedValue(new Error("503 Service Unavailable"));

    const result = await runRequirementAnalystAgent({
      userPrompt: "Design a flyer",
      creativeBrief: makeCreativeBrief(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
  });

  // 10. Invalid JSON
  it("returns failed when AI returns invalid JSON", async () => {
    mockExecuteAI.mockResolvedValueOnce({ content: "```\nnot json\n```", promptTokens: 10, completionTokens: 5, tokensUsed: 15, latencyMs: 50 });

    const result = await runRequirementAnalystAgent({
      userPrompt: "Design a flyer",
      creativeBrief: makeCreativeBrief(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.includes("invalid JSON"))).toBe(true);
  });
});

// 5. Brand colour keywords
describe("Brand Strategist Agent", () => {
  it("sets useExistingBrandPalette=true when brand profile is provided", async () => {
    const strategy = makeBrandStrategy({
      colorDirection: {
        primaryMood: "warm",
        supportingMood: ["earthy"],
        avoid: ["cool blues"],
        useExistingBrandPalette: true,
      },
    });
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(strategy));

    const result = await runBrandStrategistAgent({
      creativeBrief: makeCreativeBrief(),
      requirementAnalysis: makeRequirementAnalysis(),
      brandProfile: { primaryColor: "warm orange", logoUrl: "https://cdn.example.com/logo.png" },
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.data?.colorDirection.useExistingBrandPalette).toBe(true);
  });

  it("adds a warning when no brand profile is provided", async () => {
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(makeBrandStrategy()));

    const result = await runBrandStrategistAgent({
      creativeBrief: makeCreativeBrief(),
      requirementAnalysis: makeRequirementAnalysis(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("success");
    expect(result.warnings.some(w => w.includes("No brand profile"))).toBe(true);
  });

  // 8. Schema validation
  it("fails when readabilityPriority is invalid", async () => {
    const bad = { ...makeBrandStrategy(), typographyDirection: { category: ["sans-serif"], personality: [], readabilityPriority: "extreme" } };
    mockExecuteAI.mockResolvedValueOnce(makeAIResponse(bad));

    const result = await runBrandStrategistAgent({
      creativeBrief: makeCreativeBrief(),
      requirementAnalysis: makeRequirementAnalysis(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.includes("Schema validation failed"))).toBe(true);
  });

  // 9. AI provider error
  it("returns failed on AI provider error", async () => {
    mockExecuteAI.mockRejectedValue(new Error("Connection refused"));

    const result = await runBrandStrategistAgent({
      creativeBrief: makeCreativeBrief(),
      requirementAnalysis: makeRequirementAnalysis(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
  });

  // 10. Invalid JSON
  it("returns failed on invalid JSON response", async () => {
    mockExecuteAI.mockResolvedValueOnce({ content: "I cannot help with this.", promptTokens: 10, completionTokens: 5, tokensUsed: 15, latencyMs: 50 });

    const result = await runBrandStrategistAgent({
      creativeBrief: makeCreativeBrief(),
      requirementAnalysis: makeRequirementAnalysis(),
      modelConfig: TEST_MODEL,
    });

    expect(result.status).toBe("failed");
  });
});

// 12. Full pipeline — happy path
describe("runDiscoveryPipeline", () => {
  it("runs all three agents sequentially and returns DiscoveryTeamOutput", async () => {
    mockExecuteAI
      .mockResolvedValueOnce(makeAIResponse(makeCreativeBrief()))        // Agent 1
      .mockResolvedValueOnce(makeAIResponse(makeRequirementAnalysis()))  // Agent 2
      .mockResolvedValueOnce(makeAIResponse(makeBrandStrategy()));        // Agent 3

    const output = await runDiscoveryPipeline({
      userPrompt: "Create an Instagram post for a new running shoe",
      modelConfig: TEST_MODEL,
    });

    expect(output.creativeBrief).toBeDefined();
    expect(output.requirementAnalysis).toBeDefined();
    expect(output.brandStrategy).toBeDefined();
    expect(mockExecuteAI).toHaveBeenCalledTimes(3);
  });

  // 13. Fails fast when first agent fails
  it("throws DiscoveryPipelineError when Creative Director fails", async () => {
    mockExecuteAI.mockRejectedValue(new Error("Quota exceeded"));

    await expect(
      runDiscoveryPipeline({
        userPrompt: "Make something",
        modelConfig: TEST_MODEL,
      }),
    ).rejects.toThrow(DiscoveryPipelineError);

    // Should not have called agents 2 or 3
    // maxRetries=1 → 2 attempts, then fail
    expect(mockExecuteAI).toHaveBeenCalledTimes(2);
  });

  it("throws DiscoveryPipelineError when Requirement Analyst fails", async () => {
    mockExecuteAI
      .mockResolvedValueOnce(makeAIResponse(makeCreativeBrief()))   // Agent 1 OK
      .mockRejectedValue(new Error("Bad gateway"));                 // Agent 2 fails both attempts

    await expect(
      runDiscoveryPipeline({
        userPrompt: "Make something",
        modelConfig: TEST_MODEL,
      }),
    ).rejects.toThrow(DiscoveryPipelineError);
  });

  it("pipeline error names the failing stage", async () => {
    mockExecuteAI.mockRejectedValue(new Error("timeout"));

    let caught: DiscoveryPipelineError | null = null;
    try {
      await runDiscoveryPipeline({ userPrompt: "test", modelConfig: TEST_MODEL });
    } catch (e) {
      caught = e as DiscoveryPipelineError;
    }

    expect(caught).toBeInstanceOf(DiscoveryPipelineError);
    expect(caught?.stage).toBe("creative-director");
  });
});
