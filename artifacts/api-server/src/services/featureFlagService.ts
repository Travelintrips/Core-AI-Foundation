/**
 * featureFlagService — V4.2I Feature Flag System
 *
 * Provides runtime-controllable feature flags without code redeploy.
 * Flags are stored in the database (ai_feature_flags table) and cached
 * in memory for 60 seconds to avoid per-request DB hits.
 *
 * RULES:
 *  - Environment is always derived server-side (NODE_ENV)
 *  - Unknown flags default to false (fail-safe)
 *  - Rollout percentage is evaluated deterministically per sessionId
 *  - Admin operations require caller to supply updatedBy identity
 */

import { eq, and } from "drizzle-orm";
import { db, aiFeatureFlagsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import type { FeatureFlag } from "@workspace/db";

// ── V4.2 well-known flag keys ─────────────────────────────────────────────────

export const FLAG_KEYS = {
  GOAL_DISCOVERY_ENABLED: "v4_2_goal_discovery_enabled",
  SOLUTION_COLLECTIONS_ENABLED: "v4_2_solution_collections_enabled",
  DISCOVERY_ANALYTICS_ENABLED: "v4_2_discovery_analytics_enabled",
  NEW_MARKETPLACE_DEFAULT: "v4_2_new_marketplace_default",
} as const;

export type FlagKey = (typeof FLAG_KEYS)[keyof typeof FLAG_KEYS];

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  flags: Map<string, FeatureFlag>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache: Map<string, CacheEntry> = new Map(); // keyed by environment

async function getFlagsForEnvironment(environment: string): Promise<Map<string, FeatureFlag>> {
  const cached = cache.get(environment);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.flags;
  }

  try {
    const rows = await db
      .select()
      .from(aiFeatureFlagsTable)
      .where(eq(aiFeatureFlagsTable.environment, environment));

    const flags = new Map<string, FeatureFlag>();
    for (const row of rows) flags.set(row.flagKey, row);
    cache.set(environment, { flags, fetchedAt: Date.now() });
    return flags;
  } catch (err) {
    logger.warn({ err }, "[feature-flags] failed to load flags — defaulting to false");
    return cached?.flags ?? new Map();
  }
}

function invalidateCache(environment: string): void {
  cache.delete(environment);
}

// ── Deterministic rollout percentage ──────────────────────────────────────────
// Uses a simple hash of sessionId to determine if a session is in the rollout.

function isInRollout(sessionId: string, rolloutPercent: number): boolean {
  if (rolloutPercent <= 0) return false;
  if (rolloutPercent >= 100) return true;

  let hash = 5381;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 33) ^ sessionId.charCodeAt(i);
  }
  const bucket = Math.abs(hash) % 100;
  return bucket < rolloutPercent;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Check if a flag is enabled for the current environment + optional session. */
export async function isFlagEnabled(
  flagKey: string,
  opts: { sessionId?: string } = {},
): Promise<boolean> {
  const environment = process.env["NODE_ENV"] === "production" ? "production" : "development";

  try {
    const flags = await getFlagsForEnvironment(environment);
    const flag = flags.get(flagKey);

    if (!flag) return false; // unknown flag → safe default
    if (!flag.enabled) return false;
    if (opts.sessionId) {
      return isInRollout(opts.sessionId, flag.rolloutPercent);
    }
    return flag.rolloutPercent >= 100;
  } catch (err) {
    logger.warn({ err, flagKey }, "[feature-flags] evaluation failed — returning false");
    return false;
  }
}

/** Get all flags for the current environment (admin use). */
export async function getAllFlags(): Promise<FeatureFlag[]> {
  const environment = process.env["NODE_ENV"] === "production" ? "production" : "development";
  const flags = await getFlagsForEnvironment(environment);
  return Array.from(flags.values());
}

/** Upsert a feature flag (admin only). */
export async function upsertFlag(opts: {
  flagKey: string;
  description?: string;
  enabled: boolean;
  rolloutPercent?: number;
  updatedBy: string;
  environment?: string;
}): Promise<FeatureFlag> {
  const environment = opts.environment ?? (process.env["NODE_ENV"] === "production" ? "production" : "development");

  const [row] = await db
    .insert(aiFeatureFlagsTable)
    .values({
      flagKey: opts.flagKey,
      description: opts.description,
      enabled: opts.enabled,
      environment,
      rolloutPercent: opts.rolloutPercent ?? (opts.enabled ? 100 : 0),
      updatedBy: opts.updatedBy,
    })
    .onConflictDoUpdate({
      target: [aiFeatureFlagsTable.flagKey, aiFeatureFlagsTable.environment],
      set: {
        enabled: opts.enabled,
        rolloutPercent: opts.rolloutPercent ?? (opts.enabled ? 100 : 0),
        description: opts.description,
        updatedBy: opts.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();

  invalidateCache(environment);
  logger.info({ flagKey: opts.flagKey, enabled: opts.enabled, updatedBy: opts.updatedBy }, "[feature-flags] flag updated");
  return row;
}

/** Seed the default V4.2 flags if they don't exist. Idempotent. */
export async function seedDefaultFlags(): Promise<void> {
  const environments = ["development", "production"];
  const defaults: Array<{
    flagKey: string;
    description: string;
    enabled: boolean;
    rolloutPercent: number;
  }> = [
    {
      flagKey: FLAG_KEYS.GOAL_DISCOVERY_ENABLED,
      description: "Enables V4.2 goal-based discovery section in marketplace",
      enabled: false,
      rolloutPercent: 0,
    },
    {
      flagKey: FLAG_KEYS.SOLUTION_COLLECTIONS_ENABLED,
      description: "Enables V4.2 solution collections in marketplace",
      enabled: false,
      rolloutPercent: 0,
    },
    {
      flagKey: FLAG_KEYS.DISCOVERY_ANALYTICS_ENABLED,
      description: "Enables V4.2 analytics event capture",
      enabled: true,
      rolloutPercent: 100,
    },
    {
      flagKey: FLAG_KEYS.NEW_MARKETPLACE_DEFAULT,
      description: "Makes V4.2 marketplace the default experience",
      enabled: false,
      rolloutPercent: 0,
    },
  ];

  for (const env of environments) {
    for (const flag of defaults) {
      await db
        .insert(aiFeatureFlagsTable)
        .values({ ...flag, environment: env, updatedBy: "system/seed" })
        .onConflictDoNothing();
    }
  }

  cache.clear();
  logger.info("[feature-flags] default V4.2 flags seeded");
}
