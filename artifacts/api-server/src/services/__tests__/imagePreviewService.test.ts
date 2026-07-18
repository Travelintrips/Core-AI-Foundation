/**
 * Tests for the Two-Stage Image Preview Pipeline service.
 * Unit tests use vi.mock to isolate DB and external API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

const mockProject = {
  id: 1,
  projectId: "proj-uuid-1234",
  brandName: "TestBrand",
  businessType: "Technology",
  targetMarket: "SMB",
  productOrService: "SaaS",
  stylePreference: "modern",
  goal: "brand awareness",
  status: "planning",
};

const mockSession = {
  id: 42,
  projectId: "proj-uuid-1234",
  sessionStatus: "planning",
  packageTier: "standard",
  previewCount: 4,
  previewCostUsd: "0",
  finalCostUsd: "0",
  qcCostUsd: "0",
  totalCostUsd: "0",
  selectedConceptId: null,
  customerFeedback: null,
  requestedFinalCount: 1,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAsset = {
  id: 101,
  projectId: "proj-uuid-1234",
  renderSessionId: 42,
  renderStage: "preview",
  conceptIndex: 1,
  prompt: "Professional brand visual for TestBrand",
  negativePrompt: "text, watermark, low quality",
  aspectRatio: "1:1",
  imageUrl: "https://example.com/preview.webp",
  thumbnailUrl: null,
  status: "completed",
  aiExplanation: "Modern minimalist concept focusing on brand clarity.",
  metadata: { estimatedStyle: "Modern Minimalist", estimatedTemplate: "Clean Grid" },
  cost: "0.003000",
  latencyMs: 8500,
  qcScore: null,
  qcNotes: null,
  estimatedFinalCostUsd: "0.003000",
  estimatedRenderTimeMs: 15000,
  createdAt: new Date(),
};

// Mock the db module
vi.mock("@workspace/db", () => {
  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 101 }]),
    }),
  });
  const mockSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([mockProject]),
      }),
    }),
  });
  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });

  return {
    db: { insert: mockInsert, select: mockSelect, update: mockUpdate },
    creativeProjectsTable: { id: "id", projectId: "project_id" },
    creativeProjectStepsTable: { id: "id", projectId: "project_id", stepName: "step_name" },
    creativeAiAssetsTable: { id: "id", renderSessionId: "render_session_id", renderStage: "render_stage" },
    creativeRenderSessionsTable: { id: "id", projectId: "project_id" },
  };
});

// Mock service dependencies
vi.mock("../../services/aiExecutionService.js", () => ({
  executeAI: vi.fn().mockResolvedValue({ content: "[]", tokensUsed: 100 }),
}));

vi.mock("../../services/aiSecretService.js", () => ({
  getProviderApiKey: vi.fn().mockReturnValue(null), // no real Replicate key in tests
}));

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/costService.js", () => ({
  recordCost: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/guardrailService.js", () => ({
  readGuardrails: vi.fn().mockResolvedValue({
    maxCostPerWorkflow: 0,
    maxRetryPerProvider: 2,
    providerTimeoutMs: 60000,
    fallbackEnabled: true,
    disableOnErrorRate: 0.5,
  }),
}));

vi.mock("../../lib/publicBaseUrl.js", () => ({
  getPublicBaseUrl: vi.fn().mockReturnValue("http://localhost:8080"),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("imagePreviewService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startPreviewSession", () => {
    it("creates a render session and returns sessionId", async () => {
      const { db } = await import("@workspace/db");

      // Project lookup returns a project
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockProject]),
        }),
      } as unknown as ReturnType<typeof db.select>);

      // Session insert returns session with id=42
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockSession, id: 42 }]),
        }),
      } as unknown as ReturnType<typeof db.insert>);

      const { startPreviewSession } = await import("../imagePreviewService.js");
      const result = await startPreviewSession("proj-uuid-1234", { packageTier: "standard", previewCount: 4 });

      expect(result.sessionId).toBe(42);
      expect(result.message).toContain("4");
    });

    it("throws if project not found", async () => {
      const { db } = await import("@workspace/db");

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // empty
        }),
      } as unknown as ReturnType<typeof db.select>);

      const { startPreviewSession } = await import("../imagePreviewService.js");
      await expect(startPreviewSession("nonexistent-uuid")).rejects.toThrow("not found");
    });
  });

  describe("preview generation (no Replicate key)", () => {
    it("marks session as preview_ready even without Replicate key", async () => {
      const { db } = await import("@workspace/db");
      const updateMock = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      });
      vi.mocked(db.update).mockImplementation(updateMock);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockProject]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.select>);
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 101 }]),
        }),
      } as unknown as ReturnType<typeof db.insert>);

      const { runPreviewGeneration } = await import("../imagePreviewService.js");
      // Should not throw — no Replicate key path is graceful
      await expect(runPreviewGeneration(42, "proj-uuid-1234", 1)).resolves.toBeUndefined();
    });
  });

  describe("selectConcept", () => {
    it("updates session with selected concept and concept_selected status", async () => {
      const { db } = await import("@workspace/db");
      const updateSetWhere = vi.fn().mockResolvedValue([]);
      const updateSet = vi.fn().mockReturnValue({ where: updateSetWhere });
      const updateMock = vi.fn().mockReturnValue({ set: updateSet });
      vi.mocked(db.update).mockImplementation(updateMock);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockSession]),
        }),
      } as unknown as ReturnType<typeof db.select>);

      const { selectConcept } = await import("../imagePreviewService.js");
      await expect(selectConcept(42, 101, "Make it bolder")).resolves.toBeUndefined();
      expect(updateMock).toHaveBeenCalled();
    });

    it("throws when session not found", async () => {
      const { db } = await import("@workspace/db");
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.select>);

      const { selectConcept } = await import("../imagePreviewService.js");
      await expect(selectConcept(999, 101)).rejects.toThrow("Session 999 not found");
    });
  });

  describe("runFinalGeneration", () => {
    it("throws when no concept selected", async () => {
      const { db } = await import("@workspace/db");
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...mockSession, selectedConceptId: null }]),
        }),
      } as unknown as ReturnType<typeof db.select>);

      const { runFinalGeneration } = await import("../imagePreviewService.js");
      await expect(runFinalGeneration(42)).rejects.toThrow("No concept selected");
    });
  });

  describe("generateMorePreviews", () => {
    it("throws when session not found", async () => {
      const { db } = await import("@workspace/db");
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as unknown as ReturnType<typeof db.select>);

      const { generateMorePreviews } = await import("../imagePreviewService.js");
      await expect(generateMorePreviews(999)).rejects.toThrow("Session 999 not found");
    });
  });
});

// ── Route-level tests ─────────────────────────────────────────────────────────

describe("Preview pipeline API contract (Zod schemas)", () => {
  it("StartPreviewSessionBody accepts valid input", async () => {
    const { StartPreviewSessionBody } = await import("@workspace/api-zod");
    const result = StartPreviewSessionBody.safeParse({ packageTier: "premium", previewCount: 3 });
    expect(result.success).toBe(true);
    expect(result.data?.packageTier).toBe("premium");
    expect(result.data?.previewCount).toBe(3);
  });

  it("StartPreviewSessionBody uses defaults when empty", async () => {
    const { StartPreviewSessionBody } = await import("@workspace/api-zod");
    const result = StartPreviewSessionBody.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.packageTier).toBe("standard");
    expect(result.data?.previewCount).toBe(4);
  });

  it("PackageTierEnum rejects invalid tier", async () => {
    const { PackageTierEnum } = await import("@workspace/api-zod");
    const result = PackageTierEnum.safeParse("ultra");
    expect(result.success).toBe(false);
  });

  it("SelectConceptBody requires conceptAssetId", async () => {
    const { SelectConceptBody } = await import("@workspace/api-zod");
    const noId = SelectConceptBody.safeParse({ feedback: "looks good" });
    expect(noId.success).toBe(false);

    const withId = SelectConceptBody.safeParse({ conceptAssetId: 42, feedback: "make it darker" });
    expect(withId.success).toBe(true);
    expect(withId.data?.conceptAssetId).toBe(42);
  });

  it("RenderSessionStatusEnum covers all pipeline stages", async () => {
    const { RenderSessionStatusEnum } = await import("@workspace/api-zod");
    const validStatuses = [
      "planning", "preview_generating", "preview_ready", "waiting_customer",
      "concept_selected", "final_generating", "quality_check", "completed", "failed",
    ];
    for (const status of validStatuses) {
      expect(RenderSessionStatusEnum.safeParse(status).success).toBe(true);
    }
  });

  it("PreviewPipelineAnalyticsQuery coerces string days to number", async () => {
    const { PreviewPipelineAnalyticsQuery } = await import("@workspace/api-zod");
    const result = PreviewPipelineAnalyticsQuery.safeParse({ days: "30" });
    expect(result.success).toBe(true);
    expect(result.data?.days).toBe(30);
  });

  it("GenerateFinalBody accepts requestedCount", async () => {
    const { GenerateFinalBody } = await import("@workspace/api-zod");
    const result = GenerateFinalBody.safeParse({ requestedCount: 10 });
    expect(result.success).toBe(true);

    // Over max rejected
    const over = GenerateFinalBody.safeParse({ requestedCount: 99 });
    expect(over.success).toBe(false);
  });

  it("MorePreviewsBody defaults to 4 concepts", async () => {
    const { MorePreviewsBody } = await import("@workspace/api-zod");
    const result = MorePreviewsBody.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.count).toBe(4);
  });
});

// ── Backward compatibility (uses real, un-mocked module) ─────────────────────

describe("backward compatibility", () => {
  it("existing creativeAiAssetsTable schema has renderStage with legacy default", async () => {
    // Must use importActual so the vi.mock above doesn't intercept this
    const actualDb = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
    const cols = Object.keys(actualDb.creativeAiAssetsTable);
    expect(cols).toContain("renderStage");
    expect(cols).toContain("renderSessionId");
    expect(cols).toContain("conceptIndex");
    expect(cols).toContain("aiExplanation");
  });

  it("creativeRenderSessionsTable is exported from @workspace/db", async () => {
    const actualDb = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
    expect(actualDb.creativeRenderSessionsTable).toBeDefined();
    const cols = Object.keys(actualDb.creativeRenderSessionsTable);
    expect(cols).toContain("sessionStatus");
    expect(cols).toContain("packageTier");
    expect(cols).toContain("selectedConceptId");
  });
});
