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

/**
 * Returns a single active model by its DB id, joined with its provider.
 * Returns null if not found or inactive.
 */
export async function getActiveModel(modelId: number): Promise<ModelWithProvider | null> {
  const [row] = await db
    .select({ model: aiModelsTable, provider: aiProvidersTable })
    .from(aiModelsTable)
    .innerJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
    .where(and(eq(aiModelsTable.id, modelId), eq(aiModelsTable.isActive, true), eq(aiProvidersTable.isActive, true)));

  return row ? { model: row.model, provider: row.provider } : null;
}


/**
 * Disable one exact registered model after the provider explicitly reports
 * that the model is retired / no longer available. This is intentionally
 * model-scoped: provider health remains independent so other models from the
 * same provider can continue serving traffic.
 */
export async function deactivateRegisteredModel(
  providerSlug: string,
  modelId: string,
): Promise<boolean> {
  const normalizedProvider = providerSlug.trim().toLowerCase();
  const normalizedModel = modelId.trim();
  if (!normalizedProvider || !normalizedModel) return false;

  const [provider] = await db
    .select({ id: aiProvidersTable.id })
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.slug, normalizedProvider))
    .limit(1);

  if (!provider) return false;

  const rows = await db
    .update(aiModelsTable)
    .set({ isActive: false })
    .where(
      and(
        eq(aiModelsTable.providerId, provider.id),
        eq(aiModelsTable.modelId, normalizedModel),
        eq(aiModelsTable.isActive, true),
      ),
    )
    .returning({ id: aiModelsTable.id });

  return rows.length > 0;
}
