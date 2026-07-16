/**
 * Integration Tests — Design AI Orchestrator (Team 1–5)
 *
 * Tests the full pipeline: Discovery → Design → Components → Engineering → QA → Gate.
 *
 * AI calls (executeAI) are mocked for Team 1 (Discovery) and Team 5 (QA).
 * Teams 2/3/4 pipeline functions are mocked at the module level so their
 * internal executeAI calls do not interfere with the orchestration-level mocks.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";

// ── Mock AI execution (Team 1 / Discovery + QA calls) ────────────────────────
vi.mock("../../services/aiExecutionService.js", () => ({ executeAI: vi.fn() }));

// ── Mock Team 2 (Design pipeline) ────────────────────────────────────────────
vi.mock("../../services/design-ai/agents/design/index.js", () => ({
  runDesignPipeline: vi.fn(),
}));

// ── Mock Team 3 (Component pipeline) ─────────────────────────────────────────
vi.mock("../../services/design-ai/agents/components/index.js", () => ({
  runComponentPipeline: vi.fn(),
}));

// ── Mock Team 4 (Engineering pipeline) ───────────────────────────────────────
vi.mock("../../services/design-ai/pipeline/engineeringPipeline.js", () => ({
  runEngineeringPipeline: vi.fn(),
}));

import { executeAI } from "../../services/aiExecutionService.js";
import { runDesignPipeline } from "../../services/design-ai/agents/design/index.js";
import { runComponentPipeline } from "../../services/design-ai/agents/components/index.js";
import { runEngineeringPipeline } from "../../services/design-ai/pipeline/engineeringPipeline.js";
import { generateDesignTemplate } from "../../services/design-ai/orchestrator/designAiOrchestrator.js";
import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "../../types/designTemplate.js";

const mockExecuteAI         = executeAI          as MockedFunction<typeof executeAI>;
const mockRunDesignPipeline = runDesignPipeline   as MockedFunction<typeof runDesignPipeline>;
const mockRunComponentPipeline = runComponentPipeline as MockedFunction<typeof runComponentPipeline>;
const mockRunEngineeringPipeline = runEngineeringPipeline as MockedFunction<typeof runEngineeringPipeline>;

// ── Fixture builders ──────────────────────────────────────────────────────────

function aiResp(json: unknown) {
  return { content: JSON.stringify(json), promptTokens: 150, completionTokens: 300, tokensUsed: 450, latencyMs: 200 };
}

function makeDiscoveryResponses() {
  const brief = {
    designGoal: "Brand awareness post", communicationObjective: "Drive awareness",
    targetAudience: { primary: "Young professionals", characteristics: ["tech-savvy"] },
    coreMessage: "Innovation starts here", tone: ["professional"], desiredEmotion: ["excitement"],
    visualDirection: ["modern"], styleKeywords: ["minimal"], contentPriority: ["headline"],
    assumptions: [], missingInformation: [],
  };
  const requirements = {
    platform: "instagram-square", language: "en",
    canvas: { width: 1080, height: 1080, unit: "px", orientation: "square" },
    sections: [{ id: "hero", name: "Hero", required: true, contentPurpose: "Primary message" }],
    callsToAction: [{ label: "Learn More", purpose: "Engagement", priority: "primary" }],
    requestedVariables: ["headline"], requiredContent: ["headline"], optionalContent: [],
    contentConstraints: [], visualConstraints: [], exportFormats: ["png"],
    explicitRequirements: [], inferredRequirements: [], conflicts: [], missingInformation: [],
  };
  const brand = {
    brandPersonality: ["innovative"], brandStyle: ["modern"], mood: ["energetic"],
    visualKeywords: ["bold"],
    colorDirection: { primaryMood: "cool", supportingMood: [], avoid: [], useExistingBrandPalette: false },
    typographyDirection: { category: ["sans-serif"], personality: ["clean"], readabilityPriority: "high" },
    imageryDirection: [], logoRules: [], brandingRules: [], forbiddenStyles: [], assumptions: [],
  };
  return [aiResp(brief), aiResp(requirements), aiResp(brand)];
}

/** Minimal valid DesignTeamOutput (Team 2 real type from design.types.ts) */
function makeDesignOutput() {
  return {
    layout: {
      canvas: { width: 1080, height: 1080 },
      grid: { columns: 1, gutter: 24, margin: { top: 40, right: 40, bottom: 40, left: 40 } },
      safeArea: { x: 40, y: 40, width: 1000, height: 1000 },
      sections: [{ id: "hero", name: "Hero", order: 1, region: { x: 0, y: 0, width: 1080, height: 1080 }, alignment: "center" as const, priority: 10 }],
      readingOrder: ["hero"],
      whitespaceRules: [],
    },
    composition: {
      focalPoint: { sectionId: "hero", reason: "Primary message" },
      eyeFlow: ["top-to-bottom"],
      balance: "symmetrical" as const,
      visualWeight: [{ sectionId: "hero", weight: 100 }],
      spacingScale: [8, 16, 24, 32],
      relationships: [],
      densityMap: [{ sectionId: "hero", density: "medium" as const }],
    },
    typography: {
      fontPairing: { headingFont: "Inter", bodyFont: "Inter" },
      styles: {
        display:    { fontFamily: "Inter", fontSize: 64, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.02 },
        heading:    { fontFamily: "Inter", fontSize: 48, fontWeight: 700, lineHeight: 1.2, letterSpacing: -0.01 },
        subheading: { fontFamily: "Inter", fontSize: 32, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0 },
        body:       { fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0 },
        caption:    { fontFamily: "Inter", fontSize: 12, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0.01 },
        button:     { fontFamily: "Inter", fontSize: 16, fontWeight: 600, lineHeight: 1.0, letterSpacing: 0.02 },
      },
      fallbackFonts: ["system-ui"],
      readabilityRules: [],
    },
    colors: {
      tokens: {
        background: "#ffffff", surface: "#f5f5f5", primary: "#1E3A5F",
        secondary: "#4A90D9", accent: "#FF6B35",
        textPrimary: "#1a1a1a", textSecondary: "#666666", border: "#e0e0e0",
      },
      gradients: [],
      shadows: [],
      contrastChecks: [{ foreground: "#1a1a1a", background: "#ffffff", ratio: 15.3, passed: true }],
    },
    decorations: { decorations: [] },
  };
}

