/**
 * Policy Engine — Type Definitions
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 */

// ── Stage State ───────────────────────────────────────────────────────────────

export type StageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface StageState {
  stageId: string;
  status: StageStatus;
  /** Whether the stage was declared optional in the workflow definition. */
  optional: boolean;
}

// ── Review Records ────────────────────────────────────────────────────────────

export type GateStatus = "pending" | "approved" | "rejected" | "timed_out";

export interface ReviewRecord {
  reviewGateId: string;
  approverId: string;
  decision: "approve" | "reject";
  decidedAt: Date;
}

// ── Policy Outcomes ───────────────────────────────────────────────────────────

export interface CompletionCheck {
  complete: boolean;
  /** Human-readable explanation. */
  reason: string;
  /** Stage IDs blocking completion. Empty when complete === true. */
  blockingStages: string[];
}

export interface GateCheck {
  gateId: string;
  status: GateStatus;
  reason: string;
  approvalsReceived: number;
  approvalsRequired: number;
}
