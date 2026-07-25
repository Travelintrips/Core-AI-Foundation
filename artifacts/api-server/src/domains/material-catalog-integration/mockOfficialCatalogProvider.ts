/**
 * Phase 3 — Material Catalog Integration: mock provider (test-only).
 *
 * This provider is NEVER registered at production startup. It exists solely
 * for unit/integration tests so they can exercise the integration layer without
 * making real network requests or touching the database.
 *
 * Do NOT import this module from any production startup path.
 */

import type { CatalogProvider, CatalogPage, CatalogEntry, ProviderHealthStatus } from "./types.js";

export const MOCK_PROVIDER_ID = "mock-official-catalog";

const MOCK_ENTRIES: CatalogEntry[] = [
  {
    externalId: "MOCK-FLR-001",
    source: MOCK_PROVIDER_ID,
    name: "Roman Marble Effect Tile",
    category: "Floor",
    subcategory: "Porcelain Tile",
    brand: "Roman",
    materialType: "Porcelain Tile",
    finish: "Polished",
    color: "White",
    priceTier: "Standard",
    description: "Classic marble-look porcelain floor tile",
    searchKeywords: ["marble", "tile", "floor", "porcelain"],
  },
  {
    externalId: "MOCK-WLL-001",
    source: MOCK_PROVIDER_ID,
    name: "Dulux Premium Wall Paint White",
    category: "Wall",
    subcategory: "Paint",
    brand: "Dulux",
    materialType: "Paint",
    finish: "Matte",
    color: "White",
    priceTier: "Standard",
    description: "Premium interior wall paint",
    searchKeywords: ["paint", "wall", "white", "interior"],
  },
  {
    externalId: "MOCK-FLR-002",
    source: MOCK_PROVIDER_ID,
    name: "Pergo Vinyl Plank Natural Oak",
    category: "Floor",
    subcategory: "Vinyl Plank",
    brand: "Pergo",
    materialType: "Vinyl Plank",
    finish: "Matte",
    color: "Brown",
    priceTier: "Budget",
    description: "Durable vinyl plank flooring with natural oak look",
    searchKeywords: ["vinyl", "plank", "oak", "wood", "floor"],
  },
  {
    externalId: "MOCK-CLG-001",
    source: MOCK_PROVIDER_ID,
    name: "Gypsum Board Ceiling Panel",
    category: "Ceiling",
    subcategory: "Gypsum",
    brand: "Knauf",
    materialType: "Gypsum Board",
    finish: "Smooth",
    color: "White",
    priceTier: "Standard",
    description: "Standard gypsum ceiling board panel",
    searchKeywords: ["gypsum", "ceiling", "board"],
  },
  {
    externalId: "MOCK-WLL-002",
    source: MOCK_PROVIDER_ID,
    name: "Asia Tile Subway Wall Tile",
    category: "Wall",
    subcategory: "Ceramic Tile",
    brand: "Asia Tile",
    materialType: "Ceramic Tile",
    finish: "Gloss",
    color: "White",
    priceTier: "Budget",
    description: "Classic subway ceramic wall tile",
    searchKeywords: ["subway", "tile", "wall", "ceramic"],
  },
];

export const mockOfficialCatalogProvider: CatalogProvider = {
  providerId: MOCK_PROVIDER_ID,

  async fetchPage(page: number, pageSize: number): Promise<CatalogPage> {
    const start = (page - 1) * pageSize;
    const entries = MOCK_ENTRIES.slice(start, start + pageSize);
    return {
      entries,
      total: MOCK_ENTRIES.length,
      pageNumber: page,
      pageSize: entries.length,
    };
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      providerId: MOCK_PROVIDER_ID,
      status: "online",
      lastCheckedAt: new Date(),
      latencyMs: 0,
    };
  },
};

/** Total number of entries in the mock dataset (for assertions). */
export const MOCK_ENTRY_COUNT = MOCK_ENTRIES.length;
