/**
 * interior-concept-chain.test.ts
 *
 * Verifies the full interior concept output chain:
 *
 * 1.  stepsToInitialDraftData recognises all 5 interior agent output keys
 * 2.  Does NOT produce JSON.stringify as visual concept text
 * 3.  buildInteriorImagePromptContext draft-path fallback reads interior format
 * 4.  buildInteriorImagePromptContext — empty / undefined fields never produce "undefined"
 * 5.  Legacy JSON string input is parsed correctly
 * 6.  Legacy { visualConcept: string } format still works
 * 7.  Null draft → step_outputs path, visual concept extracted from interior format
 * 8.  All fields partially present — no crash
 * 9.  signature_elements (array) handled gracefully
 * 10. color_concept.primary_palette does not appear as raw JSON in visualConcept
 */

import { describe, it, expect, vi } from "vitest";

// ── Hoist DB mock (required by service.ts imports) ────────────────────────────

const { mockDb } = vi.hoisted(() => {
  const mockDb: Record<string, ReturnType<typeof vi.fn>> = {};
  mockDb["select"]   = vi.fn().mockReturnValue(mockDb);
  mockDb["from"]     = vi.fn().mockReturnValue(mockDb);
  mockDb["where"]    = vi.fn().mockReturnValue(mockDb);
  mockDb["limit"]    = vi.fn().mockResolvedValue([]);
  mockDb["orderBy"]  = vi.fn().mockReturnValue(mockDb);
  mockDb["insert"]   = vi.fn().mockReturnValue(mockDb);
  mockDb["values"]   = vi.fn().mockReturnValue(mockDb);
  mockDb["onConflictDoNothing"] = vi.fn().mockReturnValue(mockDb);
  mockDb["returning"] = vi.fn().mockResolvedValue([]);
  return { mockDb };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  creativeProjectsTable: {},
  creativeProjectStepsTable: {},
  idConceptDraftsTable: {},
  aiAgentsTable: {},
  aiModelsTable: {},
  aiProvidersTable: {},
  creativeAiAssetsTable: {},
  aiServiceRequestsTable: {},
  aiAuditLogsTable: {},
  aiCostRecordsTable: {},
}));

vi.mock("../domains/interior-design/schema.js", () => ({
  idConceptDraftsTable: {},
  CONCEPT_DRAFT_REVIEW_STATES: [
    "ai_generated", "edited_by_admin", "ready_for_review",
    "revision_requested", "approved_for_rendering",
  ],
}));

vi.mock("../domains/interior-design/validation.js", () => ({
  runFullValidation:         vi.fn().mockReturnValue({ valid: true, errors: [] }),
  generateSafetyDisclaimers: vi.fn().mockReturnValue([]),
}));

vi.mock("../domains/interior-design/brandIntelligenceAdapter.js", () => ({
  readBrandStyleSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/aiExecutionService.js", () => ({
  executeAI: vi.fn().mockResolvedValue({ content: "[]", tokensUsed: 0 }),
}));

vi.mock("../services/costService.js", () => ({
  recordCost:      vi.fn().mockResolvedValue(undefined),
  getProjectCosts: vi.fn().mockResolvedValue({ totalEstimatedCostUsd: 0 }),
}));

vi.mock("../services/guardrailService.js", () => ({
  readGuardrails: vi.fn().mockResolvedValue({
    maxCostPerWorkflow: 0, maxRetryPerProvider: 1, fallbackEnabled: false, providerTimeoutMs: 30000,
  }),
}));

vi.mock("../services/aiSecretService.js", () => ({
  getProviderApiKey: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/publicBaseUrl.js", () => ({
  getPublicBaseUrl: vi.fn().mockReturnValue("http://localhost"),
}));

