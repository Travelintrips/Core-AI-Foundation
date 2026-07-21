/**
 * AssetSourceRegistry.ts — Deterministic, permission-aware source registry (Team 14)
 *
 * Sources are registered statically (no arbitrary external URLs). Plugins from
 * Team 24+ domain layers contribute source metadata through the contract below.
 * No second source of truth — this registry is additive over existing storage.
 */

import type { AssetSourceRegistration, AssetSourceId } from "./types";

// ── Built-in source registrations ─────────────────────────────────────────────

const BUILTIN_SOURCES: AssetSourceRegistration[] = [
  {
    id: "project_assets",
    label: "Project Assets",
    description: "Assets attached to the current design project",
    requiresAdmin: false,
  },
  {
    id: "brand_library",
    label: "Brand Library",
    description: "Customer enterprise brand asset library",
    requiresAdmin: false,
  },
  {
    id: "generated_artifacts",
    label: "Generated Artifacts",
    description: "AI-generated images and design artifacts",
    requiresAdmin: false,
  },
  {
    id: "uploaded_references",
    label: "Uploaded References",
    description: "User-uploaded reference files",
    requiresAdmin: false,
  },
  {
    id: "shared_approved",
    label: "Shared Approved Library",
    description: "Platform-wide approved shared assets",
    requiresAdmin: true,
  },
];

// ── Registry class ─────────────────────────────────────────────────────────────

class AssetSourceRegistryImpl {
  private readonly sources = new Map<AssetSourceId, AssetSourceRegistration>();

  constructor(builtins: AssetSourceRegistration[]) {
    for (const s of builtins) {
      this.sources.set(s.id, s);
    }
  }

  /**
   * Register a plugin-contributed source. Throws if id already registered.
   * Call once at app startup — not inside render.
   */
  register(registration: AssetSourceRegistration): void {
    if (this.sources.has(registration.id)) {
      throw new Error(
        `[AssetSourceRegistry] Source "${registration.id}" is already registered. ` +
          `Each source ID must be unique. Rename the plugin source ID to avoid conflicts.`,
      );
    }
    this.sources.set(registration.id, registration);
  }

  /** List sources the current user is allowed to see. */
  list(options?: { adminMode?: boolean }): AssetSourceRegistration[] {
    const adminMode = options?.adminMode ?? false;
    return Array.from(this.sources.values()).filter(
      (s) => !s.requiresAdmin || adminMode,
    );
  }

  get(id: AssetSourceId): AssetSourceRegistration | undefined {
    return this.sources.get(id);
  }

  has(id: AssetSourceId): boolean {
    return this.sources.has(id);
  }

  /** Returns source label for display, falls back to the raw id. */
  labelFor(id: AssetSourceId): string {
    return this.sources.get(id)?.label ?? id;
  }
}

/** Singleton registry — import and use directly. */
export const AssetSourceRegistry = new AssetSourceRegistryImpl(BUILTIN_SOURCES);

export type { AssetSourceRegistration };
