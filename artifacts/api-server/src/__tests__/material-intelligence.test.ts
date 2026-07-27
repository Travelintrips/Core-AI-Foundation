import { describe, expect, it, beforeEach } from "vitest";
import type { MaterialRecord } from "../domains/material-library/types.js";
import {
  getMaterialAnalytics,
  resetMaterialAnalytics,
  recordSearch,
} from "../domains/material-intelligence/materialAnalytics.js";
import { MATERIAL_ALIASES } from "../domains/material-intelligence/materialAliases.js";
import {
  normalizeQuery,
} from "../domains/material-intelligence/materialNormalizer.js";
import { MaterialCache } from "../domains/material-intelligence/materialCache.js";
import {
  rankMaterials,
} from "../domains/material-intelligence/materialSearchEngine.js";
import { rankSimilarMaterials } from "../domains/material-intelligence/materialSimilarity.js";
import { buildMaterialSuggestions } from "../domains/material-intelligence/materialSuggestions.js";
import { performance } from "node:perf_hooks";

// ── Shared test catalog (used by hard-filter tests) ──────────────────────────

function makeCatalog(): MaterialRecord[] {
  const base = (overrides: Partial<MaterialRecord>): MaterialRecord => ({
    id: 1,
    materialCode: "MAT-001",
    name: "Roman Carrara Marble Tile",
    slug: "mat-001",
    category: "Floor",
    subcategory: "Porcelain Tile",
    brand: "Roman",
    materialType: "Porcelain Tile",
    color: "White",
    finish: "Polished",
    texture: "Smooth",
    pattern: "Marble Veining",
    description: "White marble-look floor tile",
    priceTier: "Premium",
    thumbnailUrl: null,
    previewImages: null,
    technicalData: null,
    searchKeywords: ["marble", "tile"],
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  });
  return [
    base({ id: 1, name: "Roman Carrara Marble Tile", category: "Floor", brand: "Roman",    finish: "Polished", color: "White",  priceTier: "Premium",  searchKeywords: ["marble", "tile"] }),
    base({ id: 2, name: "Asia Tile Granite Budget",   category: "Floor", brand: "Asia Tile", finish: "Matte",    color: "Grey",   priceTier: "Budget",   searchKeywords: ["granite", "tile"] }),
    base({ id: 3, name: "Dulux Blue Wall Paint",       category: "Wall",  brand: "Dulux",     finish: "Matte",    color: "Blue",   priceTier: "Budget",   searchKeywords: ["paint", "wall"]  }),
    base({ id: 4, name: "Bellagio Marble Wall Tile",   category: "Wall",  brand: "Bellagio",  finish: "Polished", color: "White",  priceTier: "Standard", searchKeywords: ["marble", "wall"] }),
    base({ id: 5, name: "Vinyl Plank Wood Floor",      category: "Floor", brand: "Pergo",     finish: "Matte",    color: "Brown",  priceTier: "Standard", searchKeywords: ["vinyl", "wood"]  }),
  ];
}


