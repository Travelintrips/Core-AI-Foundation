/**
 * Design Workflow Engine — Core Type Definitions
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Defines the Universal Design Platform workflow model.
 * Intentionally separate from creative-workflow-v2 (Team 1 owned).
 *
 * Conditions use a safe structured expression — no eval, no arbitrary JS
 * from the database.
 */

// ── Condition Expression ──────────────────────────────────────────────────────

/**
 * A safe, serialisable condition expression.
 * Evaluated entirely by the ConditionalStageResolver — never via eval or
 * dynamic code execution.
 */
export type ConditionExpression =
  | { type: "always" }
  | { type: "never" }
  | {
      type: "context_field";
      field: string;
      operator: "eq" | "neq" | "in" | "not_in" | "exists" | "not_exists";
      /** The comparison value. Not required for exists/not_exists operators. */
      value?: unknown;
    }
  | {
      /** Stage is active when the project has AT LEAST ONE of the listed goals. */
      type: "goal";
      goals: string[];
    }
  | {
      /** Stage is active when the project requires AT LEAST ONE of the listed deliverables. */
      type: "deliverable";
      deliverables: string[];
    }
  | {
      /** Stage is active when the project service type is in the listed values. */
      type: "service_type";
      serviceTypes: string[];
    }
  | { type: "and"; conditions: ConditionExpression[] }
  | { type: "or"; conditions: ConditionExpression[] }
  | { type: "not"; condition: ConditionExpression };

// ── Artifact Spec ─────────────────────────────────────────────────────────────

export interface ArtifactSpec {
  /** Unique artifact type identifier (e.g. "mood_board_image", "technical_drawing"). */
  artifactType: string;
  /** Whether this artifact is mandatory for stage completion. */
  required: boolean;
  /** Human-readable description. */
  description?: string;
}

// ── Review Gate ───────────────────────────────────────────────────────────────

export interface ReviewGateRef {
  /** Whether a human review must be approved before the next stage begins. */
  required: boolean;
  /** Roles authorised to approve this gate (empty = any authenticated user). */
  approverRoles?: string[];
  /** Number of independent approvals required. Defaults to 1. */
  minimumApprovals?: number;
  /**
   * Maximum ms to wait for approval before auto-escalating.
   * 0 or absent = no timeout.
   */
  timeoutMs?: number;
}

// ── Stage Definition ──────────────────────────────────────────────────────────

export interface StageDefinition {
  /** Unique identifier within this workflow definition (stable across versions). */
  id: string;
  /** Human-readable stage label. */
  label: string;
  /** Optional description shown to users and reviewers. */
  description?: string;
  /**
   * Capability token required to execute this stage.
   * Must match a capability registered in the platform capability registry.
   * The engine will reject activation if the capability is unavailable.
   */
  requiredCapability: string;
  /**
   * Stage IDs that must reach terminal "completed" status before this stage
   * becomes eligible. Forms the inbound edges of the dependency DAG.
   */
  dependencies: string[];
  /**
   * When true this stage may be skipped without failing the workflow.
   * The completion policy determines which optional stages must still run.
   */
  optional: boolean;
  /**
   * When true this stage may be executed more than once within a single
   * workflow execution (e.g. revision cycles).
   */
  repeatable: boolean;
  /**
   * When true this stage may run concurrently with sibling stages that
   * share the same dependency set.
   */
  parallel: boolean;
  /**
   * Structured condition evaluated against the project context.
   * If absent the stage is always active (equivalent to { type: "always" }).
   * MUST NOT use eval or reference arbitrary JS.
   */
  activationCondition?: ConditionExpression;
  /**
   * Structured condition evaluated to determine whether this stage is
   * complete, in addition to worker-reported success.
   * If absent, worker success alone marks the stage complete.
   */
  completionCondition?: ConditionExpression;
  /** Review gate configuration. Absent = no review required. */
  reviewGate?: ReviewGateRef;
  /** Artifacts this stage is expected to produce. */
  artifactOutputs?: ArtifactSpec[];
  /** Estimated wall-clock duration in ms (for scheduling and UX progress display). */
  estimatedDurationMs?: number;
}

// ── Completion Policy ─────────────────────────────────────────────────────────

export type CompletionPolicySpec =
  | { type: "all_required" }               // All non-optional stages must complete
  | { type: "all_stages" }                 // Every stage (including optional) must complete
  | { type: "any_of"; stageIds: string[] } // At least one of the listed stages must complete
  | { type: "all_of"; stageIds: string[] } // All listed stages must complete
  | { type: "milestone"; milestoneId: string }; // A named milestone must be reached

// ── Fallback Behaviour ────────────────────────────────────────────────────────

export interface FallbackBehavior {
  /** Action when a required stage fails and all retries are exhausted. */
  onRequiredStageFailure: "fail_workflow" | "skip_to_next" | "pause_for_review";
  /** Action when an optional stage fails. */
  onOptionalStageFailure: "continue" | "pause_for_review";
}

// ── Migration / Versioning ────────────────────────────────────────────────────

export interface MigrationMetadata {
  /**
   * Lowest version this definition is backward-compatible with (inclusive).
   * Used by the version-mismatch handler.
   */
  compatibleFromVersion: number;
  /** Human-readable changelog entry for this version. */
  changelog?: string;
  /**
   * Stage IDs renamed from the previous version.
   * Key = old id, value = new id.
   * Used by the legacy adapter to remap step names without data loss.
   */
  renamedStages?: Record<string, string>;
  /**
   * Stage IDs removed in this version.
   * The legacy adapter maps removed steps to a synthetic "removed" snapshot.
   */
  removedStages?: string[];
}

// ── Design Workflow Definition ────────────────────────────────────────────────

export interface DesignWorkflowDefinition {
  /**
   * Globally unique, stable workflow identifier.
   * Convention: "<pluginId>.<purpose>" (e.g. "fashion.production_ready").
   */
  workflowId: string;
  /**
   * Monotonically increasing integer. Bump on any breaking change to stages,
   * dependencies, or capabilities.
   */
  version: number;
  /** Human-readable workflow name. */
  name: string;
  /** Optional description. */
  description?: string;
  /**
   * Plugin namespace that owns this workflow.
   * Examples: "fashion", "interior", "packaging", "branding".
   */
  pluginId: string;
  /**
   * Service type codes this workflow supports.
   * Registry resolver uses these to match workflows to project service types.
   * At least one entry is required.
   */
  supportedServiceTypes: string[];
  /**
   * Ordered / partially-ordered list of stage definitions.
   * Ordering in this array is informational; execution order is derived from
   * the dependency DAG.
   */
  stages: StageDefinition[];
  /**
   * Union of capability tokens required by all stages.
   * Must be populated correctly — the validator cross-checks this against
   * individual stage requiredCapability values.
   */
  requiredCapabilities: string[];
  /** Determines when the entire workflow execution is considered complete. */
  completionPolicy: CompletionPolicySpec;
  /** Behaviour when stages fail. */
  fallbackBehavior: FallbackBehavior;
  /**
   * Required when version > 1.
   * Describes backward-compatibility range and stage ID changes.
   */
  migrationMetadata?: MigrationMetadata;
  /** Searchable tags for discovery (e.g. "production", "concept", "export"). */
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}
