/**
 * Team 04 — Adaptive Question Engine (Core)
 *
 * Extends the existing deterministic question planner with:
 * 1. Schema-driven priority scoring (field ordering from DynamicBriefSchema)
 * 2. Dependency satisfaction checking (fields with dependsOn are hidden until deps met)
 * 3. Dynamic priority rule evaluation (PriorityRule boosts based on current brief state)
 * 4. Completion policy enforcement (session ends only when policy is satisfied)
 * 5. Contradiction detection
 * 6. Optional AI clarification adapter integration point
 *
 * CONTRACT:
 * - planAdaptiveQuestions() returns the same PlannedBriefQuestion[] shape as the
 *   existing planBriefQuestions() — UI compatibility is preserved.
 * - All functions are PURE and DETERMINISTIC: same inputs → same outputs.
 * - No AI provider imports. AI adapter is an optional injected dependency.
 * - Schema is optional: falls back to built-in schema when not provided.
 */

import type { BriefData } from "@/pages/brief";
import type { ServiceType } from "@/config/brief-service-config";
import type { PlannedBriefQuestion, AssistantMode } from "./types";
import {
  planBriefQuestions,
  isFieldFilled,
  type PlanInput,
} from "./question-planner";
import type { DynamicBriefSchema, BriefFieldSchema } from "./adaptive-schema";
import { getBuiltinSchema } from "./adaptive-schema";
import type { AiClarificationAdapter } from "./ai-clarification-adapter";

// ── Score constants ────────────────────────────────────────────────────────────

const SCORE = {
  REQUIRED_BONUS:       20,
  GATING_BONUS:         15,
  PRICING_BONUS:        10,
  DEPENDENCY_UNLOCKED:   5,  // bonus when all deps satisfied
  LOW_CONFIDENCE_BOOST: 25,  // revisit low-confidence answered fields
  SKIP_PENALTY:        -30,  // per-skip in correction mode
} as const;

// ── Input / output types ───────────────────────────────────────────────────────

export interface AdaptivePlanInput extends PlanInput {
  /**
   * Dynamic brief schema from Team 03 or built-in default.
   * If omitted, the engine resolves via getBuiltinSchema(serviceType).
   */
  schema?: DynamicBriefSchema;
  /**
   * Optional AI clarification adapter — engine works without it.
   * Checked via adapter.isAvailable() before use.
   */
  aiAdapter?: AiClarificationAdapter | null;
  /**
   * Fields where the answer has been flagged as low-confidence.
   * These get a scoring bonus to be re-visited during correction mode.
   * Key = field name; value = confidence score 0–1.
   */
  confidenceMap?: Partial<Record<keyof BriefData, number>>;
}

export interface AdaptivePlanResult {
  /** Scored and ordered question list — same shape as planBriefQuestions(). */
  questions: PlannedBriefQuestion[];
  /** Fields blocked by unsatisfied dependencies. */
  blockedByDependency: (keyof BriefData)[];
  /** Whether the current brief satisfies the schema's completion policy. */
  completionSatisfied: boolean;
  /** Active contradiction pairs detected in the current brief. */
  contradictions: ContradictionPair[];
  /** Whether the AI adapter is available for clarification. */
  aiClarificationAvailable: boolean;
  /** Schema version used for this plan (for session versioning). */
  schemaVersion: string;
}

export interface ContradictionPair {
  fieldA: keyof BriefData;
  fieldB: keyof BriefData;
  description: string;
}

// ── Dependency checking ────────────────────────────────────────────────────────

function isDependencySatisfied(
  fieldSchema: BriefFieldSchema,
  brief: BriefData,
  answeredQuestionIds: string[],
): boolean {
  if (!fieldSchema.dependsOn?.length) return true;
  return fieldSchema.dependsOn.every(
    (dep) => isFieldFilled(brief, dep) || answeredQuestionIds.includes(dep),
  );
}

// ── Priority scoring ───────────────────────────────────────────────────────────

