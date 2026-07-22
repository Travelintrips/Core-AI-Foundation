/**
 * Stage Eligibility Evaluator
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Evaluates whether a single stage's activationCondition is satisfied
 * by the current project context, producing a fully-traced result.
 *
 * This module is PURE — no I/O, no DB, no side effects.
 */

import type { ConditionExpression, StageDefinition } from "../types/definition.js";
import type {
  ProjectContext,
  ConditionEvaluation,
  EligibilityResult,
} from "../types/evaluator.js";

// ── Condition Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a single ConditionExpression against a ProjectContext.
 * Returns the boolean result and a human-readable reason.
 */
function evaluateCondition(
  expr: ConditionExpression,
  ctx: ProjectContext,
): ConditionEvaluation {
  switch (expr.type) {
    case "always":
      return { expression: expr, result: true, reason: "Condition is always true." };

    case "never":
      return { expression: expr, result: false, reason: "Condition is always false." };

    case "goal": {
      const matched = expr.goals.filter((g) => ctx.goals.includes(g));
      const result = matched.length > 0;
      return {
        expression: expr,
        result,
        reason: result
          ? `Project goal(s) ${matched.map((g) => `"${g}"`).join(", ")} matched.`
          : `No project goal matched. Required one of: ${expr.goals.map((g) => `"${g}"`).join(", ")}. ` +
            `Project goals: ${ctx.goals.length > 0 ? ctx.goals.map((g) => `"${g}"`).join(", ") : "(none)"}.`,
      };
    }

    case "deliverable": {
      const matched = expr.deliverables.filter((d) => ctx.deliverables.includes(d));
      const result = matched.length > 0;
      return {
        expression: expr,
        result,
        reason: result
          ? `Deliverable(s) ${matched.map((d) => `"${d}"`).join(", ")} matched.`
          : `No deliverable matched. Required one of: ${expr.deliverables.map((d) => `"${d}"`).join(", ")}.`,
      };
    }

    case "service_type": {
      const result = expr.serviceTypes.includes(ctx.serviceType);
      return {
        expression: expr,
        result,
        reason: result
          ? `Service type "${ctx.serviceType}" is in [${expr.serviceTypes.join(", ")}].`
          : `Service type "${ctx.serviceType}" is not in [${expr.serviceTypes.join(", ")}].`,
      };
    }

    case "context_field": {
      const val = ctx.fields[expr.field];
      let result: boolean;
      let reason: string;
      switch (expr.operator) {
        case "exists":
          result = val !== undefined && val !== null;
          reason = result
            ? `Field "${expr.field}" exists (value: ${JSON.stringify(val)}).`
            : `Field "${expr.field}" does not exist or is null.`;
          break;
        case "not_exists":
          result = val === undefined || val === null;
          reason = result
            ? `Field "${expr.field}" does not exist.`
            : `Field "${expr.field}" exists (value: ${JSON.stringify(val)}).`;
          break;
        case "eq":
          result = val === expr.value;
          reason = result
            ? `Field "${expr.field}" equals ${JSON.stringify(expr.value)}.`
            : `Field "${expr.field}" is ${JSON.stringify(val)}, expected ${JSON.stringify(expr.value)}.`;
          break;
        case "neq":
          result = val !== expr.value;
          reason = result
            ? `Field "${expr.field}" (${JSON.stringify(val)}) is not equal to ${JSON.stringify(expr.value)}.`
            : `Field "${expr.field}" equals ${JSON.stringify(expr.value)} but must not.`;
          break;
        case "in":
          result = Array.isArray(expr.value) && expr.value.includes(val);
          reason = result
            ? `Field "${expr.field}" value ${JSON.stringify(val)} is in the allowed list.`
            : `Field "${expr.field}" value ${JSON.stringify(val)} is not in ${JSON.stringify(expr.value)}.`;
          break;
        case "not_in":
          result = Array.isArray(expr.value) && !expr.value.includes(val);
          reason = result
            ? `Field "${expr.field}" value ${JSON.stringify(val)} is not in the excluded list.`
            : `Field "${expr.field}" value ${JSON.stringify(val)} is in the excluded list ${JSON.stringify(expr.value)}.`;
          break;
        default: {
          // Exhaustive check
          const _never: never = expr.operator;
          result = false;
          reason = `Unknown operator "${String(_never)}".`;
        }
      }
      return { expression: expr, result, reason };
    }

    case "and": {
      const evaluations = expr.conditions.map((c) => evaluateCondition(c, ctx));
      const result = evaluations.every((e) => e.result);
      return {
        expression: expr,
        result,
        reason: result
          ? "All sub-conditions satisfied."
          : `AND condition failed: ${evaluations
              .filter((e) => !e.result)
              .map((e) => e.reason)
              .join("; ")}.`,
      };
    }

    case "or": {
      const evaluations = expr.conditions.map((c) => evaluateCondition(c, ctx));
      const result = evaluations.some((e) => e.result);
      return {
        expression: expr,
        result,
        reason: result
          ? `At least one sub-condition satisfied: ${evaluations.find((e) => e.result)?.reason ?? ""}`
          : `OR condition failed — no sub-condition matched.`,
      };
    }

    case "not": {
      const inner = evaluateCondition(expr.condition, ctx);
      return {
        expression: expr,
        result: !inner.result,
        reason: !inner.result
          ? `NOT condition satisfied (inner was false): ${inner.reason}`
          : `NOT condition failed (inner was true): ${inner.reason}`,
      };
    }

    default: {
      const _never: never = expr;
      return {
        expression: _never,
        result: false,
        reason: `Unknown condition type.`,
      };
    }
  }
}

// ── Eligibility Evaluator ─────────────────────────────────────────────────────

export class StageEligibilityEvaluator {
  /**
   * Evaluate whether a single stage is eligible (active) for the given context.
   *
   * A stage with no activationCondition is always eligible.
   */
  evaluate(stage: StageDefinition, context: ProjectContext): EligibilityResult {
    if (!stage.activationCondition) {
      return {
        stageId: stage.id,
        eligible: true,
        reason: `Stage "${stage.id}" has no activation condition — always eligible.`,
        conditionTrace: [],
      };
    }

    const evaluation = evaluateCondition(stage.activationCondition, context);
    return {
      stageId: stage.id,
      eligible: evaluation.result,
      reason: evaluation.result
        ? `Stage "${stage.id}" activation condition satisfied: ${evaluation.reason}`
        : `Stage "${stage.id}" activation condition not satisfied: ${evaluation.reason}`,
      conditionTrace: [evaluation],
    };
  }
}

// Re-export evaluateCondition for use by ConditionalStageResolver
export { evaluateCondition };