function material(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: 1,
    materialCode: "MAT-FLR-001",
    name: "Roman Carrara Marble Tile",
    slug: "mat-flr-001",
    category: "Floor",
    subcategory: "Porcelain Tile",
    brand: "Roman",
    materialType: "Porcelain Tile",
    color: "White",
    finish: "Polished",
    texture: "Smooth",
    pattern: "Marble Veining",
    description: "White marble-look floor tile",
    priceTier: "Premium",
    thumbnailUrl: null,
    previewImages: null,
    technicalData: null,
    searchKeywords: ["marble", "tile", "carrara"],
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── Phase 2 Acceptance Gap 2A: Explicit UI filters must be hard filters ───────

describe("Material Intelligence Phase 2 — Explicit UI Hard Filters", () => {
  it("priceTier=Budget restricts result set to Budget materials only", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "marble", priceTier: "Budget" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.priceTier).toBe("Budget");
    }
  });

  it("priceTier=Budget with q=marble: every returned material has priceTier=Budget", () => {
    const catalog = makeCatalog();
    // The required test example from the integration spec
    const results = rankMaterials(catalog, { query: "marble", priceTier: "Budget" });
    for (const { material } of results) {
      expect(material.priceTier).toBe("Budget");
    }
  });

  it("priceTier=Premium excludes Budget and Standard materials", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "", priceTier: "Premium" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.priceTier).toBe("Premium");
    }
  });

  it("category=Floor excludes Wall and other categories", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "tile", category: "Floor" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.category).toBe("Floor");
    }
  });

  it("category=Wall excludes Floor materials even when query matches Floor items", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "marble", category: "Wall" });
    for (const { material } of results) {
      expect(material.category).toBe("Wall");
    }
    // Marble Floor items must NOT appear
    expect(results.some((r) => r.material.id === 1)).toBe(false);
  });

  it("brand=Roman excludes all non-Roman brands", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "", brand: "Roman" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.brand).toBe("Roman");
    }
  });

  it("brand=Dulux returns only Dulux materials", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "paint", brand: "Dulux" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.brand).toBe("Dulux");
    }
  });

  it("finish=Polished excludes Matte materials", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "tile", finish: "Polished" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.finish).toBe("Polished");
    }
  });

  it("finish=Matte excludes Polished materials", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "", finish: "Matte" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.finish).toBe("Matte");
    }
  });

  it("color=White excludes Grey, Blue, Brown materials", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "tile", color: "White" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.color).toBe("White");
    }
  });

  it("color=Blue returns only Blue materials", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "", color: "Blue" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.color).toBe("Blue");
    }
  });

  it("combined hard filters: category=Floor AND priceTier=Budget", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "granite", category: "Floor", priceTier: "Budget" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.category).toBe("Floor");
      expect(material.priceTier).toBe("Budget");
    }
  });

  it("combined hard filters: brand=Roman AND finish=Polished", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "", brand: "Roman", finish: "Polished" });
    expect(results.length).toBeGreaterThan(0);
    for (const { material } of results) {
      expect(material.brand).toBe("Roman");
      expect(material.finish).toBe("Polished");
    }
  });

  it("impossible filter combination returns empty array", () => {
    const catalog = makeCatalog();
    const results = rankMaterials(catalog, { query: "marble", brand: "Roman", priceTier: "Budget" });
    // Roman only has Premium — expect no results
    expect(results).toHaveLength(0);
  });

  it("filter values are case-insensitive (normalized)", () => {
    const catalog = makeCatalog();
    const upper = rankMaterials(catalog, { query: "", priceTier: "BUDGET" });
    const lower = rankMaterials(catalog, { query: "", priceTier: "budget" });
    expect(upper.map((r) => r.material.id)).toEqual(lower.map((r) => r.material.id));
  });

  it("omitting a filter does not restrict results on that dimension", () => {
    const catalog = makeCatalog();
    const withoutBrand = rankMaterials(catalog, { query: "tile" });
    const withBrand    = rankMaterials(catalog, { query: "tile", brand: "Roman" });
    expect(withoutBrand.length).toBeGreaterThanOrEqual(withBrand.length);
  });
});

// ── Core Phase 2 tests ────────────────────────────────────────────────────────


