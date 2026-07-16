/**
 * Universal Template Matching — Orchestration Service
 *
 * Wires together ports, the scoring engine, and post-processing.
 * Entry point for route handlers and internal callers.
 */

import { runMatching } from "./scoring.js";
import { createDefaultDeps } from "./adapters.js";
import type { MatchInput, MatchResult } from "./types.js";
import type { MatchingDeps } from "./ports.js";

export class UniversalTemplateMatcher {
  private deps: MatchingDeps;

  constructor(deps?: MatchingDeps) {
    this.deps = deps ?? createDefaultDeps();
  }

  /**
   * Run template matching for a given input.
   *
   * Steps:
   * 1. Fetch blueprint candidates from BlueprintPort (respects category/serviceType filter).
   * 2. Run deterministic scoring engine over all candidates.
   * 3. Return structured MatchResult.
   *
   * No AI calls. No side effects. Fully synchronous scoring after the DB fetch.
   */
  async match(input: MatchInput): Promise<MatchResult> {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);

    // Fetch candidates — narrow the DB scan when possible
    const candidates = await this.deps.blueprints.listCandidates({
      category: input.category,
      serviceType: input.serviceType,
      limit: 300, // fetch generously; scoring handles the rest
    });

    // Pure scoring — no I/O from here
    const result = runMatching(candidates, { ...input, limit });
    return result;
  }

  /**
   * Score a single blueprint by ID against a given input.
   * Useful for "why was this blueprint chosen?" explanations.
   */
  async scoreSingle(blueprintId: string, input: MatchInput): Promise<MatchResult | null> {
    const blueprint = await this.deps.blueprints.getById(blueprintId);
    if (!blueprint) return null;

    const result = runMatching([blueprint], { ...input, limit: 1 });
    return result;
  }
}

// ── Default singleton (production) ────────────────────────────────────────────

let _defaultMatcher: UniversalTemplateMatcher | null = null;

export function getDefaultMatcher(): UniversalTemplateMatcher {
  if (!_defaultMatcher) {
    _defaultMatcher = new UniversalTemplateMatcher();
  }
  return _defaultMatcher;
}
