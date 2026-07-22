/**
 * design-quality/index.ts — Team 33
 *
 * Public API for the Universal Design Quality Assurance Engine.
 *
 * Usage:
 *   import { globalDesignQualityRegistry, designQualityEvaluator } from "./design-quality/index.js";
 *   const result = await designQualityEvaluator.evaluate(request);
 */

export * from "./types.js";
export { DesignQualityRuleRegistry } from "./registry.js";
export { DesignQualityEvaluator } from "./evaluator.js";
export { runAiQualityCheck } from "./aiAdapter.js";
export { CORE_RULES } from "./rules/core.js";

import { DesignQualityRuleRegistry } from "./registry.js";
import { DesignQualityEvaluator } from "./evaluator.js";
import { CORE_RULES } from "./rules/core.js";

// ── Global singleton registry ─────────────────────────────────────────────────

/**
 * Global registry pre-loaded with all core rules.
 *
 * Routes and external consumers should use this registry rather than creating
 * their own to avoid rule duplication. Plugin rule sets from requests are
 * handled ephemerally by the evaluator and never written to this registry.
 */
export const globalDesignQualityRegistry = new DesignQualityRuleRegistry();

for (const bound of CORE_RULES) {
  globalDesignQualityRegistry.register(bound.rule, bound.evaluate);
}

/**
 * Global evaluator backed by the global registry.
 */
export const designQualityEvaluator = new DesignQualityEvaluator(globalDesignQualityRegistry);
