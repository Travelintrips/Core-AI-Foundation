/**
 * Policy Tests — CompletionPolicy + ReviewGatePolicy
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Covers (per spec):
 * - completion policy (all_required, all_stages, any_of, all_of)
 * - review gate (pending, approved, rejected, no-gate)
 */

import { describe, it, expect } from "vitest";
import { CompletionPolicyEvaluator } from "../policy/CompletionPolicy.js";
import { ReviewGatePolicy } from "../policy/ReviewGatePolicy.js";
import type { StageState, ReviewRecord } from "../types/policy.js";
import type { StageDefinition } from "../types/definition.js";
import type { ProjectContext } from "../types/evaluator.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStageState(
  stageId: string,
  status: StageState["status"],
  optional = false,
): StageState {
  return { stageId, status, optional };
}

function makeStage(overrides: Partial<StageDefinition> & { id: string }): StageDefinition {
  return {
    label: overrides.id,
    requiredCapability: "cap",
    dependencies: [],
    optional: false,
    repeatable: false,
    parallel: false,
    ...overrides,
  };
}

function makeContext(): ProjectContext {
  return { goals: [], deliverables: [], serviceType: "test", fields: {} };
}

// ── CompletionPolicyEvaluator ─────────────────────────────────────────────────

describe("CompletionPolicyEvaluator", () => {
  const evaluator = new CompletionPolicyEvaluator();

  describe("all_required policy", () => {
    it("returns complete when all required stages are completed", () => {
      const states = [
        makeStageState("a", "completed", false),
        makeStageState("b", "completed", false),
        makeStageState("opt", "pending", true),
      ];
      const result = evaluator.evaluate(states, { type: "all_required" });
      expect(result.complete).toBe(true);
      expect(result.blockingStages).toHaveLength(0);
    });

    it("returns incomplete when a required stage is still pending", () => {
      const states = [
        makeStageState("a", "completed", false),
        makeStageState("b", "pending", false),
      ];
      const result = evaluator.evaluate(states, { type: "all_required" });
      expect(result.complete).toBe(false);
      expect(result.blockingStages).toContain("b");
    });

    it("treats skipped required stages as complete", () => {
      const states = [
        makeStageState("a", "completed", false),
        makeStageState("b", "skipped", false),
      ];
      const result = evaluator.evaluate(states, { type: "all_required" });
      expect(result.complete).toBe(true);
    });
  });

  describe("all_stages policy", () => {
    it("returns complete only when every stage (including optional) is done", () => {
      const states = [
        makeStageState("a", "completed", false),
        makeStageState("opt", "completed", true),
      ];
      expect(evaluator.evaluate(states, { type: "all_stages" }).complete).toBe(true);
    });

    it("returns incomplete when an optional stage is still pending", () => {
      const states = [
        makeStageState("a", "completed", false),
        makeStageState("opt", "pending", true),
      ];
      const result = evaluator.evaluate(states, { type: "all_stages" });
      expect(result.complete).toBe(false);
      expect(result.blockingStages).toContain("opt");
    });
  });

  describe("any_of policy", () => {
    it("returns complete when at least one listed stage is completed", () => {
      const states = [
        makeStageState("a", "pending", false),
        makeStageState("b", "completed", false),
      ];
      const result = evaluator.evaluate(states, { type: "any_of", stageIds: ["a", "b"] });
      expect(result.complete).toBe(true);
    });

    it("returns incomplete when none of the listed stages are completed", () => {
      const states = [
        makeStageState("a", "running", false),
        makeStageState("b", "pending", false),
      ];
      const result = evaluator.evaluate(states, { type: "any_of", stageIds: ["a", "b"] });
      expect(result.complete).toBe(false);
    });
  });

  describe("all_of policy", () => {
    it("returns complete when all listed stages are completed", () => {
      const states = [
        makeStageState("a", "completed", false),
        makeStageState("b", "completed", false),
        makeStageState("c", "pending", false), // not in the list
      ];
      const result = evaluator.evaluate(states, { type: "all_of", stageIds: ["a", "b"] });
      expect(result.complete).toBe(true);
    });

    it("returns incomplete when any listed stage is not completed", () => {
      const states = [
        makeStageState("a", "completed", false),
        makeStageState("b", "running", false),
      ];
      const result = evaluator.evaluate(states, { type: "all_of", stageIds: ["a", "b"] });
      expect(result.complete).toBe(false);
      expect(result.blockingStages).toContain("b");
    });
  });
});