function scoreField(
  field: keyof BriefData,
  fieldSchema: BriefFieldSchema,
  schema: DynamicBriefSchema,
  brief: BriefData,
  confidenceMap: Partial<Record<keyof BriefData, number>>,
  skippedQuestionIds: string[],
  answeredQuestionIds: string[],
): number {
  let score = fieldSchema.priorityWeight;

  // Structural bonuses from schema metadata
  if (fieldSchema.required)       score += SCORE.REQUIRED_BONUS;
  if (fieldSchema.isGating)       score += SCORE.GATING_BONUS;
  if (fieldSchema.affectsPricing) score += SCORE.PRICING_BONUS;

  // Dependency satisfaction bonus (questions become more relevant once unlocked)
  if (fieldSchema.dependsOn?.length && isDependencySatisfied(fieldSchema, brief, answeredQuestionIds)) {
    score += SCORE.DEPENDENCY_UNLOCKED;
  }

  // Low-confidence revisit boost
  const confidence = confidenceMap[field];
  if (typeof confidence === "number" && confidence < 0.5) {
    score += SCORE.LOW_CONFIDENCE_BOOST;
  }

  // Skip penalty (user previously skipped — don't push to front again)
  if (skippedQuestionIds.includes(field)) {
    score += SCORE.SKIP_PENALTY;
  }

  // Dynamic priority rules from schema
  for (const rule of schema.priorityRules ?? []) {
    if (rule.targetField === field) {
      const allEmpty = rule.ifAllEmpty.every((f) => !isFieldFilled(brief, f));
      if (allEmpty) {
        score += rule.boost;
      }
    }
  }

  return score;
}

// ── Contradiction detection ────────────────────────────────────────────────────

/**
 * Returns pairs of fields whose values are logically contradictory.
 * Extend this as domain knowledge grows — keeping domain logic in data (rules),
 * not embedded in the engine function body.
 */

interface ContradictionRule {
  fieldA: keyof BriefData;
  fieldB: keyof BriefData;
  description: string;
  check: (valA: string, valB: string) => boolean;
}

const CONTRADICTION_RULES: ContradictionRule[] = [
  {
    fieldA: "primaryGoal",
    fieldB: "audienceChannels",
    description: "Tujuan brand awareness dengan channel yang tidak mendukung jangkauan luas",
    check: (goal, channels) =>
      goal.toLowerCase().includes("brand awareness") &&
      channels.toLowerCase().includes("print") &&
      !channels.toLowerCase().includes("digital") &&
      !channels.toLowerCase().includes("social"),
  },
  {
    fieldA: "outputLanguage",
    fieldB: "audienceDemographics",
    description: "Bahasa output tidak sesuai dengan target audiens yang dipilih",
    check: (lang, audience) =>
      lang.toLowerCase().includes("en") &&
      audience.toLowerCase().includes("lokal") &&
      !audience.toLowerCase().includes("internasional"),
  },
];

function detectContradictions(brief: BriefData): ContradictionPair[] {
  const result: ContradictionPair[] = [];
  for (const rule of CONTRADICTION_RULES) {
    const valA = brief[rule.fieldA] ?? "";
    const valB = brief[rule.fieldB] ?? "";
    if (valA && valB && rule.check(valA, valB)) {
      result.push({
        fieldA: rule.fieldA,
        fieldB: rule.fieldB,
        description: rule.description,
      });
    }
  }
  return result;
}

// ── Completion policy ──────────────────────────────────────────────────────────

function isCompletionPolicySatisfied(
  schema: DynamicBriefSchema,
  brief: BriefData,
): boolean {
  const requiredFields = schema.fields.filter((f) => f.required);
  const filledRequired = requiredFields.filter((f) => isFieldFilled(brief, f.field));
  return filledRequired.length >= schema.completionPolicy.requiredFieldsMinimum;
}

// ── Main planner ───────────────────────────────────────────────────────────────

/**
 * Returns an adaptive-scored question plan.
 *
 * Algorithm:
 * 1. Delegate field filtering to existing planBriefQuestions() (preserves all
 *    existing visibility, skip, answered-check logic).
 * 2. Resolve schema (provided or built-in default).
 * 3. Filter out questions whose schema dependencies are unsatisfied.
 * 4. Score each remaining question using schema weights + dynamic rules.
 * 5. Sort by descending score → adaptive ordering.
 *
 * Deterministic: same inputs → same output.
 */
