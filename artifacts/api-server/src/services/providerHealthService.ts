/**
 * providerHealthService — shared provider ping + health-check logic.
 *
 * Extracted from routes/registry.ts so it can be used by both the registry
 * route handlers and the background providerHealthAlertService poller without
 * circular imports.
 */

import { eq, lt, and } from "drizzle-orm";
import {
  db,
  aiProvidersTable,
  aiProviderHealthLogsTable,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Ping ─────────────────────────────────────────────────────────────────────

function providerRequestFailure(
  status: number,
  context: "models" | "generation",
): string {
  if (status === 401 || status === 403) {
    return context === "generation"
      ? "Provider authentication failed for a real generation request. Check the configured API key."
      : "Provider authentication failed. Check the configured API key.";
  }
  if (status === 429) {
    return context === "generation"
      ? "Provider rate limit or quota exceeded for a real generation request."
      : "Provider rate limit or quota exceeded.";
  }
  return context === "generation"
    ? `Provider generation request failed (HTTP ${status}).`
    : `Provider request failed (HTTP ${status}).`;
}

function selectGenerationProbeModel(
  slugValue: string,
  payload: unknown,
): string | null {
  const slug = slugValue.trim().toLowerCase();
  if (!payload || typeof payload !== "object") return null;

  if (slug === "gemini" || slug === "google-gemini" || slug === "google") {
    const models = Array.isArray((payload as { models?: unknown }).models)
      ? (payload as {
          models: Array<{
            name?: unknown;
            supportedGenerationMethods?: unknown;
          }>;
        }).models
      : [];
    const model = models.find((candidate) => {
      const methods = Array.isArray(candidate.supportedGenerationMethods)
        ? candidate.supportedGenerationMethods
        : [];
      return (
        typeof candidate.name === "string" &&
        methods.includes("generateContent")
      );
    });
    return typeof model?.name === "string"
      ? model.name.replace(/^models\//, "")
      : null;
  }

  const data = Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: Array<{ id?: unknown }> }).data
    : [];
  const ids = data
    .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
    .filter(Boolean);

  if (slug === "openai") {
    return (
      ids.find((id) => id === "gpt-4o-mini") ??
      ids.find((id) => /^(gpt-|o\d)/i.test(id)) ??
      null
    );
  }
  if (slug === "anthropic") {
    return (
      ids.find((id) => /haiku/i.test(id)) ??
      ids.find((id) => /^claude-/i.test(id)) ??
      null
    );
  }
  if (slug === "mistral") {
    return (
      ids.find((id) => id === "mistral-small-latest") ??
      ids.find((id) => /mistral|codestral/i.test(id)) ??
      null
    );
  }

  return null;
}

async function probeProviderGeneration(input: {
  slug: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  const slug = input.slug.trim().toLowerCase();
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  if (slug === "anthropic") {
    url = `${input.baseUrl}/messages`;
    headers = {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    };
    body = {
      model: input.modelId,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    };
  } else if (
    slug === "gemini" ||
    slug === "google-gemini" ||
    slug === "google"
  ) {
    url =
      `${input.baseUrl}/models/${encodeURIComponent(input.modelId)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
    headers = { "content-type": "application/json" };
    body = {
      contents: [{ parts: [{ text: "Reply with exactly: OK" }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8 },
    };
  } else if (slug === "openai" || slug === "mistral") {
    url = `${input.baseUrl}/chat/completions`;
    headers = {
      "content-type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    };
    body = {
      model: input.modelId,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_tokens: 8,
      temperature: 0,
    };
  } else {
    return { ok: true, httpStatus: 200 };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const ok = response.status >= 200 && response.status < 300;
    if (!ok) {
      return {
        ok: false,
        httpStatus: response.status,
        error: providerRequestFailure(response.status, "generation"),
      };
    }
    return { ok: true, httpStatus: response.status };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ping a provider's API with the configured key.
 * Returns httpStatus, ok flag, and error string if failed.
 */
export async function pingProvider(
  slug: string,
  baseUrl: string,
  apiKey: string,
  options: { verifyGeneration?: boolean; modelId?: string } = {},
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
    if (!ok) {
      return {
        ok: false,
        httpStatus: resp.status,
        error: providerRequestFailure(resp.status, "models"),
      };
    }

    if (options.verifyGeneration) {
      let modelId = options.modelId?.trim() || "";
      if (!modelId) {
        let catalog: unknown;
        try {
          catalog = await resp.json();
        } catch {
          return {
            ok: false,
            httpStatus: 502,
            error: "Provider model catalog could not be parsed during recovery verification.",
          };
        }
        modelId = selectGenerationProbeModel(slug, catalog) ?? "";
      }

      if (!modelId) {
        return {
          ok: false,
          httpStatus: 502,
          error: "No generation-capable model was available for provider recovery verification.",
        };
      }

      return probeProviderGeneration({
        slug,
        baseUrl,
        apiKey,
        modelId,
      });
    }

    return { ok: true, httpStatus: resp.status };
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
      error: `Environment variable "${envVar}" is not available in the runtime environment / Secret Manager.`,
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
      error: `Environment variable "${envVar}" is not available in the runtime environment / Secret Manager.`,
    };
  }

  const ping = await pingProvider(provider.slug, provider.baseUrl, apiKey, {
    // A real generation probe is required while recovering a provider from a
    // runtime failure. The provider catalog supplies the probe model so the
    // check stays aligned with what the provider actually exposes.
    verifyGeneration: (provider.consecutiveFailures ?? 0) > 0,
  });
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
