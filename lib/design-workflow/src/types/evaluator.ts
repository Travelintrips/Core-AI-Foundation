/**
 * Design Workflow Evaluator — Type Definitions
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 */

import type { ConditionExpression, StageDefinition } from "./definition.js";

// ── Project Context ───────────────────────────────────────────────────────────

/**
 * Runtime context for a design project.
 * Passed to the eligibility evaluator to determine which stages are active.
 */
export interface ProjectContext {
  /** Goal identifiers for this project (e.g. "production_ready", "concept_only"). */
  goals: string[];
  /**
   * Deliverable identifiers expected by the client
   * (e.g. "print_ready", "campaign_mockup").
   */
  deliverables: string[];
  /** Active service type code (e.g. "fashion_design", "interior_concept"). */
  serviceType: string;
  /**
   * Arbitrary key-value context for extensibility.
   * Evaluated by "context_field" condition expressions.
   */
  fields: Record<string, unknown>;
}

// ── Condition Evaluation ──────────────────────────────────────────────────────

export interface ConditionEvaluation {
  /** The condition expression that was evaluated. */
  expression: ConditionExpression;
  /** Result of the evaluation. */
  result: boolean;
  /** Human-readable explanation. */
  reason: string;
}

// ── Eligibility Result ────────────────────────────────────────────────────────

export interface EligibilityResult {
  stageId: string;
  /** Whether the stage is active for the given project context. */
  eligible: boolean;
  /** Primary reason — top-level explanation readable by non-engineers. */
  reason: string;
  /** Full evaluation trace for debugging and explainability. */
  conditionTrace: ConditionEvaluation[];
}

// ── Resolved Stage Set ────────────────────────────────────────────────────────

export interface ResolvedStageSet {
  /** Stages that are active and should be scheduled for this project. */
  active: StageDefinition[];
  /** Stages that are inactive and will be excluded from execution. */
  excluded: Array<{ stage: StageDefinition; reason: string }>;
  /** Eligibility evaluation for every stage (active + excluded). */
  eligibilityResults: EligibilityResult[];
}
