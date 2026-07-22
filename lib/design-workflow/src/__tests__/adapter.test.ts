/**
 * LegacyCreativeStepAdapter Tests
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Covers (per spec):
 * - legacy step mapping (id match, label match, renamedStages, removedStages)
 * - unmapped step names reported separately
 * - read-only — no modification of input objects
 * - status normalisation
 */

import { describe, it, expect } from "vitest";
import { LegacyCreativeStepAdapter } from "../adapter/LegacyCreativeStepAdapter.js";
import type { DesignWorkflowDefinition } from "../types/definition.js";
import type { LegacyProjectStep } from "../types/adapter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date("2024-01-01T00:00:00Z");

function makeWorkflow(
  overrides: Partial<DesignWorkflowDefinition> = {},
): DesignWorkflowDefinition {
  return {
    workflowId: "test.workflow",
    version: 1,
    name: "Test",
    pluginId: "test",
    supportedServiceTypes: ["test_service"],
    stages: [
      { id: "brief", label: "Brief Analysis", requiredCapability: "cap_a", dependencies: [], optional: false, repeatable: false, parallel: false },
      { id: "moodboard", label: "Moodboard Generation", requiredCapability: "cap_b", dependencies: ["brief"], optional: false, repeatable: false, parallel: false },
      { id: "concept", label: "Concept Design", requiredCapability: "cap_c", dependencies: ["moodboard"], optional: false, repeatable: false, parallel: false },
    ],
    requiredCapabilities: ["cap_a", "cap_b", "cap_c"],
    completionPolicy: { type: "all_required" },
    fallbackBehavior: { onRequiredStageFailure: "fail_workflow", onOptionalStageFailure: "continue" },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeStep(
  overrides: Partial<LegacyProjectStep> & { stepName: string },
): LegacyProjectStep {
  const { stepName, ...rest } = overrides;
  return {
    id: 1,
    projectId: 100,
    agentId: null,
    stepName,
    status: "completed",
    tokenUsage: 500,
    latencyMs: 1200,
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LegacyCreativeStepAdapter", () => {
  // ── Exact stage ID match ─────────────────────────────────────────────────

  it("maps a step whose stepName matches a stage id exactly", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const step = makeStep({ id: 1, stepName: "brief" });
    const { snapshots, unmappedStepNames } = adapter.adaptSteps([step]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.stageId).toBe("brief");
    expect(unmappedStepNames).toHaveLength(0);
  });

  // ── Label match ───────────────────────────────────────────────────────────

  it("maps a step whose stepName matches a stage label", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const step = makeStep({ id: 2, stepName: "Moodboard Generation" });
    const { snapshots } = adapter.adaptSteps([step]);
    expect(snapshots[0]!.stageId).toBe("moodboard");
  });

  // ── renamedStages ─────────────────────────────────────────────────────────

  it("maps a renamed stage using migrationMetadata.renamedStages", () => {
    const workflowV2 = makeWorkflow({
      version: 2,
      migrationMetadata: {
        compatibleFromVersion: 1,
        renamedStages: { "concept_sketch": "concept" }, // old → new
      },
    });
    const adapter = new LegacyCreativeStepAdapter(workflowV2);
    const step = makeStep({ id: 3, stepName: "concept_sketch" });
    const { snapshots } = adapter.adaptSteps([step]);
    expect(snapshots[0]!.stageId).toBe("concept");
  });

  // ── removedStages ─────────────────────────────────────────────────────────

  it("maps a removed stage to a synthetic snapshot using the original stepName as stageId", () => {
    const workflowV2 = makeWorkflow({
      version: 2,
      migrationMetadata: {
        compatibleFromVersion: 1,
        removedStages: ["old_review_gate"],
      },
    });
    const adapter = new LegacyCreativeStepAdapter(workflowV2);
    const step = makeStep({ id: 4, stepName: "old_review_gate", status: "completed" });
    const { snapshots, unmappedStepNames } = adapter.adaptSteps([step]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.stageId).toBe("old_review_gate");
    expect(unmappedStepNames).toHaveLength(0);
  });

  // ── Unmapped steps ────────────────────────────────────────────────────────

  it("reports unmapped step names instead of silently discarding them", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const step = makeStep({ id: 5, stepName: "totally_unknown_step" });
    const { snapshots, unmappedStepNames } = adapter.adaptSteps([step]);
    expect(snapshots).toHaveLength(0);
    expect(unmappedStepNames).toContain("totally_unknown_step");
  });

  // ── Status normalisation ──────────────────────────────────────────────────

  it("normalises known statuses correctly", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    for (const status of ["pending", "running", "completed", "failed"] as const) {
      const step = makeStep({ id: 10, stepName: "brief", status });
      const { snapshots } = adapter.adaptSteps([step]);
      expect(snapshots[0]!.status).toBe(status);
    }
  });

  it("normalises unknown status to 'pending'", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const step = makeStep({ id: 6, stepName: "brief", status: "archived" });
    const { snapshots } = adapter.adaptSteps([step]);
    expect(snapshots[0]!.status).toBe("pending");
  });

  // ── isTerminal ────────────────────────────────────────────────────────────

  it("sets isTerminal=true for completed and failed steps", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const completed = makeStep({ id: 7, stepName: "brief", status: "completed" });
    const failed = makeStep({ id: 8, stepName: "moodboard", status: "failed" });
    const { snapshots } = adapter.adaptSteps([completed, failed]);
    expect(snapshots[0]!.isTerminal).toBe(true);
    expect(snapshots[1]!.isTerminal).toBe(true);
  });

  it("sets isTerminal=false for pending and running steps", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const pending = makeStep({ id: 9, stepName: "brief", status: "pending" });
    const { snapshots } = adapter.adaptSteps([pending]);
    expect(snapshots[0]!.isTerminal).toBe(false);
  });

  // ── Read-only guarantee ───────────────────────────────────────────────────

  it("does not modify the input step objects", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const step = makeStep({ id: 11, stepName: "brief" });
    const originalStepName = step.stepName;
    const originalStatus = step.status;
    adapter.adaptSteps([step]);
    expect(step.stepName).toBe(originalStepName);
    expect(step.status).toBe(originalStatus);
  });

  // ── adaptStep (single) ────────────────────────────────────────────────────

  it("adaptStep returns null for unmapped step", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const step = makeStep({ id: 12, stepName: "unknown" });
    expect(adapter.adaptStep(step)).toBeNull();
  });

  it("adaptStep returns a snapshot for a mapped step", () => {
    const adapter = new LegacyCreativeStepAdapter(makeWorkflow());
    const step = makeStep({ id: 13, stepName: "concept" });
    const snapshot = adapter.adaptStep(step);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.stageId).toBe("concept");
  });

  // ── Full workflow integration ─────────────────────────────────────────────

  it("adapts legacy fashion steps correctly", async () => {
    const { fashionWorkflow } = await import("../fixtures/fashion.workflow.js");
    const adapter = new LegacyCreativeStepAdapter(fashionWorkflow);
    const steps: LegacyProjectStep[] = [
      makeStep({ id: 1, stepName: "brief", status: "completed" }),
      makeStep({ id: 2, stepName: "moodboard", status: "completed" }),
      makeStep({ id: 3, stepName: "Concept Sketch", status: "running" }), // label match
    ];
    const { snapshots, unmappedStepNames } = adapter.adaptSteps(steps);
    expect(snapshots).toHaveLength(3);
    expect(unmappedStepNames).toHaveLength(0);
    const conceptSnapshot = snapshots.find((s) => s.stageId === "concept_sketch");
    expect(conceptSnapshot).toBeDefined();
    expect(conceptSnapshot!.isTerminal).toBe(false);
  });
});
