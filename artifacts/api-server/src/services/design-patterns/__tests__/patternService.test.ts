/**
 * patternService.test.ts — Team 09 unit tests for service layer
 * Tests: licensing guard, slug validation, cultural metadata enforcement.
 */

import { describe, it, expect, vi } from "vitest";
import {
  assertLicensingCompliance,
  LicensingError,
  CreatePatternSchema,
} from "../patternService.js";

// ── assertLicensingCompliance ─────────────────────────────────────────────────

describe("assertLicensingCompliance", () => {
  it("passes for original pattern without license", () => {
    const input = CreatePatternSchema.parse({
      slug: "geo-squares-v1",
      name: "Geometric Squares",
      category: "pattern",
      domain: "geometric",
      source_type: "original",
    });
    expect(() => assertLicensingCompliance(input)).not.toThrow();
  });

  it("passes for CC pattern WITH license field", () => {
    const input = CreatePatternSchema.parse({
      slug: "cc-wave-v1",
      name: "CC Wave",
      category: "pattern",
      domain: "wave",
      source_type: "creative-commons",
      license: "CC-BY-4.0",
    });
    expect(() => assertLicensingCompliance(input)).not.toThrow();
  });

  it("throws LicensingError for non-original pattern missing license", () => {
    const input = CreatePatternSchema.parse({
      slug: "licensed-marble",
      name: "Licensed Marble",
      category: "texture",
      domain: "marble",
      source_type: "licensed",
      // license omitted
    });
    expect(() => assertLicensingCompliance(input)).toThrow(LicensingError);
    expect(() => assertLicensingCompliance(input)).toThrow("must include a license identifier");
  });

  it("throws LicensingError for batik-inspired missing cultural_origin", () => {
    const input = CreatePatternSchema.parse({
      slug: "batik-parang-v1",
      name: "Batik Parang",
      category: "motif",
      domain: "batik-inspired",
      // cultural_origin omitted
    });
    expect(() => assertLicensingCompliance(input)).toThrow(LicensingError);
    expect(() => assertLicensingCompliance(input)).toThrow("cultural_origin");
  });

  it("passes for batik-inspired WITH cultural_origin", () => {
    const input = CreatePatternSchema.parse({
      slug: "batik-parang-v1",
      name: "Batik Parang",
      category: "motif",
      domain: "batik-inspired",
      cultural_origin: "Yogyakarta, Indonesia",
    });
    expect(() => assertLicensingCompliance(input)).not.toThrow();
  });

  describe("trademark guard", () => {
    const BLOCKED = ["gucci", "louis vuitton", "lv", "hermes", "chanel", "burberry",
                     "prada", "versace", "fendi", "dior", "balenciaga", "supreme"];

    for (const term of BLOCKED) {
      it(`blocks "${term}" in pattern name`, () => {
        const input = CreatePatternSchema.parse({
          slug: "test-pattern",
          name: `${term} inspired`,
          category: "pattern",
          domain: "luxury",
        });
        expect(() => assertLicensingCompliance(input)).toThrow(LicensingError);
        expect(() => assertLicensingCompliance(input)).toThrow("trademarked");
      });
    }
  });
});

// ── CreatePatternSchema validation ────────────────────────────────────────────

describe("CreatePatternSchema", () => {
  it("accepts valid minimal input", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "wave-minimal",
      name: "Wave Minimal",
      category: "pattern",
      domain: "wave",
    });
    expect(result.success).toBe(true);
  });

  it("rejects slug with uppercase", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "Wave-Pattern",
      name: "Wave",
      category: "pattern",
      domain: "wave",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slug with spaces", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "wave pattern",
      name: "Wave",
      category: "pattern",
      domain: "wave",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown domain", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "test",
      name: "Test",
      category: "pattern",
      domain: "unknown-domain",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown category", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "test",
      name: "Test",
      category: "wallpaper",
      domain: "geometric",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-hex color in color_palette", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "test-color",
      name: "Test",
      category: "pattern",
      domain: "geometric",
      color_palette: ["rgb(255,0,0)"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts hex shorthand #fff", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "test-short-hex",
      name: "Test",
      category: "pattern",
      domain: "geometric",
      color_palette: ["#fff"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-semver version", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "test-ver",
      name: "Test",
      category: "texture",
      domain: "marble",
      version: "v1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects version without patch segment", () => {
    const result = CreatePatternSchema.safeParse({
      slug: "test-ver2",
      name: "Test",
      category: "texture",
      domain: "marble",
      version: "1.0",
    });
    expect(result.success).toBe(false);
  });

  it("applies correct defaults", () => {
    const result = CreatePatternSchema.parse({
      slug: "defaults-test",
      name: "Defaults",
      category: "pattern",
      domain: "geometric",
    });
    expect(result.repeat_behavior).toBe("tile");
    expect(result.scale).toBe("md");
    expect(result.colorizable).toBe(true);
    expect(result.version).toBe("1.0.0");
    expect(result.status).toBe("active");
  });

  it("accepts all valid repeat_behavior values", () => {
    const slugMap: Record<string, string> = {
      "tile":      "test-tile",
      "half-drop": "test-halfdrop",
      "mirror":    "test-mirror",
      "brick":     "test-brick",
      "no-repeat": "test-norepeat",
    };
    for (const rb of ["tile", "half-drop", "mirror", "brick", "no-repeat"] as const) {
      const result = CreatePatternSchema.safeParse({
        slug: slugMap[rb],
        name: "Test",
        category: "pattern",
        domain: "geometric",
        repeat_behavior: rb,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid scale values", () => {
    for (const scale of ["xs", "sm", "md", "lg", "xl", "full-bleed"] as const) {
      const result = CreatePatternSchema.safeParse({
        slug: `test-scale-${scale}`,
        name: "Test",
        category: "pattern",
        domain: "geometric",
        scale,
      });
      expect(result.success).toBe(true);
    }
  });
});
