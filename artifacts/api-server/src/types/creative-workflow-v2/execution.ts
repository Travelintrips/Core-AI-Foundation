/**
 * creative-workflow-v2 — Execution Plan Types
 *
 * An ExecutionPlan is a runtime snapshot derived from a WorkflowDefinition.
 * It tracks the live status of each node, computed topology (parallel groups,
 * critical path), pause/resume/cancel lifecycle, and deterministic progress.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { RetryStrategy } from "./workflow.js";

// ── Status Enums ──────────────────────────────────────────────────────────────

export type PlanStatus =
  | "pending"    // built but not yet started
  | "running"    // at least one node is executing
  | "paused"     // operator-requested pause; resumes from current state
  | "completed"  // all non-skipped nodes completed
  | "cancelled"  // operator-requested cancellation
  | "failed";    // one or more nodes failed beyond retry budget with no failover

export type NodeStatus =
  | "pending"    // waiting; dependencies not yet met
  | "ready"      // all dependencies met; eligible to be dispatched
  | "running"    // job claimed and executing
  | "completed"  // job finished successfully
  | "failed"     // exhausted retry budget (and failover, if any)
  | "skipped"    // bypassed via on_failure edge or failover routing
  | "cancelled"; // cancelled as part of plan-level cancel

export type MilestoneStatus = "pending" | "reached";

/** Plan statuses from which no further transitions are permitted. */
export const TERMINAL_PLAN_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "completed",
  "cancelled",
  "failed",
]);

/** Node statuses from which no further transitions are permitted. */
export const TERMINAL_NODE_STATUSES: ReadonlySet<NodeStatus> = new Set([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

// ── Retry State ───────────────────────────────────────────────────────────────

export interface RetryState {
  retryCount: number;
  maxRetry: number;
  strategy: RetryStrategy;
  /** Earliest wall-clock time the next attempt may start (exponential only). */
  nextRetryAt?: Date;
  /** Error message from the most recent failed attempt. */
  lastError?: string;
}

// ── Execution Node ────────────────────────────────────────────────────────────

export interface ExecutionNode {
  /** Matches NodeDefinition.id — stable identifier within the plan. */
  nodeId: string;
  /** Copy of NodeDefinition.id (alias for clarity in serialised payloads). */
  definitionId: string;
  label: string;
  jobType: string;
  status: NodeStatus;
  /** Queue job id once dispatched. Null until the node is running. */
  jobId?: string;
  /** Retry tracking. */
  retry: RetryState;
  /** Failover node id copied from NodeDefinition.failover.fallbackNodeId. */
  failoverNodeId?: string;
  estimatedDurationMs?: number;
  estimatedCost?: number;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  result?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ── Execution Milestone ───────────────────────────────────────────────────────

export interface ExecutionMilestone {
  id: string;
  label: string;
  requiresAllOf?: string[];
  requiresAnyOf?: string[];
  status: MilestoneStatus;
  reachedAt?: Date;
}

// ── Progress Snapshot ─────────────────────────────────────────────────────────

export interface ProgressSnapshot {
  /** 0–100, rounded to 2 decimal places. Deterministic given node statuses. */
  progressPct: number;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  runningNodes: number;
  skippedNodes: number;
  pendingNodes: number;
  readyNodes: number;
}

// ── Execution Plan ────────────────────────────────────────────────────────────

export interface ExecutionPlan {
  /** UUID v4. */
  id: string;
  workflowDefinitionId: string;
  /** Snapshot of the definition version this plan was built from. */
  workflowVersion: number;
  /** External entity driving this plan (e.g. creative_project UUID). */
  contextId: string;
  /** Discriminator for the context entity (e.g. "creative_project"). */
  contextType: string;

  status: PlanStatus;

  /** One entry per node, keyed by array position (lookup by nodeId). */
  nodes: ExecutionNode[];

  // ── Computed Topology ────────────────────────────────────────────────────

  /**
   * Execution waves: nodes within the same group may run concurrently.
   * Groups are ordered; group[i] must fully complete before group[i+1] starts.
   * Derived via Kahn's algorithm over the dependency graph.
   */
  parallelGroups: string[][];

  /**
   * Ordered node ids on the longest path through the DAG (by estimated duration).
   * Determines the minimum possible wall-clock duration for the workflow.
   */
  criticalPath: string[];

  /**
   * Full topological sort of all node ids (parallelGroups.flat()).
   * Stable across equal-duration DAGs (tie-broken by definition order).
   */
  topologicalOrder: string[];

  milestones: ExecutionMilestone[];

  // ── Lifecycle Timestamps ─────────────────────────────────────────────────

  startedAt?: Date;
  pausedAt?: Date;
  resumedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  completedAt?: Date;
  failedAt?: Date;

  // ── Progress (denormalised for fast reads) ───────────────────────────────

  progressPct: number;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  runningNodes: number;
  skippedNodes: number;
  pendingNodes: number;
  readyNodes: number;

  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Context for building a plan ───────────────────────────────────────────────

export interface BuildPlanContext {
  contextId: string;
  contextType: string;
  metadata?: Record<string, unknown>;
}

// ── Control Commands ──────────────────────────────────────────────────────────

export interface PauseCommand {
  reason?: string;
}

export interface CancelCommand {
  reason?: string;
}

export interface NodeTransitionCommand {
  nodeId: string;
  status: NodeStatus;
  jobId?: string;
  result?: Record<string, unknown>;
  errorMessage?: string;
}
