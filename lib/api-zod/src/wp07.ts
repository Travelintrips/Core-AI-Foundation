/**
 * WP-07 — Layout Constraint Engine contracts.
 *
 * Keep the rule DSL in the shared package so API routes and clients validate
 * the same bounded payload. The persisted rule set remains JSONB because rule
 * parameters are intentionally type-specific.
 */
import { z } from "zod";

export const WP07_MAX_RULES = 100;

export const wp07RuleTypeSchema = z.enum([
  "min_clearance",
  "wall_proximity",
  "anchor_required",
  "rotation_locked",
  "zone_exclusion",
  "circulation_path",
]);

export const wp07RulePrioritySchema = z.enum(["hard", "soft", "hint"]);

export const wp07RuleSchema = z.object({
  id: z.string().min(1).max(120),
  type: wp07RuleTypeSchema,
  priority: wp07RulePrioritySchema.default("hard"),
  order: z.number().int().min(0).max(10000).default(0),
  message: z.string().max(500).optional(),
  remediation: z.string().max(500).optional(),
  params: z.record(z.unknown()).default({}),
}).strict();

export const wp07RuleSetSchema = z.array(wp07RuleSchema).max(WP07_MAX_RULES);

export const wp07EvaluateLayoutSchema = z.object({}).strict();

export const wp07ViolationSchema = z.object({
  ruleId: z.string(),
  ruleType: wp07RuleTypeSchema,
  placementIds: z.array(z.string()),
  message: z.string(),
  remediation: z.string().nullable(),
  severity: z.enum(["error", "warning", "info"]),
  detail: z.record(z.unknown()).optional(),
});

export const wp07RuleResultSchema = z.object({
  ruleId: z.string(),
  ruleType: wp07RuleTypeSchema,
  priority: wp07RulePrioritySchema,
  status: z.enum(["passed", "violated", "not_applicable"]),
  notApplicableReason: z.string().nullable(),
  violationCount: z.number().int().nonnegative(),
});

export const wp07EvaluationResponseSchema = z.object({
  valid: z.boolean(),
  score: z.number().min(0).max(100),
  violations: z.array(wp07ViolationSchema),
  warnings: z.array(z.string()),
  rules: z.array(wp07RuleResultSchema),
  evaluatedAt: z.string(),
  roomType: z.string().nullable(),
  constraintSetId: z.string().nullable(),
  activePlacementCount: z.number().int().nonnegative(),
  archivedPlacementCount: z.number().int().nonnegative(),
});

export type Wp07Rule = z.infer<typeof wp07RuleSchema>;
export type Wp07EvaluationResponse = z.infer<typeof wp07EvaluationResponseSchema>;