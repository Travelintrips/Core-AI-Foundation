/**
 * Eligibility & Conditional Stage Tests
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Covers (per spec):
 * - conditional stage on/off (all condition types)
 * - optional stage handling
 * - review gate stage
 * - stage with no activation condition (always eligible)
 */

import { describe, it, expect } from "vitest";
import { StageEligibilityEvaluator } from "../evaluator/StageEligibilityEvaluator.js";
import { ConditionalStageResolver } from "../evaluator/ConditionalStageResolver.js";
import type { StageDefinition, DesignWorkflowDefinition } from "../types/definition.js";
import type { ProjectContext } from "../types/evaluator.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date("2024-01-01T00:00:00Z");

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

function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    goals: [],
    deliverables: [],
    serviceType: "test_service",
    fields: {},
    ...overrides,
  };
}

// ── StageEligibilityEvaluator ─────────────────────────────────────────────────

describe("StageEligibilityEvaluator", () => {
  const evaluator = new StageEligibilityEvaluator();

  it("returns eligible=true for stage with no activationCondition", () => {
    const stage = makeStage({ id: "s1" });
    const result = evaluator.evaluate(stage, makeContext());
    expect(result.eligible).toBe(true);
    expect(result.conditionTrace).toHaveLength(0);
  });

  it("evaluates { type: 'always' } as true", () => {
    const stage = makeStage({ id: "s1", activationCondition: { type: "always" } });
    const result = evaluator.evaluate(stage, makeContext());
    expect(result.eligible).toBe(true);
  });

  it("evaluates { type: 'never' } as false", () => {
    const stage = makeStage({ id: "s1", activationCondition: { type: "never" } });
    const result = evaluator.evaluate(stage, makeContext());
    expect(result.eligible).toBe(false);
  });

  // ── goal conditions ───────────────────────────────────────────────────────

  it("goal condition: eligible when project has the required goal", () => {
    const stage = makeStage({
      id: "tech_drawing",
      activationCondition: { type: "goal", goals: ["production_ready"] },
    });
    const ctx = makeContext({ goals: ["production_ready", "campaign"] });
    expect(evaluator.evaluate(stage, ctx).eligible).toBe(true);
  });

  it("goal condition: not eligible when project lacks the required goal", () => {
    const stage = makeStage({
      id: "tech_drawing",
      activationCondition: { type: "goal", goals: ["production_ready"] },
    });
    const ctx = makeContext({ goals: ["campaign_only"] });
    const result = evaluator.evaluate(stage, ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("No project goal matched");
  });

  // ── deliverable conditions ────────────────────────────────────────────────

  it("deliverable condition: eligible when deliverable is in project", () => {
    const stage = makeStage({
      id: "dieline",
      activationCondition: { type: "deliverable", deliverables: ["print_ready"] },
    });
    expect(evaluator.evaluate(stage, makeContext({ deliverables: ["print_ready"] })).eligible).toBe(true);
  });

  it("deliverable condition: not eligible when deliverable absent", () => {
    const stage = makeStage({
      id: "dieline",
      activationCondition: { type: "deliverable", deliverables: ["print_ready"] },
    });
    expect(evaluator.evaluate(stage, makeContext({ deliverables: [] })).eligible).toBe(false);
  });

  // ── service_type conditions ───────────────────────────────────────────────

  it("service_type condition: eligible for matching type", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: { type: "service_type", serviceTypes: ["fashion_design"] },
    });
    expect(evaluator.evaluate(stage, makeContext({ serviceType: "fashion_design" })).eligible).toBe(true);
  });

  it("service_type condition: not eligible for non-matching type", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: { type: "service_type", serviceTypes: ["interior_design"] },
    });
    expect(evaluator.evaluate(stage, makeContext({ serviceType: "fashion_design" })).eligible).toBe(false);
  });

  // ── context_field conditions ──────────────────────────────────────────────

  it("context_field eq: eligible when field matches", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: { type: "context_field", field: "tier", operator: "eq", value: "premium" },
    });
    expect(evaluator.evaluate(stage, makeContext({ fields: { tier: "premium" } })).eligible).toBe(true);
    expect(evaluator.evaluate(stage, makeContext({ fields: { tier: "basic" } })).eligible).toBe(false);
  });

  it("context_field exists: eligible when field is present", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: { type: "context_field", field: "client_code", operator: "exists" },
    });
    expect(evaluator.evaluate(stage, makeContext({ fields: { client_code: "ABC" } })).eligible).toBe(true);
    expect(evaluator.evaluate(stage, makeContext({ fields: {} })).eligible).toBe(false);
  });

  it("context_field in: eligible when value is in list", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: { type: "context_field", field: "region", operator: "in", value: ["ID", "SG", "MY"] },
    });
    expect(evaluator.evaluate(stage, makeContext({ fields: { region: "ID" } })).eligible).toBe(true);
    expect(evaluator.evaluate(stage, makeContext({ fields: { region: "US" } })).eligible).toBe(false);
  });

  // ── composite conditions ──────────────────────────────────────────────────

  it("AND condition: eligible only when all sub-conditions pass", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: {
        type: "and",
        conditions: [
          { type: "goal", goals: ["production_ready"] },
          { type: "deliverable", deliverables: ["print_ready"] },
        ],
      },
    });
    const both = makeContext({ goals: ["production_ready"], deliverables: ["print_ready"] });
    const onlyGoal = makeContext({ goals: ["production_ready"], deliverables: [] });
    expect(evaluator.evaluate(stage, both).eligible).toBe(true);
    expect(evaluator.evaluate(stage, onlyGoal).eligible).toBe(false);
  });

  it("OR condition: eligible when at least one sub-condition passes", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: {
        type: "or",
        conditions: [
          { type: "goal", goals: ["production_ready"] },
          { type: "deliverable", deliverables: ["print_ready"] },
        ],
      },
    });
    const neitherCtx = makeContext({ goals: [], deliverables: [] });
    const eitherCtx = makeContext({ goals: ["production_ready"], deliverables: [] });
    expect(evaluator.evaluate(stage, neitherCtx).eligible).toBe(false);
    expect(evaluator.evaluate(stage, eitherCtx).eligible).toBe(true);
  });

  it("NOT condition: inverts the inner result", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: {
        type: "not",
        condition: { type: "goal", goals: ["concept_only"] },
      },
    });
    expect(evaluator.evaluate(stage, makeContext({ goals: ["concept_only"] })).eligible).toBe(false);
    expect(evaluator.evaluate(stage, makeContext({ goals: ["production_ready"] })).eligible).toBe(true);
  });

  // ── Explainability ─────────────────────────────────────────────────────────

  it("provides a non-empty reason string for every result", () => {
    const stage = makeStage({
      id: "s1",
      activationCondition: { type: "goal", goals: ["production_ready"] },
    });
    const result = evaluator.evaluate(stage, makeContext({ goals: [] }));
    expect(result.reason).toBeTruthy();
    expect(result.conditionTrace.length).toBeGreaterThan(0);
    expect(result.conditionTrace[0]!.reason).toBeTruthy();
  });
});

