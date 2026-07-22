/**
 * Domain Plugin Framework — Plugin Loader (Team 07)
 *
 * Loads compiled-in domain plugins at server startup.
 * 
 * SECURITY rules enforced here:
 *   - No dynamic require() or eval of manifests.
 *   - No loading from URLs or arbitrary module paths.
 *   - No accepting module paths from clients.
 *   - Only plugins statically imported and passed to loadPlugins() run.
 *   - One failing optional plugin does not crash the application.
 */

import { registerPlugin } from "./registry.js";
import type { PluginWithHealthCheck } from "./diagnostics.js";
import type { RegistrationResult } from "./types.js";
import { logger } from "../../lib/logger.js";

export interface LoaderReport {
  loaded: number;
  failed: number;
  results: RegistrationResult[];
}

/**
 * Load a list of pre-imported plugin modules.
 *
 * Each plugin is an object with at minimum a `manifest` property.
 * An optional `healthCheck` function is called during registration.
 *
 * Errors in individual plugins are caught and logged; they do not
 * propagate and do not prevent other plugins from loading.
 *
 * Usage (in server startup):
 *   import * as fashionPlugin from "../domains/design-plugins/plugins/fashion.js";
 *   await loadPlugins([fashionPlugin]);
 */
export async function loadPlugins(
  plugins: PluginWithHealthCheck[],
): Promise<LoaderReport> {
  const results: RegistrationResult[] = [];
  let failed = 0;

  for (const plugin of plugins) {
    try {
      const result = await registerPlugin(plugin.manifest, plugin.healthCheck);
      results.push(result);
      if (!result.ok) failed++;
    } catch (err: unknown) {
      failed++;
      const id =
        typeof plugin.manifest === "object" && plugin.manifest !== null
          ? (plugin.manifest as Record<string, unknown>).id as string ?? "unknown"
          : "unknown";
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(
        { pluginId: id, err: reason },
        "[design-plugins] Unexpected error during plugin load — plugin skipped",
      );
      results.push({ ok: false, pluginId: id, reason });
    }
  }

  logger.info(
    { loaded: results.length - failed, failed, total: results.length },
    "[design-plugins] Plugin loading complete",
  );

  return { loaded: results.length - failed, failed, results };
}
