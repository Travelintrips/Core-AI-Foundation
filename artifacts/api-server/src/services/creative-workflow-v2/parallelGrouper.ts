/**
 * parallelGrouper — Kahn's algorithm for topological sort + parallel grouping.
 *
 * Partitions the DAG into "execution waves". All nodes within a wave have
 * their dependencies satisfied by waves that precede them, so they can run
 * concurrently without coordination.
 *
 * O(V + E) time.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { AdjacencyMap } from "./cycleDetector.js";

export interface ParallelGroupResult {
  /**
   * Ordered waves: groups[0] runs first, groups[1] runs after all of
   * groups[0] complete, etc. Nodes within a group run in parallel.
   */
  groups: string[][];
  /**
   * Flat topological ordering (groups.flat()). Useful for forward/backward
   * passes in critical-path calculation.
   */
  topologicalOrder: string[];
}

/**
 * Build parallel execution groups via Kahn's BFS topological sort.
 *
 * The caller MUST guarantee the graph is acyclic (call assertAcyclic first).
 * Passing a cyclic graph results in an incomplete result (not all nodes appear).
 *
 * @param nodes      All node ids.
 * @param adjacency  Outgoing edges: from → [to, ...].
 */
export function buildParallelGroups(
  nodes: string[],
  adjacency: AdjacencyMap,
): ParallelGroupResult {
  // Build in-degree map.
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n, 0);

  for (const [, targets] of adjacency) {
    for (const t of targets) {
      inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
    }
  }

  const groups: string[][] = [];
  let frontier = nodes.filter((n) => (inDegree.get(n) ?? 0) === 0);

  // Preserve definition order within each wave for determinism.
  while (frontier.length > 0) {
    groups.push([...frontier]);

    const next: string[] = [];
    for (const node of frontier) {
      for (const successor of adjacency.get(node) ?? []) {
        const newDeg = (inDegree.get(successor) ?? 0) - 1;
        inDegree.set(successor, newDeg);
        if (newDeg === 0) next.push(successor);
      }
    }
    frontier = next;
  }

  return {
    groups,
    topologicalOrder: groups.flat(),
  };
}

/**
 * Given a completed node, return the ids of successor nodes whose
 * dependencies are now fully met (ready to transition to "ready" status).
 *
 * @param completedNodeId  The node that just completed.
 * @param adjacency        Outgoing edges.
 * @param completedSet     Set of all currently-completed node ids (including completedNodeId).
 * @param reverseAdjacency Incoming edges: to → [from, ...]. Pre-compute for performance.
 */
export function resolveUnblockedSuccessors(
  completedNodeId: string,
  adjacency: AdjacencyMap,
  completedSet: Set<string>,
  reverseAdjacency: Map<string, string[]>,
): string[] {
  const unblocked: string[] = [];

  for (const successor of adjacency.get(completedNodeId) ?? []) {
    const predecessors = reverseAdjacency.get(successor) ?? [];
    const allPredsDone = predecessors.every((p) => completedSet.has(p));
    if (allPredsDone) {
      unblocked.push(successor);
    }
  }

  return unblocked;
}

/**
 * Build reverse adjacency map (to → [from, ...]) from a forward adjacency map.
 */
export function buildReverseAdjacency(
  nodes: string[],
  adjacency: AdjacencyMap,
): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const n of nodes) rev.set(n, []);

  for (const [from, targets] of adjacency) {
    for (const to of targets) {
      rev.get(to)?.push(from);
    }
  }
  return rev;
}
