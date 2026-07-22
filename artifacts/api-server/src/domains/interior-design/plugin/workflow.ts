/**
 * Team 25 — Interior Design Domain Plugin
 * workflow.ts
 *
 * 12-step Interior Design workflow DAG.
 *
 * The DAG is expressed as a self-contained data structure — it does NOT
 * import from the core creative-workflow-v2 runner.  The runner can consume
 * this via the plugin manifest adapter (Team 39).
 *
 * Ordering rules:
 *  - brief → site_info → style_research → moodboard (linear bootstrap)
 *  - moodboard unlocks space_planning AND material_direction AND lighting_direction (fan-out)
 *  - space_planning + furniture_selection must both complete before visualization
 *  - All of the above must complete before review
 *  - review → documentation → export (linear close)
 */

// ── Types (self-contained — no core import) ───────────────────────────────────

export interface InteriorWorkflowNode {
  /** Stable step identifier — matches InteriorArtifactType.producedAtStage where applicable */
  id: InteriorWorkflowStepId;
  label: string;
  description: string;
  /** Steps that must be complete before this one can start */
  dependsOn: InteriorWorkflowStepId[];
  /** Approximate effort tier: low | medium | high */
  effort: "low" | "medium" | "high";
  /** Whether this step produces a client-facing deliverable */
  producesDeliverable: boolean;
  /**
   * Agent or team responsible — free-form string so the plugin never
   * hard-codes a specific team or provider ID.
   */
  assignedRole: string;
}

export interface InteriorWorkflowEdge {
  from: InteriorWorkflowStepId;
  to:   InteriorWorkflowStepId;
}

export interface InteriorWorkflowDefinition {
  id: string;
  name: string;
  version: string;
  domainId: string;
  nodes: InteriorWorkflowNode[];
  edges: InteriorWorkflowEdge[];
  /** Steps on the critical path (longest chain). */
  criticalPath: InteriorWorkflowStepId[];
  /** Groups of steps that can run in parallel. */
  parallelGroups: InteriorWorkflowStepId[][];
}

export const INTERIOR_WORKFLOW_STEP_IDS = [
  "brief",
  "site_info",
  "style_research",
  "moodboard",
  "space_planning",
  "material_direction",
  "lighting_direction",
  "furniture_selection",
  "visualization",
  "review",
  "documentation",
  "export",
] as const;

export type InteriorWorkflowStepId = (typeof INTERIOR_WORKFLOW_STEP_IDS)[number];

// ── Node definitions ──────────────────────────────────────────────────────────

