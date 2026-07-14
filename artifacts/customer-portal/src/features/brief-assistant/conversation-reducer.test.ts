/**
 * Phase 4A — Brief Assistant: Reducer Tests
 */

import { describe, it, expect } from "vitest";
import { assistantReducer } from "./conversation-reducer";
import type { AssistantConversationState, AssistantDraftChange } from "./types";
import { INITIAL_CONVERSATION_STATE } from "./types";

function makeChange(): AssistantDraftChange {
  return {
    field: "audienceDemographics",
    previousValue: "",
    nextValue: "B2B",
    displayBefore: [],
    displayAfter: ["B2B"],
    conflict: false,
    warnings: [],
    canMerge: true,
  };
}

describe("assistantReducer — OPEN", () => {
  it("stays in idle stage when no mode selected", () => {
    const s = assistantReducer(INITIAL_CONVERSATION_STATE, { type: "OPEN" });
    expect(s.stage).toBe("idle");
  });
});

describe("assistantReducer — CLOSE", () => {
  it("preserves all state when closed", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      mode: "complete-missing",
      stage: "question",
      answeredQuestionIds: ["companyIndustry"],
    };
    const s = assistantReducer(state, { type: "CLOSE" });
    expect(s.mode).toBe("complete-missing");
    expect(s.answeredQuestionIds).toContain("companyIndustry");
  });
});

describe("assistantReducer — SELECT_MODE", () => {
  it("sets mode and advances to intro", () => {
    const s = assistantReducer(INITIAL_CONVERSATION_STATE, {
      type: "SELECT_MODE",
      mode: "complete-missing",
    });
    expect(s.mode).toBe("complete-missing");
    expect(s.stage).toBe("intro");
  });

  it("show-recommendations goes directly to complete stage", () => {
    const s = assistantReducer(INITIAL_CONVERSATION_STATE, {
      type: "SELECT_MODE",
      mode: "show-recommendations",
    });
    expect(s.stage).toBe("complete");
  });

  it("clears any pending change when mode selected", () => {
    const stateWithChange: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      pendingChange: makeChange(),
    };
    const s = assistantReducer(stateWithChange, {
      type: "SELECT_MODE",
      mode: "start-from-beginning",
    });
    expect(s.pendingChange).toBeNull();
  });
});

describe("assistantReducer — SHOW_QUESTION", () => {
  it("sets question stage and currentQuestionId", () => {
    const s = assistantReducer(INITIAL_CONVERSATION_STATE, {
      type: "SHOW_QUESTION",
      questionId: "companyIndustry",
    });
    expect(s.stage).toBe("question");
    expect(s.currentQuestionId).toBe("companyIndustry");
  });
});

describe("assistantReducer — ANSWER_DRAFTED", () => {
  it("sets preview stage and stores pendingChange", () => {
    const change = makeChange();
    const s = assistantReducer(INITIAL_CONVERSATION_STATE, {
      type: "ANSWER_DRAFTED",
      change,
    });
    expect(s.stage).toBe("preview");
    expect(s.pendingChange).toEqual(change);
  });
});

describe("assistantReducer — EDIT_DRAFT", () => {
  it("returns to question stage and clears pending change", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      stage: "preview",
      pendingChange: makeChange(),
    };
    const s = assistantReducer(state, { type: "EDIT_DRAFT" });
    expect(s.stage).toBe("question");
    expect(s.pendingChange).toBeNull();
  });
});

describe("assistantReducer — APPLY_DRAFT", () => {
  it("adds currentQuestionId to answeredQuestionIds and clears pendingChange", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      stage: "preview",
      currentQuestionId: "audienceDemographics",
      pendingChange: makeChange(),
    };
    const s = assistantReducer(state, { type: "APPLY_DRAFT" });
    expect(s.answeredQuestionIds).toContain("audienceDemographics");
    expect(s.pendingChange).toBeNull();
    expect(s.stage).toBe("question");
  });

  it("does not duplicate an already-answered question", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      currentQuestionId: "audienceDemographics",
      answeredQuestionIds: ["audienceDemographics"],
      pendingChange: makeChange(),
    };
    const s = assistantReducer(state, { type: "APPLY_DRAFT" });
    const count = s.answeredQuestionIds.filter((id) => id === "audienceDemographics").length;
    expect(count).toBe(1);
  });
});

