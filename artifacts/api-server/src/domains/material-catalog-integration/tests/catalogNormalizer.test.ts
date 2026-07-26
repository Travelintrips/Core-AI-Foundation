/**
 * Material Catalog Integration — Phase 3
 * Tests: Catalog Normalizer
 */

import { describe, it, expect } from "vitest";
import { normalizeExternalItem } from "../catalogNormalizer.js";

describe("catalogNormalizer", () => {
  // Test 6 — normalized catalog DTO validation
  it("normalizes a complete valid item", () => {
    const raw = {
      externalId: "TEST-001",
      providerId: "mock-official-catalog",
      productName: "Marble White",
      brand: "niro granite",
      category: "Flooring",
      priceTier: "premium",
      unit: "sqm",
      color: ["White", "Grey"],
      finish: ["polished"],
    };
    const { item, warnings } = normalizeExternalItem(raw);
    expect(item.externalId).toBe("TEST-001");
    expect(item.productName).toBe("Marble White");
    expect(warnings.some((w) => w.includes("casing"))).toBe(true);
  });

  // Test 7 — whitespace normalization
  it("trims whitespace from string fields", () => {
    const { item } = normalizeExternalItem({
      externalId: "  WS-001  ",
      providerId: "  mock  ",
      productName: "  Tile A  ",
      brand: "  Essenzo  ",
      category: "  Flooring  ",
    });
    expect(item.externalId).toBe("WS-001");
    expect(item.productName).toBe("Tile A");
    expect(item.brand).toBe("Essenzo");
    expect(item.category).toBe("flooring");
  });

  it("converts empty strings to undefined", () => {
    const { item } = normalizeExternalItem({
      externalId: "ES-001",
      providerId: "mock",
      productName: "Tile",
      description: "   ",
      texture: "",
    });
    expect(item.description).toBeUndefined();
    expect(item.texture).toBeUndefined();
  });

  // Test 8 — brand normalization
  it("normalizes brand to title case", () => {
    const cases = [
      ["NIRO GRANITE", "Niro Granite"],
      ["niro granite", "Niro Granite"],
      ["essenzo", "Essenzo"],
      ["ROMAN CERAMICS", "Roman Ceramics"],
    ];
    for (const [input, expected] of cases) {
      const { item, warnings } = normalizeExternalItem({
        externalId: "B-001",
        providerId: "mock",
        productName: "X",
        brand: input,
      });
      expect(item.brand).toBe(expected);
      if (input !== expected) {
        expect(warnings.some((w) => w.includes("casing"))).toBe(true);
      }
    }
  });

  // Test 9 — category normalization
  it("normalizes category to lowercase with spaces", () => {
    const { item } = normalizeExternalItem({
      externalId: "C-001",
      providerId: "mock",
      productName: "X",
      category: "Wall-Tile",
    });
    expect(item.category).toBe("wall tile");
  });

  it("normalizes category underscores to spaces", () => {
    const { item } = normalizeExternalItem({
      externalId: "C-002",
      providerId: "mock",
      productName: "X",
      category: "wall_covering",
    });
    expect(item.category).toBe("wall covering");
  });

  // Test 10 — price-tier normalization
  it("normalizes price tier vocabulary", () => {
    const tiers: [string, string][] = [
      ["eco", "economy"],
      ["budget", "economy"],
      ["low", "economy"],
      ["mid", "standard"],
      ["medium", "standard"],
      ["high", "premium"],
      ["exclusive", "luxury"],
      ["ultra", "luxury"],
    ];
    for (const [input, expected] of tiers) {
      const { item } = normalizeExternalItem({
        externalId: "PT-001",
        providerId: "mock",
        productName: "X",
        priceTier: input,
      });
      expect(item.priceTier).toBe(expected);
    }
  });

  it("preserves unknown price tier values as lowercase", () => {
    const { item } = normalizeExternalItem({
      externalId: "PT-X",
      providerId: "mock",
      productName: "X",
      priceTier: "Custom",
    });
    expect(item.priceTier).toBe("custom");
  });

  // Test 11 — unit normalization
  it("normalizes unit abbreviations", () => {
    const units: [string, string][] = [
      ["sqm", "m²"],
      ["m2", "m²"],
      ["sq.m", "m²"],
      ["square meter", "m²"],
      ["pieces", "pcs"],
      ["liter", "L"],
      ["linear meter", "lm"],
      ["kilogram", "kg"],
    ];
    for (const [input, expected] of units) {
      const { item } = normalizeExternalItem({
        externalId: "U-001",
        providerId: "mock",
        productName: "X",
        unit: input,
      });
      expect(item.unit).toBe(expected);
    }
  });

  it("preserves unknown units unchanged", () => {
    const { item } = normalizeExternalItem({
      externalId: "U-X",
      providerId: "mock",
      productName: "X",
      unit: "bale",
    });
    expect(item.unit).toBe("bale");
  });

  it("normalizes color array to lowercase strings", () => {
    const { item } = normalizeExternalItem({
      externalId: "COL-001",
      providerId: "mock",
      productName: "X",
      color: ["White", "GREY", " Beige "],
    });
    expect(item.color).toEqual(["white", "grey", "beige"]);
  });

  it("parses comma-separated color string into array", () => {
    const { item } = normalizeExternalItem({
      externalId: "COL-002",
      providerId: "mock",
      productName: "X",
      color: "White, Grey, Beige",
    });
    expect(item.color).toEqual(["white", "grey", "beige"]);
  });

  it("normalizes finish vocabulary", () => {
    const { item } = normalizeExternalItem({
      externalId: "FIN-001",
      providerId: "mock",
      productName: "X",
      finish: ["glossy", "mat", "semi_gloss"],
    });
    expect(item.finish).toEqual(["gloss", "matte", "semi-gloss"]);
  });

  it("preserves sourceUpdatedAt as Date", () => {
    const date = new Date("2024-03-01T00:00:00.000Z");
    const { item } = normalizeExternalItem({
      externalId: "D-001",
      providerId: "mock",
      productName: "X",
      sourceUpdatedAt: date,
    });
    expect(item.sourceUpdatedAt).toEqual(date);
  });

  it("parses sourceUpdatedAt from ISO string", () => {
    const { item } = normalizeExternalItem({
      externalId: "D-002",
      providerId: "mock",
      productName: "X",
      sourceUpdatedAt: "2024-03-01T00:00:00.000Z",
    });
    expect(item.sourceUpdatedAt?.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });

  it("sanitizes sourceMetadata to plain primitives", () => {
    const { item } = normalizeExternalItem({
      externalId: "META-001",
      providerId: "mock",
      productName: "X",
      sourceMetadata: {
        version: "2.0",
        count: 42,
        fn: () => "nope",
        nested: { ok: true },
      },
    });
    expect(item.sourceMetadata?.["version"]).toBe("2.0");
    expect(item.sourceMetadata?.["count"]).toBe(42);
    expect(item.sourceMetadata?.["fn"]).toBeUndefined();
    expect((item.sourceMetadata?.["nested"] as Record<string, unknown>)?.["ok"]).toBe(true);
  });

  // Test 12 — invalid item rejection
  it("returns warnings for missing externalId", () => {
    const { warnings } = normalizeExternalItem({
      providerId: "mock",
      productName: "X",
    });
    expect(warnings.some((w) => w.toLowerCase().includes("externalid"))).toBe(true);
  });

  it("returns warnings for missing productName", () => {
    const { warnings } = normalizeExternalItem({
      externalId: "NOPROD-001",
      providerId: "mock",
    });
    expect(warnings.some((w) => w.toLowerCase().includes("productname"))).toBe(true);
  });

  it("handles non-object input gracefully", () => {
    const { item, warnings } = normalizeExternalItem("not an object");
    expect(warnings.length).toBeGreaterThan(0);
    expect(item.productName).toBe("(invalid)");
  });
});
