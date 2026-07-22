/**
 * design-quality/evaluator.ts — Team 33
 *
 * DesignQualityEvaluator
 *
 * Runs all applicable rules against a DesignQualityCheckRequest and produces
 * a DesignQualityResult with scores, findings, and pass/fail determination.
 *
 * Scoring rules:
 *   - Per-check score: 100 (pass) | 85 (info) | 60 (warning) | 20 (error) | 0 (blocking)
 *   - Per-category score: average of checks that ran (unavailable checks excluded)
 *   - Overall score: average of available category scores (equal weight)
 *   - passed = overall >= DESIGN_QUALITY_PASS_THRESHOLD AND no blocking findings
 *   - deterministic = false when any AI checks were included
 *
 * Tenant isolation: plugin rules from request.pluginRuleSets are registered in
 * an ephemeral sub-registry scoped to the evaluation, never the global registry.
 */

import { randomUUID } from "crypto";
import type {
  DesignQualityCheckRequest,
  DesignQualityResult,
  DesignQualityFinding,
  DesignQualityCheckOutcome,
  DesignQualityScore,
  DesignQualityCategory,
  BoundRule,
} from "./types.js";
import { DESIGN_QUALITY_PASS_THRESHOLD, ALL_CATEGORIES } from "./types.js";
import { DesignQualityRuleRegistry } from "./registry.js";

// ── Score constants ───────────────────────────────────────────────────────────

const CHECK_SCORE: Record<string, number> = {
  blocking: 0,
  error:    20,
  warning:  60,
  info:     85,
  passed:   100,
};

// ── Evaluator ─────────────────────────────────────────────────────────────────

export class DesignQualityEvaluator {
  constructor(private readonly globalRegistry: DesignQualityRuleRegistry) {}

  /**
   * Evaluate a design artifact against all applicable rules.
   *
   * Plugin rules from request.pluginRuleSets are merged into an ephemeral
   * registry that is scoped to this evaluation only. They do not pollute the
   * global registry between evaluations (tenant isolation).
   */
  async evaluate(request: DesignQualityCheckRequest): Promise<DesignQualityResult> {
    const requestId = randomUUID();
    const evaluatedAt = new Date().toISOString();

    // ── Build evaluation registry ──────────────────────────────────────────────
    // Start with applicable global rules, then layer plugin rules on top.
    const applicableRules = this.globalRegistry.getApplicableRules(
      request.artifactType,
      request.enabledCategories ?? null,
    );

    // Plugin rules: ephemeral, tenant-scoped.
    //
    // DesignQualityRuleSet carries only metadata (no evaluator functions).
    // Metadata-only plugin rules are registered with a pass-through evaluator
    // (returns null) — they contribute to rulesApplied count and category coverage
    // without fabricating findings. In-process plugin contributions with real
    // evaluators must use DesignQualityRuleRegistry.registerSet() before calling
    // evaluate(), not request.pluginRuleSets.
    const pluginRules: BoundRule[] = [];
    if (request.pluginRuleSets && request.pluginRuleSets.length > 0) {
      for (const ruleSet of request.pluginRuleSets) {
        for (const rule of ruleSet.rules) {
          // Skip if category is filtered out
          if (
            request.enabledCategories != null &&
            !request.enabledCategories.includes(rule.category)
          ) {
            continue;
          }
          // Skip if not applicable to this artifact type
          if (
            rule.applicableTo != null &&
            rule.applicableTo.length > 0 &&
            !rule.applicableTo.includes(request.artifactType)
          ) {
            continue;
          }
          // Avoid ID collision with global rules — prefix to make safe
          const bound = this.globalRegistry.getRule(rule.id);
          const safeId = bound ? `plugin:${rule.id}` : rule.id;
          pluginRules.push({
            rule: { ...rule, id: safeId },
            // Metadata-only: pass through (null = passed)
            evaluate: () => null,
          });
        }
      }
    }

    const allRules = [...applicableRules, ...pluginRules];

    // ── Run each rule ─────────────────────────────────────────────────────────
    const outcomes: DesignQualityCheckOutcome[] = [];
    const findings: DesignQualityFinding[] = [];
    let usedAi = false;

    for (const bound of allRules) {
      const { rule, evaluate } = bound;

      // Capability check — if required capability is absent, mark unavailable
      if (rule.capabilityRequirement) {
        const caps = request.availableCapabilities ?? [];
        if (!caps.includes(rule.capabilityRequirement)) {
          outcomes.push({
            ruleId: rule.id,
            status: "unavailable",
            score: null,
            finding: null,
          });
          continue;
        }
      }

      // Run evaluator — never let a single rule crash the whole evaluation
      let finding: DesignQualityFinding | null = null;
      let evalError: string | null = null;

      try {
        finding = await Promise.resolve(evaluate(request));
        // Detect AI-assisted findings
        if (finding?.aiAssisted) usedAi = true;
      } catch (err) {
        evalError = err instanceof Error ? err.message : String(err);
      }

      if (evalError !== null) {
        outcomes.push({
          ruleId: rule.id,
          status: "error",
          score: 20,  // degraded but not blocking — rule failure ≠ artifact failure
          finding: null,
          evaluatorError: evalError,
        });
        continue;
      }

      if (finding === null) {
        // Rule passed
        outcomes.push({ ruleId: rule.id, status: "passed", score: 100, finding: null });
      } else {
        findings.push(finding);
        const score = CHECK_SCORE[finding.severity] ?? 20;
        outcomes.push({ ruleId: rule.id, status: "finding", score, finding });
      }
    }

    // ── Compute score ─────────────────────────────────────────────────────────
    const score = this._computeScore(outcomes, findings);

    // ── Determine pass ────────────────────────────────────────────────────────
    const passed = score.overall >= DESIGN_QUALITY_PASS_THRESHOLD && !score.hasBlockingFindings;

    return {
      requestId,
      artifactType: request.artifactType,
      artifactId: request.artifactId ?? null,
      tenantId: request.tenantId ?? null,
      findings,
      checkOutcomes: outcomes,
      score,
      passed,
      evaluatedAt,
      rulesApplied: allRules.length,
      deterministic: !usedAi,
    };
  }