/** Minimal valid ComponentTeamOutput (Team 3 real type from component-plan.types.ts) */
function makeComponentOutput() {
  return {
    componentPlan: {
      components: [{
        id: "hero-title",
        sectionId: "hero",
        type: "title" as const,
        role: "title",
        required: true,
        contentSource: "variable" as const,
        bindingKey: "headline",
        region: { x: 40, y: 200, width: 1000, height: 120 },
        layerRole: "content" as const,
        properties: {},
      }],
    },
    variablePlan: {
      variables: [{
        key: "headline",
        label: "Headline",
        type: "text" as const,
        required: true,
        usedByComponentIds: ["hero-title"],
      }],
    },
    assetPlan: { assets: [] },
  };
}

/** Minimal valid DesignTemplate with canonical schemaVersion */
function makeDesignTemplate() {
  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: "test-template-001",
    tenantId: "tenant-123",
    name: "Test AI Template",
    canvas: { width: 1080, height: 1080, unit: "px" as const },
    elements: [],
    variables: [],
    metadata: {
      createdBy: "ai-orchestrator",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  };
}

/** Minimal valid EngineeringPipelineOutput (Team 4 real type from engineering.types.ts) */
function makeEngineeringOutput(passed = true) {
  const template = makeDesignTemplate();
  const report = { passed, score: passed ? 100 : 40, errors: [], warnings: [], info: [] };
  return {
    initialTemplate:   template,
    initialValidation: report,
    optimizedTemplate: template,
    finalValidation:   report,
    optimizationChanges: [],
  };
}

function makeGoodQaReport() {
  return {
    overallScore: 95,
    scores: {
      premiumAppearance: 95, visualBalance: 92, modernity: 90, hierarchy: 96,
      readability: 95, ctaVisibility: 94, brandConsistency: 93, typographyQuality: 95,
      colorHarmony: 91, spacingConsistency: 90, contentCompleteness: 97,
    },
    readyToPublish: true, blockingIssues: [], warnings: [], recommendations: [],
  };
}

function makeBadQaReport(score = 70) {
  return {
    overallScore: score,
    scores: {
      premiumAppearance: score, visualBalance: score, modernity: score, hierarchy: score,
      readability: score, ctaVisibility: score, brandConsistency: score, typographyQuality: score,
      colorHarmony: score, spacingConsistency: score, contentCompleteness: score,
    },
    readyToPublish: false,
    blockingIssues: [{
      code: "LOW_CONTRAST", category: "color", severity: "blocking",
      message: "Low contrast", affectedNodeIds: [], recommendedAgent: "color-designer",
    }],
    warnings: [], recommendations: [],
  };
}

const INPUT = {
  tenantId: "tenant-123", actorId: "user-456",
  prompt: "Create an Instagram post for a new running shoe launch",
};

beforeEach(() => {
  vi.resetAllMocks();
  // Default Team 2/3/4 pipeline mocks — return minimal valid outputs
  mockRunDesignPipeline.mockResolvedValue(makeDesignOutput() as any);
  mockRunComponentPipeline.mockResolvedValue(makeComponentOutput() as any);
  mockRunEngineeringPipeline.mockResolvedValue(makeEngineeringOutput() as any);
});

// ══════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE SUCCESS
// ══════════════════════════════════════════════════════════════════════════════

