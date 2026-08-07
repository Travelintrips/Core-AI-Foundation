/**
 * WP-06A — deterministic furniture placement suggestions.
 *
 * This contract is intentionally independent from persistence. Suggest is a
 * preview operation; Apply accepts only a candidateId and re-validates it on
 * the server before writing the existing placements table.
 */
import { z } from "zod";
import { wp03PlacementGeometrySchema } from "./wp03";

export const WP06A_MAX_PLACEMENTS = 50;

export const wp06aPlacementInputSchema = wp03PlacementGeometrySchema.extend({
  label: z.string().max(200).optional(),
  version: z.number().int().positive().optional(),
});

export const wp06aSuggestSchema = z.object({
  targetPlacementId: z.string().uuid(),
  placements: z.array(wp06aPlacementInputSchema).min(1).max(WP06A_MAX_PLACEMENTS),
}).strict();

export const wp06aApplySchema = z.object({
  candidateId: z.string().min(20).max(12000),
}).strict();

export const wp06aStrategySchema = z.enum([
  "WALL_LEFT",
  "WALL_RIGHT",
  "WALL_TOP",
  "WALL_BOTTOM",
  "CENTER",
]);

export const wp06aCandidateSchema = z.object({
  candidateId: z.string(),
  strategy: wp06aStrategySchema,
  rank: z.number().int().positive(),
  score: z.number().min(0).max(100),
  valid: z.boolean(),
  targetPlacementId: z.string().uuid(),
  placement: wp06aPlacementInputSchema,
  warnings: z.array(z.string()),
  explanation: z.string(),
}).strict();

export const wp06aSuggestResponseSchema = z.object({
  sessionId: z.string().uuid(),
  candidates: z.array(wp06aCandidateSchema).max(5),
}).strict();

export type Wp06aPlacementInput = z.infer<typeof wp06aPlacementInputSchema>;
export type Wp06aCandidate = z.infer<typeof wp06aCandidateSchema>;