const NODES: InteriorWorkflowNode[] = [
  {
    id: "brief",
    label: "Brief",
    description:
      "Capture client requirements: space type, dimensions, occupants, style, functional needs, budget, location, existing conditions, colour and material preferences, lighting, accessibility, and sustainability goals.",
    dependsOn: [],
    effort: "low",
    producesDeliverable: false,
    assignedRole: "client_intake",
  },
  {
    id: "site_info",
    label: "Site / Space Information",
    description:
      "Document structural data: floor plan upload, door/window positions, columns, immutable zones, and any constraints derived from a site visit or existing drawings.",
    dependsOn: ["brief"],
    effort: "medium",
    producesDeliverable: false,
    assignedRole: "design_team",
  },
  {
    id: "style_research",
    label: "Style Research",
    description:
      "Research and curate reference imagery, precedent projects, and competitor work aligned to the client's style preference. Produce a filtered style shortlist.",
    dependsOn: ["brief"],
    effort: "medium",
    producesDeliverable: false,
    assignedRole: "design_team",
  },
  {
    id: "moodboard",
    label: "Moodboard",
    description:
      "Compile the approved colour palette, texture swatches, mood words, and style references into the interior_moodboard artifact for client sign-off.",
    dependsOn: ["site_info", "style_research"],
    effort: "medium",
    producesDeliverable: true,
    assignedRole: "design_team",
  },
  {
    id: "space_planning",
    label: "Space Planning",
    description:
      "Produce a 2-D space plan showing zone layout, furniture footprints, door swing clearances, and circulation paths. Output: interior_space_plan artifact.",
    dependsOn: ["moodboard"],
    effort: "high",
    producesDeliverable: true,
    assignedRole: "design_team",
  },
  {
    id: "material_direction",
    label: "Material Direction",
    description:
      "Select and specify surface materials (flooring, walls, ceiling, textiles) aligned to the moodboard palette. Output: interior_material_board artifact.",
    dependsOn: ["moodboard"],
    effort: "medium",
    producesDeliverable: true,
    assignedRole: "design_team",
  },
  {
    id: "lighting_direction",
    label: "Lighting Direction",
    description:
      "Design the layered lighting scheme (ambient, task, accent) and produce the interior_lighting_plan artifact with fixture specs and control zones.",
    dependsOn: ["moodboard"],
    effort: "medium",
    producesDeliverable: true,
    assignedRole: "design_team",
  },
  {
    id: "furniture_selection",
    label: "Furniture Selection",
    description:
      "Curate furniture and component references by category (seating, table, storage, lighting, decor, fixture, partition). Output: interior_furniture_board artifact.",
    dependsOn: ["space_planning"],
    effort: "medium",
    producesDeliverable: true,
    assignedRole: "design_team",
  },
  {
    id: "visualization",
    label: "Visualization",
    description:
      "Produce perspective renders or illustrated views of the completed space applying all confirmed materials, lighting, and furniture. Output: interior_visualization and (optional) interior_elevation artifacts.",
    dependsOn: ["space_planning", "furniture_selection", "material_direction", "lighting_direction"],
    effort: "high",
    producesDeliverable: true,
    assignedRole: "visualization_team",
  },
  {
    id: "review",
    label: "Review",
    description:
      "Internal QC check and client review round. All deliverable artifacts are validated. Revisions feed back to the relevant upstream step.",
    dependsOn: ["visualization"],
    effort: "medium",
    producesDeliverable: false,
    assignedRole: "design_lead",
  },
  {
    id: "documentation",
    label: "Documentation",
    description:
      "Compile the interior_specification artifact: itemised finish schedule, furniture list with codes, and installation notes.",
    dependsOn: ["review"],
    effort: "medium",
    producesDeliverable: true,
    assignedRole: "design_team",
  },
  {
    id: "export",
    label: "Export",
    description:
      "Assemble all approved artifacts into the interior_presentation deck and export the final delivery package per the agreed export preset.",
    dependsOn: ["documentation"],
    effort: "low",
    producesDeliverable: true,
    assignedRole: "design_team",
  },
];

// ── Edge list (derived from dependsOn for convenience) ────────────────────────

function buildEdges(nodes: InteriorWorkflowNode[]): InteriorWorkflowEdge[] {
  const edges: InteriorWorkflowEdge[] = [];
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      edges.push({ from: dep, to: node.id });
    }
  }
  return edges;
}

// ── DAG validation ────────────────────────────────────────────────────────────

/**
 * Detects cycles in the DAG using depth-first search.
 * Returns an array of cycle descriptions, or empty array if acyclic.
 */
export function detectCycles(nodes: InteriorWorkflowNode[]): string[] {
  const adjMap = new Map<string, string[]>();
  for (const n of nodes) adjMap.set(n.id, n.dependsOn.slice());

  const visiting = new Set<string>();
  const visited  = new Set<string>();
  const cycles: string[] = [];

  function dfs(id: string, path: string[]): void {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      cycles.push(`Cycle detected: ${path.slice(cycleStart).join(" → ")} → ${id}`);
      return;
    }
    if (visited.has(id)) return;

    visiting.add(id);
    for (const dep of (adjMap.get(id) ?? [])) {
      dfs(dep, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const n of nodes) dfs(n.id, []);
  return cycles;
}

/**
 * Compute topological order via Kahn's algorithm.
 * Throws if cycles are present.
 */
export function topologicalOrder(nodes: InteriorWorkflowNode[]): InteriorWorkflowStepId[] {
  const inDegree = new Map<string, number>();
  const successors = new Map<string, string[]>();

  for (const n of nodes) {
    if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
    for (const dep of n.dependsOn) {
      inDegree.set(n.id, (inDegree.get(n.id) ?? 0) + 1);
      successors.set(dep, [...(successors.get(dep) ?? []), n.id]);
    }
  }

  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: InteriorWorkflowStepId[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur as InteriorWorkflowStepId);
    for (const succ of (successors.get(cur) ?? [])) {
      const deg = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, deg);
      if (deg === 0) queue.push(succ as InteriorWorkflowStepId);
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("[interior-plugin] Workflow DAG contains a cycle — cannot produce topological order.");
  }

  return order;
}

