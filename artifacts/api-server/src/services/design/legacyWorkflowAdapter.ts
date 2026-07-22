/**
 * legacyWorkflowAdapter.ts — Team 38: Design Migration
 *
 * Maps creative_project_steps rows + creative_projects.status
 * to CanonicalDesignWorkflow.
 *
 * Invariants:
 *  - Raw status strings are always preserved in rawStatus / unmappableStatuses.
 *  - Step IDs (legacyStepId) are preserved verbatim.
 *  - Timestamps are preserved verbatim (never synthesized).
 *  - Unmappable step statuses are captured, not silently dropped.
 */

import type { CreativeProject, CreativeProjectStep } from "@workspace/db";
import type {
  CanonicalDesignWorkflow,
  CanonicalWorkflowStatus,
  CanonicalWorkflowStep,
} from "./designMigrationTypes.js";

// ── Status mapping tables ────────────────────────────────────────────────────

/**
 * Maps every known project status string to a canonical workflow status.
 * Legacy values: pending | running | completed | failed
 * Commercial flow adds many more — all resolve to one of the 6 canonical values.
 */
const PROJECT_STATUS_MAP: Record<string, CanonicalWorkflowStatus> = {
  // Legacy
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
  // Commercial flow
  waiting_payment: "pending",
  deposit_paid: "pending",
  waiting_payment_verification: "pending",
  payment_verified: "pending",
  waiting_remaining_payment: "paused",
  remaining_paid: "pending",
  ready_to_build: "pending",
  building: "running",
  internal_review: "running",
  waiting_client_review: "paused",
  revision: "running",
  approved: "completed",
  generating_document: "running",
  generating_presentation: "running",
  cancelled: "cancelled",
};

/**
 * Maps creative_project_steps.status to CanonicalWorkflowStatus.
 * Step statuses: pending | running | completed | failed
 */
const STEP_STATUS_MAP: Record<string, CanonicalWorkflowStatus> = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapProjectStatus(raw: string): CanonicalWorkflowStatus {
  return PROJECT_STATUS_MAP[raw] ?? "pending";
}

function mapStepStatus(raw: string): CanonicalWorkflowStatus | null {
  return STEP_STATUS_MAP[raw] ?? null;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Maps a creative_projects row + its steps to a CanonicalDesignWorkflow.
 *
 * @param project  The parent project row (for status + legacy ID).
 * @param steps    All creative_project_steps for this project.
 */
export function mapLegacyWorkflow(
  project: CreativeProject,
  steps: CreativeProjectStep[],
): CanonicalDesignWorkflow {
  const unmappableStatuses: Array<{ stepId: number; rawStatus: string }> = [];
  const canonicalSteps: CanonicalWorkflowStep[] = [];

  for (const step of steps) {
    const inferredFields: string[] = [];
    const rawStepStatus = step.status ?? "pending";
    const mapped = mapStepStatus(rawStepStatus);

    if (mapped === null) {
      unmappableStatuses.push({ stepId: step.id, rawStatus: rawStepStatus });
    }

    // provider/model missing on very old steps — mark as inferred
    if (!step.provider) inferredFields.push("provider");
    if (!step.model) inferredFields.push("model");

    canonicalSteps.push({
      legacyStepId: step.id,
      stepName: step.stepName,
      agentId: step.agentId ?? null,
      provider: step.provider ?? null,
      model: step.model ?? null,
      status: mapped ?? "pending",
      latencyMs: step.latencyMs ?? null,
      tokenUsage: step.tokenUsage ?? 0,
      errorMessage: step.errorMessage ?? null,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
      inferredFields,
    });
  }

  const rawStatus = project.status ?? "pending";

  return {
    legacyProjectId: project.id,
    status: mapProjectStatus(rawStatus),
    steps: canonicalSteps,
    rawStatus,
    unmappableStatuses,
  };
}

/**
 * Returns true when the project's raw status string is fully mappable
 * to a canonical workflow status without inference.
 */
export function isProjectStatusMappable(rawStatus: string): boolean {
  return rawStatus in PROJECT_STATUS_MAP;
}
