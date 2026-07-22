/**
 * designFeatureFlag.ts — Team 38: Design Migration
 *
 * Extends the existing featureFlagService with Universal Design Platform
 * flag keys and a seed helper.
 *
 * Rules:
 *  - Re-exports isFlagEnabled / upsertFlag from the existing service so
 *    callers don't need to import from two places.
 *  - All design flags default to disabled (rolloutPercent=0) — no feature
 *    is turned on by this seeder; that is a deliberate admin action.
 *  - seedDesignFlags() is idempotent (onConflictDoNothing).
 *  - No hard-coded environment switches — environment is always derived
 *    server-side from NODE_ENV inside isFlagEnabled().
 */

import { db, aiFeatureFlagsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { isFlagEnabled, upsertFlag } from "../featureFlagService.js";
import { DESIGN_FLAG_KEYS, type DesignFlagKey } from "./designMigrationTypes.js";

// Re-export shared utilities so callers only need one import
export { isFlagEnabled, upsertFlag };
export { DESIGN_FLAG_KEYS, type DesignFlagKey };

// ── Check helpers ─────────────────────────────────────────────────────────────

/** Returns true when the Universal Design Workspace flag is on for this session. */
export async function isDesignWorkspaceEnabled(opts: { sessionId?: string } = {}): Promise<boolean> {
  return isFlagEnabled(DESIGN_FLAG_KEYS.UNIVERSAL_DESIGN_WORKSPACE, opts);
}

/** Returns true when the Dynamic Brief flag is on for this session. */
export async function isDynamicBriefEnabled(opts: { sessionId?: string } = {}): Promise<boolean> {
  return isFlagEnabled(DESIGN_FLAG_KEYS.DYNAMIC_DESIGN_BRIEF, opts);
}

/** Returns true when the Plugin Runtime flag is on for this session. */
export async function isPluginRuntimeEnabled(opts: { sessionId?: string } = {}): Promise<boolean> {
  return isFlagEnabled(DESIGN_FLAG_KEYS.DESIGN_PLUGIN_RUNTIME, opts);
}

/** Returns true when the Material Library flag is on for this session. */
export async function isMaterialLibraryEnabled(opts: { sessionId?: string } = {}): Promise<boolean> {
  return isFlagEnabled(DESIGN_FLAG_KEYS.DESIGN_MATERIAL_LIBRARY, opts);
}

/** Returns true when the Component Library flag is on for this session. */
export async function isComponentLibraryEnabled(opts: { sessionId?: string } = {}): Promise<boolean> {
  return isFlagEnabled(DESIGN_FLAG_KEYS.DESIGN_COMPONENT_LIBRARY, opts);
}

/** Returns true when the AI Orchestration flag is on for this session. */
export async function isAiOrchestrationEnabled(opts: { sessionId?: string } = {}): Promise<boolean> {
  return isFlagEnabled(DESIGN_FLAG_KEYS.DESIGN_AI_ORCHESTRATION, opts);
}

/** Returns true when the Export Workspace flag is on for this session. */
export async function isExportWorkspaceEnabled(opts: { sessionId?: string } = {}): Promise<boolean> {
  return isFlagEnabled(DESIGN_FLAG_KEYS.DESIGN_EXPORT_WORKSPACE, opts);
}

/**
 * Returns a map of all design flag states for the current environment.
 * Useful for a single "feature context" fetch rather than N individual calls.
 */
export async function getDesignFlagContext(opts: {
  sessionId?: string;
} = {}): Promise<Record<DesignFlagKey, boolean>> {
  const entries = await Promise.all(
    Object.entries(DESIGN_FLAG_KEYS).map(async ([, flagKey]) => {
      const enabled = await isFlagEnabled(flagKey, opts);
      return [flagKey, enabled] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<DesignFlagKey, boolean>;
}

// ── Seeder ────────────────────────────────────────────────────────────────────

interface DesignFlagDef {
  flagKey: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
}

const DESIGN_FLAG_DEFAULTS: DesignFlagDef[] = [
  {
    flagKey: DESIGN_FLAG_KEYS.UNIVERSAL_DESIGN_WORKSPACE,
    description: "Universal Design Platform workspace — gates the new design UX for all flows",
    enabled: false,
    rolloutPercent: 0,
  },
  {
    flagKey: DESIGN_FLAG_KEYS.DYNAMIC_DESIGN_BRIEF,
    description: "Dynamic multi-step design brief (replaces legacy free-text brief_json)",
    enabled: false,
    rolloutPercent: 0,
  },
  {
    flagKey: DESIGN_FLAG_KEYS.DESIGN_PLUGIN_RUNTIME,
    description: "Design plugin runtime — loads registered design plugins at project start",
    enabled: false,
    rolloutPercent: 0,
  },
  {
    flagKey: DESIGN_FLAG_KEYS.DESIGN_MATERIAL_LIBRARY,
    description: "Material library — surfaces brand materials in the design workspace",
    enabled: false,
    rolloutPercent: 0,
  },
  {
    flagKey: DESIGN_FLAG_KEYS.DESIGN_COMPONENT_LIBRARY,
    description: "Component library — enables reusable design component picker in workspace",
    enabled: false,
    rolloutPercent: 0,
  },
  {
    flagKey: DESIGN_FLAG_KEYS.DESIGN_AI_ORCHESTRATION,
    description: "Design AI orchestration — routes brief through Universal Design AI agents",
    enabled: false,
    rolloutPercent: 0,
  },
  {
    flagKey: DESIGN_FLAG_KEYS.DESIGN_EXPORT_WORKSPACE,
    description: "Export workspace — enables multi-format export from Universal Design Platform",
    enabled: false,
    rolloutPercent: 0,
  },
];

/**
 * Seeds design feature flags for both development and production environments.
 * Idempotent — uses onConflictDoNothing so existing overrides are not reset.
 * All flags default to disabled; enabling is a deliberate admin action.
 */
export async function seedDesignFlags(): Promise<void> {
  const environments = ["development", "production"];

  for (const env of environments) {
    for (const flag of DESIGN_FLAG_DEFAULTS) {
      await db
        .insert(aiFeatureFlagsTable)
        .values({ ...flag, environment: env, updatedBy: "system/design-migration-team38" })
        .onConflictDoNothing();
    }
  }

  logger.info(
    { count: DESIGN_FLAG_DEFAULTS.length * environments.length },
    "[design-feature-flags] design flags seeded (idempotent)",
  );
}