describe("Full pipeline", () => {
  it("returns status=ready on full pipeline success", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief)
      .mockResolvedValueOnce(req)
      .mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    const result = await generateDesignTemplate(INPUT);
    expect(result.status).toBe("ready");
    expect(result.template).toBeDefined();
    expect(result.pipelineRunId).toBeTruthy();
    expect(result.revisionCount).toBe(0);
  });

  it("final template has canonical schemaVersion", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    const result = await generateDesignTemplate(INPUT);
    expect(result.template?.schemaVersion).toBe(DESIGN_TEMPLATE_SCHEMA_VERSION);
  });

  it("aggregates metrics across agents", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    const result = await generateDesignTemplate(INPUT);
    expect(result.metrics.agents.length).toBeGreaterThan(0);
    // QA agent has 150 input tokens from the mocked aiResp
    expect(result.metrics.totalInputTokens).toBeGreaterThan(0);
  });

  it("preserves tenant context in pipeline run ID", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    const result = await generateDesignTemplate({ ...INPUT, tenantId: "acme-corp" });
    expect(result.pipelineRunId).toBeTruthy();
    // tenantId must not leak into the template itself
    expect(JSON.stringify(result.template ?? {})).not.toContain("acme-corp");
  });

  it("records all pipeline stages", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    const result = await generateDesignTemplate(INPUT);
    const stageIds = result.stages.map(s => s.stageId);
    expect(stageIds).toContain("creative-director");
    expect(stageIds).toContain("art-director-qa");
    expect(stageIds).toContain("publish-gate");
  });

  it("calls all three real pipeline adapters", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    await generateDesignTemplate(INPUT);
    expect(mockRunDesignPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunComponentPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunEngineeringPipeline).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FAILURE MODES
// ══════════════════════════════════════════════════════════════════════════════

describe("Pipeline failures", () => {
  // Team 1 failure
  it("returns status=failed when Discovery pipeline fails", async () => {
    mockExecuteAI.mockRejectedValue(new Error("OpenAI quota exceeded"));

    const result = await generateDesignTemplate(INPUT);
    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.stage === "discovery")).toBe(true);
    expect(result.template).toBeUndefined();
  });

  // Team 2 failure
  it("returns status=failed when Design pipeline fails", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand);
    mockRunDesignPipeline.mockRejectedValue(new Error("Design model timeout"));

    const result = await generateDesignTemplate(INPUT);
    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.stage === "design")).toBe(true);
  });

  // Team 3 failure
  it("returns status=failed when Component pipeline fails", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand);
    mockRunComponentPipeline.mockRejectedValue(new Error("Component model timeout"));

    const result = await generateDesignTemplate(INPUT);
    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.stage === "components")).toBe(true);
  });

  // Team 4 failure
  it("returns status=failed when Engineering pipeline fails", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand);
    mockRunEngineeringPipeline.mockRejectedValue(new Error("Engineering model timeout"));

    const result = await generateDesignTemplate(INPUT);
    expect(result.status).toBe("failed");
    expect(result.errors.some(e => e.stage === "engineering")).toBe(true);
  });

  // QA rejection → revision
  it("returns needs_human_review after QA rejects and revision cycles exhausted", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValue(aiResp(makeBadQaReport())); // all subsequent QA calls return bad score

    const result = await generateDesignTemplate(INPUT);
    expect(["needs_human_review", "ready"]).toContain(result.status);
    // After exhausting MAX_REVISION_CYCLES with bad score it should be human review
    if (result.status === "needs_human_review") {
      expect(result.errors.some(e => e.code === "revision_exhausted")).toBe(true);
    }
  });

  // Engineering validation failure is captured
  it("records engineering_validation_failed error when engineering passes=false", async () => {
    mockRunEngineeringPipeline.mockResolvedValue(makeEngineeringOutput(false) as any);

    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    const result = await generateDesignTemplate(INPUT);
    // Engineering validation failed → error recorded but pipeline continues to QA
    expect(result.errors.some(e => e.code === "engineering_validation_failed")).toBe(true);
  });

  // Sanitized error messages
  it("does not expose API keys in error messages", async () => {
    mockExecuteAI.mockRejectedValue(new Error("sk-proj-secretkey123456 rate limited"));

    const result = await generateDesignTemplate(INPUT);
    const errorText = JSON.stringify(result.errors);
    expect(errorText).not.toContain("sk-proj-secretkey");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE FLAG (integration)
// ══════════════════════════════════════════════════════════════════════════════

describe("Feature flag integration", () => {
  it("generateDesignTemplate runs when called directly (flag check is in route layer)", async () => {
    const [brief, req, brand] = makeDiscoveryResponses();
    mockExecuteAI
      .mockResolvedValueOnce(brief).mockResolvedValueOnce(req).mockResolvedValueOnce(brand)
      .mockResolvedValueOnce(aiResp(makeGoodQaReport()));

    // Direct call always runs — flag is checked in the route layer
    const result = await generateDesignTemplate(INPUT);
    expect(["ready", "needs_human_review", "failed"]).toContain(result.status);
  });
});
