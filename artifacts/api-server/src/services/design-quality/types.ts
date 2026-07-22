/**
 * design-quality/types.ts — Team 33
 *
 * Universal Design Quality Assurance Engine — contract types.
 *
 * All types are pure data (no classes). The evaluator and registry
 * import these; nothing here depends on DB or AI providers.
 */

// ── Severity ──────────────────────────────────────────────────────────────────

/**
 * Finding severity.
 *
 *  info      — informational; does not affect pass/fail
 *  warning   — degrades score but does not block pass
 *  error     — significantly degrades score but does not block on its own
 *  blocking  — unconditionally prevents pass, regardless of overall score
 *
 * Mapping rule: NOT all warnings become failures. Only "blocking" blocks pass.
 */
export type DesignQualitySeverity = "info" | "warning" | "error" | "blocking";

// ── Category ──────────────────────────────────────────────────────────────────

export type DesignQualityCategory =
  | "schema"
  | "completeness"
  | "consistency"
  | "technical"
  | "visual"
  | "accessibility"
  | "brand"
  | "compliance"
  | "export"
  | "workflow"
  | "provenance"
  | "security";

export const ALL_CATEGORIES: readonly DesignQualityCategory[] = [
  "schema",
  "completeness",
  "consistency",
  "technical",
  "visual",
  "accessibility",
  "brand",
  "compliance",
  "export",
  "workflow",
  "provenance",
  "security",
];

// ── Rule source ───────────────────────────────────────────────────────────────

export type DesignQualityRuleSource =
  | "core"
  | "workflow"
  | "plugin"
  | "export_format"
  | "organization_policy"
  | "brand_policy";

// ── Rule ─────────────────────────────────────────────────────────────────────

/**
 * A single quality rule.
 *
 * Rules are registered in the DesignQualityRuleRegistry. Each rule must have
 * a globally unique `id` (recommended format: `<source>:<category>:<sequence>`,
 * e.g. `core:schema:001`).
 *
 * Rules are versioned, ordered deterministically, and source-attributed.
 */
export interface DesignQualityRule {
  /** Globally unique rule identifier. */
  id: string;
  /** Semantic version of this rule definition. */
  version: string;
  /** Short human-readable name. */
  name: string;
  /** Full description of what this rule checks and why. */
  description: string;
  /** Quality category this rule belongs to. */
  category: DesignQualityCategory;
  /** Default severity when this rule produces a finding. */
  severity: DesignQualitySeverity;
  /** Where this rule originates. */
  source: DesignQualityRuleSource;
  /**
   * Optional capability tag required to run this check.
   * When the evaluator context does not satisfy the requirement,
   * the check is marked "unavailable" rather than "passed".
   */
  capabilityRequirement?: string | null;
  /**
   * Artifact type slugs this rule applies to.
   * null / undefined = applies to ALL artifact types.
   */
  applicableTo?: string[] | null;
  /** Whether this rule can be auto-remediated. */
  autoFixable: boolean;
  /** Human-readable attribution (team, spec, standard). */
  sourceAttribution: string;
}

// ── Rule set ──────────────────────────────────────────────────────────────────

/**
 * A named, versioned collection of rules from a common source.
 * Used for plugin, workflow, or export-format rule contributions.
 */
export interface DesignQualityRuleSet {
  id: string;
  name: string;
  version: string;
  source: DesignQualityRuleSource;
  rules: DesignQualityRule[];
}

// ── Evidence ──────────────────────────────────────────────────────────────────

/**
 * Structured evidence attached to a finding.
 * Helps reviewers understand exactly what the rule observed.
 */
export interface DesignQualityEvidence {
  field?: string | null;
  value?: unknown;
  expected?: unknown;
  actual?: unknown;
  detail?: string | null;
}

// ── Finding ───────────────────────────────────────────────────────────────────

/**
 * A single quality problem (or information item) raised by a rule.
 *
 * AI-assisted findings must carry confidence, reason, evidence, limitation,
 * modelProvenance, and humanReviewRecommended. They MUST NOT be presented as
 * absolute facts.
 */
export interface DesignQualityFinding {
  ruleId: string;
  ruleName: string;
  category: DesignQualityCategory;
  severity: DesignQualitySeverity;
  message: string;
  evidence?: DesignQualityEvidence | null;

  // ── AI-assisted finding fields (only when aiAssisted === true) ──────────────
  aiAssisted?: boolean;
  /** Confidence in the AI finding: 0.0 – 1.0. */
  confidence?: number | null;
  /** Reason the AI model produced this finding. */
  reason?: string | null;
  /** Known limitations of this AI check. */
  limitation?: string | null;
  /** Model identifier used for this check. */
  modelProvenance?: string | null;
  /** Whether a human reviewer should verify before acting. */
  humanReviewRecommended?: boolean;
}

