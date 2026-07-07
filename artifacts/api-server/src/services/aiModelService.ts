import { and, eq } from "drizzle-orm";
import { db, aiModelsTable, aiProvidersTable } from "@workspace/db";

export type ModelWithProvider = {
  model: typeof aiModelsTable.$inferSelect;
  provider: typeof aiProvidersTable.$inferSelect;
};

/** Get a single active model by DB id, including its provider. Returns null if not found or inactive. */
export async function getActiveModel(modelId: number): Promise<ModelWithProvider | null> {
  const [row] = await db
    .select({ model: aiModelsTable, provider: aiProvidersTable })
    .from(aiModelsTable)
    .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
    .where(eq(aiModelsTable.id, modelId));

  if (!row?.provider) return null;
  if (!row.model.isActive) return null;
  if (!row.provider.isActive) return null;

  return { model: row.model, provider: row.provider };
}

/** Get all active models whose provider is also active, ordered by provider then model name. */
export async function getAllActiveModels(): Promise<ModelWithProvider[]> {
  const rows = await db
    .select({ model: aiModelsTable, provider: aiProvidersTable })
    .from(aiModelsTable)
    .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
    .where(and(eq(aiModelsTable.isActive, true), eq(aiProvidersTable.isActive, true)));

  return rows.filter((r): r is ModelWithProvider => r.provider !== null);
}
