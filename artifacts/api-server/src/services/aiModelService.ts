import {
  db,
  aiModelsTable,
  aiProviderHealthLogsTable,
  aiProvidersTable,
  withTransientDatabaseRetry,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface ModelWithProvider {
  model: typeof aiModelsTable.$inferSelect;
  provider: typeof aiProvidersTable.$inferSelect;
}

const ACTIVE_MODEL_CACHE_TTL_MS = 5_000;
const ACTIVE_MODEL_STALE_TTL_MS = 60_000;

let activeModelCache: {
  rows: ModelWithProvider[];
  expiresAt: number;
  staleUntil: number;
} | null = null;
let activeModelLoad: Promise<ModelWithProvider[]> | null = null;

function invalidateActiveModelCache(): void {
  activeModelCache = null;
}

export type ProviderRuntimeFailureKind =
  | "AUTH"
  | "RATE_LIMIT"
  | "UNAVAILABLE";

function normalizeProviderRegistrySlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "google-gemini" || normalized === "gemini") return "google";
  return normalized;
}

function providerRuntimeFailureHttpStatus(kind: ProviderRuntimeFailureKind): number {
  if (kind === "AUTH") return 401;
  if (kind === "RATE_LIMIT") return 429;
  return 503;
}

/**
 * Mark a provider unhealthy when a real model invocation fails.
 * Health-check /models probes can be weaker than an actual generation call;
 * this runtime signal must therefore participate in coding-model routing.
 */
export async function recordProviderRuntimeFailure(
  providerSlug: string,
  kind: ProviderRuntimeFailureKind,
  detail: string,
): Promise<boolean> {
  const normalizedProvider = normalizeProviderRegistrySlug(providerSlug);
  if (!normalizedProvider) return false;

  const checkedAt = new Date();
  const safeDetail = detail
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);

  const updated = await withTransientDatabaseRetry(
    () =>
      db.transaction(async (tx) => {
        const [provider] = await tx
          .select({
            id: aiProvidersTable.id,
            consecutiveFailures: aiProvidersTable.consecutiveFailures,
          })
          .from(aiProvidersTable)
          .where(eq(aiProvidersTable.slug, normalizedProvider))
          .for("update")
          .limit(1);

        if (!provider) return false;

        const consecutiveFailures =
          Math.max(0, Number(provider.consecutiveFailures ?? 0)) + 1;

        await tx
          .update(aiProvidersTable)
          .set({
            consecutiveFailures,
            lastCheckedAt: checkedAt,
          })
          .where(eq(aiProvidersTable.id, provider.id));

        await tx.insert(aiProviderHealthLogsTable).values({
          providerId: provider.id,
          isActive: false,
          httpStatus: providerRuntimeFailureHttpStatus(kind),
          error:
            "Runtime model invocation " +
            kind.toLowerCase().replace("_", " ") +
            " failure" +
            (safeDetail ? ": " + safeDetail : "."),
          checkedAt,
        });

        return true;
      }),
    { attempts: 3, baseDelayMs: 150 },
  );

  if (updated) invalidateActiveModelCache();
  return updated;
}

/**
 * Returns all active models joined with their active provider.
 */
export async function getAllActiveModels(): Promise<ModelWithProvider[]> {
  const now = Date.now();
  if (activeModelCache && now < activeModelCache.expiresAt) {
    return activeModelCache.rows;
  }
  if (activeModelLoad) return activeModelLoad;

  const stale = activeModelCache;
  activeModelLoad = withTransientDatabaseRetry(async () => {
    const rows = await db
      .select({ model: aiModelsTable, provider: aiProvidersTable })
      .from(aiModelsTable)
      .innerJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
      .where(and(eq(aiModelsTable.isActive, true), eq(aiProvidersTable.isActive, true)));
    return rows.map((row) => ({ model: row.model, provider: row.provider }));
  }, { attempts: 3, baseDelayMs: 150 })
    .then((rows) => {
      const loadedAt = Date.now();
      activeModelCache = {
        rows,
        expiresAt: loadedAt + ACTIVE_MODEL_CACHE_TTL_MS,
        staleUntil: loadedAt + ACTIVE_MODEL_STALE_TTL_MS,
      };
      return rows;
    })
    .catch((error) => {
      if (stale && Date.now() < stale.staleUntil) {
        return stale.rows;
      }
      throw error;
    })
    .finally(() => {
      activeModelLoad = null;
    });

  return activeModelLoad;
}

/**
 * Returns a single active model by its DB id, joined with its provider.
 * Returns null if not found or inactive.
 */
export async function getActiveModel(modelId: number): Promise<ModelWithProvider | null> {
  const [row] = await withTransientDatabaseRetry(() => db
    .select({ model: aiModelsTable, provider: aiProvidersTable })
    .from(aiModelsTable)
    .innerJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
    .where(and(eq(aiModelsTable.id, modelId), eq(aiModelsTable.isActive, true), eq(aiProvidersTable.isActive, true))),
  { attempts: 3, baseDelayMs: 150 });

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

  const [provider] = await withTransientDatabaseRetry(() => db
    .select({ id: aiProvidersTable.id })
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.slug, normalizedProvider))
    .limit(1),
  { attempts: 3, baseDelayMs: 150 });

  if (!provider) return false;

  const rows = await withTransientDatabaseRetry(() => db
    .update(aiModelsTable)
    .set({ isActive: false })
    .where(
      and(
        eq(aiModelsTable.providerId, provider.id),
        eq(aiModelsTable.modelId, normalizedModel),
        eq(aiModelsTable.isActive, true),
      ),
    )
    .returning({ id: aiModelsTable.id }),
  { attempts: 3, baseDelayMs: 150 });

  if (rows.length > 0) invalidateActiveModelCache();
  return rows.length > 0;
}
