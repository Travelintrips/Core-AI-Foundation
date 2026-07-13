/**
 * Completeness score (section 19) — 0-100, based on how much context the
 * engine had available. Independent from the wizard's own step-progress
 * tracking; purely about how much *the engine* had to reason with.
 */

import type { BriefIntelligenceContext } from "./types";

export function computeCompleteness(ctx: BriefIntelligenceContext): number {
  let score = 0;
  if (ctx.industryKey) score += 35;
  else if (ctx.industryCustomText.trim()) score += 15;
  if (ctx.serviceType !== "default") score += 20;
  if (ctx.goalKeys.length > 0) score += 15;
  if (ctx.audienceKeys.length > 0) score += 15;
  if (ctx.companySizeKey) score += 5;
  if (ctx.priorityKey) score += 5;
  if (ctx.existingAssetKeys.length > 0) score += 5;
  return Math.min(100, score);
}
