/**
 * branding-identity/workflow.test.ts — Team 27
 *
 * Tests:
 *   - createWorkflowState
 *   - isTransitionAllowed (all rules)
 *   - advanceStage (success + errors)
 *   - nextStage
 *   - getWorkflowProgress
 *   - Review loop behaviour
 */

import { describe, it, expect } from "vitest";
import {
  createWorkflowState,
  advanceStage,
  nextStage,
  stageIndex,
  isTransitionAllowed,
  getWorkflowProgress,
} from "../workflow.js";
import { BRANDING_STAGES, type BrandingStage } from "../schema.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRIEF_ID = "test-brief-001";

function makeFullyAdvancedState() {
  let state = createWorkflowState(BRIEF_ID);
  for (let i = 1; i < BRANDING_STAGES.length; i++) {
    const result = advanceStage(state, BRANDING_STAGES[i]!);
    if (!result.ok) throw new Error(`Unexpected: ${result.error}`);
    state = result.state;
  }
  return state;
}

// ── createWorkflowState ───────────────────────────────────────────────────────

describe("createWorkflowState", () => {
  it("starts at brand_brief", () => {
    const state = createWorkflowState(BRIEF_ID);
    expect(state.currentStage).toBe("brand_brief");
  });

  it("starts with status draft", () => {
    const state = createWorkflowState(BRIEF_ID);
    expect(state.status).toBe("draft");
  });

  it("records one initial transition", () => {
    const state = createWorkflowState(BRIEF_ID);
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]!.fromStage).toBeNull();
    expect(state.transitions[0]!.toStage).toBe("brand_brief");
  });

  it("starts with no completed stages", () => {
    const state = createWorkflowState(BRIEF_ID);
    expect(state.completedStages).toHaveLength(0);
  });

  it("stageIndex is 0", () => {
    const state = createWorkflowState(BRIEF_ID);
    expect(state.stageIndex).toBe(0);
  });
});

// ── nextStage ─────────────────────────────────────────────────────────────────

describe("nextStage", () => {
  it("returns research after brand_brief", () => {
    expect(nextStage("brand_brief")).toBe("research");
  });

  it("returns null after export (last stage)", () => {
    expect(nextStage("export")).toBeNull();
  });

  it("returns correct next for every stage except last", () => {
    for (let i = 0; i < BRANDING_STAGES.length - 1; i++) {
      expect(nextStage(BRANDING_STAGES[i]!)).toBe(BRANDING_STAGES[i + 1]);
    }
  });
});

// ── stageIndex ────────────────────────────────────────────────────────────────

describe("stageIndex", () => {
  it("returns 0 for brand_brief", () => {
    expect(stageIndex("brand_brief")).toBe(0);
  });

  it("returns 12 for export", () => {
    expect(stageIndex("export")).toBe(12);
  });

  it("returns 11 for review", () => {
    expect(stageIndex("review")).toBe(11);
  });
});

// ── isTransitionAllowed ───────────────────────────────────────────────────────

describe("isTransitionAllowed", () => {
  it("allows brand_brief → research (linear forward)", () => {
    expect(isTransitionAllowed("brand_brief", "research").allowed).toBe(true);
  });

  it("allows any stage → review (quality gate)", () => {
    for (const stage of BRANDING_STAGES) {
      if (stage !== "review") {
        expect(isTransitionAllowed(stage, "review").allowed).toBe(true);
      }
    }
  });

  it("allows review → any prior stage (revision loop)", () => {
    expect(isTransitionAllowed("review", "brand_strategy").allowed).toBe(true);
    expect(isTransitionAllowed("review", "color_system").allowed).toBe(true);
    expect(isTransitionAllowed("review", "brand_brief").allowed).toBe(true);
  });

  it("disallows skipping a stage forward", () => {
    const result = isTransitionAllowed("brand_brief", "brand_strategy");
    expect(result.allowed).toBe(false);
  });

  it("disallows moving to same stage", () => {
    const result = isTransitionAllowed("brand_brief", "brand_brief");
    expect(result.allowed).toBe(false);
  });

  it("disallows going backward (non-review)", () => {
    const result = isTransitionAllowed("brand_strategy", "research");
    expect(result.allowed).toBe(false);
  });

  it("provides reason on disallowed transition", () => {
    const result = isTransitionAllowed("brand_brief", "positioning");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBeTruthy();
    }
  });
});

