/**
 * WP-07 — Layout Constraint Engine contracts.
 *
 * These schemas deliberately describe the supported room metadata instead of
 * passing arbitrary JSON through the constraint result. The engine remains
 * deterministic and server-owned.
 */
import { z } from "zod";

export const WP07_MAX_ITEMS = 200;

const constraintZoneSchema = z.object({
  id: z.string().min(1).max(100),
  xCm: z.number().finite(),
  yCm: z.number().finite(),
  widthCm: z.number().positive().finite(),
  depthCm: z.number().positive().finite(),
  rotationDeg: z.number().finite().optional().default(0),
  clearanceCm: z.number().nonnegative().finite().optional().default(0),
  label: z.string().max(200).optional(),
}).strict();

const focalPointSchema = z.object({
  xCm: z.number().finite(),
  yCm: z.number().finite(),
}).strict();

export const wp07SessionMetadataSchema = z.object({
  doors: z.array(constraintZoneSchema).max(32).optional(),
  windows: z.array(constraintZoneSchema).max(32).optional(),
  excludedZones: z.array(constraintZoneSchema).max(64).optional(),
  preferredZones: z.array(constraintZoneSchema).max(64).optional(),
  walkwayZones: z.array(constraintZoneSchema).max(64).optional(),
  symmetryAxis: z.enum(["vertical", "horizontal"]).optional(),
  focalPoint: focalPointSchema.optional(),
  roomFunction: z.string().min(1).max(100).optional(),
  style: z.string().min(1).max(100).optional(),
  styleTags: z.array(z.string().min(1).max(50)).max(32).optional(),
  maxPlacements: z.number().int().positive().max(WP07_MAX_ITEMS).optional(),
  minFurnitureClearanceCm: z.number().nonnegative().finite().optional(),
  minWalkwayClearanceCm: z.number().nonnegative().finite().optional(),
}).passthrough();

export const wp07PlacementMetadataSchema = z.object({
  locked: z.boolean().optional(),
  zoneId: z.string().min(1).max(100).optional(),
  roomFunction: z.string().min(1).max(100).optional(),
  compatibleRoomFunctions: z.array(z.string().min(1).max(100)).max(32).optional(),
  style: z.string().min(1).max(100).optional(),
  styleTags: z.array(z.string().min(1).max(50)).max(32).optional(),
  wallAlignment: z.enum(["left", "right", "top", "bottom", "none"]).optional(),
}).passthrough();

export const wp07ConstraintRequestSchema = z.object({}).strict();

export const wp07ConstraintRuleIdSchema = z.enum([
  "HC-01", "HC-02", "HC-03", "HC-04", "HC-05", "HC-06", "HC-07", "HC-08", "HC-09", "HC-10", "HC-11",
  "SC-01", "SC-02", "SC-03", "SC-04", "SC-05", "SC-06", "SC-07", "SC-08", "SC-09",
]);

export const wp07ConstraintRuleResultSchema = z.object({
  ruleId: wp07ConstraintRuleIdSchema,
  category: z.enum(["hard", "soft"]),
  status: z.enum(["pass", "fail", "warning", "not_applicable"]),
  score: z.number().finite().min(0).max(100).nullable(),
  message: z.string().max(1000),
  itemIds: z.array(z.string().uuid()).max(WP07_MAX_ITEMS),
}).strict();

export const wp07ConstraintViolationSchema = z.object({
  ruleId: wp07ConstraintRuleIdSchema,
  itemIds: z.array(z.string().uuid()).max(WP07_MAX_ITEMS),
  message: z.string().max(1000),
}).strict();

export const wp07ConstraintWarningSchema = z.object({
  ruleId: wp07ConstraintRuleIdSchema,
  itemIds: z.array(z.string().uuid()).max(WP07_MAX_ITEMS),
  message: z.string().max(1000),
}).strict();

export const wp07ConstraintScoreBreakdownSchema = z.object({
  ruleId: wp07ConstraintRuleIdSchema,
  weight: z.number().finite().nonnegative(),
  score: z.number().finite().min(0).max(100).nullable(),
  weightedScore: z.number().finite().nonnegative(),
  status: z.enum(["pass", "warning", "not_applicable"]),
}).strict();

export const wp07ConstraintRemediationSchema = z.object({
  ruleId: wp07ConstraintRuleIdSchema,
  action: z.enum([
    "move_item_inside_room",
    "increase_clearance",
    "move_item_away_from_door",
    "move_item_away_from_window",
    "resolve_overlap",
    "clear_excluded_zone",
    "improve_wall_alignment",
    "improve_circulation",
    "move_toward_preferred_zone",
    "review_geometry",
  ]),
  message: z.string().max(500),
  itemIds: z.array(z.string().uuid()).max(WP07_MAX_ITEMS),
}).strict();

export const wp07ConstraintMetadataSchema = z.object({
  sessionId: z.string().uuid(),
  itemsEvaluated: z.number().int().nonnegative(),
  rulesEvaluated: z.number().int().nonnegative(),
  pairChecks: z.number().int().nonnegative(),
  hardViolationCount: z.number().int().nonnegative(),
  softWarningCount: z.number().int().nonnegative(),
  elapsedMs: z.number().finite().nonnegative(),
  approvedLayout: z.boolean(),
}).strict();

export const wp07ConstraintResultSchema = z.object({
  valid: z.boolean(),
  totalScore: z.number().finite().min(0).max(100),
  hardViolations: z.array(wp07ConstraintViolationSchema).max(WP07_MAX_ITEMS),
  softWarnings: z.array(wp07ConstraintWarningSchema).max(WP07_MAX_ITEMS),
  ruleResults: z.array(wp07ConstraintRuleResultSchema).length(20),
  scoreBreakdown: z.array(wp07ConstraintScoreBreakdownSchema).length(9),
  explanation: z.string().max(4000),
  suggestedRemediations: z.array(wp07ConstraintRemediationSchema).max(WP07_MAX_ITEMS),
  deterministic: z.literal(true),
  metadata: wp07ConstraintMetadataSchema,
}).strict();

export type Wp07SessionMetadata = z.infer<typeof wp07SessionMetadataSchema>;
export type Wp07PlacementMetadata = z.infer<typeof wp07PlacementMetadataSchema>;
export type Wp07ConstraintRequest = z.infer<typeof wp07ConstraintRequestSchema>;
export type Wp07ConstraintRuleResult = z.infer<typeof wp07ConstraintRuleResultSchema>;
export type Wp07ConstraintViolation = z.infer<typeof wp07ConstraintViolationSchema>;
export type Wp07ConstraintWarning = z.infer<typeof wp07ConstraintWarningSchema>;
export type Wp07ConstraintScoreBreakdown = z.infer<typeof wp07ConstraintScoreBreakdownSchema>;
export type Wp07ConstraintRemediation = z.infer<typeof wp07ConstraintRemediationSchema>;
export type Wp07ConstraintResult = z.infer<typeof wp07ConstraintResultSchema>;