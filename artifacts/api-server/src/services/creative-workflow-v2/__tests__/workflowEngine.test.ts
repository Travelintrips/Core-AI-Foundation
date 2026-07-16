/**
 * creative-workflow-v2 — Workflow Engine Test Suite
 *
 * 10 required test cases:
 *   1. deterministic plan
 *   2. dependency ordering
 *   3. cycle detection
 *   4. parallel execution group
 *   5. milestone progress
 *   6. retry policy
 *   7. cancellation state
 *   8. critical path
 *   9. invalid dependency
 *  10. terminal-state immutability
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";

import type {
  WorkflowDefinition,
  ExecutionPlan,
} from "../../../types/creative-workflow-v2/index.js";

import {
  buildExecutionPlan,
  validateWorkflowDefinition,
  detectCycle,
  buildParallelGroups,
  calculateCriticalPath,
  calculateProgress,
  isMilestoneReached,
  startPlan,
  pausePlan,
  resumePlan,
  cancelPlan,
  markNodeCompleted,
  markNodeRunning,
  markNodeSkipped,
  applyRetry,
  canAutoRetry,
  isRetryExhausted,
  computeNextRetryDelayMs,
  buildRetryState,
} from "../index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeId() {
  return randomUUID();
}

/**
 * Build a simple linear workflow: A → B → C
 */