// ── advanceStage ──────────────────────────────────────────────────────────────

describe("advanceStage", () => {
  it("advances brand_brief → research", () => {
    const state  = createWorkflowState(BRIEF_ID);
    const result = advanceStage(state, "research");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.currentStage).toBe("research");
      expect(result.state.status).toBe("active");
    }
  });

  it("marks previous stage as completed on advance", () => {
    const state  = createWorkflowState(BRIEF_ID);
    const result = advanceStage(state, "research");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.completedStages).toContain("brand_brief");
    }
  });

  it("records transition in audit trail", () => {
    const state  = createWorkflowState(BRIEF_ID);
    const result = advanceStage(state, "research", "Starting research phase");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const last = result.state.transitions.at(-1)!;
      expect(last.fromStage).toBe("brand_brief");
      expect(last.toStage).toBe("research");
      expect(last.note).toBe("Starting research phase");
    }
  });

  it("returns error for invalid transition (skip forward)", () => {
    const state  = createWorkflowState(BRIEF_ID);
    const result = advanceStage(state, "positioning");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it("sets status to in_review when advancing to review", () => {
    let state = createWorkflowState(BRIEF_ID);
    state = (advanceStage(state, "research") as { ok: true; state: typeof state }).state;
    const result = advanceStage(state, "review");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe("in_review");
    }
  });

  it("sets status to active when leaving review", () => {
    let state = createWorkflowState(BRIEF_ID);
    state = (advanceStage(state, "research") as { ok: true; state: typeof state }).state;
    state = (advanceStage(state, "review") as { ok: true; state: typeof state }).state;
    const result = advanceStage(state, "brand_brief");  // revision loop
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.status).toBe("active");
    }
  });

  it("sets status to exported when reaching export stage", () => {
    const state = makeFullyAdvancedState();
    expect(state.currentStage).toBe("export");
    expect(state.status).toBe("exported");
  });

  it("does not mutate original state", () => {
    const state  = createWorkflowState(BRIEF_ID);
    const before = state.currentStage;
    advanceStage(state, "research");
    expect(state.currentStage).toBe(before);
  });
});

// ── getWorkflowProgress ───────────────────────────────────────────────────────

describe("getWorkflowProgress", () => {
  it("starts at 0% complete", () => {
    const state    = createWorkflowState(BRIEF_ID);
    const progress = getWorkflowProgress(state);
    expect(progress.percentComplete).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it("marks current stage correctly", () => {
    const state    = createWorkflowState(BRIEF_ID);
    const progress = getWorkflowProgress(state);
    const current  = progress.stages.find((s) => s.current);
    expect(current?.stage).toBe("brand_brief");
  });

  it("totalStages is 13", () => {
    const state    = createWorkflowState(BRIEF_ID);
    const progress = getWorkflowProgress(state);
    expect(progress.totalStages).toBe(13);
  });

  it("marks isComplete when at export with prior stages done", () => {
    const state    = makeFullyAdvancedState();
    const progress = getWorkflowProgress(state);
    expect(progress.isComplete).toBe(true);
  });

  it("returns stages array with correct length", () => {
    const state    = createWorkflowState(BRIEF_ID);
    const progress = getWorkflowProgress(state);
    expect(progress.stages).toHaveLength(13);
  });

  it("completed stages are marked after advancing", () => {
    let state  = createWorkflowState(BRIEF_ID);
    state = (advanceStage(state, "research") as { ok: true; state: typeof state }).state;
    const progress = getWorkflowProgress(state);
    const briefStage = progress.stages.find((s) => s.stage === "brand_brief");
    expect(briefStage?.completed).toBe(true);
  });
});
