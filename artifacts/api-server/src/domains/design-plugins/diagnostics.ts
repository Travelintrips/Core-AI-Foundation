/**
 * Domain Plugin Framework — Plugin Health & Diagnostics (Team 07)
 *
 * Runs a lightweight health check on a registered plugin and returns
 * a diagnostics object.  Plugins can optionally expose a healthCheck()
 * function on their module; if they don't, the framework performs a
 * structural check instead.
 */

import type { DesignPluginManifest, PluginDiagnostics } from "./types.js";
import { checkCompatibility } from "./compatibility.js";

export interface PluginWithHealthCheck {
  manifest: DesignPluginManifest;
  /** Optional — plugin module may export this */
  healthCheck?: () => Promise<{ healthy: boolean; notes?: string[] }>;
}

/**
 * Run diagnostics for a plugin.
 * Fail-closed: any unexpected error marks the plugin unhealthy rather
 * than propagating upward.
 */
export async function runDiagnostics(
  plugin: PluginWithHealthCheck,
): Promise<PluginDiagnostics> {
  const notes: string[] = [];
  let healthy = true;

  try {
    // 1. Contract version
    const compat = checkCompatibility(plugin.manifest.contractVersion);
    if (!compat.compatible) {
      notes.push(`Contract incompatible: ${compat.reason}`);
      healthy = false;
    }

    // 2. Required manifest fields
    if (!plugin.manifest.id) {
      notes.push("Missing required field: id");
      healthy = false;
    }
    if (!plugin.manifest.version) {
      notes.push("Missing required field: version");
      healthy = false;
    }

    // 3. Optional self-reported health check
    if (plugin.healthCheck) {
      const result = await plugin.healthCheck();
      if (!result.healthy) {
        healthy = false;
        notes.push(...(result.notes ?? ["Plugin self-reported unhealthy"]));
      } else {
        notes.push(...(result.notes ?? []));
      }
    }
  } catch (err: unknown) {
    healthy = false;
    notes.push(
      `Diagnostics threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    lastCheckedAt: new Date(),
    healthy,
    notes,
  };
}