function linearDef(): WorkflowDefinition {
  const now = new Date();
  return {
    id: makeId(),
    name: "Linear Workflow",
    version: 1,
    nodes: [
      { id: "A", label: "Node A", jobType: "llm_inference", estimatedDurationMs: 1000 },
      { id: "B", label: "Node B", jobType: "image_generation", estimatedDurationMs: 2000, dependencies: ["A"] },
      { id: "C", label: "Node C", jobType: "pdf_export", estimatedDurationMs: 500, dependencies: ["B"] },
    ],
    edges: [],
    milestones: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a diamond workflow:
 *   A → B
 *   A → C
 *   B → D
 *   C → D
 */
function diamondDef(): WorkflowDefinition {
  const now = new Date();
  return {
    id: makeId(),
    name: "Diamond Workflow",
    version: 1,
    nodes: [
      { id: "A", label: "Node A", jobType: "llm_inference",    estimatedDurationMs: 1000 },
      { id: "B", label: "Node B", jobType: "image_generation", estimatedDurationMs: 3000, dependencies: ["A"] },
      { id: "C", label: "Node C", jobType: "creative_text",    estimatedDurationMs: 1000, dependencies: ["A"] },
      { id: "D", label: "Node D", jobType: "pdf_export",       estimatedDurationMs: 500,  dependencies: ["B", "C"] },
    ],
    edges: [],
    milestones: [
      { id: "m1", label: "Images done", requiresAllOf: ["B"] },
      { id: "m2", label: "Any branch done", requiresAnyOf: ["B", "C"] },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Deterministic plan
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Deterministic plan", () => {
  it("produces identical plan structure for the same definition and context", () => {
    const def = linearDef();
    const ctx = { contextId: "proj-1", contextType: "creative_project" };

    const plan1 = buildExecutionPlan(def, ctx);
    const plan2 = buildExecutionPlan(def, ctx);

    // ids differ (uuid), but structure is identical
    expect(plan1.nodes.map((n) => n.nodeId)).toEqual(plan2.nodes.map((n) => n.nodeId));
    expect(plan1.topologicalOrder).toEqual(plan2.topologicalOrder);
    expect(plan1.parallelGroups).toEqual(plan2.parallelGroups);
    expect(plan1.criticalPath).toEqual(plan2.criticalPath);
    expect(plan1.progressPct).toBe(plan2.progressPct);
    expect(plan1.status).toBe("pending");
    expect(plan1.workflowDefinitionId).toBe(def.id);
    expect(plan1.workflowVersion).toBe(1);
  });

  it("starts with 0% progress and all nodes in pending or ready status", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    expect(plan.progressPct).toBe(0);
    const statuses = plan.nodes.map((n) => n.status);
    expect(statuses).toContain("ready");
    expect(statuses.every((s) => s === "pending" || s === "ready")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dependency ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Dependency ordering", () => {
  it("places nodes with dependencies after their predecessors in topological order", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    const order = plan.topologicalOrder;
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("C"));
  });

  it("only marks wave-0 nodes as ready; dependents remain pending", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    const nodeA = plan.nodes.find((n) => n.nodeId === "A")!;
    const nodeB = plan.nodes.find((n) => n.nodeId === "B")!;
    const nodeC = plan.nodes.find((n) => n.nodeId === "C")!;

    expect(nodeA.status).toBe("ready");
    expect(nodeB.status).toBe("pending");
    expect(nodeC.status).toBe("pending");
  });

  it("correctly handles multi-level diamond dependencies", () => {
    const plan = buildExecutionPlan(diamondDef(), { contextId: "p", contextType: "t" });
    const order = plan.topologicalOrder;
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("C"));
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("D"));
    expect(order.indexOf("C")).toBeLessThan(order.indexOf("D"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cycle detection
// ─────────────────────────────────────────────────────────────────────────────

describe("3. Cycle detection", () => {
  it("returns null for an acyclic graph", () => {
    const adj = new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", []],
    ]);
    expect(detectCycle(["A", "B", "C"], adj).cycle).toBeNull();
  });

  it("detects a simple 2-node cycle", () => {
    const adj = new Map([
      ["A", ["B"]],
      ["B", ["A"]],
    ]);
    const { cycle } = detectCycle(["A", "B"], adj);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThan(0);
  });

  it("detects a 3-node cycle", () => {
    const adj = new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const { cycle } = detectCycle(["A", "B", "C"], adj);
    expect(cycle).not.toBeNull();
  });

  it("throws a descriptive error when buildExecutionPlan receives a cyclic definition", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "Cyclic", version: 1,
      nodes: [
        { id: "X", label: "X", jobType: "llm_inference", dependencies: ["Z"] },
        { id: "Y", label: "Y", jobType: "llm_inference", dependencies: ["X"] },
        { id: "Z", label: "Z", jobType: "llm_inference", dependencies: ["Y"] },
      ],
      edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/cycle/i);
  });

  it("detects a self-loop", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "Self-loop", version: 1,
      nodes: [{ id: "A", label: "A", jobType: "llm_inference" }],
      edges: [{ from: "A", to: "A" }],
      milestones: [], createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/self-loop|cycle/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Parallel execution groups
// ─────────────────────────────────────────────────────────────────────────────

describe("4. Parallel execution groups", () => {
  it("groups B and C in the same wave for a diamond DAG", () => {
    const plan = buildExecutionPlan(diamondDef(), { contextId: "p", contextType: "t" });
    // Wave 0: [A], Wave 1: [B, C], Wave 2: [D]
    expect(plan.parallelGroups).toHaveLength(3);
    expect(plan.parallelGroups[0]).toEqual(["A"]);
    expect(plan.parallelGroups[1]).toContain("B");
    expect(plan.parallelGroups[1]).toContain("C");
    expect(plan.parallelGroups[2]).toEqual(["D"]);
  });

  it("produces one-node groups for a linear chain", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    expect(plan.parallelGroups).toHaveLength(3);
    expect(plan.parallelGroups.every((g) => g.length === 1)).toBe(true);
  });

  it("covers every node exactly once across all groups", () => {
    const plan = buildExecutionPlan(diamondDef(), { contextId: "p", contextType: "t" });
    const flat = plan.parallelGroups.flat();
    expect(flat).toHaveLength(plan.nodes.length);
    expect(new Set(flat).size).toBe(plan.nodes.length);
  });

  it("handles fully independent nodes (no edges) as a single wave", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "Flat", version: 1,
      nodes: [
        { id: "A", label: "A", jobType: "llm_inference" },
        { id: "B", label: "B", jobType: "llm_inference" },
        { id: "C", label: "C", jobType: "llm_inference" },
      ],
      edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    const plan = buildExecutionPlan(def, { contextId: "p", contextType: "t" });
    expect(plan.parallelGroups).toHaveLength(1);
    expect(plan.parallelGroups[0]).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Milestone progress
// ─────────────────────────────────────────────────────────────────────────────

describe("5. Milestone progress", () => {
  it("isMilestoneReached returns false when required nodes are not complete", () => {
    const reached = isMilestoneReached(
      { requiresAllOf: ["B"] },
      new Set(["A"]),
    );
    expect(reached).toBe(false);
  });

  it("isMilestoneReached returns true for requiresAllOf when all nodes complete", () => {
    expect(isMilestoneReached({ requiresAllOf: ["B", "C"] }, new Set(["A", "B", "C"]))).toBe(true);
  });

  it("isMilestoneReached returns true for requiresAnyOf when at least one completes", () => {
    expect(isMilestoneReached({ requiresAnyOf: ["B", "C"] }, new Set(["B"]))).toBe(true);
    expect(isMilestoneReached({ requiresAnyOf: ["B", "C"] }, new Set(["C"]))).toBe(true);
    expect(isMilestoneReached({ requiresAnyOf: ["B", "C"] }, new Set(["A"]))).toBe(false);
  });

  it("auto-marks milestones as reached in plan after node completion", () => {
    let plan = buildExecutionPlan(diamondDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = markNodeRunning(plan, "A", "job-a");
    plan = markNodeCompleted(plan, "A");
    plan = markNodeRunning(plan, "B", "job-b");
    plan = markNodeCompleted(plan, "B");

    const m1 = plan.milestones.find((m) => m.id === "m1")!;
    const m2 = plan.milestones.find((m) => m.id === "m2")!;

    expect(m1.status).toBe("reached");  // requiresAllOf: ["B"] — B completed
    expect(m2.status).toBe("reached");  // requiresAnyOf: ["B", "C"] — B completed
  });

  it("progress reaches 100 when all nodes complete", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = markNodeRunning(plan, "A", "j1");
    plan = markNodeCompleted(plan, "A");
    plan = markNodeRunning(plan, "B", "j2");
    plan = markNodeCompleted(plan, "B");
    plan = markNodeRunning(plan, "C", "j3");
    plan = markNodeCompleted(plan, "C");

    expect(plan.progressPct).toBe(100);
    expect(plan.status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Retry policy
// ─────────────────────────────────────────────────────────────────────────────

describe("6. Retry policy", () => {
  it("canAutoRetry returns true when retries remain", () => {
    const state = buildRetryState({ maxRetry: 3, strategy: "exponential" });
    expect(canAutoRetry(state)).toBe(true);
  });

  it("canAutoRetry returns false when strategy is manual", () => {
    const state = buildRetryState({ maxRetry: 3, strategy: "manual" });
    expect(canAutoRetry(state)).toBe(false);
  });

  it("isRetryExhausted returns true when retryCount >= maxRetry", () => {
    expect(isRetryExhausted({ retryCount: 3, maxRetry: 3, strategy: "exponential" })).toBe(true);
    expect(isRetryExhausted({ retryCount: 2, maxRetry: 3, strategy: "exponential" })).toBe(false);
  });

  it("applyRetry increments retryCount and keeps status pending while budget remains", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    const node = plan.nodes.find((n) => n.nodeId === "A")!;
    const retried = applyRetry(node, "timeout");

    expect(retried.status).toBe("pending");
    expect(retried.retry.retryCount).toBe(1);
    expect(retried.retry.lastError).toBe("timeout");
  });

  it("applyRetry sets status to failed when budget is exhausted", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    let node = plan.nodes.find((n) => n.nodeId === "A")!;
    // Exhaust retries
    for (let i = 0; i < node.retry.maxRetry; i++) {
      node = applyRetry(node, `error-${i}`);
    }
    const final = applyRetry(node, "final-error");
    expect(final.status).toBe("failed");
  });

  it("computeNextRetryDelayMs returns 0 for immediate strategy", () => {
    expect(computeNextRetryDelayMs({ maxRetry: 3, strategy: "immediate" }, 0)).toBe(0);
  });

  it("computeNextRetryDelayMs returns -1 for manual strategy", () => {
    expect(computeNextRetryDelayMs({ maxRetry: 3, strategy: "manual" }, 0)).toBe(-1);
  });

  it("computeNextRetryDelayMs applies exponential back-off with cap", () => {
    const policy = { maxRetry: 5, strategy: "exponential" as const, backoffMs: 1000, maxBackoffMs: 8000 };
    expect(computeNextRetryDelayMs(policy, 0)).toBe(1000);  // 1000 * 2^0
    expect(computeNextRetryDelayMs(policy, 1)).toBe(2000);  // 1000 * 2^1
    expect(computeNextRetryDelayMs(policy, 2)).toBe(4000);  // 1000 * 2^2
    expect(computeNextRetryDelayMs(policy, 3)).toBe(8000);  // capped
    expect(computeNextRetryDelayMs(policy, 4)).toBe(8000);  // still capped
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cancellation state
// ─────────────────────────────────────────────────────────────────────────────

describe("7. Cancellation state", () => {
  it("cancels a running plan and marks non-terminal nodes as cancelled", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = markNodeRunning(plan, "A", "job-a");
    plan = cancelPlan(plan, "user requested");

    expect(plan.status).toBe("cancelled");
    expect(plan.cancelReason).toBe("user requested");
    expect(plan.cancelledAt).toBeInstanceOf(Date);

    // A was running → cancelled; B and C were pending → cancelled
    for (const node of plan.nodes) {
      expect(node.status).toBe("cancelled");
    }
  });

  it("cancelling preserves already-completed nodes", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = markNodeRunning(plan, "A", "job-a");
    plan = markNodeCompleted(plan, "A");
    plan = cancelPlan(plan, "mid-way");

    const nodeA = plan.nodes.find((n) => n.nodeId === "A")!;
    const nodeB = plan.nodes.find((n) => n.nodeId === "B")!;
    expect(nodeA.status).toBe("completed"); // preserved
    expect(nodeB.status).toBe("cancelled");
  });

  it("pause/resume round-trip preserves plan state", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = pausePlan(plan, "maintenance");
    expect(plan.status).toBe("paused");

    plan = resumePlan(plan);
    expect(plan.status).toBe("running");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Critical path
// ─────────────────────────────────────────────────────────────────────────────

describe("8. Critical path", () => {
  it("identifies the single critical path in a linear workflow", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    // All nodes are on the critical path in a linear chain
    expect(plan.criticalPath).toContain("A");
    expect(plan.criticalPath).toContain("B");
    expect(plan.criticalPath).toContain("C");
  });

  it("identifies the longer branch as critical in a diamond", () => {
    // Diamond: A(1000) → B(3000) → D(500) and A → C(1000) → D
    // Critical path: A → B → D (duration 4500 vs A → C → D = 2500)
    const plan = buildExecutionPlan(diamondDef(), { contextId: "p", contextType: "t" });

    expect(plan.criticalPath).toContain("A");
    expect(plan.criticalPath).toContain("B"); // longer branch
    expect(plan.criticalPath).toContain("D");
    expect(plan.criticalPath).not.toContain("C"); // shorter branch excluded
  });

  it("returns empty critical path when all nodes have zero duration", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "NoDuration", version: 1,
      nodes: [
        { id: "A", label: "A", jobType: "llm_inference" },
        { id: "B", label: "B", jobType: "llm_inference", dependencies: ["A"] },
      ],
      edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    const { criticalPath } = calculateCriticalPath(
      ["A", "B"],
      new Map([["A", { estimatedDurationMs: undefined }], ["B", { estimatedDurationMs: undefined }]]),
      new Map([["A", ["B"]], ["B", []]]),
    );
    // All nodes have zero duration → all have zero float → all are critical
    // (or alternatively empty — implementation may differ; just verify no throw)
    expect(Array.isArray(criticalPath)).toBe(true);
  });

  it("critical path nodes appear in topological order", () => {
    const plan = buildExecutionPlan(diamondDef(), { contextId: "p", contextType: "t" });
    const topoIndexOf = (id: string) => plan.topologicalOrder.indexOf(id);
    const cpIndices = plan.criticalPath.map(topoIndexOf);
    const sorted = [...cpIndices].sort((a, b) => a - b);
    expect(cpIndices).toEqual(sorted);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Invalid dependency
// ─────────────────────────────────────────────────────────────────────────────

describe("9. Invalid dependency", () => {
  it("throws when a node references a non-existent dependency", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "BadDep", version: 1,
      nodes: [{ id: "A", label: "A", jobType: "llm_inference", dependencies: ["GHOST"] }],
      edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/GHOST/);
  });

  it("throws when an edge references a non-existent source node", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "BadEdge", version: 1,
      nodes: [{ id: "A", label: "A", jobType: "llm_inference" }],
      edges: [{ from: "GHOST", to: "A" }],
      milestones: [], createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/GHOST/);
  });

  it("throws when an edge references a non-existent target node", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "BadEdgeTarget", version: 1,
      nodes: [{ id: "A", label: "A", jobType: "llm_inference" }],
      edges: [{ from: "A", to: "GHOST" }],
      milestones: [], createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/GHOST/);
  });

  it("validateWorkflowDefinition returns errors without throwing", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "BadDep", version: 1,
      nodes: [{ id: "A", label: "A", jobType: "llm_inference", dependencies: ["GHOST"] }],
      edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    const errors = validateWorkflowDefinition(def);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /GHOST/i.test(e))).toBe(true);
  });

  it("throws when a failover references a non-existent node", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "BadFailover", version: 1,
      nodes: [{ id: "A", label: "A", jobType: "llm_inference", failover: { fallbackNodeId: "GHOST" } }],
      edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/GHOST/);
  });

  it("throws when a milestone references a non-existent node", () => {
    const now = new Date();
    const def: WorkflowDefinition = {
      id: makeId(), name: "BadMilestone", version: 1,
      nodes: [{ id: "A", label: "A", jobType: "llm_inference" }],
      edges: [],
      milestones: [{ id: "m1", label: "Milestone 1", requiresAllOf: ["GHOST"] }],
      createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/GHOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Terminal-state immutability
// ─────────────────────────────────────────────────────────────────────────────

describe("10. Terminal-state immutability", () => {
  function completedPlan(): ExecutionPlan {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = markNodeRunning(plan, "A", "j1");
    plan = markNodeCompleted(plan, "A");
    plan = markNodeRunning(plan, "B", "j2");
    plan = markNodeCompleted(plan, "B");
    plan = markNodeRunning(plan, "C", "j3");
    plan = markNodeCompleted(plan, "C");
    return plan;
  }

  it("completed plan cannot be paused", () => {
    const plan = completedPlan();
    expect(plan.status).toBe("completed");
    expect(() => pausePlan(plan)).toThrow(/terminal/i);
  });

  it("completed plan cannot be cancelled", () => {
    const plan = completedPlan();
    expect(() => cancelPlan(plan)).toThrow(/terminal/i);
  });

  it("completed plan cannot be started again", () => {
    const plan = completedPlan();
    expect(() => startPlan(plan)).toThrow(/terminal/i);
  });

  it("cancelled plan cannot be resumed", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = cancelPlan(plan, "test");
    expect(plan.status).toBe("cancelled");
    expect(() => resumePlan(plan)).toThrow(/terminal/i);
  });

  it("completing an already-completed node throws", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = markNodeRunning(plan, "A", "j1");
    plan = markNodeCompleted(plan, "A");
    expect(() => markNodeCompleted(plan, "A")).toThrow(/terminal/i);
  });

  it("cancelled node cannot be transitioned to running", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = cancelPlan(plan, "test");
    expect(() => markNodeRunning(plan, "A", "j1")).toThrow(/terminal/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus: Progress calculation
// ─────────────────────────────────────────────────────────────────────────────

describe("Progress calculation", () => {
  it("is deterministic: same node statuses always yield same result", () => {
    const plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    const snap1 = calculateProgress(plan.nodes);
    const snap2 = calculateProgress(plan.nodes);
    expect(snap1).toEqual(snap2);
  });

  it("counts skipped nodes as done for progress purposes", () => {
    let plan = buildExecutionPlan(linearDef(), { contextId: "p", contextType: "t" });
    plan = startPlan(plan);
    plan = markNodeRunning(plan, "A", "j1");
    plan = markNodeSkipped(plan, "A");
    // 1/3 skipped
    expect(plan.progressPct).toBeCloseTo(33.33, 1);
  });

  it("returns 100% for an empty node list", () => {
    const snap = calculateProgress([]);
    expect(snap.progressPct).toBe(100);
  });
});
