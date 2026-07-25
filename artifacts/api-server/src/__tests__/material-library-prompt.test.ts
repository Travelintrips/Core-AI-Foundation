/**
 * Image prompt builder tests — Task 6 verification.
 *
 * Tests the matSummary logic extracted from generateInteriorImagePrompts.
 * Verifies that the prompt includes useful visual information and excludes
 * internal IDs, URLs, and raw JSON.
 */

import { describe, it, expect } from "vitest";

// ── Mirror of the matSummary builder from imageDesignerService.ts ─────────────
// We extract the pure transformation logic so we can unit-test it without
// importing the full service (which requires DB + AI provider env vars).

function buildMatSummary(
  materials: Record<string, unknown> | null,
): string[] {
  const mat = materials;
  const items = Array.isArray(mat?.["items"])
    ? (mat?.["items"] as Array<Record<string, unknown>>)
    : [];
  return items.slice(0, 8).map((m) => {
    const parts: string[] = [];
    const component = String(m["component"] ?? m["area"] ?? "").trim();
    const name      = String(m["name"]      ?? "").trim();
    const matType   = String(m["materialType"] ?? m["material"] ?? m["type"] ?? "").trim();
    const color     = String(m["color"]   ?? "").trim();
    const finish    = String(m["finish"]  ?? "").trim();
    const texture   = String(m["texture"] ?? "").trim();
    const brand     = String(m["brand"]   ?? "").trim();
    if (component) parts.push(component);
    if (name) parts.push(name);
    else if (matType) parts.push(matType);
    if (color)   parts.push(color);
    if (finish)  parts.push(finish);
    if (texture && texture !== "Smooth") parts.push(texture);
    if (brand && brand.length <= 20) parts.push(`(${brand})`);
    return parts.join(", ");
  }).filter(Boolean);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LIBRARY_MATERIAL_FIXTURE: Record<string, unknown> = {
  items: [
    {
      id:              "item-1",
      area:            "Floor",
      component:       "Main floor",
      category:        "Floor",
      name:            "Roman Porcelain Marble White Carrara",
      materialType:    "porcelain tile",
      color:           "White",
      finish:          "Polished",
      texture:         "Smooth",
      brand:           "Roman",
      libraryMaterialId: 42,
      thumbnailUrl:    "https://cdn.example.com/thumb/42.jpg",
      previewImages:   ["https://cdn.example.com/preview/42a.jpg"],
      description:     "Elegant Carrara marble-effect porcelain floor tile.",
      technicalData:   { "Size": "60x60cm", "MOQ": "20sqm" },
      status:          "selected",
    },
    {
      id:           "item-2",
      area:         "Wall",
      component:    "Accent wall",
      category:     "Wall",
      name:         "Jotun Essence Dusty Rose",
      materialType: "paint",
      color:        "Dusty Rose",
      finish:       "Matt",
      texture:      "Smooth",
      brand:        "Jotun",
      libraryMaterialId: 101,
      thumbnailUrl: null,
      status:       "selected",
    },
  ],
};

const LEGACY_MATERIAL_FIXTURE: Record<string, unknown> = {
  items: [
    {
      id:           "leg-1",
      area:         "Ceiling",
      component:    "",
      category:     "Ceiling",
      materialType: "gypsum",
      color:        "White",
      finish:       "Matt",
      // no name, no libraryMaterialId, no thumbnailUrl
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildMatSummary — library-enriched materials", () => {
  const summary = buildMatSummary(LIBRARY_MATERIAL_FIXTURE);
  const combined = summary.join("; ");

  it("includes material name", () => {
    expect(combined).toContain("Roman Porcelain Marble White Carrara");
  });

  it("includes component / location", () => {
    expect(combined).toContain("Main floor");
    expect(combined).toContain("Accent wall");
  });

  it("includes color", () => {
    expect(combined).toContain("White");
    expect(combined).toContain("Dusty Rose");
  });

  it("includes finish", () => {
    expect(combined).toContain("Polished");
    expect(combined).toContain("Matt");
  });

  it("includes brand when short", () => {
    expect(combined).toContain("(Roman)");
    expect(combined).toContain("(Jotun)");
  });

  it("does NOT include libraryMaterialId", () => {
    expect(combined).not.toContain("42");
    expect(combined).not.toContain("101");
  });

  it("does NOT include thumbnailUrl", () => {
    expect(combined).not.toContain("thumbnailUrl");
    expect(combined).not.toContain("https://cdn.example.com");
  });

  it("does NOT include previewImages URLs", () => {
    expect(combined).not.toContain("previewImages");
    expect(combined).not.toContain("preview/42a");
  });

  it("does NOT contain raw JSON braces", () => {
    expect(combined).not.toContain("{");
    expect(combined).not.toContain("}");
  });

  it("does NOT include internal technicalData keys", () => {
    expect(combined).not.toContain("MOQ");
    expect(combined).not.toContain("technicalData");
  });

  it("omits Smooth texture (uninformative default)", () => {
    // Both items have Smooth texture — should not appear as a standalone token
    expect(combined.split("Smooth")).toHaveLength(1);
  });
});

describe("buildMatSummary — legacy materials (no name/brand)", () => {
  const summary = buildMatSummary(LEGACY_MATERIAL_FIXTURE);
  const combined = summary.join("; ");

  it("renders without errors", () => {
    expect(() => buildMatSummary(LEGACY_MATERIAL_FIXTURE)).not.toThrow();
  });

  it("uses materialType as fallback when name is absent", () => {
    expect(combined).toContain("gypsum");
  });

  it("includes color and finish from legacy record", () => {
    expect(combined).toContain("White");
    expect(combined).toContain("Matt");
  });
});

describe("buildMatSummary — null/empty input", () => {
  it("returns empty array for null materials", () => {
    expect(buildMatSummary(null)).toHaveLength(0);
  });

  it("returns empty array for empty items list", () => {
    expect(buildMatSummary({ items: [] })).toHaveLength(0);
  });
});
