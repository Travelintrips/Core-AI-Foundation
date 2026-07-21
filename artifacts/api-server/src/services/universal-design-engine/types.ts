/**
 * types.ts — Core domain types for UniversalDesignEngine
 *
 * All types are domain-neutral. No domain-specific fields (collar, floor plan,
 * dieline, logo lockup, etc.) are referenced here. Plugin manifests carry
 * domain knowledge; the engine only sees the shapes below.
 *
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */

// ─────────────────────────────────────────────────────────────────────────────
// Stage lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_STATUSES = [
  "pending",    // Waiting for dependencies to be met
  "active",     // Currently being worked on
  "completed",  // Successfully finished
  "failed",     // Failed — eligible for retry if policy allows
  "skipped",    // Bypassed (optional stages only)
  "cancelled",  // Project cancelled while stage was pending/active
] as const;

export type StageStatus = (typeof STAGE_STATUSES)[number];

export const TERMINAL_STAGE_STATUSES = new Set<StageStatus>([
  "completed",
  "skipped",
  "cancelled",
]);

export const ACTIVE_STAGE_STATUSES = new Set<StageStatus>(["active"]);

// ─────────────────────────────────────────────────────────────────────────────
// Project lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export const PROJECT_STATUSES = [
  "idle",        // Session opened, not yet initialized with plugin+workflow
  "initialized", // Plugin and workflow loaded, stages created, ready to begin
  "active",      // At least one stage is active
  "completed",   // All required stages completed
  "failed",      // A non-recoverable failure occurred
  "cancelled",   // Operator cancelled
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TERMINAL_PROJECT_STATUSES = new Set<ProjectStatus>([
  "completed",
  "failed",
  "cancelled",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Workflow + plugin definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single stage within a workflow definition.
 * The engine only cares about ordering, dependencies, and optionality.
 * Domain-specific schema references are opaque strings.
 */
export interface WorkflowStageDef {
  /** Stable key unique within the workflow, e.g. "moodboard", "concept" */
  stageKey: string;
  /** Human-readable name for display */
  name: string;
  /** Whether this stage can be skipped by the operator */
  optional: boolean;
  /** Stage keys that must be "completed" before this stage can activate */
  dependsOn: string[];
  /** Capability required from the execution port, e.g. "image_generation" */
  requiredCapability?: string;
  /** Opaque reference to a schema for this stage's artifact/output */
  schemaRef?: string;
  /** Opaque reference to an artifact type, e.g. "moodboard_board" */
  artifactType?: string;
  /** Max retries — defaults to 0 (no retry) */
  maxRetries?: number;
}

/**
 * A complete workflow definition loaded from the DesignWorkflowResolver.
 * Versions allow additive changes without breaking existing sessions.
 */
export interface DesignWorkflowDefinition {
  workflowId: string;
  version: string;
  stages: WorkflowStageDef[];
}

/**
 * Plugin manifest returned by DesignPluginResolver.
 * Declares which workflow ID this plugin uses and what capabilities it needs.
 */
export interface DesignPluginManifest {
  pluginId: string;
  version: string;
  displayName: string;
  workflowId: string;
  workflowVersion: string;
  /** Capability keys this plugin requires — for validation only */
  requiredCapabilities: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime stage
// ─────────────────────────────────────────────────────────────────────────────

/** An attached artifact on a stage. */
export interface DesignArtifactRef {
  artifactId: string;
  artifactType: string;
  /** Version counter — increments when a completed artifact is edited */
  version: number;
  attachedAt: Date;
  /** Was this attached to a reopened stage? */
  isRevision: boolean;
}

/** Runtime state of a single design stage. */
export interface DesignStage {
  stageKey: string;
  name: string;
  optional: boolean;
  dependsOn: string[];
  requiredCapability: string | undefined;
  schemaRef: string | undefined;
  artifactType: string | undefined;
  maxRetries: number;
  status: StageStatus;
  retryCount: number;
  artifacts: DesignArtifactRef[];
  activatedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  skipReason: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full in-memory session for a Universal Design project.
 * Persisted/restored via DesignProjectRepository.
 */
export interface DesignProjectSession {
  /** UUID — must match the caller's existing creative_projects record */
  projectId: string;
  /** Tenant that owns this project */
  tenantId: string;
  /** Plugin identifier that defines the domain */
  pluginId: string;
  workflowId: string;
  workflowVersion: string;
  status: ProjectStatus;
  stages: DesignStage[];
  /** Correlation ID propagated from RequestContext */
  correlationId: string;
  /** Set of idempotency keys already applied */
  processedIdempotencyKeys: Set<string>;
  initializedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  failureReason: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

export const DESIGN_EVENT_TYPES = [
  "design.project.initialized",
  "design.project.completed",
  "design.project.failed",
  "design.project.cancelled",
  "design.stage.activated",
  "design.stage.completed",
  "design.stage.failed",
  "design.stage.skipped",
  "design.stage.retried",
  "design.stage.reopened",
  "design.artifact.attached",
  "design.review.requested",
] as const;

export type DesignEventType = (typeof DESIGN_EVENT_TYPES)[number];

/**
 * Event envelope produced by the engine.
 *
 * Compatible with the CanonicalEvent model — eventId is deterministic,
 * payload is customer-safe (no prompts, keys, or internal traces).
 */
export interface DesignEvent {
  /** Deterministic: sha1-like hash of (projectId + eventType + stageKey + occurredAt ISO) */
  eventId: string;
  eventType: DesignEventType;
  projectId: string;
  tenantId: string;
  /** Present for stage-scoped events */
  stageKey: string | null;
  /** Present for artifact events */
  artifactId: string | null;
  correlationId: string;
  /** ID of the command that caused this event */
  causationId: string | null;
  occurredAt: Date;
  /** Customer-safe payload — no internals */
  payload: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command result
// ─────────────────────────────────────────────────────────────────────────────

export interface DesignCommandResult {
  /** The updated session after command application */
  session: DesignProjectSession;
  /** Events produced by this command (published via DesignEventPublisher) */
  events: DesignEvent[];
  /** True when the command was a no-op due to idempotency key match */
  idempotent: boolean;
}
