/**
 * Domain Plugin Framework — Registration Hooks (Team 07)
 *
 * Provides a typed hook system for other server subsystems to react
 * when plugins are registered, enabled, or disabled.
 *
 * SECURITY: Hooks run server-side only.  They are never exposed to
 * clients and are never sourced from plugin manifests.
 */

import type { RegistryEntry, PluginStatus } from "./types.js";

export type PluginHookEvent =
  | { type: "registered"; entry: RegistryEntry }
  | { type: "enabled"; pluginId: string }
  | { type: "disabled"; pluginId: string }
  | { type: "statusChanged"; pluginId: string; from: PluginStatus; to: PluginStatus };

export type PluginHookHandler = (event: PluginHookEvent) => void | Promise<void>;

const handlers: PluginHookHandler[] = [];

/**
 * Subscribe to plugin lifecycle events.
 * Returns an unsubscribe function.
 */
export function onPluginEvent(handler: PluginHookHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  };
}

/**
 * Dispatch a plugin lifecycle event to all subscribers.
 * Handler errors are swallowed so a bad hook cannot crash the registry.
 */
export async function dispatchPluginEvent(event: PluginHookEvent): Promise<void> {
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch {
      // Intentionally swallowed — hooks must not crash the framework.
    }
  }
}

/** Remove all registered hooks.  For use in tests only. */
export function _clearHooks(): void {
  handlers.length = 0;
}
