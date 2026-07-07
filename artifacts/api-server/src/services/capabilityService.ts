/**
 * capabilityService — queries and manages the ai_capabilities table.
 * Used by the Intelligent Router to score model selection per skill.
 */

import { eq, and, desc } from "drizzle-orm";
import { db, aiCapabilitiesTable, aiProvidersTable, aiModelsTable } from "@workspace/db";

export type CapabilityWithRelations = {
  capability: typeof aiCapabilitiesTable.$inferSelect;
  provider: typeof aiProvidersTable.$inferSelect | null;
  model: typeof aiModelsTable.$inferSelect | null;
};

/** Get all active capabilities, joined with provider and model info. */
export async function getAllCapabilities(): Promise<CapabilityWithRelations[]> {
  const rows = await db
    .select({
      capability: aiCapabilitiesTable,
      provider: aiProvidersTable,
      model: aiModelsTable,
    })
    .from(aiCapabilitiesTable)
    .leftJoin(aiProvidersTable, eq(aiCapabilitiesTable.providerId, aiProvidersTable.id))
    .leftJoin(aiModelsTable, eq(aiCapabilitiesTable.modelId, aiModelsTable.id))
    .where(eq(aiCapabilitiesTable.status, "active"))
    .orderBy(desc(aiCapabilitiesTable.priority));

  return rows.map((r) => ({
    capability: r.capability,
    provider: r.provider ?? null,
    model: r.model ?? null,
  }));
}

/** Get capabilities for a specific skill, sorted by priority descending. */
export async function getCapabilitiesForSkill(skill: string): Promise<CapabilityWithRelations[]> {
  const rows = await db
    .select({
      capability: aiCapabilitiesTable,
      provider: aiProvidersTable,
      model: aiModelsTable,
    })
    .from(aiCapabilitiesTable)
    .leftJoin(aiProvidersTable, eq(aiCapabilitiesTable.providerId, aiProvidersTable.id))
    .leftJoin(aiModelsTable, eq(aiCapabilitiesTable.modelId, aiModelsTable.id))
    .where(and(eq(aiCapabilitiesTable.skill, skill), eq(aiCapabilitiesTable.status, "active")))
    .orderBy(desc(aiCapabilitiesTable.priority));

  return rows.map((r) => ({
    capability: r.capability,
    provider: r.provider ?? null,
    model: r.model ?? null,
  }));
}

/** Get capabilities for a specific agent slug. */
export async function getCapabilitiesForAgent(agentSlug: string): Promise<CapabilityWithRelations[]> {
  const rows = await db
    .select({
      capability: aiCapabilitiesTable,
      provider: aiProvidersTable,
      model: aiModelsTable,
    })
    .from(aiCapabilitiesTable)
    .leftJoin(aiProvidersTable, eq(aiCapabilitiesTable.providerId, aiProvidersTable.id))
    .leftJoin(aiModelsTable, eq(aiCapabilitiesTable.modelId, aiModelsTable.id))
    .where(and(eq(aiCapabilitiesTable.agentSlug, agentSlug), eq(aiCapabilitiesTable.status, "active")))
    .orderBy(desc(aiCapabilitiesTable.priority));

  return rows.map((r) => ({
    capability: r.capability,
    provider: r.provider ?? null,
    model: r.model ?? null,
  }));
}

/** Compute a composite capability score (0–100) for a capability row. */
export function computeCapabilityScore(
  cap: typeof aiCapabilitiesTable.$inferSelect,
  weights = { accuracy: 0.4, speed: 0.3, cost: 0.3 },
): number {
  const accuracy = cap.accuracyScore != null ? Number(cap.accuracyScore) : 50;
  const speed = cap.speedScore != null ? Number(cap.speedScore) : 50;
  const cost = cap.costScore != null ? Number(cap.costScore) : 50;
  return accuracy * weights.accuracy + speed * weights.speed + cost * weights.cost;
}
