/**
 * criticalPathCalculator — CPM (Critical Path Method) for execution plans.
 *
 * Performs a forward pass (Earliest Start / Finish) and backward pass
 * (Latest Start / Finish) over the DAG, then identifies nodes with zero
 * float (slack). Nodes with zero float lie on the critical path — the
 * longest path that determines the minimum possible workflow duration.
 *
 * O(V + E) time.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { AdjacencyMap } from "./cycleDetector.js";
import { buildReverseAdjacency } from "./parallelGrouper.js";

export interface NodeDuration {
  estimatedDurationMs?: number;
}

export interface CriticalPathResult {
  /**
   * Ordered node ids on the critical path (from first to last).
   * Empty if all nodes have zero estimated duration.
   */
  criticalPath: string[];
  /** Total estimated wall-clock duration in ms. */
  projectDurationMs: number;
  /** Per-node timing data (useful for Gantt chart rendering). */
  timings: Map<string, NodeTiming>;
}

export interface NodeTiming {
  /** Earliest possible start time (ms from project start). */
  earliestStart: number;
  /** Earliest possible finish time. */
  earliestFinish: number;
  /** Latest allowable start without delaying the project. */
  latestStart: number;
  /** Latest allowable finish without delaying the project. */
  latestFinish: number;
  /** Total float (slack) = latestStart − earliestStart. Zero → critical. */
  totalFloat: number;
  /** True when totalFloat === 0. */
  isCritical: boolean;
}

/**
 * Calculate the critical path of a workflow DAG.
 *
 * @param nodes            All node ids, in topological order.
 * @param durations        Estimated duration per node (ms). Missing → 0 ms.
 * @param adjacency        Outgoing edges: from → [to, ...].
 */
export function calculateCriticalPath(
  nodes: string[],
  durations: Map<string, NodeDuration>,
  adjacency: AdjacencyMap,
): CriticalPathResult {
  if (nodes.length === 0) {
    return { criticalPath: [], projectDurationMs: 0, timings: new Map() };
  }

  const getDuration = (id: string): number =>
    durations.get(id)?.estimatedDurationMs ?? 0;

  const reverseAdj = buildReverseAdjacency(nodes, adjacency);

  // ── Forward pass ──────────────────────────────────────────────────────────
  const est = new Map<string, number>(); // Earliest Start Time
  const eft = new Map<string, number>(); // Earliest Finish Time

  for (const node of nodes) {
    const predecessors = reverseAdj.get(node) ?? [];
    const es =
      predecessors.length === 0
        ? 0
        : Math.max(...predecessors.map((p) => eft.get(p) ?? 0));
    est.set(node, es);
    eft.set(node, es + getDuration(node));
  }

  const projectDurationMs = Math.max(...nodes.map((n) => eft.get(n) ?? 0));

  // ── Backward pass ─────────────────────────────────────────────────────────
  const lft = new Map<string, number>(); // Latest Finish Time
  const lst = new Map<string, number>(); // Latest Start Time

  for (const node of [...nodes].reverse()) {
    const successors = adjacency.get(node) ?? [];
    const lf =
      successors.length === 0
        ? projectDurationMs
        : Math.min(...successors.map((s) => lst.get(s) ?? projectDurationMs));
    lft.set(node, lf);
    lst.set(node, lf - getDuration(node));
  }

  // ── Float & criticality ───────────────────────────────────────────────────
  const timings = new Map<string, NodeTiming>();
  const criticalNodes: string[] = [];

  for (const node of nodes) {
    const es = est.get(node) ?? 0;
    const ef = eft.get(node) ?? 0;
    const ls = lst.get(node) ?? 0;
    const lf = lft.get(node) ?? 0;
    const totalFloat = ls - es;
    const isCritical = totalFloat === 0;

    timings.set(node, { earliestStart: es, earliestFinish: ef, latestStart: ls, latestFinish: lf, totalFloat, isCritical });
    if (isCritical) criticalNodes.push(node);
  }

  // criticalNodes is already in topological order (we iterated nodes in topo order).
  return { criticalPath: criticalNodes, projectDurationMs, timings };
}