// ── Parallel groups ───────────────────────────────────────────────────────────

/**
 * Returns groups of steps that can execute concurrently.
 * Steps within the same group have no intra-group dependencies.
 */
export function computeParallelGroups(
  nodes: InteriorWorkflowNode[],
): InteriorWorkflowStepId[][] {
  const order = topologicalOrder(nodes);
  const levelMap = new Map<string, number>();

  // Assign level = max(level of dependencies) + 1
  for (const id of order) {
    const node = nodes.find((n) => n.id === id)!;
    const maxDepLevel = node.dependsOn.reduce(
      (m, dep) => Math.max(m, levelMap.get(dep) ?? 0),
      0,
    );
    levelMap.set(id, maxDepLevel + 1);
  }

  const groups = new Map<number, InteriorWorkflowStepId[]>();
  for (const [id, level] of levelMap) {
    const g = groups.get(level) ?? [];
    g.push(id as InteriorWorkflowStepId);
    groups.set(level, g);
  }

  return [...groups.keys()].sort((a, b) => a - b).map((k) => groups.get(k)!);
}

// ── Critical path ─────────────────────────────────────────────────────────────

/**
 * Returns the longest dependency chain (critical path) through the DAG.
 * Uses node effort as weights: low=1, medium=2, high=3.
 */
export function computeCriticalPath(
  nodes: InteriorWorkflowNode[],
): InteriorWorkflowStepId[] {
  const effortWeight: Record<InteriorWorkflowNode["effort"], number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  const order = topologicalOrder(nodes);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const dist  = new Map<string, number>();
  const prev  = new Map<string, string | null>();

  for (const id of order) {
    dist.set(id, 0);
    prev.set(id, null);
  }

  for (const id of order) {
    const node = nodeMap.get(id)!;
    const w = effortWeight[node.effort];
    for (const dep of node.dependsOn) {
      const newDist = (dist.get(dep) ?? 0) + w;
      if (newDist > (dist.get(id) ?? 0)) {
        dist.set(id, newDist);
        prev.set(id, dep);
      }
    }
  }

  // Find terminal node with highest distance
  let terminus = order[0]!;
  for (const id of order) {
    if ((dist.get(id) ?? 0) > (dist.get(terminus) ?? 0)) terminus = id;
  }

  // Trace back
  const path: InteriorWorkflowStepId[] = [];
  let cur: string | null = terminus;
  while (cur !== null) {
    path.unshift(cur as InteriorWorkflowStepId);
    cur = prev.get(cur) ?? null;
  }

  return path;
}

// ── Singleton workflow definition ─────────────────────────────────────────────

const EDGES = buildEdges(NODES);
const PARALLEL_GROUPS = computeParallelGroups(NODES);
const CRITICAL_PATH   = computeCriticalPath(NODES);

export const INTERIOR_WORKFLOW: InteriorWorkflowDefinition = {
  id: "interior-design-v1",
  name: "Interior Design Workflow",
  version: "1.0.0",
  domainId: "interior-design",
  nodes: NODES,
  edges: EDGES,
  criticalPath: CRITICAL_PATH,
  parallelGroups: PARALLEL_GROUPS,
};