vi.mock("../lib/textOverlay.js", () => ({
  applyTextOverlay: vi.fn().mockResolvedValue(null),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  buildInteriorImagePromptContext,
} from "../services/imageDesignerService.js";

import {
  stepsToInitialDraftData,
} from "../domains/interior-design/service.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INTERIOR_AGENT_OUTPUT = {
  design_concept: {
    title: "Japandi Serenity",
    narrative: "A calm minimalist space blending Japanese and Scandinavian aesthetics.",
    design_philosophy: "Less is more — each object earns its place.",
    emotional_intent: "Peaceful, grounded, and quietly luxurious.",
  },
  style_direction: {
    primary_style: "Japandi",
    style_blend: "Japanese Wabi-sabi + Nordic Hygge",
    local_cultural_integration: "Batik textile cushions as accent pieces",
    contemporary_vs_traditional_balance: "70% contemporary, 30% traditional",
  },
  spatial_concept: {
    overall_flow: "Open-plan living flowing into dining; no visual barriers.",
    focal_points: ["Statement stone fireplace", "Low platform seating area", "Bonsai corner"],
    light_philosophy: "Layered natural light with warm-toned dimmable accents.",
    indoor_outdoor_connection: "Sliding glass doors to garden terrace.",
  },
  color_concept: {
    primary_palette: [
      { name: "Warm Stone", hex: "#C8B89A", application: "Walls and large surfaces" },
      { name: "Charcoal Oak", hex: "#3D3D3D", application: "Furniture and frames" },
      { name: "Sage Mist", hex: "#A3B5A0", application: "Textile accents" },
    ],
    accent_colors: [
      { name: "Terracotta", hex: "#C1694F" },
      { name: "Brass", hex: "#B5883C" },
    ],
    palette_mood: "Earthy tranquility — organic warmth with restrained depth.",
    color_flow_between_rooms: "Tone lightens from living to bedroom.",
  },
  signature_elements: [
    "Hand-crafted ceramic vessel",
    "Linen shoji-inspired room divider",
    "Reclaimed teak low table",
  ],
  client_lifestyle_alignment: "A busy professional seeking a retreat that restores calm.",
};

const LEGACY_VISUAL_CONCEPT_OUTPUT = {
  visualConcept: "A modern minimalist space with clean lines.",
  concept: "Alternative key that should also work",
};

function makeUnapprovedDraft(overrides: Record<string, unknown> = {}) {
  return {
    reviewState: "ai_generated",
    approvedAt: null,
    approvedVisualConcept: null,
    approvedSpacePlan: null,
    approvedMaterials: null,
    approvedFurniture: null,
    approvedLighting: null,
    visualConceptDraft: null,
    spacePlanDraft: null,
    materialsDraft: null,
    furnitureDraft: null,
    lightingDraft: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. stepsToInitialDraftData — recognises all 5 interior output keys
// ════════════════════════════════════════════════════════════════════════════

describe("stepsToInitialDraftData — interior agent format", () => {
  it("extracts a non-empty visualConcept when design_concept is present", () => {
    const steps = [{ stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT }];
    const result = stepsToInitialDraftData(steps);
    expect(result.visualConcept).not.toBeNull();
    expect(typeof result.visualConcept).toBe("string");
    expect(result.visualConcept!.length).toBeGreaterThan(0);
  });

  it("includes the concept title in visualConcept", () => {
    const steps = [{ stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT }];
    const { visualConcept } = stepsToInitialDraftData(steps);
    expect(visualConcept).toContain("Japandi Serenity");
  });

  it("includes the narrative in visualConcept", () => {
    const steps = [{ stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT }];
    const { visualConcept } = stepsToInitialDraftData(steps);
    expect(visualConcept).toContain("Japanese and Scandinavian");
  });

  it("does NOT produce a raw JSON.stringify blob as visualConcept", () => {
    const steps = [{ stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT }];
    const { visualConcept } = stepsToInitialDraftData(steps);
    // If it were JSON.stringify, the result would start with "{"
    expect(visualConcept).not.toMatch(/^\s*\{/);
    // And would not contain these JSON artifacts
    expect(visualConcept).not.toContain('"design_concept"');
    expect(visualConcept).not.toContain('"primary_palette"');
  });

  it("color_concept.primary_palette does NOT appear as raw JSON in visualConcept", () => {
    const steps = [{ stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT }];
    const { visualConcept } = stepsToInitialDraftData(steps);
    expect(visualConcept).not.toContain('"hex"');
    expect(visualConcept).not.toContain('"application"');
  });

  it("signature_elements (array) is handled — does not crash or produce undefined", () => {
    const steps = [{ stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT }];
    const result = stepsToInitialDraftData(steps);
    expect(result.visualConcept).not.toContain("undefined");
    expect(result.visualConcept).not.toBeUndefined();
  });

  it("passes through Space Planning output unchanged", () => {
    const spacePlan = { zones: [{ id: "z1", name: "Living" }] };
    const steps = [
      { stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT },
      { stepName: "Space Planning", output: spacePlan },
    ];
    const result = stepsToInitialDraftData(steps);
    expect(result.spacePlan).toEqual(spacePlan);
  });

  it("passes through Material Specification output unchanged", () => {
    const mat = { items: [{ component: "floor", name: "Oak hardwood" }] };
    const steps = [
      { stepName: "Design Concept", output: INTERIOR_AGENT_OUTPUT },
      { stepName: "Material Specification", output: mat },
    ];
    const result = stepsToInitialDraftData(steps);
    expect(result.materials).toEqual(mat);
  });

  it("still works when some interior sub-keys are missing (partial output)", () => {
    const partial = {
      design_concept: { title: "Minimal", narrative: "Clean space." },
      // style_direction, spatial_concept, color_concept, signature_elements all missing
    };
    const steps = [{ stepName: "Design Concept", output: partial }];
    const result = stepsToInitialDraftData(steps);
    expect(result.visualConcept).toContain("Minimal");
    expect(result.visualConcept).not.toContain("undefined");
  });

  it("returns null visualConcept when Design Concept step is absent", () => {
    const steps = [{ stepName: "Space Planning", output: { zones: [] } }];
    const result = stepsToInitialDraftData(steps);
    expect(result.visualConcept).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. stepsToInitialDraftData — legacy formats
// ════════════════════════════════════════════════════════════════════════════

describe("stepsToInitialDraftData — legacy formats", () => {
  it("accepts plain string output", () => {
    const steps = [{ stepName: "Design Concept", output: "A bright coastal retreat." }];
    const { visualConcept } = stepsToInitialDraftData(steps);
    expect(visualConcept).toBe("A bright coastal retreat.");
  });

  it("accepts legacy { visualConcept: string } object", () => {
    const steps = [{ stepName: "Design Concept", output: { visualConcept: "Nordic minimalism." } }];
    const { visualConcept } = stepsToInitialDraftData(steps);
    expect(visualConcept).toBe("Nordic minimalism.");
  });

  it("accepts legacy { concept: string } object", () => {
    const steps = [{ stepName: "Design Concept", output: { concept: "Wabi-sabi inspired." } }];
    const { visualConcept } = stepsToInitialDraftData(steps);
    expect(visualConcept).toBe("Wabi-sabi inspired.");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. buildInteriorImagePromptContext — draft path with interior agent format
// ════════════════════════════════════════════════════════════════════════════

describe("buildInteriorImagePromptContext — draft path fallback reads interior format", () => {
  it("when visualConceptDraft is null, falls back to interior agent format in step outputs", () => {
    const draft = makeUnapprovedDraft({ visualConceptDraft: null });
    const stepsByName = { "Design Concept": INTERIOR_AGENT_OUTPUT };

    const ctx = buildInteriorImagePromptContext(draft, stepsByName);

    expect(ctx.renderSource).toBe("draft");
    expect(ctx.visualConcept).not.toBe("");
    expect(ctx.visualConcept).not.toBeNull();
  });

  it("fallback concept contains the title from design_concept", () => {
    const draft = makeUnapprovedDraft({ visualConceptDraft: null });
    const ctx = buildInteriorImagePromptContext(draft, { "Design Concept": INTERIOR_AGENT_OUTPUT });
    expect(ctx.visualConcept).toContain("Japandi Serenity");
  });

  it("fallback concept contains style info from style_direction", () => {
    const draft = makeUnapprovedDraft({ visualConceptDraft: null });
    const ctx = buildInteriorImagePromptContext(draft, { "Design Concept": INTERIOR_AGENT_OUTPUT });
    expect(ctx.visualConcept).toContain("Japandi");
  });

  it("fallback concept contains colour mood from color_concept", () => {
    const draft = makeUnapprovedDraft({ visualConceptDraft: null });
    const ctx = buildInteriorImagePromptContext(draft, { "Design Concept": INTERIOR_AGENT_OUTPUT });
    expect(ctx.visualConcept).toContain("Earthy tranquility");
  });

  it("when visualConceptDraft is set, uses draft value (ignores step output)", () => {
    const draft = makeUnapprovedDraft({ visualConceptDraft: "Draft-edited concept text" });
    const ctx = buildInteriorImagePromptContext(draft, { "Design Concept": INTERIOR_AGENT_OUTPUT });
    expect(ctx.visualConcept).toBe("Draft-edited concept text");
    expect(ctx.renderSource).toBe("draft");
  });

  it("empty fields do not produce 'undefined' in the fallback string", () => {
    const partial = { design_concept: { title: "Calm Retreat" } };
    const draft = makeUnapprovedDraft({ visualConceptDraft: null });
    const ctx = buildInteriorImagePromptContext(draft, { "Design Concept": partial });
    expect(ctx.visualConcept).not.toContain("undefined");
  });

  it("returns empty string (not crash) when Design Concept step is missing entirely", () => {
    const draft = makeUnapprovedDraft({ visualConceptDraft: null });
    const ctx = buildInteriorImagePromptContext(draft, {});
    expect(ctx.visualConcept).toBe("");
    expect(ctx.renderSource).toBe("draft");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. buildInteriorImagePromptContext — step_outputs path (no draft)
// ════════════════════════════════════════════════════════════════════════════

describe("buildInteriorImagePromptContext — step_outputs path (null draft)", () => {
  it("renderSource is step_outputs when draft is null", () => {
    const ctx = buildInteriorImagePromptContext(null, { "Design Concept": INTERIOR_AGENT_OUTPUT });
    expect(ctx.renderSource).toBe("step_outputs");
  });

  it("visualConcept is non-empty when interior agent output is present", () => {
    const ctx = buildInteriorImagePromptContext(null, { "Design Concept": INTERIOR_AGENT_OUTPUT });
    expect(ctx.visualConcept).not.toBe("");
    expect(ctx.visualConcept).toContain("Japandi Serenity");
  });

  it("visualConcept does not contain raw JSON when step output is interior format", () => {
    const ctx = buildInteriorImagePromptContext(null, { "Design Concept": INTERIOR_AGENT_OUTPUT });
    expect(ctx.visualConcept).not.toContain('"design_concept"');
    expect(ctx.visualConcept).not.toContain('"primary_palette"');
  });

  it("legacy { visualConcept: string } is still returned correctly", () => {
    const ctx = buildInteriorImagePromptContext(null, {
      "Design Concept": LEGACY_VISUAL_CONCEPT_OUTPUT,
    });
    expect(ctx.visualConcept).toBe("A modern minimalist space with clean lines.");
  });

  it("empty fields do not produce undefined in visualConcept", () => {
    const partial = { design_concept: { title: "Only Title" } };
    const ctx = buildInteriorImagePromptContext(null, { "Design Concept": partial });
    expect(ctx.visualConcept).not.toContain("undefined");
    expect(ctx.visualConcept).toBe("Only Title");
  });
});
