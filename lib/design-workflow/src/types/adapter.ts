/**
 * Legacy Adapter — Type Definitions
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Defines a read-only snapshot of a creative_project_steps row,
 * without importing from lib/db (keeps this package pure and DB-free).
 */

// ── Minimal legacy step shape ─────────────────────────────────────────────────

/**
 * Minimal interface matching the shape of a creative_project_steps row.
 * Declared here so callers can pass plain objects without importing lib/db.
 */
export interface LegacyProjectStep {
  id: number;
  projectId: number;
  agentId?: number | null;
  stepName: string;
  status: string; // "pending" | "running" | "completed" | "failed"
  tokenUsage: number;
  latencyMs?: number | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/** Read-only snapshot of a legacy step, mapped to the stage model. */
export interface LegacyStageSnapshot {
  /** Original DB row id. */
  legacyId: number;
  /** Project this step belongs to. */
  projectId: number;
  /**
   * Mapped design-workflow stage id.
   * Derived from stepName via the stage name mapping provided at adapter
   * construction time.
   */
  stageId: string;
  /** Original stepName as stored in the database (unmodified). */
  stepName: string;
  /** Normalised status. */
  status: "pending" | "running" | "completed" | "failed";
  /** Agent id if assigned. */
  agentId?: number;
  tokenUsage: number;
  latencyMs?: number;
  errorMessage?: string;
  /** Whether the status is terminal (completed or failed). */
  isTerminal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Adapter Result ────────────────────────────────────────────────────────────

export interface LegacyAdapterResult {
  snapshots: LegacyStageSnapshot[];
  /**
   * Step names that could not be mapped to any known stage id in the workflow.
   * Callers should log or surface these for review — do NOT silently discard.
   */
  unmappedStepNames: string[];
}