  // ── Score computation ───────────────────────────────────────────────────────

  private _computeScore(
    outcomes: DesignQualityCheckOutcome[],
    findings: DesignQualityFinding[],
  ): DesignQualityScore {
    const hasBlockingFindings = findings.some((f) => f.severity === "blocking");

    // Group outcomes by category (via findings for finding outcomes)
    const categoryScores: Map<DesignQualityCategory, number[]> = new Map();

    for (const outcome of outcomes) {
      if (outcome.status === "unavailable") continue; // exclude from scoring

      // Determine category
      let category: DesignQualityCategory | null = null;
      if (outcome.finding) {
        category = outcome.finding.category;
      } else if (outcome.status === "passed" || outcome.status === "error") {
        // Look up the rule's category from the global registry
        const bound = this.globalRegistry.getRule(outcome.ruleId);
        if (bound) {
          category = bound.rule.category;
        }
      }

      if (!category) continue;

      const existing = categoryScores.get(category) ?? [];
      existing.push(outcome.score ?? 100);
      categoryScores.set(category, existing);
    }

    // Per-category averages
    const byCategory: Partial<Record<DesignQualityCategory, number | null>> = {};
    for (const cat of ALL_CATEGORIES) {
      const scores = categoryScores.get(cat);
      if (!scores || scores.length === 0) {
        byCategory[cat] = null; // no rules ran for this category
      } else {
        byCategory[cat] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      }
    }

    // Overall: average of available categories
    const availableCatScores = Object.values(byCategory).filter(
      (v): v is number => v !== null && v !== undefined,
    );
    const overall =
      availableCatScores.length === 0
        ? 100 // no rules ran — pristine by convention
        : Math.round(availableCatScores.reduce((a, b) => a + b, 0) / availableCatScores.length);

    const checksRun = outcomes.filter((o) => o.status !== "unavailable").length;
    const checksPassed = outcomes.filter((o) => o.status === "passed").length;
    const checksUnavailable = outcomes.filter((o) => o.status === "unavailable").length;
    const checksWithFindings = outcomes.filter((o) => o.status === "finding").length;

    return {
      overall,
      byCategory,
      hasBlockingFindings,
      checksRun,
      checksPassed,
      checksUnavailable,
      checksWithFindings,
    };
  }
}
