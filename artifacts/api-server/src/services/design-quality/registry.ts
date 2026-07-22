/**
 * design-quality/registry.ts — Team 33
 *
 * DesignQualityRuleRegistry
 *
 * - Maintains a globally ordered, versioned map of rules.
 * - Enforces unique rule IDs (duplicate registration throws).
 * - Supports bulk registration via DesignQualityRuleSet.
 * - Order is deterministic: rules are sorted by ID lexicographically.
 * - Filtering by artifactType and category is pure and predictable.
 */

import type {
  DesignQualityRule,
  DesignQualityRuleSet,
  DesignQualityCategory,
  BoundRule,
  RuleEvaluatorFn,
} from "./types.js";

export class DesignQualityRuleRegistry {
  /** Insertion-order map, keyed by ruleId. */
  private readonly _rules = new Map<string, BoundRule>();

  /**
   * Register a single rule with its evaluator.
   * @throws {Error} if a rule with the same ID is already registered.
   */
  register(rule: DesignQualityRule, evaluate: RuleEvaluatorFn): void {
    if (this._rules.has(rule.id)) {
      throw new Error(
        `DesignQualityRuleRegistry: duplicate rule ID "${rule.id}". ` +
          `Rules must have globally unique IDs. If you are updating a rule, increment its version and use a new ID.`,
      );
    }
    this._rules.set(rule.id, { rule, evaluate });
  }

  /**
   * Register all rules from a rule set.
   * @throws {Error} if any rule ID in the set already exists in the registry.
   */
  registerSet(ruleSet: DesignQualityRuleSet, evaluators: Map<string, RuleEvaluatorFn>): void {
    for (const rule of ruleSet.rules) {
      const evaluate = evaluators.get(rule.id);
      if (!evaluate) {
        throw new Error(
          `DesignQualityRuleRegistry: no evaluator provided for rule "${rule.id}" in set "${ruleSet.id}".`,
        );
      }
      this.register(rule, evaluate);
    }
  }

  /**
   * Get all rules applicable to the given artifact type and categories,
   * sorted deterministically by rule ID.
   *
   * A rule is applicable when:
   *   - rule.applicableTo is null/undefined (applies to all), OR
   *   - artifactType is included in rule.applicableTo
   * AND
   *   - categories is null/undefined (all categories), OR
   *   - rule.category is included in categories
   */
  getApplicableRules(
    artifactType: string,
    categories?: DesignQualityCategory[] | null,
  ): BoundRule[] {
    const result: BoundRule[] = [];
    for (const bound of this._rules.values()) {
      const { rule } = bound;
      // Applicability filter
      if (
        rule.applicableTo != null &&
        rule.applicableTo.length > 0 &&
        !rule.applicableTo.includes(artifactType)
      ) {
        continue;
      }
      // Category filter
      if (categories != null && categories.length > 0 && !categories.includes(rule.category)) {
        continue;
      }
      result.push(bound);
    }
    // Deterministic order by rule ID
    result.sort((a, b) => a.rule.id.localeCompare(b.rule.id));
    return result;
  }

  /**
   * Retrieve a rule by its ID. Returns undefined if not found.
   */
  getRule(id: string): BoundRule | undefined {
    return this._rules.get(id);
  }

  /**
   * List all registered rules, sorted by ID.
   */
  listRules(): DesignQualityRule[] {
    return Array.from(this._rules.values())
      .map((b) => b.rule)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Total rule count. */
  get size(): number {
    return this._rules.size;
  }
}
