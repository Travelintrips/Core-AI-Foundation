/**
 * nullDesignPluginResolver.ts — In-memory stub for testing
 * TEAM 02 OWNED — feature/team-02-universal-design-engine
 */
import type { DesignPluginResolver } from "../ports.js";
import type { DesignPluginManifest } from "../types.js";

export class NullDesignPluginResolver implements DesignPluginResolver {
  private readonly registry = new Map<string, DesignPluginManifest>();

  register(manifest: DesignPluginManifest): void {
    this.registry.set(manifest.pluginId, manifest);
  }

  async resolve(pluginId: string): Promise<DesignPluginManifest | undefined> {
    return this.registry.get(pluginId);
  }
}