describe("assistantReducer — SKIP_QUESTION", () => {
  it("adds the question to skippedQuestionIds", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      currentQuestionId: "companySize",
    };
    const s = assistantReducer(state, { type: "SKIP_QUESTION", questionId: "companySize" });
    expect(s.skippedQuestionIds).toContain("companySize");
  });

  it("clears currentQuestionId so planner can advance", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      currentQuestionId: "companySize",
    };
    const s = assistantReducer(state, { type: "SKIP_QUESTION", questionId: "companySize" });
    expect(s.currentQuestionId).toBeNull();
  });

  it("does not call onBriefChange (pure reducer — no side effects)", () => {
    // Skipping is purely state — the reducer has no access to callbacks
    const state = { ...INITIAL_CONVERSATION_STATE, currentQuestionId: "companySize" };
    expect(() =>
      assistantReducer(state, { type: "SKIP_QUESTION", questionId: "companySize" }),
    ).not.toThrow();
  });
});

describe("assistantReducer — GO_TO_REVIEW", () => {
  it("sets review stage and clears currentQuestionId", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      stage: "question",
      currentQuestionId: "primaryGoal",
    };
    const s = assistantReducer(state, { type: "GO_TO_REVIEW" });
    expect(s.stage).toBe("review");
    expect(s.currentQuestionId).toBeNull();
  });
});

describe("assistantReducer — COMPLETE", () => {
  it("sets complete stage and completed=true", () => {
    const s = assistantReducer(INITIAL_CONVERSATION_STATE, { type: "COMPLETE" });
    expect(s.stage).toBe("complete");
    expect(s.completed).toBe(true);
  });
});

describe("assistantReducer — RESET", () => {
  it("returns exactly the initial state", () => {
    const state: AssistantConversationState = {
      mode: "complete-missing",
      stage: "question",
      currentQuestionId: "stylePreference",
      answeredQuestionIds: ["companyIndustry", "primaryGoal"],
      skippedQuestionIds: ["companySize"],
      pendingChange: makeChange(),
      completed: false,
    };
    const s = assistantReducer(state, { type: "RESET" });
    expect(s).toEqual(INITIAL_CONVERSATION_STATE);
  });
});

describe("assistantReducer — RESTORE", () => {
  it("restores saved state but ALWAYS clears pendingChange", () => {
    const saved: AssistantConversationState = {
      mode: "complete-missing",
      stage: "question",
      currentQuestionId: "stylePreference",
      answeredQuestionIds: ["companyIndustry"],
      skippedQuestionIds: [],
      pendingChange: makeChange(), // This must be cleared on restore
      completed: false,
    };
    const s = assistantReducer(INITIAL_CONVERSATION_STATE, { type: "RESTORE", state: saved });
    expect(s.mode).toBe("complete-missing");
    expect(s.answeredQuestionIds).toContain("companyIndustry");
    // Critical: pending change MUST NOT be restored (spec §17)
    expect(s.pendingChange).toBeNull();
  });
});

describe("assistantReducer — pending change not auto-applied", () => {
  it("OPEN action does not apply pendingChange", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      pendingChange: makeChange(),
    };
    const s = assistantReducer(state, { type: "OPEN" });
    expect(s.pendingChange).not.toBeNull(); // unchanged
  });

  it("CLOSE action does not apply pendingChange", () => {
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      pendingChange: makeChange(),
    };
    const s = assistantReducer(state, { type: "CLOSE" });
    expect(s.pendingChange).not.toBeNull(); // unchanged by close
  });

  it("SKIP_QUESTION does not apply pendingChange to brief", () => {
    // Reducer is pure — it cannot call onBriefChange
    // This ensures no accidental mutation
    const state: AssistantConversationState = {
      ...INITIAL_CONVERSATION_STATE,
      currentQuestionId: "companySize",
      pendingChange: makeChange(),
    };
    const s = assistantReducer(state, { type: "SKIP_QUESTION", questionId: "companySize" });
    // Pending change is cleared (not applied) on skip
    expect(s.pendingChange).toBeNull();
  });
});
