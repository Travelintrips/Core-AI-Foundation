/**
 * capabilityService.ts — Capability matrix lookups and scoring.
 *
 * getCapabilitiesForSkill() → fetches all capability rows for a given skill,
 *                             joined with model + provider info.
 * computeCapabilityScore()  → weighted score (0–100) from accuracy/speed/cost
 *                             fields on a capability row.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  aiCapabilitiesTable,
  aiModelsTable,
  aiProvidersTable,
  type AiCapability,
} from "@workspace/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CapabilityEntry {
  capability: AiCapability;
  model: typeof aiModelsTable.$inferSelect | null;
  provider: typeof aiProvidersTable.$inferSelect | null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getCapabilitiesForSkill(skill: string): Promise<CapabilityEntry[]> {
  const rows = await db
    .select({
      capability: aiCapabilitiesTable,
      model:      aiModelsTable,
      provider:   aiProvidersTable,
    })
    .from(aiCapabilitiesTable)
    .leftJoin(aiModelsTable,     eq(aiCapabilitiesTable.modelId,    aiModelsTable.id))
    .leftJoin(aiProvidersTable,  eq(aiCapabilitiesTable.providerId, aiProvidersTable.id))
    .where(
      and(
        eq(aiCapabilitiesTable.skill,  skill),
        eq(aiCapabilitiesTable.status, "active"),
      ),
    );

  return rows.map((r) => ({
    capability: r.capability,
    model:      r.model ?? null,
    provider:   r.provider ?? null,
  }));
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Combines accuracy (50%), speed (25%), and cost-efficiency (25%)
 * into a single 0–100 score.  Defaults to 70 if a sub-score is missing.
 */
export function computeCapabilityScore(capability: AiCapability): number {
  const accuracy = capability.accuracyScore != null ? parseFloat(String(capability.accuracyScore)) : 70;
  const speed    = capability.speedScore    != null ? parseFloat(String(capability.speedScore))    : 70;
  const cost     = capability.costScore     != null ? parseFloat(String(capability.costScore))     : 70;

  return Math.min(100, Math.max(0, accuracy * 0.5 + speed * 0.25 + cost * 0.25));
}
