/**
 * Conditional Stage Resolver
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Given a DesignWorkflowDefinition and a ProjectContext, resolves which
 * stages are active, which are excluded, and provides a full trace for
 * explainability.
 *
 * PURE — no I/O, no DB, no side effects.
 */

import type { DesignWorkflowDefinition } from "../types/definition.js";
import type { ProjectContext, ResolvedStageSet } from "../types/evaluator.js";
import { StageEligibilityEvaluator } from "./StageEligibilityEvaluator.js";

export class ConditionalStageResolver {
  private readonly evaluator = new StageEligibilityEvaluator();

  /**
   * Resolve the active and excluded stage sets for a given project context.
   *
   * Rules applied:
   * 1. Each stage's activationCondition is evaluated. Stages that fail are excluded.
   * 2. After exclusion, dependency graph integrity is checked: if an excluded stage
   *    is a dependency of an active required stage, a warning is included in the
   *    excluded set reason.
   */
  resolve(
    definition: DesignWorkflowDefinition,
    context: ProjectContext,
  ): ResolvedStageSet {
    const eligibilityResults = definition.stages.map((stage) =>
      this.evaluator.evaluate(stage, context),
    );

    const resultByStageId = new Map(
      eligibilityResults.map((r) => [r.stageId, r]),
    );

    const activeSet = new Set<string>();
    const excludedSet = new Set<string>();

    for (const result of eligibilityResults) {
      if (result.eligible) {
        activeSet.add(result.stageId);
      } else {
        excludedSet.add(result.stageId);
      }
    }

    // Build active and excluded stage lists
    const stageById = new Map(definition.stages.map((s) => [s.id, s]));

    const active = definition.stages.filter((s) => activeSet.has(s.id));
    const excluded = definition.stages
      .filter((s) => excludedSet.has(s.id))
      .map((stage) => {
        const eligibility = resultByStageId.get(stage.id)!;

        // Check if any active required stage depends on this excluded stage
        const dependents = definition.stages.filter(
          (other) =>
            activeSet.has(other.id) &&
            other.dependencies.includes(stage.id),
        );

        let reason = eligibility.reason;
        if (dependents.length > 0) {
          const requiredDependents = dependents.filter((d) => !d.optional);
          if (requiredDependents.length > 0) {
            reason +=
              ` WARNING: active required stage(s) [${requiredDependents.map((d) => `"${d.id}"`).join(", ")}] ` +
              `depend on this excluded stage — they may not be schedulable.`;
          }
        }

        return { stage, reason };
      });

    return {
      active,
      excluded,
      eligibilityResults,
    };
  }
}
