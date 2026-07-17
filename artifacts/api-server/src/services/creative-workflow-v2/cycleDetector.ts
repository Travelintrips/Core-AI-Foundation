/**
 * cycleDetector — DFS-based cycle detection for workflow DAGs.
 *
 * Implements the standard three-colour DFS (white/grey/black).
 * Returns the cycle path (as node ids) for human-readable error messages,
 * or null if the graph is acyclic.
 *
 * O(V + E) time, O(V) space.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

export type AdjacencyMap = Map<string, string[]>;

export interface CycleDetectionResult {
  /** null = no cycle; string[] = ids forming the detected cycle (first = entry point). */
  cycle: string[] | null;
}

/**
 * Detect any cycle in a directed graph.
 *
 * @param nodes    All node ids in the graph.
 * @param adjacency  Outgoing edges map: from → [to, ...].
 *                   Every node id must be present as a key (even with an empty array).
 */
export function detectCycle(
  nodes: string[],
  adjacency: AdjacencyMap,
): CycleDetectionResult {
  const WHITE = 0; // not yet visited
  const GREY  = 1; // on the current DFS path (in stack)
  const BLACK = 2; // fully processed

  const colour = new Map<string, 0 | 1 | 2>();
  for (const n of nodes) colour.set(n, WHITE);

  // Tracks the current DFS path for cycle path reconstruction.
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    colour.set(node, GREY);
    stack.push(node);

    for (const neighbour of adjacency.get(node) ?? []) {
      const c = colour.get(neighbour);
      if (c === GREY) {
        // Found back-edge → cycle detected.
        // Extract the cycle portion from the stack.
        const cycleStart = stack.indexOf(neighbour);
        return [...stack.slice(cycleStart), neighbour];
      }
      if (c === WHITE) {
        const result = dfs(neighbour);
        if (result !== null) return result;
      }
      // BLACK → already fully processed, safe to skip.
    }

    stack.pop();
    colour.set(node, BLACK);
    return null;
  }

  for (const node of nodes) {
    if (colour.get(node) === WHITE) {
      const cycle = dfs(node);
      if (cycle !== null) return { cycle };
    }
  }

  return { cycle: null };
}

/**
 * Convenience: throws a descriptive error if the graph has a cycle.
 */
export function assertAcyclic(nodes: string[], adjacency: AdjacencyMap): void {
  const { cycle } = detectCycle(nodes, adjacency);
  if (cycle !== null) {
    throw new Error(
      `Workflow graph contains a cycle: ${cycle.join(" → ")}`,
    );
  }
}
