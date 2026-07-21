/**
 * relationship.ts — ArtifactRelationship & Artifact Dependency Graph
 *
 * TASK B: ArtifactRelationship contract
 * ──────────────────────────────────────
 * Describes directed edges between design artifacts, enabling the core engine
 * and audit layer to trace the full design lineage — e.g.:
 *
 *   Moodboard → (derived_from) → Concept
 *             → (depends_on)   → Brand Brief
 *   Concept   → (derived_from) → Sketch
 *   Sketch    → (derived_from) → Technical Drawing
 *   Technical Drawing → (presentation_of) → Production Specification
 *
 * TASK C: Artifact dependency graph utilities
 * ────────────────────────────────────────────
 * Pure functions that operate on collections of ArtifactRelationship objects.
 * No database dependency — callers fetch the edges and pass them in.
 *
 *   validateArtifactGraph()     — full graph validation (cycles + orphans)
 *   detectArtifactCycles()      — DFS cycle detection; returns cycle paths
 *   findArtifactDependencies()  — direct parents (what this artifact needs)
 *   findArtifactDependents()    — direct children (what depends on this)
 */

import { z } from "zod";

// ── RelationshipType ──────────────────────────────────────────────────────────

/**
 * Semantic type of the directed edge from parentArtifactId → childArtifactId.
 *
 * - depends_on      — child cannot exist/be generated without parent being ready.
 * - derived_from    — child was generated using parent as primary input.
 * - references      — child informally references parent (loose coupling).
 * - variation_of    — child is an alternative take on the same concept as parent.
 * - revision_of     — child supersedes parent (iterative improvement).
 * - presentation_of — child is a client-facing view of parent's technical content.
 */
export const RELATIONSHIP_TYPES = [
  "depends_on",
  "derived_from",
  "references",
  "variation_of",
  "revision_of",
  "presentation_of",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

// ── ArtifactRelationship schema ───────────────────────────────────────────────

export const ArtifactRelationshipSchema = z.object({
  /** Stable UUID for this relationship edge. */
  relationshipId: z.string().uuid(),
  /**
   * ID of the upstream (source) artifact.
   * For "depends_on": the artifact that must exist first.
   * For "derived_from": the artifact used as primary input.
   */
  parentArtifactId: z.string().uuid(),
  /**
   * ID of the downstream (target) artifact.
   */
  childArtifactId: z.string().uuid(),
  /** Semantic type of the directed edge. */
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  /** ISO-8601 timestamp when this relationship was recorded. */
  createdAt: z.string().datetime(),
  /**
   * Arbitrary relationship-level metadata.
   * Examples: { "stageId": "concept", "confidence": 0.92 }
   * Opaque to the core engine.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ArtifactRelationship = z.infer<typeof ArtifactRelationshipSchema>;

// ── Graph validation result ───────────────────────────────────────────────────

export interface ArtifactGraphValidationResult {
  /** True when the graph is a valid DAG with no self-references. */
  valid: boolean;
  /** Detected cycle paths. Each inner array is a sequence of artifactIds forming a cycle. */
  cycles: string[][];
  /**
   * Artifact IDs that appear only on one side (either all parents or all children)
   * with no corresponding peer — indicates possibly orphaned relationships.
   * NOTE: orphan detection is advisory; the validator does NOT fail on orphans alone.
   */
  orphanedArtifactIds: string[];
  /** Total number of edges in the graph. */
  edgeCount: number;
  /** Total number of unique artifact IDs referenced in the graph. */
  nodeCount: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildAdjacency(relationships: ArtifactRelationship[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!adj.has(rel.parentArtifactId)) adj.set(rel.parentArtifactId, new Set());
    if (!adj.has(rel.childArtifactId)) adj.set(rel.childArtifactId, new Set());
    adj.get(rel.parentArtifactId)!.add(rel.childArtifactId);
  }
  return adj;
}

/**
 * DFS-based cycle detection over a directed graph.
 * Returns all cycles as arrays of node IDs.
 */
function dfsDetectCycles(adj: Map<string, Set<string>>): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, 0 | 1 | 2>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const node of adj.keys()) color.set(node, WHITE);

  function dfs(node: string): void {
    color.set(node, GRAY);
    for (const neighbor of (adj.get(node) ?? [])) {
      if (color.get(neighbor) === GRAY) {
        // Reconstruct the cycle path
        const cycle: string[] = [neighbor];
        let cur: string | null | undefined = node;
        while (cur && cur !== neighbor) {
          cycle.unshift(cur);
          cur = parent.get(cur);
        }
        cycle.unshift(neighbor);
        cycles.push(cycle);
      } else if (color.get(neighbor) === WHITE) {
        parent.set(neighbor, node);
        dfs(neighbor);
      }
    }
    color.set(node, BLACK);
  }

  for (const node of adj.keys()) {
    if (color.get(node) === WHITE) {
      parent.set(node, null);
      dfs(node);
    }
  }

  return cycles;
}

