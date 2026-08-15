/**
 * providerHealthService — shared provider ping + health-check logic.
 *
 * Extracted from routes/registry.ts so it can be used by both the registry
 * route handlers and the background providerHealthAlertService poller without
 * circular imports.
 */

import { eq, lt, and } from "drizzle-orm";
import { db, aiProvidersTable, aiProviderHealthLogsTable } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Ping ─────────────────────────────────────────────────────────────────────

/**
 * Ping a provider's API with the configured key.
 * Returns httpStatus, ok flag, and error string if failed.
 */
export async function pingProvider(
  slug: string,
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  try {
    let url: string;
    const headers: Record<string, string> = {};

    if (slug === "anthropic") {
      url = `${baseUrl}/models`;
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (slug === "gemini" || slug === "google-gemini" || slug === "google") {
      url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;
    } else if (slug === "replicate") {
      url = `${baseUrl}/models`;
      headers["Authorization"] = `Token ${apiKey}`;
    } else {
      // OpenAI, Mistral, and any other Bearer-based provider
      url = `${baseUrl}/models`;
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const ok = resp.status >= 200 && resp.status < 300;
    let error: string | undefined;
    if (!ok) {
      if (resp.status === 401 || resp.status === 403) {
        error = "Provider authentication failed. Check the configured API key.";
      } else if (resp.status === 429) {
        error = "Provider rate limit or quota exceeded.";
      } else {
        error = `Provider request failed (HTTP ${resp.status}).`;
      }
    }
    return { ok, httpStatus: resp.status, error };
  } catch (err) {
    return { ok: false, httpStatus: 0, error: String(err) };
  }
}

// ── Health check ──────────────────────────────────────────────────────────────

export type HealthCheckResult =
  | {
      providerId: number;
      slug: string;
      keyConfigured: boolean;
      envVar: string;
      httpStatus: number | null;
      isActive: boolean;
      pingOk: boolean;
      consecutiveFailures: number;
      lastCheckedAt: Date;
      lastSuccessAt: Date | null;
      error: string | null;
    }
  | { error: string; notFound: true };

/**
 * Prune health log entries older than 30 days for a given provider.
 * Called automatically after each health check write.
 */
async function pruneOldLogs(providerId: number): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db
    .delete(aiProviderHealthLogsTable)
    .where(
      and(
        eq(aiProviderHealthLogsTable.providerId, providerId),
        lt(aiProviderHealthLogsTable.checkedAt, cutoff),
      ),
    );
}

/**
 * Run a health check for one provider and persist results.
 * Health checks update health metadata only — they do NOT touch isActive.
 * Admin enablement (isActive) is a separate administrative decision.
 */
export async function runHealthCheck(id: number): Promise<HealthCheckResult> {
  const [provider] = await db
    .select()
    .from(aiProvidersTable)
    .where(eq(aiProvidersTable.id, id))
    .limit(1);

  if (!provider) return { error: "Provider not found", notFound: true };

  const envVar = provider.apiKeyEnvVar ?? "";
  const apiKey = envVar ? (process.env[envVar] ?? "") : "";
  const keyConfigured = Boolean(apiKey);
  const now = new Date();

  if (!keyConfigured) {
    const newFailures = (provider.consecutiveFailures ?? 0) + 1;
    await db.update(aiProvidersTable)
      .set({ consecutiveFailures: newFailures, lastCheckedAt: now })
      .where(eq(aiProvidersTable.id, id));

    // Log the check result
    await db.insert(aiProviderHealthLogsTable).values({
      providerId: id,
      isActive: false,
      httpStatus: null,
      error: `Environment variable "${envVar}" is not set in Replit Secrets.`,
      checkedAt: now,
    });
    pruneOldLogs(id).catch(() => {/* fire-and-forget */});

    return {
      providerId: id,
      slug: provider.slug,
      keyConfigured: false,
      envVar,
      httpStatus: null,
      isActive: provider.isActive,
      pingOk: false,
      consecutiveFailures: newFailures,
      lastCheckedAt: now,
      lastSuccessAt: provider.lastSuccessAt ?? null,
      error: `Environment variable "${envVar}" is not set in Replit Secrets.`,
    };
  }

  const ping = await pingProvider(provider.slug, provider.baseUrl, apiKey);
  const newFailures = ping.ok ? 0 : (provider.consecutiveFailures ?? 0) + 1;
  const lastSuccessAt = ping.ok ? now : (provider.lastSuccessAt ?? null);

  await db
    .update(aiProvidersTable)
    .set({ consecutiveFailures: newFailures, lastCheckedAt: now, lastSuccessAt })
    .where(eq(aiProvidersTable.id, id));

  // Log the check result
  await db.insert(aiProviderHealthLogsTable).values({
    providerId: id,
    isActive: ping.ok,
    httpStatus: ping.httpStatus ?? null,
    error: ping.error ?? null,
    checkedAt: now,
  });
  pruneOldLogs(id).catch(() => {/* fire-and-forget */});

  await logAudit(
    "registry",
    "provider_health_check",
    String(id),
    "provider",
    ping.ok ? "success" : "failure",
    { slug: provider.slug, httpStatus: ping.httpStatus, error: ping.error, consecutiveFailures: newFailures },
  );

  return {
    providerId: id,
    slug: provider.slug,
    keyConfigured: true,
    envVar,
    httpStatus: ping.httpStatus,
    isActive: provider.isActive,
    pingOk: ping.ok,
    consecutiveFailures: newFailures,
    lastCheckedAt: now,
    lastSuccessAt,
    error: ping.error ?? null,
  };
}

/**
 * Run health checks for all providers in parallel.
 */
export async function runAllHealthChecks(): Promise<HealthCheckResult[]> {
  const providers = await db.select({ id: aiProvidersTable.id }).from(aiProvidersTable);
  return Promise.all(providers.map((p) => runHealthCheck(p.id)));
}
