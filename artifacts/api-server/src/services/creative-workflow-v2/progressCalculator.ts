/**
 * progressCalculator — Deterministic progress calculation for execution plans.
 *
 * Progress is defined as:
 *   (completedNodes + skippedNodes) / totalNodes × 100
 *
 * This is deterministic: given the same set of node statuses the result
 * is always identical, regardless of wall-clock time or execution order.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { ExecutionNode, ProgressSnapshot } from "../../types/creative-workflow-v2/index.js";

/**
 * Calculate a deterministic progress snapshot from the current node statuses.
 *
 * Rounds progressPct to 2 decimal places for stable serialisation.
 */
export function calculateProgress(nodes: ExecutionNode[]): ProgressSnapshot {
  const total = nodes.length;

  if (total === 0) {
    return {
      progressPct: 100,
      totalNodes: 0,
      completedNodes: 0,
      failedNodes: 0,
      runningNodes: 0,
      skippedNodes: 0,
      pendingNodes: 0,
      readyNodes: 0,
    };
  }

  let completed = 0;
  let failed = 0;
  let running = 0;
  let skipped = 0;
  let pending = 0;
  let ready = 0;

  for (const node of nodes) {
    switch (node.status) {
      case "completed":  completed++;  break;
      case "failed":     failed++;     break;
      case "cancelled":  failed++;     break; // cancelled counts as failed for progress
      case "running":    running++;    break;
      case "skipped":    skipped++;    break;
      case "pending":    pending++;    break;
      case "ready":      ready++;      break;
    }
  }

  // Deterministic: round to 2 decimal places.
  const raw = ((completed + skipped) / total) * 100;
  const progressPct = Math.round(raw * 100) / 100;

  return {
    progressPct,
    totalNodes: total,
    completedNodes: completed,
    failedNodes: failed,
    runningNodes: running,
    skippedNodes: skipped,
    pendingNodes: pending,
    readyNodes: ready,
  };
}

/**
 * Evaluate milestone status given current completed node ids.
 *
 * Returns true when the milestone's completion condition is satisfied.
 */
export function isMilestoneReached(
  milestone: { requiresAllOf?: string[]; requiresAnyOf?: string[] },
  completedNodeIds: Set<string>,
): boolean {
  if (milestone.requiresAllOf && milestone.requiresAllOf.length > 0) {
    return milestone.requiresAllOf.every((id) => completedNodeIds.has(id));
  }
  if (milestone.requiresAnyOf && milestone.requiresAnyOf.length > 0) {
    return milestone.requiresAnyOf.some((id) => completedNodeIds.has(id));
  }
  // No condition specified → not reachable (degenerate milestone).
  return false;
}

/**
 * Determine the overall plan status given current node statuses.
 *
 * Rules (in priority order):
 *  1. Any node is running → "running"
 *  2. All nodes are in terminal state and all completed/skipped → "completed"
 *  3. All nodes are in terminal state and any failed/cancelled → "failed"
 *  4. Otherwise → plan status unchanged (return null to signal no change)
 */
export function derivePlanStatus(
  nodes: ExecutionNode[],
): "running" | "completed" | "failed" | null {
  if (nodes.some((n) => n.status === "running")) return "running";

  const allTerminal = nodes.every((n) =>
    ["completed", "failed", "skipped", "cancelled"].includes(n.status),
  );
  if (!allTerminal) return null;

  const anyFailed = nodes.some(
    (n) => n.status === "failed" || n.status === "cancelled",
  );
  return anyFailed ? "failed" : "completed";
}
