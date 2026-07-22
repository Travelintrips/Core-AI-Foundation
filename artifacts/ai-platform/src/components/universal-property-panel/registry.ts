/**
 * Universal Property Panel — Registries
 *
 * PropertySectionRegistry    — sections (core + plugins)
 * PropertyFieldRendererRegistry — field renderers (core + plugins)
 *
 * Rules:
 * - Duplicate section IDs are rejected (throws).
 * - Ordering: explicit `order` first, then registration order as tiebreaker.
 * - Visibility and capability conditions are evaluated at render time.
 * - No switch on service type — plugin-supplied sections handle domain logic.
 * - Missing renderer generates a diagnostic, not a crash.
 */

import type {
  PropertySectionDefinition,
  PropertyFieldRenderer,
  PropertyPanelContext,
  PluginPropertyRegistration,
} from "./types";

// ── PropertySectionRegistry ───────────────────────────────────────────────────

interface StoredSection extends PropertySectionDefinition {
  /** Monotonically increasing counter for stable tiebreaking */
  _seq: number;
}

export class PropertySectionRegistry {
  private readonly _sections = new Map<string, StoredSection>();
  private _seq = 0;

  /**
   * Register a section. Throws on duplicate ID.
   * Safe to call from plugin initialization (before first render).
   */
  register(section: PropertySectionDefinition): void {
    if (this._sections.has(section.id)) {
      throw new Error(
        `PropertySectionRegistry: duplicate section id "${section.id}". ` +
          `Each section must have a globally unique ID.`,
      );
    }
    this._sections.set(section.id, { ...section, _seq: this._seq++ });
  }

  /** Remove a section (plugin teardown / hot-reload). */
  unregister(id: string): void {
    this._sections.delete(id);
  }

  /**
   * Return sections visible to the given context, sorted by order.
   * Evaluates visibility conditions and capability requirements.
   */
  getSections(ctx: PropertyPanelContext): PropertySectionDefinition[] {
    const visible: StoredSection[] = [];

    for (const section of this._sections.values()) {
      // Visibility condition
      const vis =
        typeof section.visible === "function"
          ? section.visible(ctx)
          : section.visible;
      if (vis === false) continue;

      // Capability requirement
      if (section.capabilities && section.capabilities.length > 0) {
        const hasAll = section.capabilities.every((cap) =>
          ctx.capabilities.includes(cap),
        );
        if (!hasAll) continue;
      }

      visible.push(section);
    }

    // Sort: explicit order first, then registration sequence
    return visible.sort((a, b) => {
      const oa = a.order ?? Infinity;
      const ob = b.order ?? Infinity;
      if (oa !== ob) return oa - ob;
      return a._seq - b._seq;
    });
  }

  /** Number of registered sections (including hidden ones). */
  get size(): number {
    return this._sections.size;
  }

  /** All registered section IDs (for diagnostics). */
  get ids(): string[] {
    return Array.from(this._sections.keys());
  }

  /** Diagnostic messages (missing fields, etc.) */
  getDiagnostics(ctx: PropertyPanelContext): string[] {
    const msgs: string[] = [];
    for (const section of this._sections.values()) {
      if (!section.fields || section.fields.length === 0) {
        msgs.push(`Section "${section.id}" has no fields.`);
      }
      for (const field of section.fields ?? []) {
        if (!field.id) {
          msgs.push(`Section "${section.id}" has a field with no id.`);
        }
        if (!field.label || field.label.trim() === "") {
          msgs.push(
            `Field "${field.id}" in section "${section.id}" has an empty label.`,
          );
        }
      }
    }
    return msgs;
  }
}

// ── PropertyFieldRendererRegistry ─────────────────────────────────────────────

export class PropertyFieldRendererRegistry {
  private readonly _renderers = new Map<string, PropertyFieldRenderer>();
  private readonly _diagnostics: string[] = [];

  /** Register a renderer. Overwrites previous for same type (last wins). */
  register(renderer: PropertyFieldRenderer): void {
    this._renderers.set(renderer.type, renderer);
  }

  /**
   * Resolve a renderer for a field type.
   * Returns null and records a diagnostic if not found.
   */
  resolve(type: string): PropertyFieldRenderer | null {
    const r = this._renderers.get(type);
    if (!r) {
      const msg = `PropertyFieldRendererRegistry: no renderer registered for field type "${type}".`;
      // Deduplicate
      if (!this._diagnostics.includes(msg)) {
        this._diagnostics.push(msg);
      }
      return null;
    }
    return r;
  }

  has(type: string): boolean {
    return this._renderers.has(type);
  }

  /** All registered type keys. */
  get types(): string[] {
    return Array.from(this._renderers.keys());
  }

  /** Diagnostic messages (missing renderers, etc.) */
  getDiagnostics(): string[] {
    return [...this._diagnostics];
  }

  clearDiagnostics(): void {
    this._diagnostics.length = 0;
  }
}

// ── Global singletons ─────────────────────────────────────────────────────────
// Exported as singletons so plugin code can import and call register()
// without needing to thread the registry through props.
// The shell also accepts explicit instances for testability / isolation.

export const globalSectionRegistry = new PropertySectionRegistry();
export const globalRendererRegistry = new PropertyFieldRendererRegistry();

// ── Plugin API surface ────────────────────────────────────────────────────────

/**
 * Create the public plugin registration object from a pair of registries.
 * Plugins receive this and MUST NOT import internal state.
 */
export function createPluginRegistration(
  sectionRegistry: PropertySectionRegistry,
  rendererRegistry: PropertyFieldRendererRegistry,
): PluginPropertyRegistration {
  return {
    registerSection(section) {
      sectionRegistry.register(section);
    },
    registerFieldRenderer(renderer) {
      rendererRegistry.register(renderer);
    },
  };
}