// ── Check status ──────────────────────────────────────────────────────────────

/**
 * Status of a single rule evaluation.
 * "unavailable" differs from "passed" — the check did not run (capability
 * missing, not applicable) rather than running and finding no issues.
 */
export type DesignQualityCheckStatus = "passed" | "finding" | "unavailable" | "error";

export interface DesignQualityCheckOutcome {
  ruleId: string;
  status: DesignQualityCheckStatus;
  /** Score contribution for this check (0-100). null when status = "unavailable". */
  score: number | null;
  finding?: DesignQualityFinding | null;
  /** Raw error message if the rule evaluator threw. */
  evaluatorError?: string | null;
}

// ── Score ─────────────────────────────────────────────────────────────────────

/**
 * Aggregate quality score.
 *
 * IMPORTANT:
 * - `hasBlockingFindings` being true means `passed` on the result is false,
 *   even if `overall` is high.
 * - `checksUnavailable` is tracked separately from `checksPassed` to avoid
 *   presenting skipped checks as passing.
 */
export interface DesignQualityScore {
  /** Weighted average of available check scores. 0-100. */
  overall: number;
  /** Per-category average scores. null = no rules ran for that category. */
  byCategory: Partial<Record<DesignQualityCategory, number | null>>;
  hasBlockingFindings: boolean;
  checksRun: number;
  checksPassed: number;
  checksUnavailable: number;
  checksWithFindings: number;
}

// ── Check request ─────────────────────────────────────────────────────────────

/**
 * Input to the quality evaluator.
 */
export interface DesignQualityCheckRequest {
  /** Type of artifact being checked (e.g. "graphic_design", "document", "image"). */
  artifactType: string;
  /** Optional artifact ID for logging / tracing. */
  artifactId?: string | null;
  /** Tenant context for policy isolation. */
  tenantId?: string | null;
  /**
   * Contextual metadata about the artifact.
   * Rules inspect specific keys; unknown keys are ignored.
   */
  context: Record<string, unknown>;
  /**
   * Restrict evaluation to these categories.
   * null / undefined = evaluate all categories.
   */
  enabledCategories?: DesignQualityCategory[] | null;
  /**
   * Additional rule sets contributed by plugins, workflows, or export formats.
   * These are merged with core rules for this evaluation only.
   */
  pluginRuleSets?: DesignQualityRuleSet[] | null;
  /** Enable AI-assisted checks. Defaults to false. */
  aiAssistEnabled?: boolean;
  /**
   * Capabilities available for this evaluation.
   * Rules whose `capabilityRequirement` is not in this set are skipped (unavailable).
   */
  availableCapabilities?: string[] | null;
}

// ── Result ────────────────────────────────────────────────────────────────────

/**
 * Full evaluation result.
 */
export interface DesignQualityResult {
  requestId: string;
  artifactType: string;
  artifactId?: string | null;
  tenantId?: string | null;
  findings: DesignQualityFinding[];
  checkOutcomes: DesignQualityCheckOutcome[];
  score: DesignQualityScore;
  /**
   * true only when ALL of:
   *   1. score.overall >= pass threshold (70)
   *   2. no blocking findings
   */
  passed: boolean;
  evaluatedAt: string;
  rulesApplied: number;
  /**
   * false when AI-assisted checks were included (non-deterministic).
   * Deterministic results are reproducible given the same input and registry.
   */
  deterministic: boolean;
}

// ── Pass threshold ────────────────────────────────────────────────────────────

/** Minimum overall score required to pass (same level as graphic-design QC). */
export const DESIGN_QUALITY_PASS_THRESHOLD = 70;

// ── Rule evaluator function ───────────────────────────────────────────────────

/**
 * A pure (or async-pure) function that inspects the request context and
 * returns a finding if the rule is violated, or null if it passes.
 *
 * Evaluators MUST NOT throw on bad input — they should return a finding
 * or null. Uncaught errors are caught by the evaluator harness and reported
 * as "error" status.
 */
export type RuleEvaluatorFn = (
  request: DesignQualityCheckRequest,
) => DesignQualityFinding | null | Promise<DesignQualityFinding | null>;

/**
 * A rule with its evaluator function bound.
 * These are registered in DesignQualityRuleRegistry.
 */
export interface BoundRule {
  rule: DesignQualityRule;
  evaluate: RuleEvaluatorFn;
}