// ── ReviewGatePolicy ──────────────────────────────────────────────────────────

describe("ReviewGatePolicy", () => {
  const policy = new ReviewGatePolicy();
  const NOW = new Date("2024-01-01T12:00:00Z");

  // ── requiresReview ────────────────────────────────────────────────────────

  it("returns false for a stage with no reviewGate", () => {
    const stage = makeStage({ id: "s1" });
    expect(policy.requiresReview(stage, makeContext())).toBe(false);
  });

  it("returns false for a stage with reviewGate.required = false", () => {
    const stage = makeStage({ id: "s1", reviewGate: { required: false } });
    expect(policy.requiresReview(stage, makeContext())).toBe(false);
  });

  it("returns true for a stage with reviewGate.required = true and no activationCondition", () => {
    const stage = makeStage({ id: "s1", reviewGate: { required: true } });
    expect(policy.requiresReview(stage, makeContext())).toBe(true);
  });

  it("returns false when stage activationCondition is not met", () => {
    const stage = makeStage({
      id: "s1",
      reviewGate: { required: true },
      activationCondition: { type: "goal", goals: ["production_ready"] },
    });
    expect(policy.requiresReview(stage, makeContext())).toBe(false);
  });

  // ── gateStatus ────────────────────────────────────────────────────────────

  it("auto-approves a stage with no reviewGate", () => {
    const stage = makeStage({ id: "s1" });
    const check = policy.gateStatus(stage, [], NOW);
    expect(check.status).toBe("approved");
  });

  it("returns pending when no reviews have been recorded", () => {
    const stage = makeStage({
      id: "s1",
      reviewGate: { required: true, minimumApprovals: 1 },
    });
    const check = policy.gateStatus(stage, [], NOW);
    expect(check.status).toBe("pending");
    expect(check.approvalsReceived).toBe(0);
    expect(check.approvalsRequired).toBe(1);
  });

  it("returns approved when minimum approvals are met", () => {
    const stage = makeStage({
      id: "s1",
      reviewGate: { required: true, minimumApprovals: 2 },
    });
    const reviews: ReviewRecord[] = [
      { reviewGateId: "s1", approverId: "user1", decision: "approve", decidedAt: NOW },
      { reviewGateId: "s1", approverId: "user2", decision: "approve", decidedAt: NOW },
    ];
    const check = policy.gateStatus(stage, reviews, NOW);
    expect(check.status).toBe("approved");
    expect(check.approvalsReceived).toBe(2);
  });

  it("returns rejected on any rejection decision", () => {
    const stage = makeStage({
      id: "s1",
      reviewGate: { required: true, minimumApprovals: 1 },
    });
    const reviews: ReviewRecord[] = [
      { reviewGateId: "s1", approverId: "user1", decision: "reject", decidedAt: NOW },
    ];
    const check = policy.gateStatus(stage, reviews, NOW);
    expect(check.status).toBe("rejected");
  });

  it("counts unique approvers only (deduplicates same approver)", () => {
    const stage = makeStage({
      id: "s1",
      reviewGate: { required: true, minimumApprovals: 2 },
    });
    const reviews: ReviewRecord[] = [
      { reviewGateId: "s1", approverId: "user1", decision: "approve", decidedAt: NOW },
      { reviewGateId: "s1", approverId: "user1", decision: "approve", decidedAt: NOW }, // duplicate
    ];
    const check = policy.gateStatus(stage, reviews, NOW);
    expect(check.approvalsReceived).toBe(1);
    expect(check.status).toBe("pending");
  });

  it("filters reviews to the correct gateId (stageId)", () => {
    const stage = makeStage({
      id: "concept_sketch",
      reviewGate: { required: true, minimumApprovals: 1 },
    });
    const reviews: ReviewRecord[] = [
      // review for a different stage
      { reviewGateId: "other_stage", approverId: "user1", decision: "approve", decidedAt: NOW },
    ];
    const check = policy.gateStatus(stage, reviews, NOW);
    expect(check.status).toBe("pending");
    expect(check.approvalsReceived).toBe(0);
  });
});