export function planAdaptiveQuestions(input: AdaptivePlanInput): AdaptivePlanResult {
  const { brief, serviceType, confidenceMap = {}, aiAdapter = null } = input;

  // Resolve schema — plugin-provided or built-in default
  const schema = input.schema ?? getBuiltinSchema(serviceType);

  // Get base candidate questions from existing planner (all filtering applied)
  const candidates = planBriefQuestions(input);

  const blockedByDependency: (keyof BriefData)[] = [];
  const scoredQuestions: { question: PlannedBriefQuestion; score: number }[] = [];

  for (const q of candidates) {
    const fieldSchema = schema.fields.find((f) => f.field === q.field);

    // Dependency gate: if schema declares deps and they're not met, block
    if (fieldSchema && !isDependencySatisfied(fieldSchema, brief, input.answeredQuestionIds)) {
      blockedByDependency.push(q.field);
      continue;
    }

    const score = fieldSchema
      ? scoreField(
          q.field,
          fieldSchema,
          schema,
          brief,
          confidenceMap,
          input.skippedQuestionIds,
          input.answeredQuestionIds,
        )
      : 50; // default weight for fields not in schema

    // Apply domain-specific question/helper overrides from schema
    const question: PlannedBriefQuestion = fieldSchema?.questionOverride
      ? { ...q, question: fieldSchema.questionOverride, helperText: fieldSchema.helperOverride ?? q.helperText }
      : q;

    scoredQuestions.push({ question, score });
  }

  // Sort descending by score — stable sort preserves relative order for equal scores
  scoredQuestions.sort((a, b) => b.score - a.score);

  const questions = scoredQuestions.map((s) => s.question);
  const contradictions = detectContradictions(brief);
  const completionSatisfied = isCompletionPolicySatisfied(schema, brief);
  const aiClarificationAvailable = aiAdapter?.isAvailable() ?? false;

  return {
    questions,
    blockedByDependency,
    completionSatisfied,
    contradictions,
    aiClarificationAvailable,
    schemaVersion: schema.schemaVersion,
  };
}

/**
 * Returns the next adaptive question to ask, or null if the session is done.
 * Drop-in replacement for getNextBriefQuestion() with schema-aware ordering.
 */
export function getAdaptiveNextQuestion(
  input: AdaptivePlanInput,
): PlannedBriefQuestion | null {
  const result = planAdaptiveQuestions(input);
  return result.questions[0] ?? null;
}

/**
 * Returns the full adaptive plan result for the current session state.
 * Use this when you need more than just the question list (contradictions,
 * completion status, etc.).
 */
export function getAdaptivePlanResult(input: AdaptivePlanInput): AdaptivePlanResult {
  return planAdaptiveQuestions(input);
}

/**
 * Checks if the current brief satisfies the completion policy for a given service.
 * Called before allowing the session to transition to "complete" stage.
 */
export function checkCompletionPolicy(
  serviceType: ServiceType | string,
  brief: BriefData,
  schema?: DynamicBriefSchema,
): { satisfied: boolean; requiredRemaining: (keyof BriefData)[]; summary: string } {
  const s = schema ?? getBuiltinSchema(serviceType);
  const requiredFields = s.fields.filter((f) => f.required);
  const remaining = requiredFields
    .filter((f) => !isFieldFilled(brief, f.field))
    .map((f) => f.field);
  const satisfied = remaining.length === 0 ||
    (s.completionPolicy.allowPartialCompletion &&
      (requiredFields.length - remaining.length) >= s.completionPolicy.requiredFieldsMinimum);

  const summary = satisfied
    ? "Semua field wajib sudah terisi."
    : `${remaining.length} field wajib belum terisi: ${remaining.join(", ")}`;

  return { satisfied, requiredRemaining: remaining, summary };
}

/**
 * Returns whether a question can be skipped based on its schema definition.
 * Enforces the rule: required non-skippable fields block skip actions.
 */
export function isQuestionSkippable(
  field: keyof BriefData,
  serviceType: ServiceType | string,
  schema?: DynamicBriefSchema,
): boolean {
  const s = schema ?? getBuiltinSchema(serviceType);
  const fieldSchema = s.fields.find((f) => f.field === field);
  if (!fieldSchema) return true; // unknown field = skippable by default
  if (fieldSchema.required && !fieldSchema.skippable) return false;
  return fieldSchema.skippable;
}

// Re-export for convenience
export { detectContradictions, isCompletionPolicySatisfied };
export type { ContradictionRule };
