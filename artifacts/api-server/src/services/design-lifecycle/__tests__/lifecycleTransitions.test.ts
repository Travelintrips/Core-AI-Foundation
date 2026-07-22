/**
 * __tests__/lifecycleTransitions.test.ts — Team 08
 *
 * Tests for the lifecycle transition graph and guard function.
 * Covers: valid transitions, invalid transitions, terminal-state guards, noop handling.
 */

import { describe, it, expect } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  guardTransition,
  isValidTransition,
  allowedNext,
} from "../lifecycleTransitions.js";
import {
  LifecycleInvalidTransitionError,
  LifecycleTerminalStateError,
} from "../types.js";
import type { DesignStage } from "../types.js";

// ── ALLOWED_TRANSITIONS completeness ─────────────────────────────────────────

describe("ALLOWED_TRANSITIONS", () => {
  const allStages: DesignStage[] = [
    "draft", "brief_in_progress", "ready", "active", "waiting_for_input",
    "generating", "in_review", "revision_requested", "approved",
    "completed", "failed", "cancelled",
  ];

  it("covers every DesignStage as a source key", () => {
    for (const stage of allStages) {
      expect(ALLOWED_TRANSITIONS[stage]).toBeDefined();
    }
  });

  it("has empty outgoing transitions for terminal stages", () => {
    expect(ALLOWED_TRANSITIONS.completed).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it("every listed target stage is also a valid DesignStage key", () => {
    for (const [, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const t of targets) {
        expect(allStages).toContain(t);
      }
    }
  });
});

// ── guardTransition — valid transitions ───────────────────────────────────────

describe("guardTransition — valid transitions", () => {
  const validCases: Array<[DesignStage, DesignStage]> = [
    ["draft", "brief_in_progress"],
    ["draft", "cancelled"],
    ["brief_in_progress", "ready"],
    ["brief_in_progress", "draft"],
    ["brief_in_progress", "cancelled"],
    ["ready", "active"],
    ["ready", "cancelled"],
    ["active", "waiting_for_input"],
    ["active", "generating"],
    ["active", "failed"],
    ["active", "cancelled"],
    ["waiting_for_input", "active"],
    ["waiting_for_input", "cancelled"],
    ["generating", "in_review"],
    ["generating", "failed"],
    ["generating", "cancelled"],
    ["in_review", "revision_requested"],
    ["in_review", "approved"],
    ["in_review", "failed"],
    ["revision_requested", "generating"],
    ["revision_requested", "cancelled"],
    ["approved", "completed"],
    ["approved", "generating"],
    ["failed", "generating"],
    ["failed", "cancelled"],
  ];

  it.each(validCases)("allows %s → %s", (from, to) => {
    expect(() => guardTransition(from, to)).not.toThrow();
  });
});

// ── guardTransition — invalid transitions ────────────────────────────────────

describe("guardTransition — invalid transitions", () => {
  // Only non-terminal sources that have no edge to the target
  const invalidCases: Array<[DesignStage, DesignStage]> = [
    ["draft", "completed"],
    ["draft", "generating"],
    ["ready", "draft"],
    ["generating", "approved"],   // must go via in_review first
    ["approved", "draft"],
    ["in_review", "draft"],
    ["failed", "draft"],
  ];

  it.each(invalidCases)("rejects %s → %s", (from, to) => {
    expect(() => guardTransition(from, to)).toThrow(LifecycleInvalidTransitionError);
  });
});

// ── guardTransition — terminal state ─────────────────────────────────────────

describe("guardTransition — terminal states", () => {
  it("throws LifecycleTerminalStateError when transitioning from completed", () => {
    expect(() => guardTransition("completed", "draft")).toThrow(LifecycleTerminalStateError);
  });

  it("throws LifecycleTerminalStateError when transitioning from cancelled", () => {
    expect(() => guardTransition("cancelled", "draft")).toThrow(LifecycleTerminalStateError);
  });

  it("error message identifies the terminal stage", () => {
    try {
      guardTransition("completed", "draft");
    } catch (e) {
      expect(e).toBeInstanceOf(LifecycleTerminalStateError);
      expect((e as Error).message).toContain("completed");
    }
  });
});

// ── guardTransition — noop ────────────────────────────────────────────────────

describe("guardTransition — noop transitions", () => {
  it("rejects noop (from === to) by default", () => {
    expect(() => guardTransition("active", "active")).toThrow(LifecycleInvalidTransitionError);
  });

  it("allows noop when allowNoop=true", () => {
    expect(() => guardTransition("active", "active", { allowNoop: true })).not.toThrow();
  });

  it("allowNoop does not bypass terminal state guard", () => {
    // noop on terminal is still allowed (no real transition)
    expect(() => guardTransition("completed", "completed", { allowNoop: true })).not.toThrow();
  });
});

// ── isValidTransition ─────────────────────────────────────────────────────────

describe("isValidTransition", () => {
  it("returns true for valid transitions", () => {
    expect(isValidTransition("draft", "brief_in_progress")).toBe(true);
    expect(isValidTransition("generating", "in_review")).toBe(true);
    expect(isValidTransition("failed", "generating")).toBe(true);
  });

  it("returns false for invalid transitions", () => {
    expect(isValidTransition("draft", "completed")).toBe(false);
    expect(isValidTransition("completed", "draft")).toBe(false);
    expect(isValidTransition("generating", "draft")).toBe(false);
  });
});

// ── allowedNext ───────────────────────────────────────────────────────────────

describe("allowedNext", () => {
  it("returns the correct next stages for draft", () => {
    const next = allowedNext("draft");
    expect(next).toContain("brief_in_progress");
    expect(next).toContain("cancelled");
    expect(next).not.toContain("completed");
  });

  it("returns empty array for terminal stages", () => {
    expect(allowedNext("completed")).toHaveLength(0);
    expect(allowedNext("cancelled")).toHaveLength(0);
  });

  it("includes retry path for failed", () => {
    expect(allowedNext("failed")).toContain("generating");
  });
});
