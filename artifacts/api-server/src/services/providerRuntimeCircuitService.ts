import { eq } from "drizzle-orm";
import {
  aiProvidersTable,
  db,
  withTransientDatabaseRetry,
} from "@workspace/db";

export type ProviderRuntimeFailureReason =
  | "AUTH"
  | "RATE_LIMIT"
  | "UNAVAILABLE";

export interface ProviderRuntimeCircuit {
  reason: ProviderRuntimeFailureReason;
  openedAt: string;
  openUntil: string;
  lastError: string;
}

const AUTH_COOLDOWN_MS = 15 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const UNAVAILABLE_COOLDOWN_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProviderSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (slug === "google-gemini" || slug === "gemini") return "google";
  return slug;
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function classifyProviderRuntimeFailure(
  error: unknown,
): ProviderRuntimeFailureReason | null {
  const message = safeErrorMessage(error).toLowerCase();
  if (
    message.includes("authentication failed") ||
    message.includes("api key") ||
    /\b401\b|\b403\b/.test(message)
  ) {
    return "AUTH";
  }
  if (
    message.includes("rate limit") ||
    message.includes("quota") ||
    /\b429\b/.test(message)
  ) {
    return "RATE_LIMIT";
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("unavailable") ||
    /\b502\b|\b503\b|\b504\b/.test(message)
  ) {
    return "UNAVAILABLE";
  }
  return null;
}

function cooldownMs(reason: ProviderRuntimeFailureReason): number {
  switch (reason) {
    case "AUTH":
      return AUTH_COOLDOWN_MS;
    case "RATE_LIMIT":
      return RATE_LIMIT_COOLDOWN_MS;
    case "UNAVAILABLE":
      return UNAVAILABLE_COOLDOWN_MS;
  }
}

export function getActiveProviderRuntimeCircuit(
  metadata: unknown,
  nowMs = Date.now(),
): ProviderRuntimeCircuit | null {
  if (!isRecord(metadata)) return null;
  const raw = metadata["runtimeCircuit"];
  if (!isRecord(raw)) return null;
  const reason = raw["reason"];
  const openedAt = raw["openedAt"];
  const openUntil = raw["openUntil"];
  const lastError = raw["lastError"];
  if (
    (reason !== "AUTH" && reason !== "RATE_LIMIT" && reason !== "UNAVAILABLE") ||
    typeof openedAt !== "string" ||
    typeof openUntil !== "string" ||
    typeof lastError !== "string"
  ) {
    return null;
  }
  const untilMs = Date.parse(openUntil);
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) return null;
  return { reason, openedAt, openUntil, lastError };
}

export async function recordProviderRuntimeFailure(
  providerSlug: string,
  error: unknown,
  now = new Date(),
): Promise<boolean> {
  const reason = classifyProviderRuntimeFailure(error);
  if (!reason) return false;

  const slug = normalizeProviderSlug(providerSlug);
  const [provider] = await withTransientDatabaseRetry(
    () =>
      db
        .select({
          id: aiProvidersTable.id,
          metadata: aiProvidersTable.metadata,
          consecutiveFailures: aiProvidersTable.consecutiveFailures,
        })
        .from(aiProvidersTable)
        .where(eq(aiProvidersTable.slug, slug))
        .limit(1),
    { attempts: 3, baseDelayMs: 150 },
  );
  if (!provider) return false;

  const baseMetadata = isRecord(provider.metadata)
    ? { ...provider.metadata }
    : {};
  const openUntil = new Date(now.getTime() + cooldownMs(reason));
  baseMetadata["runtimeCircuit"] = {
    reason,
    openedAt: now.toISOString(),
    openUntil: openUntil.toISOString(),
    lastError: safeErrorMessage(error),
  };

  await withTransientDatabaseRetry(
    () =>
      db
        .update(aiProvidersTable)
        .set({
          metadata: baseMetadata,
          consecutiveFailures: Math.max(
            1,
            Number(provider.consecutiveFailures ?? 0) + 1,
          ),
          lastCheckedAt: now,
        })
        .where(eq(aiProvidersTable.id, provider.id)),
    { attempts: 3, baseDelayMs: 150 },
  );

  return true;
}
