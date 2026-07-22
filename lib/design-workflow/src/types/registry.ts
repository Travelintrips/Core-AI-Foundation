/**
 * Design Workflow Registry — Type Definitions
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 */

import type { DesignWorkflowDefinition } from "./definition.js";

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Query parameters for workflow resolution.
 * At least one of workflowId, pluginId, or serviceType should be provided.
 * Ambiguous queries (multiple matches, no tiebreaker) throw a resolution error.
 */
export interface WorkflowQuery {
  /** Exact workflow ID to resolve. Highest priority matcher. */
  workflowId?: string;
  /** Filter to workflows owned by this plugin. */
  pluginId?: string;
  /** Filter to workflows that support this service type. */
  serviceType?: string;
  /**
   * If provided, returns this exact version. If absent, returns the
   * highest registered version that matches other criteria.
   */
  version?: number;
}

// ── Resolution ────────────────────────────────────────────────────────────────

export interface WorkflowResolutionExplanation {
  workflowId: string;
  version: number;
  /** Human-readable explanation of why this workflow was selected. */
  reason: string;
  /** Criteria from the query that matched this workflow. */
  matchedCriteria: string[];
  /** Criteria that were absent from the query (not considered). */
  relaxedCriteria: string[];
}

export interface ResolvedWorkflow {
  definition: DesignWorkflowDefinition;
  explanation: WorkflowResolutionExplanation;
}

// ── Registry Entry ────────────────────────────────────────────────────────────

export interface RegistryEntry {
  definition: DesignWorkflowDefinition;
  registeredAt: Date;
  /** Plugin that registered this workflow (mirrors definition.pluginId). */
  pluginId: string;
}
