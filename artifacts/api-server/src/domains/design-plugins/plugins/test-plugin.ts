/**
 * Domain Plugin Framework — Minimal Test / Example Plugin (Team 07)
 *
 * This plugin is for framework testing and documentation purposes only.
 * It demonstrates the minimum required shape for a DesignPlugin.
 *
 * Real domain plugins (fashion, interior, …) live in their own
 * domain directories and follow the same pattern.
 *
 * Template: copy this file, replace the manifest values, add your
 * domain-specific contributions, and call loadPlugins([yourPlugin])
 * in the server startup sequence.
 */

import type { DesignPluginManifest } from "../types.js";
import { PLUGIN_CONTRACT_VERSION } from "../types.js";

export const manifest: DesignPluginManifest = {
  id: "test-plugin",
  version: "1.0.0",
  name: "Test Plugin",
  description: "Minimal plugin used by the framework test suite.",
  contractVersion: PLUGIN_CONTRACT_VERSION,
  contributions: {
    capabilityRefs: ["test-capability"],
    exportProfiles: [
      {
        profileId: "test-pdf",
        name: "Test PDF Export",
        format: "pdf",
      },
    ],
    localizationMetadata: {
      defaultLocale: "en",
      supportedLocales: ["en", "id"],
    },
  },
  // No tenantPolicy — available to all tenants.
  // No featureFlag — always enabled.
};

/**
 * Optional self-reported health check.
 * Return { healthy: false, notes: [...] } to signal a problem.
 */
export async function healthCheck(): Promise<{ healthy: boolean; notes?: string[] }> {
  return { healthy: true, notes: ["Test plugin operational"] };
}
