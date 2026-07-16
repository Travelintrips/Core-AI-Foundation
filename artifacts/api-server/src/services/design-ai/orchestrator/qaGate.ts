/**
 * Deterministic QA Gate
 *
 * The AI QA report is advisory only. This gate makes the final publish decision
 * using hard deterministic rules — the AI cannot override it.
 *
 * Rule priority (all must pass):
 *  1. Engineering finalValidation.passed must be true
 *  2. Engineering finalValidation.errors must be empty
 *  3. QA overallScore must be >= 90
 *  4. QA readyToPublish must be true
 *  5. QA blockingIssues must be empty
 *  6. No out-of-bounds elements (from engineering)
 *  7. No missing variable bindings (from engineering)
 *  8. No CTA covered by other elements (from engineering)
 */

import type { ArtDirectorQaReport } from "../types/qa.types.js";
import type { EngineeringPipelineOutput } from "../types/orchestrator.types.js";
import type { QaGateResult } from "../types/qa.types.js";

/** Minimum overall score to publish */
export const PUBLISH_SCORE_THRESHOLD = 90;

export function runQaGate(
  qaReport: ArtDirectorQaReport,
  engineering: EngineeringPipelineOutput,
): QaGateResult {
  const checks: QaGateResult["checks"] = [];

  // ── Check 1: Engineering validation passed ──────────────────────────────────
  checks.push({
    name: "engineering_validation_passed",
    passed: engineering.finalValidation.passed,
    detail: engineering.finalValidation.passed
      ? undefined
      : `Engineering validation failed: ${engineering.finalValidation.errors.slice(0, 3).join("; ")}`,
  });

  // ── Check 2: No engineering validation errors ───────────────────────────────
  const noEngErrors = engineering.finalValidation.errors.length === 0;
  checks.push({
    name: "no_engineering_errors",
    passed: noEngErrors,
    detail: noEngErrors
      ? undefined
      : `${engineering.finalValidation.errors.length} engineering error(s) present`,
  });

  // ── Check 3: Score threshold ────────────────────────────────────────────────
  const scoreOk = qaReport.overallScore >= PUBLISH_SCORE_THRESHOLD;
  checks.push({
    name: "score_threshold",
    passed: scoreOk,
    detail: scoreOk
      ? undefined
      : `overallScore ${qaReport.overallScore} < required ${PUBLISH_SCORE_THRESHOLD}`,
  });

  // ── Check 4: AI says ready ──────────────────────────────────────────────────
  checks.push({
    name: "ai_ready_to_publish",
    passed: qaReport.readyToPublish,
    detail: qaReport.readyToPublish
      ? undefined
      : "QA AI reported readyToPublish=false",
  });

  // ── Check 5: No blocking issues ─────────────────────────────────────────────
  const noBlocking = qaReport.blockingIssues.length === 0;
  checks.push({
    name: "no_blocking_issues",
    passed: noBlocking,
    detail: noBlocking
      ? undefined
      : `${qaReport.blockingIssues.length} blocking issue(s): ${qaReport.blockingIssues.map(i => i.code).join(", ")}`,
  });

  // ── Check 6: No out-of-bounds elements ──────────────────────────────────────
  const outOfBounds = engineering.finalValidation.outOfBoundsIds ?? [];
  const noOutOfBounds = outOfBounds.length === 0;
  checks.push({
    name: "no_out_of_bounds_elements",
    passed: noOutOfBounds,
    detail: noOutOfBounds
      ? undefined
      : `Out-of-bounds element(s): ${outOfBounds.join(", ")}`,
  });

  // ── Check 7: No missing variable bindings ───────────────────────────────────
  const missingBindings = engineering.finalValidation.missingBindings ?? [];
  const noMissingBindings = missingBindings.length === 0;
  checks.push({
    name: "no_missing_bindings",
    passed: noMissingBindings,
    detail: noMissingBindings
      ? undefined
      : `Missing variable binding(s): ${missingBindings.join(", ")}`,
  });

  // ── Check 8: CTA not covered ────────────────────────────────────────────────
  const ctaCovered = engineering.finalValidation.ctaCoveredIds ?? [];
  const noCtaCovered = ctaCovered.length === 0;
  checks.push({
    name: "cta_not_covered",
    passed: noCtaCovered,
    detail: noCtaCovered
      ? undefined
      : `CTA element(s) are obscured: ${ctaCovered.join(", ")}`,
  });

  // ── Final decision ──────────────────────────────────────────────────────────
  const publishReady = checks.every(c => c.passed);

  const failedChecks = checks.filter(c => !c.passed);
  const reason = publishReady
    ? `All ${checks.length} gate checks passed. Score: ${qaReport.overallScore}.`
    : `Publish blocked by: ${failedChecks.map(c => c.detail ?? c.name).join(" | ")}`;

  return { publishReady, reason, checks };
}
