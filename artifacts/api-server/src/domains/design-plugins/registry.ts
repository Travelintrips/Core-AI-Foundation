/**
 * Domain Plugin Framework — Plugin Registry (Team 07)
 *
 * Singleton in-process registry.  Plugins are compiled into the server
 * package and registered at startup via registerPlugin().
 *
 * Thread-safety note: Node.js is single-threaded; the Map is safe.
 */

import type {
  DesignPluginManifest,
  PluginStatus,
  RegistryEntry,
  RegistrationResult,
} from "./types.js";
import { DesignPluginManifestSchema } from "./types.js";
import { checkCompatibility } from "./compatibility.js";
import { isFlagEnabled } from "./featureFlags.js";
import { runDiagnostics, type PluginWithHealthCheck } from "./diagnostics.js";
import { logger } from "../../lib/logger.js";

const registry = new Map<string, RegistryEntry>();

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a plugin with the framework.
 *
 * Fail-closed: invalid manifests are rejected; errors in one plugin
 * do not affect others.  The registry never stores a partially-valid entry.
 *
 * @param rawManifest — The plugin's manifest object (will be validated).
 * @param healthCheck — Optional self-reported health check fn from the plugin module.
 */
export async function registerPlugin(
  rawManifest: unknown,
  healthCheck?: PluginWithHealthCheck["healthCheck"],
): Promise<RegistrationResult> {
  // 1. Validate manifest shape
  const parsed = DesignPluginManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    logger.warn({ reason }, "[design-plugins] Plugin registration rejected — invalid manifest");
    // Use a best-effort ID for the result
    const id = (rawManifest as Record<string, unknown>)?.id as string ?? "unknown";
    return { ok: false, pluginId: id, reason: `Invalid manifest: ${reason}` };
  }

  const manifest: DesignPluginManifest = parsed.data;

  // 2. Contract version compatibility
  const compat = checkCompatibility(manifest.contractVersion);
  if (!compat.compatible) {
    logger.warn(
      { pluginId: manifest.id, reason: compat.reason },
      "[design-plugins] Plugin incompatible — contract version mismatch",
    );
    registry.set(manifest.id, buildEntry(manifest, "incompatible", [compat.reason!]));
    return { ok: false, pluginId: manifest.id, reason: compat.reason! };
  }

  // 3. Duplicate / collision detection
  if (registry.has(manifest.id)) {
    const existing = registry.get(manifest.id)!;
    if (existing.manifest.version === manifest.version) {
      logger.warn(
        { pluginId: manifest.id, version: manifest.version },
        "[design-plugins] Duplicate plugin ID+version — keeping existing",
      );
      return {
        ok: false,
        pluginId: manifest.id,
        reason: `Duplicate plugin: '${manifest.id}@${manifest.version}' is already registered`,
      };
    }
    // Different version — replace (newer registration wins)
    logger.info(
      { pluginId: manifest.id, from: existing.manifest.version, to: manifest.version },
      "[design-plugins] Plugin version updated",
    );
  }

  // 4. Determine initial status
  let status: PluginStatus = "registered";
  const featureFlag = manifest.featureFlag;
  if (featureFlag && !isFlagEnabled(featureFlag)) {
    status = "disabled";
  } else {
    status = "enabled";
  }

  // 5. Diagnostics (fail-closed — error here marks unhealthy, not a crash)
  const diagnostics = await runDiagnostics({ manifest, healthCheck });
  if (!diagnostics.healthy && status === "enabled") {
    status = "unhealthy";
  }

  const entry: RegistryEntry = {
    manifest,
    status,
    registeredAt: new Date(),
    diagnostics,
  };

  registry.set(manifest.id, entry);
  logger.info(
    { pluginId: manifest.id, version: manifest.version, status },
    "[design-plugins] Plugin registered",
  );

  return { ok: true, pluginId: manifest.id, status };
}

// ── Resolution ────────────────────────────────────────────────────────────────

/** Get a single registry entry by plugin ID, or undefined. */
export function resolvePlugin(pluginId: string): RegistryEntry | undefined {
  return registry.get(pluginId);
}

/** List all registry entries. */
export function listPlugins(): RegistryEntry[] {
  return Array.from(registry.values());
}

/** List only entries with a given status. */
export function listPluginsByStatus(status: PluginStatus): RegistryEntry[] {
  return listPlugins().filter((e) => e.status === status);
}

// ── Lifecycle mutations ───────────────────────────────────────────────────────

/** Enable a registered plugin.  No-op if already enabled. */
export function enablePlugin(pluginId: string): boolean {
  const entry = registry.get(pluginId);
  if (!entry) return false;
  if (entry.status === "incompatible") return false; // cannot enable incompatible
  entry.status = "enabled";
  return true;
}

/** Disable a registered plugin.  Incompatible plugins remain incompatible. */
export function disablePlugin(pluginId: string): boolean {
  const entry = registry.get(pluginId);
  if (!entry) return false;
  if (entry.status === "incompatible") return false;
  entry.status = "disabled";
  return true;
}

/** Re-run diagnostics and update entry status. */
export async function refreshPluginHealth(
  pluginId: string,
  healthCheck?: PluginWithHealthCheck["healthCheck"],
): Promise<RegistryEntry | undefined> {
  const entry = registry.get(pluginId);
  if (!entry) return undefined;

  const diagnostics = await runDiagnostics({
    manifest: entry.manifest,
    healthCheck,
  });

  entry.diagnostics = diagnostics;
  if (entry.status === "enabled" && !diagnostics.healthy) {
    entry.status = "unhealthy";
  } else if (entry.status === "unhealthy" && diagnostics.healthy) {
    entry.status = "enabled";
  }

  return entry;
}

// ── Test helpers (not exported from index — internal use only) ────────────────

/** Clear the registry.  Only for use in tests. */
export function _resetRegistry(): void {
  registry.clear();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildEntry(
  manifest: DesignPluginManifest,
  status: PluginStatus,
  notes: string[],
): RegistryEntry {
  return {
    manifest,
    status,
    registeredAt: new Date(),
    diagnostics: { lastCheckedAt: new Date(), healthy: false, notes },
  };
}