describe("Material Intelligence Phase 2", () => {
  beforeEach(() => resetMaterialAnalytics());

  it("normalizes Indonesian aliases into canonical search terms", () => {
    const query = normalizeQuery("marmer kayu jati doff");
    expect(query.normalized).toBe("marble teak matte");
    expect(query.aliases).toEqual(expect.arrayContaining(["marble", "teak", "matte"]));
    expect(MATERIAL_ALIASES["keramik"]).toBe("ceramic");
  });

  it("ranks exact and keyword matches deterministically", () => {
    const exact = material();
    const related = material({
      id: 2,
      materialCode: "MAT-FLR-002",
      name: "White Ceramic Tile",
      slug: "mat-flr-002",
      materialType: "Ceramic Tile",
      searchKeywords: ["tile", "white"],
    });
    const first = rankMaterials([related, exact], { query: "Roman Carrara Marble Tile" });
    const second = rankMaterials([exact, related], { query: "Roman Carrara Marble Tile" });
    expect(first.map((item) => item.material.id)).toEqual(second.map((item) => item.material.id));
    expect(first[0]?.material.id).toBe(1);
    expect(first[0]?.score.total).toBeGreaterThan(first[1]?.score.total ?? 0);
  });

  it("supports provider-independent semantic-ready scoring without an AI call", () => {
    const result = rankMaterials([material()], { query: "marble", mode: "semantic-ready" });
    expect(result[0]?.score.semantic).toBe(0);
    expect(result[0]?.score.keyword).toBeGreaterThan(0);
  });

  it("invalidates cache entries when the catalog version changes", () => {
    const cache = new MaterialCache<string>(100);
    cache.set("q", "old", "v1", 1000);
    expect(cache.get("q", "v1", 1050)).toBe("old");
    expect(cache.get("q", "v2", 1050)).toBeUndefined();
    cache.set("q", "new", "v2", 1050);
    expect(cache.get("q", "v2", 1051)).toBe("new");
    expect(cache.get("q", "v2", 1200)).toBeUndefined();
  });

  it("builds deterministic suggestions from catalog fields and aliases", () => {
    const suggestions = buildMaterialSuggestions([
      material(),
      material({ id: 2, name: "Marble Wall Panel", category: "Wall", subcategory: "Panel" }),
    ], "mar", [], 10);
    expect(suggestions.map((item) => item.value)).toEqual(expect.arrayContaining([
      "Roman Carrara Marble Tile",
      "Marble Wall Panel",
      "marble",
    ]));
    expect(suggestions.map((item) => item.value)).toEqual(
      [...suggestions].sort((a, b) => b.score - a.score || a.value.localeCompare(b.value)).map((item) => item.value),
    );
  });

  it("returns similar materials while excluding the source", () => {
    const source = material();
    const similar = material({ id: 2, name: "Bellagio White Marble Tile", brand: "Bellagio" });
    const different = material({
      id: 3,
      name: "Dulux Blue Wall Paint",
      category: "Wall",
      subcategory: "Paint",
      materialType: "Paint",
      color: "Blue",
      finish: "Matt",
      texture: "Smooth",
      pattern: "Solid",
      priceTier: "Budget",
    });
    const result = rankSimilarMaterials(source, [source, different, similar], 10);
    expect(result[0]?.material.id).toBe(2);
    expect(result.some((item) => item.material.id === 1)).toBe(false);
  });

  it("tracks in-memory analytics and cache ratio", () => {
    recordSearch("marble tile", [material()], 8, false);
    recordSearch("marble", [material()], 2, true);
    const analytics = getMaterialAnalytics();
    expect(analytics.searchCount).toBe(2);
    expect(analytics.averageResponseTimeMs).toBe(5);
    expect(analytics.cacheHitRatio).toBe(0.5);
    expect(analytics.topMaterials[0]?.materialId).toBe(1);
  });

  it("keeps deterministic ranking under the search latency target", () => {
    const catalog = Array.from({ length: 500 }, (_, index) => material({
      id: index + 1,
      materialCode: `MAT-FLR-${String(index + 1).padStart(3, "0")}`,
      name: index === 0 ? "Marble White Tile" : `Catalog Material ${index + 1}`,
      searchKeywords: index === 0 ? ["marble", "tile"] : ["catalog", "material"],
    }));
    const started = performance.now();
    rankMaterials(catalog, { query: "marble" });
    expect(performance.now() - started).toBeLessThan(100);
  });
});