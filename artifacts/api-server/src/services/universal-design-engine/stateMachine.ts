/**
 * stateMachine.ts — Explicit transition table for UniversalDesignEngine
 *
 * All valid transitions are enumerated here. Anything not in the table
 * throws InvalidTransitionError. No implicit fallthrough.
 *
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */

import type { StageStatus, ProjectStatus } from "./types.js";
import {
  TERMINAL_PROJECT_STATUSES,
  TERMINAL_STAGE_STATUSES,
} from "./types.js";
import {
  InvalidTransitionError,
  TerminalProjectError,
  DependencyNotMetError,
  MandatoryStageSkipError,
} from "./errors.js";
import type { DesignProjectSession, DesignStage } from "./types.js";

// ─── Project-level transition table ──────────────────────────────────────────

/**
 * Map of valid project transitions:
 * allowedProjectTransitions[from] = Set<to>
 */
const allowedProjectTransitions: Record<ProjectStatus, Set<ProjectStatus>> = {
  idle:        new Set(["initialized", "cancelled"]),
  initialized: new Set(["active", "cancelled"]),
  active:      new Set(["active", "completed", "failed", "cancelled"]),
  completed:   new Set(),
  failed:      new Set(["active", "cancelled"]),  // retry can reactivate
  cancelled:   new Set(),
};

export function assertProjectCanTransition(
  session: DesignProjectSession,
  to: ProjectStatus,
): void {
  if (TERMINAL_PROJECT_STATUSES.has(session.status)) {
    throw new TerminalProjectError(session.status);
  }
  if (!allowedProjectTransitions[session.status].has(to)) {
    throw new InvalidTransitionError(session.status, to);
  }
}

// ─── Stage-level transition table ─────────────────────────────────────────────

/**
 * Map of valid stage transitions:
 * allowedStageTransitions[from] = Set<to>
 */
const allowedStageTransitions: Record<StageStatus, Set<StageStatus>> = {
  pending:   new Set(["active", "skipped", "cancelled"]),
  active:    new Set(["completed", "failed", "cancelled", "pending"]), // pending = reopened
  completed: new Set(["pending"]),  // reopen creates new artifact version
  failed:    new Set(["active", "cancelled"]),  // retry
  skipped:   new Set(),
  cancelled: new Set(),
};

export function assertStageCanTransition(
  stage: DesignStage,
  to: StageStatus,
): void {
  if (TERMINAL_STAGE_STATUSES.has(stage.status) && stage.status !== "completed") {
    throw new InvalidTransitionError(stage.status, to, stage.stageKey);
  }
  if (!allowedStageTransitions[stage.status].has(to)) {
    throw new InvalidTransitionError(stage.status, to, stage.stageKey);
  }
}

// ─── Dependency guard ─────────────────────────────────────────────────────────

/**
 * Assert all declared dependencies for a stage are in "completed" state.
 * Throws DependencyNotMetError listing which keys are not completed.
 */
export function assertDependenciesMet(
  stages: DesignStage[],
  stage: DesignStage,
): void {
  if (stage.dependsOn.length === 0) return;

  const stageMap = new Map(stages.map((s) => [s.stageKey, s]));
  const unmet: string[] = [];

  for (const depKey of stage.dependsOn) {
    const dep = stageMap.get(depKey);
    if (!dep || dep.status !== "completed") {
      unmet.push(depKey);
    }
  }

  if (unmet.length > 0) {
    throw new DependencyNotMetError(stage.stageKey, unmet);
  }
}

// ─── Skip guard ───────────────────────────────────────────────────────────────

export function assertCanSkip(stage: DesignStage): void {
  if (!stage.optional) {
    throw new MandatoryStageSkipError(stage.stageKey);
  }
}

// ─── Retry guard ──────────────────────────────────────────────────────────────

export function assertCanRetry(stage: DesignStage): void {
  if (stage.status !== "failed") {
    throw new InvalidTransitionError(stage.status, "active", stage.stageKey);
  }
  if (stage.retryCount >= stage.maxRetries) {
    throw new InvalidTransitionError(
      stage.status,
      "active",
      stage.stageKey,
    );
  }
}

// ─── Derive project status ────────────────────────────────────────────────────

/**
 * Re-derive project status from stage states after any stage mutation.
 * Rules:
 *  - If any stage is "active"          → project is "active"
 *  - If any stage is "failed"          → project is "failed" (unless retry in progress)
 *  - If all required stages completed  → project is "completed"
 *  - Otherwise                         → keep current (initialized / active)
 */
export function deriveProjectStatus(
  current: ProjectStatus,
  stages: DesignStage[],
): ProjectStatus {
  // Never leave a terminal project status via derivation (only explicit commands do that)
  if (current === "cancelled") return "cancelled";

  const hasActive = stages.some((s) => s.status === "active");
  if (hasActive) return "active";

  const hasFailed = stages.some(
    (s) => s.status === "failed" && s.retryCount >= s.maxRetries,
  );
  if (hasFailed) return "failed";

  const requiredStages = stages.filter((s) => !s.optional);
  const allRequiredDone = requiredStages.every(
    (s) => s.status === "completed" || s.status === "skipped",
  );
  if (requiredStages.length > 0 && allRequiredDone) return "completed";

  return current === "idle" ? "initialized" : current;
}
