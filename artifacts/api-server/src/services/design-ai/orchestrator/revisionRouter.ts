/**
 * Revision Router
 *
 * Deterministic: decides which agent should handle the revision
 * based on issue codes and priority order.
 *
 * The AI's recommendedAgent field is NOT used as source of truth.
 * ISSUE_CODE_TO_AGENT mapping is authoritative.
 */

import type { BlockingIssue, RevisionDecision, RevisionTarget } from "../types/qa.types.js";
import type { ArtDirectorQaReport } from "../types/qa.types.js";
import { ISSUE_CODE_TO_AGENT, REVISION_PRIORITY_ORDER } from "./revisionRules.js";

export function routeRevision(qaReport: ArtDirectorQaReport): RevisionDecision {
  const issues = qaReport.blockingIssues;

  if (issues.length === 0) {
    return {
      required: false,
      issueCodes: [],
      reason: "No blocking issues — no revision required.",
      affectedNodeIds: [],
      priority: "minor",
    };
  }

  // ── Map each issue to its canonical target agent ──────────────────────────
  const mappedIssues = issues.map(issue => ({
    issue,
    target: resolveTarget(issue),
  }));

  // ── Select highest-priority target ────────────────────────────────────────
  let selectedTarget: RevisionTarget | undefined;
  let selectedPriorityIdx = Infinity;

  for (const { target } of mappedIssues) {
    if (!target) continue;
    const idx = REVISION_PRIORITY_ORDER.indexOf(target);
    if (idx !== -1 && idx < selectedPriorityIdx) {
      selectedPriorityIdx = idx;
      selectedTarget = target;
    }
  }

  // Unknown issue codes — send to human review (safe fallback)
  if (!selectedTarget) {
    const unknownCodes = mappedIssues.filter(m => !m.target).map(m => m.issue.code);
    return {
      required: true,
      targetAgent: undefined,
      issueCodes: unknownCodes,
      reason: `Unknown issue code(s) with no deterministic routing: ${unknownCodes.join(", ")}. Human review required.`,
      affectedNodeIds: issues.flatMap(i => i.affectedNodeIds),
      priority: "blocking",
    };
  }

  // ── Collect all issues that belong to the selected target ─────────────────
  const targetIssues = mappedIssues.filter(m => m.target === selectedTarget);
  const allIssueCodes = issues.map(i => i.code);
  const affectedNodeIds = [...new Set(issues.flatMap(i => i.affectedNodeIds))];

  // ── Determine overall severity ────────────────────────────────────────────
  const hasBlocking = issues.some(i => i.severity === "blocking");
  const hasMajor = issues.some(i => i.severity === "major");
  const priority = hasBlocking ? "blocking" : hasMajor ? "major" : "minor";

  const reason =
    `Revision required: ${targetIssues.length} issue(s) for ${selectedTarget}` +
    (issues.length > targetIssues.length
      ? ` (+${issues.length - targetIssues.length} lower-priority issue(s))`
      : "") +
    `. Codes: ${allIssueCodes.join(", ")}`;

  return {
    required: true,
    targetAgent: selectedTarget,
    issueCodes: allIssueCodes,
    reason,
    affectedNodeIds,
    priority,
  };
}

function resolveTarget(issue: BlockingIssue): RevisionTarget | undefined {
  // Authoritative mapping takes precedence over AI recommendation
  const fromCode = ISSUE_CODE_TO_AGENT[issue.code];
  if (fromCode) return fromCode;

  // Fallback: use AI's recommendedAgent if code is not in registry
  return issue.recommendedAgent;
}
