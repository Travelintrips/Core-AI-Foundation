/**
 * executionPlanBuilder — Builds an ExecutionPlan from a WorkflowDefinition.
 *
 * Steps:
 *   1. Merge dependency declarations + explicit edges → unified adjacency map
 *   2. Validate all node/edge/milestone references exist
 *   3. Detect cycles (throws if found)
 *   4. Topological sort → parallel execution groups (Kahn's algorithm)
 *   5. Critical-path calculation (CPM forward/backward pass)
 *   6. Build ExecutionNode list (initial statuses: ready for wave-0, pending for rest)
 *   7. Resolve milestones
 *   8. Return a fully-populated, deterministic ExecutionPlan
 *
 * This function is PURE — it has no side effects and makes no I/O calls.
 * It can be used safely in tests without any infrastructure.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { randomUUID } from "crypto";
import type {
  WorkflowDefinition,
  NodeDefinition,
} from "../../types/creative-workflow-v2/workflow.js";
import type {
  ExecutionPlan,
  ExecutionNode,
  ExecutionMilestone,
  BuildPlanContext,
} from "../../types/creative-workflow-v2/execution.js";
import type { AdjacencyMap } from "./cycleDetector.js";
import { assertAcyclic } from "./cycleDetector.js";
import { buildParallelGroups } from "./parallelGrouper.js";
import { calculateCriticalPath } from "./criticalPathCalculator.js";
import { calculateProgress } from "./progressCalculator.js";
import { buildRetryState, mergeRetryPolicy } from "./retryPolicyService.js";

// ── Adjacency builder ─────────────────────────────────────────────────────────

/**
 * Merge explicit edges + node.dependencies into a single forward adjacency map.
 * All node ids must appear as keys (even with empty arrays).
 */
function buildAdjacency(definition: WorkflowDefinition): AdjacencyMap {
  const nodeIds = new Set(definition.nodes.map((n) => n.id));
  const adj: AdjacencyMap = new Map();

  for (const n of definition.nodes) adj.set(n.id, []);

  // Explicit edges
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(`Edge references unknown source node: "${edge.from}"`);
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(`Edge references unknown target node: "${edge.to}"`);
    }
    if (edge.from === edge.to) {
      throw new Error(`Self-loop detected on node: "${edge.from}"`);
    }
    adj.get(edge.from)!.push(edge.to);
  }

  // Dependencies declared on NodeDefinition (predecessor → this node)
  for (const node of definition.nodes) {
    for (const depId of node.dependencies ?? []) {
      if (!nodeIds.has(depId)) {
        throw new Error(
          `Node "${node.id}" declares an unknown dependency: "${depId}"`,
        );
      }
      if (depId === node.id) {
        throw new Error(`Node "${node.id}" cannot depend on itself`);
      }
      // depId → node.id (dep must finish before this node)
      adj.get(depId)!.push(node.id);
    }
  }

  // Deduplicate edges (both sources may declare the same dependency)
  for (const [from, targets] of adj) {
    adj.set(from, [...new Set(targets)]);
  }

  return adj;
}

// ── Failover validation ───────────────────────────────────────────────────────

function validateFailoverReferences(
  nodes: NodeDefinition[],
  nodeIds: Set<string>,
): void {
  for (const node of nodes) {
    const fid = node.failover?.fallbackNodeId;
    if (fid && !nodeIds.has(fid)) {
      throw new Error(
        `Node "${node.id}" failover references unknown node: "${fid}"`,
      );
    }
  }
}

// ── Milestone validation ──────────────────────────────────────────────────────

function validateMilestones(
  definition: WorkflowDefinition,
  nodeIds: Set<string>,
): void {
  const milestoneIds = new Set<string>();
  for (const m of definition.milestones ?? []) {
    if (milestoneIds.has(m.id)) {
      throw new Error(`Duplicate milestone id: "${m.id}"`);
    }
    milestoneIds.add(m.id);

    if (!m.requiresAllOf?.length && !m.requiresAnyOf?.length) {
      throw new Error(
        `Milestone "${m.id}" must declare requiresAllOf or requiresAnyOf`,
      );
    }
    if (m.requiresAllOf?.length && m.requiresAnyOf?.length) {
      throw new Error(
        `Milestone "${m.id}" must not declare both requiresAllOf and requiresAnyOf`,
      );
    }
    for (const nid of [...(m.requiresAllOf ?? []), ...(m.requiresAnyOf ?? [])]) {
      if (!nodeIds.has(nid)) {
        throw new Error(
          `Milestone "${m.id}" references unknown node: "${nid}"`,
        );
      }
    }
  }
}