// ── ConditionalStageResolver ──────────────────────────────────────────────────

describe("ConditionalStageResolver", () => {
  const resolver = new ConditionalStageResolver();
  const NOW = new Date("2024-01-01T00:00:00Z");

  function makeWorkflow(stages: StageDefinition[]): DesignWorkflowDefinition {
    const caps = [...new Set(stages.map((s) => s.requiredCapability))];
    return {
      workflowId: "test.workflow",
      version: 1,
      name: "Test",
      pluginId: "test",
      supportedServiceTypes: ["test"],
      stages,
      requiredCapabilities: caps,
      completionPolicy: { type: "all_required" },
      fallbackBehavior: { onRequiredStageFailure: "fail_workflow", onOptionalStageFailure: "continue" },
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  it("marks all stages active when conditions are satisfied", () => {
    const stages = [
      makeStage({ id: "a" }),
      makeStage({ id: "b", activationCondition: { type: "goal", goals: ["production_ready"] } }),
    ];
    const def = makeWorkflow(stages);
    const ctx = makeContext({ goals: ["production_ready"] });
    const { active, excluded } = resolver.resolve(def, ctx);
    expect(active).toHaveLength(2);
    expect(excluded).toHaveLength(0);
  });

  it("excludes stages whose conditions are not met", () => {
    const stages = [
      makeStage({ id: "a" }),
      makeStage({ id: "b", optional: true, activationCondition: { type: "goal", goals: ["campaign_only"] } }),
    ];
    const def = makeWorkflow(stages);
    const ctx = makeContext({ goals: ["production_ready"] });
    const { active, excluded } = resolver.resolve(def, ctx);
    expect(active.map((s) => s.id)).toContain("a");
    expect(excluded.map((e) => e.stage.id)).toContain("b");
  });

  it("provides eligibilityResults for every stage", () => {
    const stages = [makeStage({ id: "a" }), makeStage({ id: "b", activationCondition: { type: "never" } })];
    const def = makeWorkflow(stages);
    const { eligibilityResults } = resolver.resolve(def, makeContext());
    expect(eligibilityResults).toHaveLength(2);
  });

  it("resolves fashion fixture correctly for production_ready goal", async () => {
    const { fashionWorkflow } = await import("../fixtures/fashion.workflow.js");
    const ctx = makeContext({
      goals: ["production_ready"],
      deliverables: [],
      serviceType: "fashion_design",
    });
    const { active } = resolver.resolve(fashionWorkflow, ctx);
    const activeIds = active.map((s) => s.id);
    expect(activeIds).toContain("technical_drawing");
    expect(activeIds).toContain("production_spec");
  });

  it("excludes technical_drawing for campaign-only fashion project", async () => {
    const { fashionWorkflow } = await import("../fixtures/fashion.workflow.js");
    const ctx = makeContext({
      goals: ["campaign_only"],
      deliverables: ["campaign_assets"],
      serviceType: "fashion_campaign",
    });
    const { excluded } = resolver.resolve(fashionWorkflow, ctx);
    expect(excluded.map((e) => e.stage.id)).toContain("technical_drawing");
  });

  it("excludes interior BOQ for concept_only goal", async () => {
    const { interiorWorkflow } = await import("../fixtures/interior.workflow.js");
    const ctx = makeContext({
      goals: ["concept_only"],
      deliverables: [],
      serviceType: "interior_concept",
    });
    const { excluded } = resolver.resolve(interiorWorkflow, ctx);
    expect(excluded.map((e) => e.stage.id)).toContain("boq");
  });
});
