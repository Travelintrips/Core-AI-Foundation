/**
 * design-lifecycle/types.ts — Team 08: Design Project Lifecycle & Persistence Adapter
 *
 * Defines the DesignStage vocabulary and the persistence port interfaces that
 * the Universal Design Engine uses to interact with existing project storage.
 * These interfaces are deliberately thin so the engine has no DB coupling.
 */

// ── Stage vocabulary ──────────────────────────────────────────────────────────

/**
 * Universal Design Platform lifecycle stages.
 * These map deterministically onto creative_projects.status via lifecycleStatusMap.ts.
 */
export type DesignStage =
  | "draft"              // Project created, brief not yet started
  | "brief_in_progress"  // Brief wizard is open / incomplete
  | "ready"              // Brief complete, queued for execution
  | "active"             // Workers actively processing
  | "waiting_for_input"  // Blocked — awaiting client response
  | "generating"         // AI generation in progress
  | "in_review"          // Internal QC review
  | "revision_requested" // Client requested changes
  | "approved"           // Signed off, ready to finalise
  | "completed"          // All deliverables produced
  | "failed"             // Unrecoverable error
  | "cancelled";         // Explicitly cancelled by user or system

// ── Domain view returned by the adapter ──────────────────────────────────────

/** A design-layer view of a creative project. */
export interface DesignProjectView {
  /** creative_projects.project_id — the canonical end-to-end UUID. */
  readonly projectId: string;
  /** Resolved Universal Design stage derived from status + lifecycle_metadata. */
  readonly designStage: DesignStage;
  /** Raw creative_projects.status stored in the DB. */
  readonly rawStatus: string;
  /** Optimistic concurrency version (lifecycle_version column). */
  readonly lifecycleVersion: number;
  /** Which plugin domain spawned this project (nullable until set). */
  readonly designPluginId: string | null;
  /** Supplemental design-layer metadata blob. */
  readonly lifecycleMetadata: Record<string, unknown>;
  /** ISO timestamp */
  readonly createdAt: Date;
  /** ISO timestamp */
  readonly updatedAt: Date;
}

// ── Stage record (maps to creative_project_steps) ────────────────────────────

export interface DesignStageRecord {
  readonly id?: number;
  /** The project_id UUID (used to join via creative_projects.id). */
  readonly projectId: string;
  readonly stepName: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly input?: Record<string, unknown> | null;
  readonly output?: Record<string, unknown> | null;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly errorMessage?: string | null;
}

// ── Artifact record (maps to creative_ai_assets) ──────────────────────────────

export interface DesignArtifact {
  /** creative_ai_assets.id (undefined when not yet persisted). */
  readonly id?: number;
  readonly projectId: string; // UUID
  readonly assetType: string;
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
  readonly imageUrl?: string | null;
  readonly storagePath?: string | null;
  readonly status: "pending" | "generating" | "completed" | "failed" | "approved" | "needs_revision" | "rejected";
  readonly category?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  /**
   * Deduplication key — callers should supply a stable value derived from
   * the generation request. If an asset with the same idempotencyKey already
   * exists for this project, attachArtifact returns the existing record.
   */
  readonly idempotencyKey?: string | null;
}

// ── Lifecycle event ───────────────────────────────────────────────────────────

export interface LifecycleEventPayload {
  readonly projectId: string;
  readonly fromStage?: DesignStage | null;
  readonly toStage: DesignStage;
  readonly actor?: string | null;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown>;
}

// ── Transition options ────────────────────────────────────────────────────────

export interface TransitionOptions {
  /** Expected lifecycle_version for optimistic concurrency. Pass to guard stale updates. */
  readonly expectedVersion?: number;
  /** Actor identifier (user ID, agent name, etc.). */
  readonly actor?: string;
  /** Human-readable reason for the transition. */
  readonly reason?: string;
  /** Additional metadata to merge into lifecycle_metadata. */
  readonly metadata?: Record<string, unknown>;
  /** If true, a no-op transition (same stage) is allowed without throwing. */
  readonly allowNoop?: boolean;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class LifecycleNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Design project not found: ${projectId}`);
    this.name = "LifecycleNotFoundError";
  }
}

export class LifecycleInvalidTransitionError extends Error {
  constructor(from: DesignStage, to: DesignStage) {
    super(`Invalid lifecycle transition: ${from} → ${to}`);
    this.name = "LifecycleInvalidTransitionError";
  }
}

export class LifecycleStaleVersionError extends Error {
  constructor(projectId: string, expected: number, actual: number) {
    super(
      `Stale lifecycle version for ${projectId}: expected ${expected}, got ${actual}`,
    );
    this.name = "LifecycleStaleVersionError";
  }
}

export class LifecycleTerminalStateError extends Error {
  constructor(stage: DesignStage) {
    super(`Cannot transition out of terminal stage: ${stage}`);
    this.name = "LifecycleTerminalStateError";
  }
}
