/**
 * branding-identity/service.test.ts — Team 27
 *
 * Tests:
 *   - createBrief / getBrief / listBriefs
 *   - advanceBriefStage
 *   - registerArtifact / listArtifacts
 *   - exportGuideline
 *   - runCreativeBriefExtraction (with mock adapter)
 *   - runBrandStrategyForBrief (with mock adapter)
 *   - No fixture data exposed as production data
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createBrief,
  getBrief,
  listBriefs,
  advanceBriefStage,
  getBriefWorkflow,
  registerArtifact,
  listArtifacts,
  exportGuideline,
  runCreativeBriefExtraction,
  runBrandStrategyForBrief,
  _resetStore,
} from "../service.js";
import { makeMockBrandingAgentAdapter } from "../agentAdapter.js";
import type { BrandingBrief } from "../schema.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validBrief: BrandingBrief = {
  companyName:      "Nexus Studio",
  industry:         "Creative Agency",
  targetAudience:   "Creative professionals and startups",
  positioning:      "Premium creative partner for modern brands",
  brandPersonality: ["innovative", "bold", "trustworthy"],
  brandValues:      ["quality", "creativity", "transparency"],
  tone:             ["professional", "energetic"],
  preferredStyle:   "modern",
  usageChannels:    ["digital", "social", "web"],
  competitors:      [],
  colorConstraints: [],
  avoidColors:      [],
  inspirationUrls:  [],
  language:         "id",
  namingStatus:     "confirmed",
};

beforeEach(() => {
  _resetStore();
});

// ── createBrief ───────────────────────────────────────────────────────────────

describe("createBrief", () => {
  it("returns an id, workflow, and brief", () => {
    const result = createBrief(validBrief);
    expect(result.id).toBeTruthy();
    expect(result.brief).toEqual(validBrief);
    expect(result.workflow).toBeDefined();
  });

  it("starts workflow at brand_brief stage", () => {
    const result = createBrief(validBrief);
    expect(result.workflow.currentStage).toBe("brand_brief");
  });

  it("each call returns a unique id", () => {
    const a = createBrief(validBrief);
    const b = createBrief(validBrief);
    expect(a.id).not.toBe(b.id);
  });
});

// ── getBrief ──────────────────────────────────────────────────────────────────

describe("getBrief", () => {
  it("retrieves a stored brief", () => {
    const { id } = createBrief(validBrief);
    const record  = getBrief(id);
    expect(record.id).toBe(id);
    expect(record.brief.companyName).toBe("Nexus Studio");
  });

  it("throws 404 for unknown id", () => {
    expect(() => getBrief("nonexistent-id")).toThrow();
    try {
      getBrief("nonexistent-id");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(404);
    }
  });
});

// ── listBriefs ────────────────────────────────────────────────────────────────

describe("listBriefs", () => {
  it("returns empty list when store is empty", () => {
    const result = listBriefs();
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("lists created briefs", () => {
    createBrief(validBrief);
    createBrief(validBrief);
    const result = listBriefs();
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it("filters by status", () => {
    const { id } = createBrief(validBrief);
    advanceBriefStage(id, "research"); // activates brief
    const active  = listBriefs({ status: "active" });
    const draft   = listBriefs({ status: "draft" });
    expect(active.total).toBe(1);
    expect(draft.total).toBe(0);
  });

  it("filters by stage", () => {
    const { id } = createBrief(validBrief);
    advanceBriefStage(id, "research");
    const atResearch  = listBriefs({ stage: "research" });
    const atBranding  = listBriefs({ stage: "brand_brief" });
    expect(atResearch.total).toBe(1);
    expect(atBranding.total).toBe(0);
  });

  it("respects pageSize", () => {
    createBrief(validBrief);
    createBrief(validBrief);
    createBrief(validBrief);
    const result = listBriefs({ pageSize: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("includes artifact count in summary", () => {
    const { id } = createBrief(validBrief);
    registerArtifact(id, {
      artifactType: "brand_strategy",
      title:        "Strategy Doc",
      stage:        "brand_strategy",
      properties:   [],
      version:      1,
    });
    const result = listBriefs();
    expect(result.items[0]?.artifactCount).toBe(1);
  });
});

// ── advanceBriefStage ─────────────────────────────────────────────────────────

describe("advanceBriefStage", () => {
  it("advances the brief to the next stage", () => {
    const { id }  = createBrief(validBrief);
    const result  = advanceBriefStage(id, "research");
    expect(result.workflow.currentStage).toBe("research");
  });

  it("includes progress in result", () => {
    const { id }  = createBrief(validBrief);
    const result  = advanceBriefStage(id, "research");
    expect(result.progress.totalStages).toBe(13);
    expect(result.progress.completedCount).toBeGreaterThan(0);
  });

  it("includes stageArtifacts for new stage", () => {
    const { id }  = createBrief(validBrief);
    advanceBriefStage(id, "research");
    advanceBriefStage(id, "brand_strategy");
    const result = advanceBriefStage(id, "positioning");
    expect(Array.isArray(result.stageArtifacts)).toBe(true);
  });

  it("throws 400 for invalid transition", () => {
    const { id } = createBrief(validBrief);
    expect(() => advanceBriefStage(id, "positioning")).toThrow();
    try {
      advanceBriefStage(id, "positioning");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
  });

  it("throws 404 for unknown brief", () => {
    expect(() => advanceBriefStage("nope", "research")).toThrow();
  });

  it("persists updated workflow to store", () => {
    const { id } = createBrief(validBrief);
    advanceBriefStage(id, "research");
    const record = getBrief(id);
    expect(record.workflow.currentStage).toBe("research");
  });
});

// ── getBriefWorkflow ──────────────────────────────────────────────────────────

describe("getBriefWorkflow", () => {
  it("returns workflow and progress", () => {
    const { id }  = createBrief(validBrief);
    const result  = getBriefWorkflow(id);
    expect(result.workflow).toBeDefined();
    expect(result.progress).toBeDefined();
  });

  it("throws 404 for unknown brief", () => {
    expect(() => getBriefWorkflow("nope")).toThrow();
  });
});

// ── registerArtifact / listArtifacts ─────────────────────────────────────────

describe("registerArtifact", () => {
  it("registers an artifact and returns it with id", () => {
    const { id }  = createBrief(validBrief);
    const artifact = registerArtifact(id, {
      artifactType: "brand_strategy",
      title:        "Core Strategy",
      stage:        "brand_strategy",
      properties:   [],
      version:      1,
    });
    expect(artifact.id).toBeTruthy();
    expect(artifact.briefId).toBe(id);
    expect(artifact.artifactType).toBe("brand_strategy");
  });

  it("multiple artifacts can be registered for same brief", () => {
    const { id } = createBrief(validBrief);
    registerArtifact(id, { artifactType: "brand_strategy", title: "A", stage: "brand_strategy", properties: [], version: 1 });
    registerArtifact(id, { artifactType: "brand_positioning", title: "B", stage: "positioning", properties: [], version: 1 });
    const items = listArtifacts(id);
    expect(items).toHaveLength(2);
  });

  it("throws 404 for unknown brief", () => {
    expect(() =>
      registerArtifact("nope", {
        artifactType: "brand_strategy",
        title:        "X",
        stage:        "brand_strategy",
        properties:   [],
        version:      1,
      }),
    ).toThrow();
  });
});

describe("listArtifacts", () => {
  it("returns empty array for new brief", () => {
    const { id } = createBrief(validBrief);
    expect(listArtifacts(id)).toHaveLength(0);
  });

  it("returns all registered artifacts", () => {
    const { id } = createBrief(validBrief);
    registerArtifact(id, { artifactType: "logo_concept", title: "Logo A", stage: "logo_concepts", properties: [], version: 1 });
    registerArtifact(id, { artifactType: "color_system", title: "Colors", stage: "color_system", properties: [], version: 1 });
    expect(listArtifacts(id)).toHaveLength(2);
  });
});

// ── exportGuideline ───────────────────────────────────────────────────────────

describe("exportGuideline", () => {
  it("returns canExport:false when required artifacts are missing", () => {
    const { id } = createBrief(validBrief);
    const result = exportGuideline(id);
    expect(result.canExport).toBe(false);
    expect(result.missingArtifacts.length).toBeGreaterThan(0);
  });

  it("returns canExport:true when all required artifacts registered", () => {
    const { id } = createBrief(validBrief);
    const required = [
      "brand_strategy", "brand_positioning", "brand_voice",
      "logo_system", "color_system", "typography_system", "brand_guideline",
    ] as const;
    for (const type of required) {
      registerArtifact(id, { artifactType: type, title: type, stage: "brand_guideline", properties: [], version: 1 });
    }
    const result = exportGuideline(id);
    expect(result.canExport).toBe(true);
    expect(result.missingArtifacts).toHaveLength(0);
  });

  it("includes companyName and workflow in export", () => {
    const { id } = createBrief(validBrief);
    const result = exportGuideline(id);
    expect(result.companyName).toBe("Nexus Studio");
    expect(result.workflow).toBeDefined();
  });

  it("throws 404 for unknown brief", () => {
    expect(() => exportGuideline("nope")).toThrow();
  });
});

// ── AI-assisted methods (via mock adapter) ────────────────────────────────────

describe("runCreativeBriefExtraction", () => {
  it("calls adapter.extractCreativeBrief and returns result", async () => {
    const adapter = makeMockBrandingAgentAdapter();
    const result  = await runCreativeBriefExtraction("Build a brand for a fintech startup", adapter);
    expect(result.status).toBe("success");
    expect(result.data).not.toBeNull();
  });
});

describe("runBrandStrategyForBrief", () => {
  it("calls adapter.runBrandStrategy for stored brief", async () => {
    const { id }  = createBrief(validBrief);
    const adapter = makeMockBrandingAgentAdapter();
    const result  = await runBrandStrategyForBrief(id, adapter);
    expect(result.status).toBe("success");
  });

  it("throws 404 for unknown brief id", async () => {
    const adapter = makeMockBrandingAgentAdapter();
    await expect(runBrandStrategyForBrief("nope", adapter)).rejects.toThrow();
  });
});

// ── No fixture data exposed as production ─────────────────────────────────────

describe("no fixture data in production", () => {
  it("store starts empty after reset", () => {
    const result = listBriefs();
    expect(result.total).toBe(0);
  });

  it("no pre-seeded briefs exist without explicit creation", () => {
    // Reset is called in beforeEach — confirm no magic data
    expect(() => getBrief("any-id")).toThrow();
  });
});
