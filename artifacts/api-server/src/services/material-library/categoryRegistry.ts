/**
 * material-library/categoryRegistry.ts — Team 21
 *
 * In-process category registry for the Universal Material Library.
 *
 * Design rules:
 *   - Duplicate categoryId is rejected at registration time.
 *   - Hierarchy is validated lazily (parentId must reference a known category).
 *   - Ordering is deterministic: sortOrder ASC, then name ASC.
 *   - Platform-seeded categories are registered at startup; plugin categories
 *     are registered via the PluginContract.
 *   - Unknown category access returns a well-typed sentinel, never throws.
 */

import type { MaterialCategory, MaterialPropertyDefinition, FeatureStability } from "./types.js";

export class DuplicateCategoryError extends Error {
  constructor(categoryId: string) {
    super(`Material category "${categoryId}" is already registered`);
    this.name = "DuplicateCategoryError";
  }
}

export class UnknownCategoryError extends Error {
  constructor(categoryId: string) {
    super(`Material category "${categoryId}" is not registered`);
    this.name = "UnknownCategoryError";
  }
}

// Sentinel returned by getCategory when the ID is unknown
export const UNKNOWN_CATEGORY_SENTINEL: MaterialCategory = {
  categoryId: "__unknown__",
  name: "Unknown Category",
  description: "Category is not registered in this registry",
  parentId: null,
  sortOrder: Number.MAX_SAFE_INTEGER,
  pluginId: null,
  applicableDomains: [],
  stability: "experimental" as FeatureStability,
  capabilities: [],
  propertyDefinitions: [],
};

export interface CategoryRegistryEntry extends MaterialCategory {
  readonly _registeredAt: string; // ISO-8601
}

export class MaterialCategoryRegistry {
  private readonly _entries = new Map<string, CategoryRegistryEntry>();

  /**
   * Register a new category. Throws DuplicateCategoryError if the ID already exists.
   * Use `force: true` only for plugin hot-reload scenarios — document why.
   */
  register(category: MaterialCategory, opts: { force?: boolean } = {}): void {
    if (this._entries.has(category.categoryId) && !opts.force) {
      throw new DuplicateCategoryError(category.categoryId);
    }
    this._entries.set(category.categoryId, {
      ...category,
      _registeredAt: new Date().toISOString(),
    });
  }

  /** Register multiple categories. Stops at first duplicate unless force: true. */
  registerAll(categories: MaterialCategory[], opts: { force?: boolean } = {}): void {
    for (const cat of categories) {
      this.register(cat, opts);
    }
  }

  /** Returns the category or undefined if unknown. Prefer getOrUnknown for safe access. */
  get(categoryId: string): CategoryRegistryEntry | undefined {
    return this._entries.get(categoryId);
  }

  /** Returns the category or the UNKNOWN_CATEGORY_SENTINEL — never throws. */
  getOrUnknown(categoryId: string): MaterialCategory {
    return this._entries.get(categoryId) ?? UNKNOWN_CATEGORY_SENTINEL;
  }

  /** Returns the category or throws UnknownCategoryError. */
  getOrThrow(categoryId: string): CategoryRegistryEntry {
    const entry = this._entries.get(categoryId);
    if (!entry) throw new UnknownCategoryError(categoryId);
    return entry;
  }

  has(categoryId: string): boolean {
    return this._entries.has(categoryId);
  }

