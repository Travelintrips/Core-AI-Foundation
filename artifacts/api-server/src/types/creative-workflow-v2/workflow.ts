/**
 * creative-workflow-v2 — Workflow Definition Types
 *
 * A WorkflowDefinition is a static blueprint describing the nodes (steps),
 * edges (ordering constraints), milestones, and retry policies for a
 * Creative AI execution. It is immutable once published; new versions
 * are created by incrementing `version`.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

// ── Retry / Failover ──────────────────────────────────────────────────────────

export type RetryStrategy = "immediate" | "exponential" | "manual";

export interface RetryPolicy {
  /** Maximum number of retry attempts before declaring failure. */
  maxRetry: number;
  /** How to schedule retries. "manual" means an operator must intervene. */
  strategy: RetryStrategy;
  /** Base delay in ms for exponential back-off (ignored for other strategies). */
  backoffMs?: number;
  /** Maximum back-off cap in ms. Defaults to 60 000. */
  maxBackoffMs?: number;
}

export interface FailoverPolicy {
  /**
   * NodeDefinition.id to execute when this node reaches its retry limit.
   * The failover node runs in place of the failed node; its own retry
   * policy applies independently.
   */
  fallbackNodeId: string;
  /** Propagate the original node's error as context to the fallback payload. */
  propagateError?: boolean;
}

// ── Node / Edge ───────────────────────────────────────────────────────────────

export type EdgeCondition = "always" | "on_success" | "on_failure";

export interface EdgeDefinition {
  /** Source node id. */
  from: string;
  /** Target node id — runs after `from`. */
  to: string;
  /**
   * When to traverse this edge. Defaults to "on_success".
   * "always" means traverse regardless of source outcome.
   */
  condition?: EdgeCondition;
}

export interface NodeDefinition {
  /** Unique stable identifier within this workflow. */
  id: string;
  /** Human-readable label for display / logging. */
  label: string;
  /**
   * Job type dispatched to the queue when this node executes.
   * Must match a capability registered in the worker cluster.
   */
  jobType: string;
  /**
   * Additional node ids that must complete before this node may start.
   * Equivalent to adding edges from each dependency to this node.
   * Merged with explicit `edges` during plan building.
   */
  dependencies?: string[];
  /** Estimated wall-clock duration in ms (used for critical-path calculation). */
  estimatedDurationMs?: number;
  /** Estimated compute cost in USD (informational). */
  estimatedCost?: number;
  /** Node-level retry policy; falls back to WorkflowDefinition.defaultRetryPolicy. */
  retryPolicy?: RetryPolicy;
  /** Optional failover target when all retries are exhausted. */
  failover?: FailoverPolicy;
  /** Arbitrary metadata forwarded to the job payload. */
  metadata?: Record<string, unknown>;
}

// ── Milestones ────────────────────────────────────────────────────────────────

export interface MilestoneDefinition {
  /** Unique stable identifier within this workflow. */
  id: string;
  /** Human-readable milestone label. */
  label: string;
  /**
   * ALL listed node ids must reach "completed" status for this milestone
   * to be considered reached. Mutually exclusive with `requiresAnyOf`.
   */
  requiresAllOf?: string[];
  /**
   * ANY ONE of the listed node ids reaching "completed" triggers this
   * milestone. Mutually exclusive with `requiresAllOf`.
   */
  requiresAnyOf?: string[];
}

// ── Workflow Definition ───────────────────────────────────────────────────────

export interface WorkflowDefinition {
  /** UUID v4. */
  id: string;
  /** Short human-readable name. */
  name: string;
  /**
   * Monotonically increasing integer. Bump when nodes/edges change.
   * Execution plans record the version they were built from.
   */
  version: number;
  description?: string;
  /** All nodes in this workflow. Must form a DAG (no cycles). */
  nodes: NodeDefinition[];
  /**
   * Explicit ordering edges. Dependencies declared on NodeDefinition
   * are merged with these before plan building.
   */
  edges: EdgeDefinition[];
  /** Named checkpoints within the workflow execution. */
  milestones?: MilestoneDefinition[];
  /**
   * Default retry policy applied to any node that does not declare
   * its own `retryPolicy`.
   */
  defaultRetryPolicy?: RetryPolicy;
  /** Searchable tags (e.g. "brand", "document", "image"). */
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ── Create / Update DTOs ──────────────────────────────────────────────────────

export type CreateWorkflowDefinitionInput = Omit<
  WorkflowDefinition,
  "id" | "version" | "createdAt" | "updatedAt"
>;

export type UpdateWorkflowDefinitionInput = Partial<
  Omit<WorkflowDefinition, "id" | "version" | "createdAt" | "updatedAt">
>;
