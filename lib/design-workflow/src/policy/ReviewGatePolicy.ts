/**
 * Review Gate Policy
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Determines whether a stage requires human review and evaluates
 * the current gate status against recorded review decisions.
 *
 * PURE — no I/O, no DB, no side effects.
 */

import type { StageDefinition } from "../types/definition.js";
import type { ProjectContext } from "../types/evaluator.js";
import type { ReviewRecord, GateCheck, GateStatus } from "../types/policy.js";
import { StageEligibilityEvaluator } from "../evaluator/StageEligibilityEvaluator.js";

const evaluator = new StageEligibilityEvaluator();

export class ReviewGatePolicy {
  /**
   * Determine whether a stage requires a human review gate given the
   * current project context.
   *
   * Returns false when:
   * - The stage has no reviewGate configuration.
   * - The stage's activationCondition evaluates to false (stage is inactive).
   * - The gate's required flag is false.
   */
  requiresReview(stage: StageDefinition, context: ProjectContext): boolean {
    if (!stage.reviewGate) return false;
    if (!stage.reviewGate.required) return false;

    // Only require review for stages that are active in this context
    if (stage.activationCondition) {
      const eligibility = evaluator.evaluate(stage, context);
      if (!eligibility.eligible) return false;
    }

    return true;
  }

  /**
   * Evaluate the current status of a review gate for a specific stage.
   *
   * @param stage    The stage whose gate is being checked.
   * @param reviews  All review decisions recorded for this gate/stage.
   * @param now      Current time (for timeout evaluation). Defaults to Date.now().
   */
  gateStatus(
    stage: StageDefinition,
    reviews: ReviewRecord[],
    now: Date = new Date(),
  ): GateCheck {
    const gate = stage.reviewGate;
    const gateId = stage.id;

    if (!gate) {
      return {
        gateId,
        status: "approved",
        reason: `Stage "${stage.id}" has no review gate — automatically approved.`,
        approvalsReceived: 0,
        approvalsRequired: 0,
      };
    }

    if (!gate.required) {
      return {
        gateId,
        status: "approved",
        reason: `Review gate for stage "${stage.id}" is not required.`,
        approvalsReceived: 0,
        approvalsRequired: 0,
      };
    }

    const minimumApprovals = gate.minimumApprovals ?? 1;

    // Filter reviews to those for this gate
    const gateReviews = reviews.filter((r) => r.reviewGateId === gateId);

    // Check for any rejection — one rejection blocks the gate
    const rejection = gateReviews.find((r) => r.decision === "reject");
    if (rejection) {
      return {
        gateId,
        status: "rejected",
        reason: `Gate rejected by approver "${rejection.approverId}" at ${rejection.decidedAt.toISOString()}.`,
        approvalsReceived: 0,
        approvalsRequired: minimumApprovals,
      };
    }

    // Count approvals (unique approvers)
    const approvers = new Set(
      gateReviews
        .filter((r) => r.decision === "approve")
        .map((r) => r.approverId),
    );
    const approvalsReceived = approvers.size;

    // Check timeout
    if (gate.timeoutMs && gate.timeoutMs > 0 && gateReviews.length === 0) {
      // We can't determine timeout without the stage start time, so we expose
      // it as a warning in the reason rather than auto-transitioning.
      const status: GateStatus = "pending";
      return {
        gateId,
        status,
        reason: `Gate pending — 0 of ${minimumApprovals} approval(s) received. ` +
          `Timeout configured: ${gate.timeoutMs}ms.`,
        approvalsReceived,
        approvalsRequired: minimumApprovals,
      };
    }

    if (approvalsReceived >= minimumApprovals) {
      return {
        gateId,
        status: "approved",
        reason: `Gate approved — ${approvalsReceived} of ${minimumApprovals} approval(s) received.`,
        approvalsReceived,
        approvalsRequired: minimumApprovals,
      };
    }

    return {
      gateId,
      status: "pending",
      reason: `Gate pending — ${approvalsReceived} of ${minimumApprovals} approval(s) received.`,
      approvalsReceived,
      approvalsRequired: minimumApprovals,
    };
  }
}
