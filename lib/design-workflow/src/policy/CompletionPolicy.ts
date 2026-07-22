/**
 * Completion Policy Evaluator
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Determines whether a workflow execution has met its completion criteria.
 * PURE — no I/O, no DB, no side effects.
 */

import type { CompletionPolicySpec } from "../types/definition.js";
import type { StageState, CompletionCheck } from "../types/policy.js";

export class CompletionPolicyEvaluator {
  /**
   * Evaluate whether the current set of stage states satisfies the completion policy.
   *
   * @param stageStates  Current runtime state of all stages in the execution.
   * @param policy       The workflow's completion policy.
   * @returns            CompletionCheck with complete flag, reason, and blocking stages.
   */
  evaluate(
    stageStates: StageState[],
    policy: CompletionPolicySpec,
  ): CompletionCheck {
    switch (policy.type) {
      case "all_required":
        return this.evaluateAllRequired(stageStates);

      case "all_stages":
        return this.evaluateAllStages(stageStates);

      case "any_of":
        return this.evaluateAnyOf(stageStates, policy.stageIds);

      case "all_of":
        return this.evaluateAllOf(stageStates, policy.stageIds);

      case "milestone":
        // Milestone policy is evaluated externally (milestone tracking is handled
        // by the execution engine). We return a pending result here.
        return {
          complete: false,
          reason: `Milestone "${policy.milestoneId}" completion is tracked by the execution engine.`,
          blockingStages: [],
        };

      default: {
        const _never: never = policy;
        return {
          complete: false,
          reason: `Unknown completion policy type: ${JSON.stringify(_never)}.`,
          blockingStages: [],
        };
      }
    }
  }

  // ── Policy Implementations ────────────────────────────────────────────────

  private evaluateAllRequired(stageStates: StageState[]): CompletionCheck {
    const required = stageStates.filter((s) => !s.optional);
    const blocking = required.filter(
      (s) => s.status !== "completed" && s.status !== "skipped",
    );

    if (blocking.length === 0) {
      return {
        complete: true,
        reason: `All ${required.length} required stage(s) are completed or skipped.`,
        blockingStages: [],
      };
    }

    return {
      complete: false,
      reason: `${blocking.length} required stage(s) not yet complete.`,
      blockingStages: blocking.map((s) => s.stageId),
    };
  }

  private evaluateAllStages(stageStates: StageState[]): CompletionCheck {
    const blocking = stageStates.filter(
      (s) => s.status !== "completed" && s.status !== "skipped",
    );

    if (blocking.length === 0) {
      return {
        complete: true,
        reason: `All ${stageStates.length} stage(s) are completed or skipped.`,
        blockingStages: [],
      };
    }

    return {
      complete: false,
      reason: `${blocking.length} stage(s) not yet complete.`,
      blockingStages: blocking.map((s) => s.stageId),
    };
  }

  private evaluateAnyOf(
    stageStates: StageState[],
    stageIds: string[],
  ): CompletionCheck {
    const stateById = new Map(stageStates.map((s) => [s.stageId, s]));
    const completed = stageIds.filter(
      (id) => stateById.get(id)?.status === "completed",
    );

    if (completed.length > 0) {
      return {
        complete: true,
        reason: `At least one required stage completed: [${completed.join(", ")}].`,
        blockingStages: [],
      };
    }

    const notCompleted = stageIds.filter(
      (id) => stateById.get(id)?.status !== "completed",
    );
    return {
      complete: false,
      reason: `None of the required stages [${stageIds.join(", ")}] have completed yet.`,
      blockingStages: notCompleted,
    };
  }

  private evaluateAllOf(
    stageStates: StageState[],
    stageIds: string[],
  ): CompletionCheck {
    const stateById = new Map(stageStates.map((s) => [s.stageId, s]));
    const blocking = stageIds.filter(
      (id) => stateById.get(id)?.status !== "completed",
    );

    if (blocking.length === 0) {
      return {
        complete: true,
        reason: `All required stages [${stageIds.join(", ")}] have completed.`,
        blockingStages: [],
      };
    }

    return {
      complete: false,
      reason: `${blocking.length} of ${stageIds.length} required stages not yet complete.`,
      blockingStages: blocking,
    };
  }
}
