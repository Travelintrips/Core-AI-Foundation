import { db, aiModelsTable, aiProvidersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface ModelWithProvider {
  model: typeof aiModelsTable.$inferSelect;
  provider: typeof aiProvidersTable.$inferSelect;
}

/**
 * Returns all active models joined with their active provider.
 */
export async function getAllActiveModels(): Promise<ModelWithProvider[]> {
  const rows = await db
    .select({ model: aiModelsTable, provider: aiProvidersTable })
    .from(aiModelsTable)
    .innerJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
    .where(and(eq(aiModelsTable.isActive, true), eq(aiProvidersTable.isActive, true)));

  return rows.map((r) => ({ model: r.model, provider: r.provider }));
}
