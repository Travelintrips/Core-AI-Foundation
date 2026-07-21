/**
 * Register all built-in field renderers into the global renderer registry.
 * Import this module once at app startup (e.g. in main.tsx or the shell).
 */

import { globalRendererRegistry } from "../registry";
import { BUILT_IN_RENDERERS } from "./built-in";

let _registered = false;

export function registerBuiltInRenderers(): void {
  if (_registered) return;
  for (const r of BUILT_IN_RENDERERS) {
    globalRendererRegistry.register(r);
  }
  _registered = true;
}

// Auto-register on import (tree-shakeable side-effect)
registerBuiltInRenderers();

export { BUILT_IN_RENDERERS };