// ── ExecutionNode builder ─────────────────────────────────────────────────────

function buildExecutionNode(
  node: NodeDefinition,
  definition: WorkflowDefinition,
  isReady: boolean,
): ExecutionNode {
  const policy = mergeRetryPolicy(
    node.retryPolicy,
    definition.defaultRetryPolicy,
  );
  return {
    nodeId:             node.id,
    definitionId:       node.id,
    label:              node.label,
    jobType:            node.jobType,
    status:             isReady ? "ready" : "pending",
    retry:              buildRetryState(policy),
    failoverNodeId:     node.failover?.fallbackNodeId,
    estimatedDurationMs: node.estimatedDurationMs,
    estimatedCost:      node.estimatedCost,
    metadata:           node.metadata,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a deterministic ExecutionPlan from a WorkflowDefinition and context.
 *
 * @throws if the graph contains a cycle, invalid references, or bad milestones.
 */
/** Maximum nodes allowed in a single workflow — prevents O(N²) abuse. */
export const MAX_WORKFLOW_NODES = 500;

export function buildExecutionPlan(
  definition: WorkflowDefinition,
  context: BuildPlanContext,
): ExecutionPlan {
  if (definition.nodes.length === 0) {
    throw new Error("WorkflowDefinition must contain at least one node");
  }
  if (definition.nodes.length > MAX_WORKFLOW_NODES) {
    throw new Error(
      `WorkflowDefinition exceeds maximum node limit (${definition.nodes.length} > ${MAX_WORKFLOW_NODES})`,
    );
  }

  const nodeIds = new Set(definition.nodes.map((n) => n.id));

  // Validate node id uniqueness
  if (nodeIds.size !== definition.nodes.length) {
    throw new Error("WorkflowDefinition contains duplicate node ids");
  }

  // Build adjacency
  const adj = buildAdjacency(definition);

  // Validate failover / milestone references
  validateFailoverReferences(definition.nodes, nodeIds);
  validateMilestones(definition, nodeIds);

  // Cycle detection (throws on cycle)
  assertAcyclic([...nodeIds], adj);

  // Parallel groups + topological order
  const { groups, topologicalOrder } = buildParallelGroups([...nodeIds], adj);

  // Critical path
  const durationsMap = new Map(
    definition.nodes.map((n) => [n.id, { estimatedDurationMs: n.estimatedDurationMs }]),
  );
  const { criticalPath } = calculateCriticalPath(topologicalOrder, durationsMap, adj);

  // Build execution nodes
  const firstWave = new Set(groups[0] ?? []);
  const executionNodes: ExecutionNode[] = definition.nodes.map((n) =>
    buildExecutionNode(n, definition, firstWave.has(n.id)),
  );

  // Build milestones
  const milestones: ExecutionMilestone[] = (definition.milestones ?? []).map(
    (m) => ({
      id:            m.id,
      label:         m.label,
      requiresAllOf: m.requiresAllOf,
      requiresAnyOf: m.requiresAnyOf,
      status:        "pending",
    }),
  );

  // Initial progress (all pending/ready → 0%)
  const progress = calculateProgress(executionNodes);

  const now = new Date();
  return {
    id:                    randomUUID(),
    workflowDefinitionId:  definition.id,
    workflowVersion:       definition.version,
    contextId:             context.contextId,
    contextType:           context.contextType,
    status:                "pending",
    nodes:                 executionNodes,
    parallelGroups:        groups,
    criticalPath,
    topologicalOrder,
    milestones,
    ...progress,
    metadata:              context.metadata,
    createdAt:             now,
    updatedAt:             now,
  };
}

/**
 * Validate a WorkflowDefinition without building a plan.
 * Returns a list of validation errors (empty array = valid).
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): string[] {
  const errors: string[] = [];

  if (!definition.id) errors.push("id is required");
  if (!definition.name) errors.push("name is required");
  if (definition.nodes.length === 0) errors.push("at least one node is required");
  if (definition.nodes.length > MAX_WORKFLOW_NODES) {
    errors.push(`node count ${definition.nodes.length} exceeds limit of ${MAX_WORKFLOW_NODES}`);
  }

  try {
    const nodeIds = new Set(definition.nodes.map((n) => n.id));
    if (nodeIds.size !== definition.nodes.length) errors.push("duplicate node ids");

    const adj = buildAdjacency(definition);
    validateFailoverReferences(definition.nodes, nodeIds);
    validateMilestones(definition, nodeIds);
    assertAcyclic([...nodeIds], adj);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return errors;
}
