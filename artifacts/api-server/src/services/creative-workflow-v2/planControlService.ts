/**
 * planControlService — Pure lifecycle transitions for ExecutionPlan.
 *
 * All functions return a NEW plan object. They never mutate the input.
 * Callers are responsible for persisting the result.
 *
 * Terminal-state guard: any attempt to transition a plan that is already
 * in a terminal state (completed, cancelled, failed) throws immediately.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type {
  ExecutionPlan,
  ExecutionNode,
  NodeStatus,
  PlanStatus,
} from "../../types/creative-workflow-v2/index.js";
import {
  TERMINAL_PLAN_STATUSES,
  TERMINAL_NODE_STATUSES,
} from "../../types/creative-workflow-v2/index.js";
import { calculateProgress, isMilestoneReached, derivePlanStatus } from "./progressCalculator.js";

// ── Guard ─────────────────────────────────────────────────────────────────────

function guardNotTerminal(plan: ExecutionPlan, operation: string): void {
  if (TERMINAL_PLAN_STATUSES.has(plan.status)) {
    throw new Error(
      `Cannot ${operation} plan "${plan.id}": already in terminal state "${plan.status}".`,
    );
  }
}

function guardNotTerminalNode(node: ExecutionNode, operation: string): void {
  if (TERMINAL_NODE_STATUSES.has(node.status)) {
    throw new Error(
      `Cannot ${operation} node "${node.nodeId}": already in terminal state "${node.status}".`,
    );
  }
}

// ── Plan-level transitions ────────────────────────────────────────────────────

/**
 * Transition a pending plan to "running".
 * Marks all "ready" nodes as still ready (no change to node states here;
 * the dispatcher picks them up).
 */
export function startPlan(plan: ExecutionPlan): ExecutionPlan {
  guardNotTerminal(plan, "start");
  if (plan.status !== "pending") return plan;
  return { ...plan, status: "running", startedAt: new Date(), updatedAt: new Date() };
}

/**
 * Pause a running plan.
 *
 * - Any "running" nodes are reverted to "ready" (they will be re-dispatched on resume).
 * - Idempotent: pausing an already-paused plan is a no-op.
 */
export function pausePlan(plan: ExecutionPlan, reason?: string): ExecutionPlan {
  guardNotTerminal(plan, "pause");
  if (plan.status === "paused") return plan;

  const nodes = plan.nodes.map((n) =>
    n.status === "running" ? { ...n, status: "ready" as NodeStatus } : n,
  );
  const progress = calculateProgress(nodes);

  return {
    ...plan,
    status: "paused",
    pausedAt: new Date(),
    updatedAt: new Date(),
    nodes,
    ...progress,
    ...(reason ? { metadata: { ...plan.metadata, pauseReason: reason } } : {}),
  };
}

/**
 * Resume a paused plan.
 *
 * - Idempotent: resuming a running plan is a no-op.
 */
export function resumePlan(plan: ExecutionPlan): ExecutionPlan {
  guardNotTerminal(plan, "resume");
  if (plan.status !== "paused") return plan;
  return {
    ...plan,
    status: "running",
    resumedAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Cancel a plan.
 *
 * All non-terminal nodes are cancelled. Already-terminal nodes are untouched
 * (preserving completed work for auditing).
 */
export function cancelPlan(plan: ExecutionPlan, reason?: string): ExecutionPlan {
  guardNotTerminal(plan, "cancel");

  const nodes = plan.nodes.map((n) =>
    TERMINAL_NODE_STATUSES.has(n.status)
      ? n
      : { ...n, status: "cancelled" as NodeStatus },
  );
  const progress = calculateProgress(nodes);

  return {
    ...plan,
    status: "cancelled",
    cancelledAt: new Date(),
    cancelReason: reason,
    updatedAt: new Date(),
    nodes,
    ...progress,
  };
}

// ── Node-level transitions ────────────────────────────────────────────────────

/** Mark a node as "running" (job claimed). */
export function markNodeRunning(
  plan: ExecutionPlan,
  nodeId: string,
  jobId: string,
): ExecutionPlan {
  guardNotTerminal(plan, "mark node running in");

  const nodes = plan.nodes.map((n) => {
    if (n.nodeId !== nodeId) return n;
    guardNotTerminalNode(n, "start");
    return { ...n, status: "running" as NodeStatus, jobId, startedAt: new Date() };
  });

  return refreshPlanState(plan, nodes);
}

/** Mark a node as "completed" (job succeeded). */
export function markNodeCompleted(
  plan: ExecutionPlan,
  nodeId: string,
  result?: Record<string, unknown>,
): ExecutionPlan {
  guardNotTerminal(plan, "mark node completed in");

  const nodes = plan.nodes.map((n) => {
    if (n.nodeId !== nodeId) return n;
    guardNotTerminalNode(n, "complete");
    return {
      ...n,
      status: "completed" as NodeStatus,
      completedAt: new Date(),
      result: result ?? n.result,
    };
  });

  return refreshPlanState(plan, nodes);
}

/** Mark a node as "skipped" (bypassed via on_failure edge or failover routing). */
export function markNodeSkipped(
  plan: ExecutionPlan,
  nodeId: string,
): ExecutionPlan {
  guardNotTerminal(plan, "mark node skipped in");

  const nodes = plan.nodes.map((n) => {
    if (n.nodeId !== nodeId) return n;
    guardNotTerminalNode(n, "skip");
    return { ...n, status: "skipped" as NodeStatus, completedAt: new Date() };
  });

  return refreshPlanState(plan, nodes);
}

/** Mark a node as "ready" (dependencies met, eligible for dispatch). */
export function markNodeReady(
  plan: ExecutionPlan,
  nodeId: string,
): ExecutionPlan {
  guardNotTerminal(plan, "mark node ready in");

  const nodes = plan.nodes.map((n) => {
    if (n.nodeId !== nodeId) return n;
    if (n.status !== "pending") return n; // idempotent
    return { ...n, status: "ready" as NodeStatus };
  });

  return refreshPlanState(plan, nodes);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Recompute progress + milestones + overall plan status after a node change.
 * Returns a new plan with updated denormalised fields.
 */
function refreshPlanState(
  plan: ExecutionPlan,
  nodes: ExecutionNode[],
): ExecutionPlan {
  const progress = calculateProgress(nodes);

  const completedIds = new Set(
    nodes.filter((n) => n.status === "completed").map((n) => n.nodeId),
  );

  const milestones = plan.milestones.map((m) => {
    if (m.status === "reached") return m;
    if (isMilestoneReached(m, completedIds)) {
      return { ...m, status: "reached" as const, reachedAt: new Date() };
    }
    return m;
  });

  // Only auto-derive terminal plan states; paused/cancelled are operator-driven.
  const derivedStatus = derivePlanStatus(nodes);
  let status: PlanStatus = plan.status;
  let completedAt = plan.completedAt;
  let failedAt    = plan.failedAt;

  if (derivedStatus === "completed" && plan.status === "running") {
    status      = "completed";
    completedAt = new Date();
  } else if (derivedStatus === "failed" && plan.status === "running") {
    status    = "failed";
    failedAt  = new Date();
  }

  return {
    ...plan,
    status,
    nodes,
    milestones,
    completedAt,
    failedAt,
    updatedAt: new Date(),
    ...progress,
  };
}
