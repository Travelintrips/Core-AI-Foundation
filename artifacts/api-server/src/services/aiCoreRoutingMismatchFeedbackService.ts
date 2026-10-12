import { createHash } from "node:crypto";
import { logAudit } from "./aiAuditService.js";

export type RoutingCorrectionTarget = "POLICY_ANALYZER" | "EXECUTION_ROUTER";

/**
 * Persist a minimal, non-sensitive feedback record when a deterministic routing
 * guard prevents a known misroute. A fingerprint, rather than the user text,
 * is recorded to avoid storing credentials or private instructions in audit.
 *
 * This is feedback for review/regression coverage, NOT permission to rewrite
 * a router, change agent privileges, or deploy without CI.
 */
export function recordRoutingMismatchFeedback(input: {
  message: string;
  wrongRoute: string;
  correctedRoute: RoutingCorrectionTarget;
  ruleId: string;
}): void {
  const fingerprint = createHash("sha256")
    .update(input.message.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
  void logAudit({
    module: "ai-core-routing",
    action: "ROUTING_MISMATCH_CORRECTED",
    resourceType: "routing_rule",
    resourceId: input.ruleId,
    status: "warning",
    details: {
      fingerprint,
      wrongRoute: input.wrongRoute,
      correctedRoute: input.correctedRoute,
      ruleId: input.ruleId,
      requiresRegressionTest: true,
      autoCodeChangeAuthorized: false,
      autoDeployAuthorized: false,
    },
  }).catch(() => {
    // Never block dispatch if the feedback store is unavailable.
  });
}