  /**
   * List all registered categories, sorted deterministically:
   * sortOrder ASC, then name ASC.
   */
  list(opts: { domain?: string; pluginId?: string | null } = {}): CategoryRegistryEntry[] {
    let entries = Array.from(this._entries.values());

    if (opts.domain !== undefined) {
      entries = entries.filter(
        (e) => e.applicableDomains.length === 0 || e.applicableDomains.includes(opts.domain!),
      );
    }

    if (opts.pluginId !== undefined) {
      entries = entries.filter((e) => e.pluginId === opts.pluginId);
    }

    return entries.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Returns children of parentId in sorted order.
   * Passing null returns root categories (no parent).
   */
  getChildren(parentId: string | null): CategoryRegistryEntry[] {
    return Array.from(this._entries.values())
      .filter((e) => (e.parentId ?? null) === parentId)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Returns the full ancestor chain for a categoryId, root-first.
   * Returns an empty array if the category has no parent.
   */
  getAncestors(categoryId: string): CategoryRegistryEntry[] {
    const ancestors: CategoryRegistryEntry[] = [];
    let current = this._entries.get(categoryId);
    const visited = new Set<string>();
    while (current?.parentId) {
      if (visited.has(current.parentId)) break; // cycle guard
      visited.add(current.parentId);
      const parent = this._entries.get(current.parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      current = parent;
    }
    return ancestors;
  }

  /** Returns all property definitions for a category (category + all ancestors). */
  resolvePropertyDefinitions(categoryId: string): MaterialPropertyDefinition[] {
    const ancestors = this.getAncestors(categoryId);
    const self = this._entries.get(categoryId);
    const chain = self ? [...ancestors, self] : ancestors;
    const seen = new Set<string>();
    const defs: MaterialPropertyDefinition[] = [];
    for (const cat of chain) {
      for (const def of cat.propertyDefinitions) {
        if (!seen.has(def.propertyId)) {
          seen.add(def.propertyId);
          defs.push(def);
        }
      }
    }
    return defs;
  }

  count(): number {
    return this._entries.size;
  }

  reset(): void {
    this._entries.clear();
  }
}

// ── Singleton registry with platform-seeded categories ────────────────────────

export const materialCategoryRegistry = new MaterialCategoryRegistry();

/**
 * Platform-provided seed categories.
 * These are fixtures, not mandatory core logic — plugins and domains
 * can extend the list without touching this file.
 */
const PLATFORM_CATEGORIES: MaterialCategory[] = [
  {
    categoryId: "textile",
    name: "Textile",
    description: "Woven, knitted, and non-woven fabrics",
    parentId: null,
    sortOrder: 10,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["preview_swatch", "drape_simulation"],
    propertyDefinitions: [
      { propertyId: "weight_gsm", name: "Weight (g/m²)", type: "number", unit: "g/m²", required: false },
      { propertyId: "composition", name: "Fiber Composition", type: "text", required: false },
      { propertyId: "stretch_pct", name: "Stretch %", type: "percentage", required: false },
    ],
  },
  {
    categoryId: "wood",
    name: "Wood",
    description: "Natural and engineered wood materials",
    parentId: null,
    sortOrder: 20,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["grain_texture", "preview_swatch"],
    propertyDefinitions: [
      { propertyId: "density_kg_m3", name: "Density (kg/m³)", type: "number", unit: "kg/m³", required: false },
      { propertyId: "janka_hardness", name: "Janka Hardness (lbf)", type: "number", required: false },
    ],
  },
  {
    categoryId: "metal",
    name: "Metal",
    description: "Ferrous, non-ferrous, and precious metals",
    parentId: null,
    sortOrder: 30,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["reflectivity", "preview_swatch"],
    propertyDefinitions: [
      { propertyId: "reflectivity", name: "Reflectivity (0–1)", type: "range", required: false },
      { propertyId: "tensile_mpa", name: "Tensile Strength (MPa)", type: "number", unit: "MPa", required: false },
    ],
  },
  {
    categoryId: "glass",
    name: "Glass",
    description: "Clear, frosted, tinted, and specialty glass",
    parentId: null,
    sortOrder: 40,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["opacity", "preview_swatch"],
    propertyDefinitions: [
      { propertyId: "opacity_pct", name: "Opacity %", type: "percentage", required: false },
      { propertyId: "tint_color", name: "Tint Color", type: "color", required: false },
    ],
  },
  {
    categoryId: "plastic",
    name: "Plastic",
    description: "Thermoplastics, thermosets, and composites",
    parentId: null,
    sortOrder: 50,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["preview_swatch"],
    propertyDefinitions: [
      { propertyId: "resin_type", name: "Resin Type", type: "enum", enumOptions: ["ABS", "PET", "PP", "PE", "PC", "Nylon", "PVC", "Other"], required: false },
      { propertyId: "recyclable", name: "Recyclable", type: "boolean", required: false },
    ],
  },
  {
    categoryId: "paper",
    name: "Paper & Cardboard",
    description: "Papers, boards, and fibrous sheet materials",
    parentId: null,
    sortOrder: 60,
    pluginId: null,
    applicableDomains: ["packaging"],
    stability: "stable",
    capabilities: ["preview_swatch"],
    propertyDefinitions: [
      { propertyId: "gsm", name: "Weight (gsm)", type: "number", unit: "gsm", required: false },
      { propertyId: "finish", name: "Finish", type: "enum", enumOptions: ["matte", "gloss", "satin", "uncoated", "textured"], required: false },
    ],
  },
  {
    categoryId: "stone",
    name: "Stone",
    description: "Natural and engineered stone surfaces",
    parentId: null,
    sortOrder: 70,
    pluginId: null,
    applicableDomains: ["interior", "architecture", "landscape"],
    stability: "stable",
    capabilities: ["grain_texture", "preview_swatch"],
    propertyDefinitions: [
      { propertyId: "mohs_hardness", name: "Mohs Hardness", type: "range", min: 1, max: 10, required: false },
      { propertyId: "porosity", name: "Porosity", type: "enum", enumOptions: ["low", "medium", "high"], required: false },
    ],
  },
  {
    categoryId: "ceramic",
    name: "Ceramic",
    description: "Fired clay, porcelain, and technical ceramics",
    parentId: null,
    sortOrder: 80,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["preview_swatch"],
    propertyDefinitions: [],
  },
  {
    categoryId: "leather",
    name: "Leather",
    description: "Full-grain, top-grain, bonded, and synthetic leather",
    parentId: null,
    sortOrder: 90,
    pluginId: null,
    applicableDomains: ["fashion", "furniture", "product_design"],
    stability: "stable",
    capabilities: ["preview_swatch"],
    propertyDefinitions: [
      { propertyId: "tanning_method", name: "Tanning Method", type: "enum", enumOptions: ["vegetable", "chrome", "combination", "synthetic"], required: false },
      { propertyId: "thickness_mm", name: "Thickness (mm)", type: "number", unit: "mm", required: false },
    ],
  },
  {
    categoryId: "composite",
    name: "Composite",
    description: "Multi-material composites (e.g. carbon fiber, GRP, plywood)",
    parentId: null,
    sortOrder: 100,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["preview_swatch"],
    propertyDefinitions: [],
  },
  {
    categoryId: "coating",
    name: "Coating & Paint",
    description: "Surface coatings, paints, lacquers, and varnishes",
    parentId: null,
    sortOrder: 110,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["preview_swatch"],
    propertyDefinitions: [
      { propertyId: "sheen", name: "Sheen", type: "enum", enumOptions: ["flat", "matte", "eggshell", "satin", "semi-gloss", "gloss", "high-gloss"], required: false },
      { propertyId: "voc_gcl", name: "VOC (g/L)", type: "number", unit: "g/L", required: false },
    ],
  },
  {
    categoryId: "finish",
    name: "Surface Finish",
    description: "Post-process finishes: anodizing, powder coat, plating, etc.",
    parentId: null,
    sortOrder: 120,
    pluginId: null,
    applicableDomains: [],
    stability: "stable",
    capabilities: ["preview_swatch"],
    propertyDefinitions: [],
  },
  {
    categoryId: "digital_material",
    name: "Digital Material",
    description: "Procedural or AI-generated materials without a physical counterpart",
    parentId: null,
    sortOrder: 130,
    pluginId: null,
    applicableDomains: [],
    stability: "beta",
    capabilities: ["ai_generation"],
    propertyDefinitions: [
      { propertyId: "generation_prompt", name: "Generation Prompt", type: "text", required: false },
      { propertyId: "roughness", name: "Roughness (0–1)", type: "range", min: 0, max: 1, required: false },
      { propertyId: "reflectivity", name: "Reflectivity (0–1)", type: "range", min: 0, max: 1, required: false },
    ],
  },
];

// Seed on first import
materialCategoryRegistry.registerAll(PLATFORM_CATEGORIES, { force: false });