// ── Public graph utilities (Task C) ──────────────────────────────────────────

/**
 * Validates an artifact dependency graph.
 *
 * Checks for:
 *   - self-referencing edges (parentArtifactId === childArtifactId)
 *   - directed cycles
 *   - orphaned artifact IDs (advisory only — does not fail validation)
 *
 * Pure function — no database access, no side effects.
 *
 * @param relationships - Array of ArtifactRelationship edges to validate.
 * @returns ArtifactGraphValidationResult
 */
export function validateArtifactGraph(
  relationships: ArtifactRelationship[],
): ArtifactGraphValidationResult {
  const allParents = new Set(relationships.map((r) => r.parentArtifactId));
  const allChildren = new Set(relationships.map((r) => r.childArtifactId));
  const allNodes = new Set([...allParents, ...allChildren]);

  const orphanedArtifactIds: string[] = [];
  for (const id of allNodes) {
    if (!allParents.has(id) || !allChildren.has(id)) {
      orphanedArtifactIds.push(id);
    }
  }

  const adj = buildAdjacency(relationships);
  // Add self-reference edges as trivial cycles
  const selfRefs = relationships
    .filter((r) => r.parentArtifactId === r.childArtifactId)
    .map((r) => [r.parentArtifactId, r.childArtifactId]);
  const detectedCycles = [...dfsDetectCycles(adj), ...selfRefs];

  return {
    valid: detectedCycles.length === 0,
    cycles: detectedCycles,
    orphanedArtifactIds,
    edgeCount: relationships.length,
    nodeCount: allNodes.size,
  };
}

/**
 * Detects cycles in an artifact dependency graph.
 *
 * Returns all cycle paths. Each path is an ordered list of artifactIds
 * starting and ending at the same node.
 *
 * Pure function — no database access, no side effects.
 *
 * @param relationships - Array of ArtifactRelationship edges.
 * @returns Array of cycle paths (each path is an array of artifactIds).
 */
export function detectArtifactCycles(relationships: ArtifactRelationship[]): string[][] {
  const adj = buildAdjacency(relationships);
  const selfRefs = relationships
    .filter((r) => r.parentArtifactId === r.childArtifactId)
    .map((r) => [r.parentArtifactId, r.childArtifactId]);
  return [...dfsDetectCycles(adj), ...selfRefs];
}

/**
 * Finds direct dependencies of an artifact (its immediate parents).
 *
 * "Dependencies" are the artifacts that `artifactId` depends on:
 * i.e. relationships where `childArtifactId === artifactId`.
 *
 * Pure function — no database access, no side effects.
 *
 * @param artifactId    - The artifact whose dependencies to find.
 * @param relationships - Full set of edges to search.
 * @param types         - Optional filter by relationship type.
 * @returns Array of parent artifact IDs.
 */
export function findArtifactDependencies(
  artifactId: string,
  relationships: ArtifactRelationship[],
  types?: RelationshipType[],
): string[] {
  return relationships
    .filter(
      (r) =>
        r.childArtifactId === artifactId &&
        (types === undefined || types.includes(r.relationshipType)),
    )
    .map((r) => r.parentArtifactId);
}

/**
 * Finds direct dependents of an artifact (its immediate children).
 *
 * "Dependents" are the artifacts that depend on `artifactId`:
 * i.e. relationships where `parentArtifactId === artifactId`.
 *
 * Pure function — no database access, no side effects.
 *
 * @param artifactId    - The artifact whose dependents to find.
 * @param relationships - Full set of edges to search.
 * @param types         - Optional filter by relationship type.
 * @returns Array of child artifact IDs.
 */
export function findArtifactDependents(
  artifactId: string,
  relationships: ArtifactRelationship[],
  types?: RelationshipType[],
): string[] {
  return relationships
    .filter(
      (r) =>
        r.parentArtifactId === artifactId &&
        (types === undefined || types.includes(r.relationshipType)),
    )
    .map((r) => r.childArtifactId);
}
