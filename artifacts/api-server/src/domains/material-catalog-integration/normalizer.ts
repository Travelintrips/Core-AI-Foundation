/**
 * Phase 3 — Material Catalog Integration: normalizer.
 *
 * Converts a raw CatalogEntry (from an external provider) into a
 * NormalizedCatalogEntry that matches the canonical MaterialRecord shape.
 * This output is NEVER written directly to the database; it is returned to
 * the caller who decides whether to pass it to the admin seeding flow.
 */

import type { CatalogEntry, NormalizedCatalogEntry } from "./types.js";

/**
 * Derive a URL-safe slug from a display name.
 * e.g. "Roman Carrara Marble Tile!" → "roman-carrara-marble-tile"
 */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalize a raw CatalogEntry to the canonical MaterialRecord shape.
 *
 * @param entry     - raw entry from the provider
 * @param importedAt - timestamp to use for createdAt / updatedAt (defaults to now)
 */
export function normalizeCatalogEntry(
  entry: CatalogEntry,
  importedAt: Date = new Date(),
): NormalizedCatalogEntry {
  return {
    materialCode: entry.externalId,
    name: entry.name,
    slug: slugFromName(entry.name),
    category: entry.category,
    subcategory: entry.subcategory ?? null,
    brand: entry.brand ?? entry.source,
    materialType: entry.materialType ?? entry.category,
    color: entry.color ?? null,
    finish: entry.finish ?? null,
    texture: entry.texture ?? null,
    pattern: entry.pattern ?? null,
    description: entry.description ?? null,
    priceTier: entry.priceTier ?? "Standard",
    thumbnailUrl: entry.thumbnailUrl ?? null,
    previewImages: null,
    technicalData: null,
    searchKeywords: entry.searchKeywords ?? [],
    status: "active",
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}
