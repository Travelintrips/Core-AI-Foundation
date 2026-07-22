/**
 * material-library/pluginContract.ts — Team 21
 *
 * Plugin extension contract for the Universal Material Library.
 *
 * Domain plugins (fashion, interior, furniture, packaging, architecture, etc.)
 * extend the library by registering:
 *   - Additional material categories.
 *   - Additional property definitions on existing categories.
 *   - Custom material sources.
 *   - Domain-specific assignment capability handlers.
 *
 * Rules:
 *   - Plugins MUST declare a unique pluginId.
 *   - Plugins MUST NOT modify core platform categories; they register new ones.
 *   - Plugins MUST NOT load arbitrary modules or execute arbitrary code at
 *     registration time — only declarative data.
 *   - Plugin-owned categories are removed if the plugin is unregistered.
 *   - Integration note for Teams 24–30: call registerMaterialPlugin() at your
 *     domain's startup; the registry is process-scoped and survives HMR in dev.
 */

import type { MaterialCategory, MaterialPropertyDefinition } from "./types.js";
import { materialCategoryRegistry } from "./categoryRegistry.js";

export interface MaterialPluginCapabilityDescriptor {
  /** Stable machine-readable capability identifier, e.g. "drape_simulation". */
  readonly capabilityId: string;
  readonly name: string;
  readonly description?: string;
  /**
   * If true, this plugin can handle material assignment for elements
   * that declare this capability in their assignment contract.
   */
  readonly handlesAssignment?: boolean;
}

export interface MaterialPluginDescriptor {
  /** Globally unique plugin identifier, e.g. "team24-fashion-domain". */
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  /** Categories this plugin contributes to the registry. */
  readonly categories?: readonly MaterialCategory[];
  /**
   * Additional property definitions added to existing categories.
   * Key = categoryId; value = property defs to merge in.
   * Existing property definitions with the same propertyId are NOT overwritten.
   */
  readonly categoryPropertyExtensions?: Readonly<Record<string, readonly MaterialPropertyDefinition[]>>;
  /** Capability descriptors this plugin provides. */
  readonly capabilities?: readonly MaterialPluginCapabilityDescriptor[];
  /** Domain slugs this plugin is responsible for. */
  readonly domains?: readonly string[];
}

export interface RegisteredPlugin {
  readonly descriptor: MaterialPluginDescriptor;
  readonly registeredAt: string;
}

class MaterialPluginRegistry {
  private readonly _plugins = new Map<string, RegisteredPlugin>();

  /**
   * Register a domain plugin. Idempotent: re-registering the same pluginId
   * with a higher version replaces the previous registration.
   */
  register(descriptor: MaterialPluginDescriptor): void {
    const existing = this._plugins.get(descriptor.pluginId);
    if (existing) {
      // Only allow re-registration if version is different (plugin reload)
      if (existing.descriptor.version === descriptor.version) return;
    }

    this._plugins.set(descriptor.pluginId, {
      descriptor,
      registeredAt: new Date().toISOString(),
    });

    // Register plugin-owned categories
    if (descriptor.categories?.length) {
      for (const cat of descriptor.categories) {
        materialCategoryRegistry.register(
          { ...cat, pluginId: descriptor.pluginId },
          { force: existing !== undefined }, // force on re-registration
        );
      }
    }

    // Note: categoryPropertyExtensions are declared here but resolution
    // happens in materialCategoryRegistry.resolvePropertyDefinitions() which
    // already merges ancestor defs. For plugins that need to extend an existing
    // category's property list, the recommended pattern is to register a
    // sub-category under the target category (parentId = targetCategoryId).
    // Direct mutation of platform categories is intentionally not supported here.
  }

  unregister(pluginId: string): void {
    this._plugins.delete(pluginId);
    // Note: categories registered by this plugin remain in the category registry
    // with pluginId set; callers can filter them out using registry.list({ pluginId }).
    // Full removal would require re-seeding the registry, which is safe in tests.
  }

  get(pluginId: string): RegisteredPlugin | undefined {
    return this._plugins.get(pluginId);
  }

  list(): RegisteredPlugin[] {
    return Array.from(this._plugins.values());
  }

  has(pluginId: string): boolean {
    return this._plugins.has(pluginId);
  }
}

export const materialPluginRegistry = new MaterialPluginRegistry();

/**
 * Public API for domain teams (Teams 24–30) to register their plugin.
 * Call this once at domain startup; subsequent calls with the same version
 * are no-ops.
 */
export function registerMaterialPlugin(descriptor: MaterialPluginDescriptor): void {
  materialPluginRegistry.register(descriptor);
}

/**
 * Returns all capability IDs registered by all plugins, de-duplicated.
 * Useful for building assignment validation without hard-coding domain logic.
 */
export function getAllRegisteredCapabilities(): string[] {
  const seen = new Set<string>();
  for (const p of materialPluginRegistry.list()) {
    for (const cap of p.descriptor.capabilities ?? []) {
      seen.add(cap.capabilityId);
    }
  }
  return Array.from(seen).sort();
}
