/**
 * Universal Template Matching — Orchestration Service
 *
 * Wires together ports, the scoring engine, and post-processing.
 * Entry point for route handlers and internal callers.
 *
 * PERFORMANCE: Candidate fetching uses DB-level pre-filtering via BlueprintPort:
 *   - category → narrows the candidate set before in-memory scoring
 *   - industry → reduces candidates; cross-industry templates included via port contract
 * Hard candidate cap: 50 rows (max 100). Scoring is O(N × 13 dimensions) where N ≤ 50.
 */

import { runMatching } from "./scoring.js";
import { createDefaultDeps } from "./adapters.js";
import type { MatchInput, MatchResult } from "./types.js";
import type { MatchingDeps } from "./ports.js";

// Hard cap: number of DB candidates fetched before in-memory scoring.
// This prevents full-table scans when the library grows large.
// The port contract enforces ≤ 100 at the DB layer.
const CANDIDATE_FETCH_LIMIT = 50;

export class UniversalTemplateMatcher {
  private deps: MatchingDeps;

  constructor(deps?: MatchingDeps) {
    this.deps = deps ?? createDefaultDeps();
  }

  /**
   * Run template matching for a given input.
   *
   * Steps:
   * 1. Fetch blueprint candidates from BlueprintPort using DB-level pre-filters
   *    (category + industry reduce the candidate set before scoring).
   * 2. Run deterministic scoring engine over all candidates.
   * 3. Return structured MatchResult.
   *
   * No AI calls. No side effects. Fully synchronous scoring after the DB fetch.
   */
  async match(input: MatchInput): Promise<MatchResult> {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);

    // DB-level pre-filtering — narrows candidates before in-memory scoring.
    // category: exact category match (strongest pre-filter)
    // industry: DB WHERE = OR IS NULL (includes cross-industry templates)
    // CANDIDATE_FETCH_LIMIT: hard cap to prevent full table scan
    const candidates = await this.deps.blueprints.listCandidates({
      category: input.category,
      serviceType: input.serviceType,
      industry: input.industry,
      limit: CANDIDATE_FETCH_LIMIT,
    });

    // Pure scoring — no I/O from here
    const result = runMatching(candidates, { ...input, limit });
    return result;
  }

  /**
   * Score a single blueprint by ID against a given input.
   * Useful for "why was this blueprint chosen?" explanations.
   * Returns null if the blueprint is not found or not published.
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
