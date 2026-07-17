/**
 * patternService.test.ts — Team 09 domain unit tests (remediation)
 *
 * Tests: Zod schemas, LicensingAdapter, MotifAdapter, TextureAdapter,
 *        RepeatBehaviorAdapter, MaterialCompatAdapter, isPublicStatus.
 */

import { describe, it, expect } from "vitest";
import {
  CreatePatternSchema,
  assertLicensingCompliance,
  isPublicStatus,
  PUBLIC_STATUSES,
  PATTERN_STATUSES,
  MAX_PATTERN_LIMIT,
} from "../patternService.js";
import {
  LicensingAdapter,
  LicensingError,
  MotifAdapter,
  MotifCulturalError,
  TextureAdapter,
  RepeatBehaviorAdapter,
  RepeatBehaviorError,
  MaterialCompatAdapter,
  BLOCKED_TRADEMARK_TERMS,
} from "../patternAdapter.js";

// ── assertLicensingCompliance (backward-compat wrapper) ───────────────────────

describe("assertLicensingCompliance (backward-compat re-export)", () => {
  it("throws LicensingError for non-original pattern missing license", () => {
    expect(() =>
      assertLicensingCompliance(
        CreatePatternSchema.parse({ slug: "test", name: "Test", category: "pattern", domain: "geometric", source_type: "licensed" }),
      ),
    ).toThrow(LicensingError);
  });

  it("throws LicensingError for batik-inspired missing cultural_origin", () => {
    expect(() =>
      assertLicensingCompliance(
        CreatePatternSchema.parse({ slug: "test", name: "Test", category: "motif", domain: "batik-inspired" }),
      ),
    ).toThrow(LicensingError);
  });

  it("passes for batik-inspired WITH cultural_origin", () => {
    expect(() =>
      assertLicensingCompliance(
        CreatePatternSchema.parse({
          slug: "batik-ok", name: "Batik OK", category: "motif",
          domain: "batik-inspired", cultural_origin: "Central Java",
        }),
      ),
    ).not.toThrow();
  });
});

// ── LicensingAdapter ──────────────────────────────────────────────────────────

describe("LicensingAdapter.assertCompliance", () => {
  it("passes for original source without license", () => {
    expect(() =>
      LicensingAdapter.assertCompliance({ source_type: "original", name: "X", slug: "x" }),
    ).not.toThrow();
  });

  it("passes for public-domain without license", () => {
    expect(() =>
      LicensingAdapter.assertCompliance({ source_type: "public-domain", name: "X", slug: "x" }),
    ).not.toThrow();
  });

  it("throws for creative-commons without license", () => {
    expect(() =>
      LicensingAdapter.assertCompliance({ source_type: "creative-commons", name: "X", slug: "x" }),
    ).toThrow(LicensingError);
  });

  it("passes for creative-commons WITH license", () => {
    expect(() =>
      LicensingAdapter.assertCompliance({ source_type: "creative-commons", license: "CC-BY-4.0", name: "X", slug: "x" }),
    ).not.toThrow();
  });

  it("throws for batik-inspired without cultural_origin", () => {
    expect(() =>
      LicensingAdapter.assertCompliance({ domain: "batik-inspired", name: "X", slug: "x" }),
    ).toThrow(LicensingError);
  });

  it("passes for batik-inspired WITH cultural_origin", () => {
    expect(() =>
      LicensingAdapter.assertCompliance({ domain: "batik-inspired", cultural_origin: "Central Java", name: "X", slug: "x" }),
    ).not.toThrow();
  });

  it.each(BLOCKED_TRADEMARK_TERMS)(
    "trademark guard blocks '%s' in name",
    (term) => {
      expect(() =>
        LicensingAdapter.assertCompliance({ name: `My ${term} Collection`, slug: "ok" }),
      ).toThrow(LicensingError);
    },
  );

  it("trademark guard blocks term in slug", () => {
    expect(() =>
      LicensingAdapter.assertCompliance({ name: "OK Pattern", slug: "gucci-inspired" }),
    ).toThrow(LicensingError);
  });
});

describe("LicensingAdapter.isPublicSafe", () => {
  it("returns true for original source (no license needed)", () => {
    expect(LicensingAdapter.isPublicSafe("original", null)).toBe(true);
  });

  it("returns true for public-domain source", () => {
    expect(LicensingAdapter.isPublicSafe("public-domain", null)).toBe(true);
  });

  it("returns false for licensed source WITHOUT license field", () => {
    expect(LicensingAdapter.isPublicSafe("licensed", null)).toBe(false);
  });

  it("returns true for licensed source WITH license field", () => {
    expect(LicensingAdapter.isPublicSafe("licensed", "CC-BY-4.0")).toBe(true);
  });

  it("returns true for creative-commons WITH license field", () => {
    expect(LicensingAdapter.isPublicSafe("creative-commons", "CC0-1.0")).toBe(true);
  });
});

// ── MotifAdapter ──────────────────────────────────────────────────────────────

describe("MotifAdapter", () => {
  it("isTraditional returns true for batik-inspired", () => {
    expect(MotifAdapter.isTraditional("batik-inspired")).toBe(true);
  });

  it("isTraditional returns true for textile", () => {
    expect(MotifAdapter.isTraditional("textile")).toBe(true);
  });

  it("isTraditional returns false for geometric", () => {
    expect(MotifAdapter.isTraditional("geometric")).toBe(false);
  });

  it("validateCulturalMetadata throws MotifCulturalError for batik without cultural_origin", () => {
    expect(() =>
      MotifAdapter.validateCulturalMetadata("batik-inspired", { cultural_origin: null }),
    ).toThrow(MotifCulturalError);
  });

  it("validateCulturalMetadata throws for cultural_notes shorter than 20 chars", () => {
    expect(() =>
      MotifAdapter.validateCulturalMetadata("batik-inspired", {
        cultural_origin: "Central Java",
        cultural_notes: "Short",
      }),
    ).toThrow(MotifCulturalError);
  });

  it("validateCulturalMetadata passes for batik with valid cultural_origin", () => {
    expect(() =>
      MotifAdapter.validateCulturalMetadata("batik-inspired", {
        cultural_origin: "Central Java, Indonesia",
        cultural_notes: "Inspired by the traditional patterns of Central Java. Not a claim to specific works.",
      }),
    ).not.toThrow();
  });

  it("validateCulturalMetadata does not throw for non-traditional domain", () => {
    expect(() =>
      MotifAdapter.validateCulturalMetadata("geometric", { cultural_origin: null }),
    ).not.toThrow();
  });

  it("requiresAdditionalReview returns true for protected term without cultural_origin", () => {
    expect(MotifAdapter.requiresAdditionalReview("Parang Rusak Motif", null)).toBe(true);
  });

  it("requiresAdditionalReview returns false when cultural_origin is provided", () => {
    expect(MotifAdapter.requiresAdditionalReview("Parang Rusak Motif", "Central Java")).toBe(false);
  });

  it("requiresAdditionalReview returns false for non-protected name", () => {
    expect(MotifAdapter.requiresAdditionalReview("Modern Circles", null)).toBe(false);
  });
});

// ── TextureAdapter ────────────────────────────────────────────────────────────

describe("TextureAdapter", () => {
  it("getCompatibleMaterials returns correct list for marble", () => {
    const materials = TextureAdapter.getCompatibleMaterials("marble");
    expect(materials).toContain("interior");
    expect(materials).toContain("ceramic");
    expect(materials).toContain("print");
    expect(materials).not.toContain("fabric");
  });

  it("getCompatibleMaterials returns fallback [digital, print] for unknown domain", () => {
    const materials = TextureAdapter.getCompatibleMaterials("unknown-domain");
    expect(materials).toEqual(["digital", "print"]);
  });

  it("isCompatible returns true for marble + interior", () => {
    expect(TextureAdapter.isCompatible("marble", "interior")).toBe(true);
  });

  it("isCompatible returns false for marble + fabric", () => {
    expect(TextureAdapter.isCompatible("marble", "fabric")).toBe(false);
  });

  it("isCompatible returns true for batik-inspired + fabric", () => {
    expect(TextureAdapter.isCompatible("batik-inspired", "fabric")).toBe(true);
  });

  it("isCompatible returns false for batik-inspired + ceramic", () => {
    expect(TextureAdapter.isCompatible("batik-inspired", "ceramic")).toBe(false);
  });
});

// ── RepeatBehaviorAdapter ─────────────────────────────────────────────────────

describe("RepeatBehaviorAdapter", () => {
  it("throws RepeatBehaviorError for half-drop + decoration category", () => {
    expect(() => RepeatBehaviorAdapter.validate("half-drop", "decoration")).toThrow(RepeatBehaviorError);
  });

  it("throws RepeatBehaviorError for no-repeat + texture category", () => {
    expect(() => RepeatBehaviorAdapter.validate("no-repeat", "texture")).toThrow(RepeatBehaviorError);
  });

  it("does not throw for tile + texture", () => {
    expect(() => RepeatBehaviorAdapter.validate("tile", "texture")).not.toThrow();
  });

  it("does not throw for half-drop + motif", () => {
    expect(() => RepeatBehaviorAdapter.validate("half-drop", "motif")).not.toThrow();
  });

  it("does not throw for no-repeat + decoration", () => {
    expect(() => RepeatBehaviorAdapter.validate("no-repeat", "decoration")).not.toThrow();
  });

  it("suggestedScales returns correct scales for tile", () => {
    expect(RepeatBehaviorAdapter.suggestedScales("tile")).toContain("md");
    expect(RepeatBehaviorAdapter.suggestedScales("tile")).not.toContain("full-bleed");
  });

  it("suggestedScales returns full-bleed for no-repeat", () => {
    expect(RepeatBehaviorAdapter.suggestedScales("no-repeat")).toContain("full-bleed");
  });

  it("suggestedScales returns default for unknown repeat", () => {
    expect(RepeatBehaviorAdapter.suggestedScales("unknown")).toEqual(["md"]);
  });
});

// ── MaterialCompatAdapter ─────────────────────────────────────────────────────

describe("MaterialCompatAdapter", () => {
  it("suggestMinDPI returns 300 for print", () => {
    expect(MaterialCompatAdapter.suggestMinDPI("print")).toBe(300);
  });

  it("suggestMinDPI returns 72 for web", () => {
    expect(MaterialCompatAdapter.suggestMinDPI("web")).toBe(72);
  });

  it("suggestMinDPI returns 200 for embroidery", () => {
    expect(MaterialCompatAdapter.suggestMinDPI("embroidery")).toBe(200);
  });

  it("suggestMinDPI returns 72 fallback for unknown context", () => {
    expect(MaterialCompatAdapter.suggestMinDPI("unknown-context")).toBe(72);
  });

  it("suggestMaxScale returns xl for print", () => {
    expect(MaterialCompatAdapter.suggestMaxScale("print")).toBe("xl");
  });

  it("suggestMaxScale returns xl for ceramic", () => {
    expect(MaterialCompatAdapter.suggestMaxScale("ceramic")).toBe("xl");
  });

  it("suggestMaxScale returns lg for web", () => {
    expect(MaterialCompatAdapter.suggestMaxScale("web")).toBe("lg");
  });

  it("isKnownContext returns true for print", () => {
    expect(MaterialCompatAdapter.isKnownContext("print")).toBe(true);
  });

  it("isKnownContext returns false for unknown", () => {
    expect(MaterialCompatAdapter.isKnownContext("unknown-context")).toBe(false);
  });

  it("KNOWN_CONTEXTS includes print, web, embroidery, fabric", () => {
    expect(MaterialCompatAdapter.KNOWN_CONTEXTS).toContain("print");
    expect(MaterialCompatAdapter.KNOWN_CONTEXTS).toContain("web");
    expect(MaterialCompatAdapter.KNOWN_CONTEXTS).toContain("embroidery");
    expect(MaterialCompatAdapter.KNOWN_CONTEXTS).toContain("fabric");
  });
});

// ── isPublicStatus / PUBLIC_STATUSES ──────────────────────────────────────────

describe("isPublicStatus", () => {
  it("returns true for published", () => {
    expect(isPublicStatus("published")).toBe(true);
  });

  it("returns true for approved", () => {
    expect(isPublicStatus("approved")).toBe(true);
  });

  it("returns false for draft", () => {
    expect(isPublicStatus("draft")).toBe(false);
  });

  it("returns false for active", () => {
    expect(isPublicStatus("active")).toBe(false);
  });

  it("returns false for archived", () => {
    expect(isPublicStatus("archived")).toBe(false);
  });

  it("PUBLIC_STATUSES contains exactly published and approved", () => {
    expect(PUBLIC_STATUSES).toEqual(["published", "approved"]);
  });
});

// ── PATTERN_STATUSES and MAX_PATTERN_LIMIT ────────────────────────────────────

describe("Domain constants", () => {
  it("PATTERN_STATUSES includes draft, active, published, approved, archived", () => {
    expect(PATTERN_STATUSES).toContain("draft");
    expect(PATTERN_STATUSES).toContain("active");
    expect(PATTERN_STATUSES).toContain("published");
    expect(PATTERN_STATUSES).toContain("approved");
    expect(PATTERN_STATUSES).toContain("archived");
  });

  it("MAX_PATTERN_LIMIT is 100", () => {
    expect(MAX_PATTERN_LIMIT).toBe(100);
  });
});

// ── CreatePatternSchema ───────────────────────────────────────────────────────

describe("CreatePatternSchema", () => {
  it("accepts valid minimal input", () => {
    const result = CreatePatternSchema.parse({
      slug: "simple-test", name: "Simple Test", category: "pattern", domain: "geometric",
    });
    expect(result.slug).toBe("simple-test");
    expect(result.status).toBe("draft");   // default is draft (not active)
    expect(result.version).toBe("1.0.0");
  });

  it("default status is draft", () => {
    const result = CreatePatternSchema.parse({
      slug: "draft-test", name: "Draft Test", category: "texture", domain: "marble",
    });
    expect(result.status).toBe("draft");
  });

  it("accepts status=published", () => {
    const result = CreatePatternSchema.parse({
      slug: "pub-test", name: "Pub", category: "texture", domain: "marble", status: "published",
    });
    expect(result.status).toBe("published");
  });

  it("rejects slug with uppercase", () => {
    expect(() =>
      CreatePatternSchema.parse({ slug: "Upper-Case", name: "X", category: "pattern", domain: "geometric" }),
    ).toThrow();
  });

  it("rejects slug with spaces", () => {
    expect(() =>
      CreatePatternSchema.parse({ slug: "with spaces", name: "X", category: "pattern", domain: "geometric" }),
    ).toThrow();
  });

  it("rejects unknown domain", () => {
    expect(() =>
      CreatePatternSchema.parse({ slug: "test", name: "X", category: "pattern", domain: "unknown-domain" }),
    ).toThrow();
  });

  it("rejects unknown category", () => {
    expect(() =>
      CreatePatternSchema.parse({ slug: "test", name: "X", category: "unknown-cat", domain: "geometric" }),
    ).toThrow();
  });

  it("rejects non-hex color in color_palette", () => {
    expect(() =>
      CreatePatternSchema.parse({ slug: "test", name: "X", category: "pattern", domain: "geometric", color_palette: ["notahex"] }),
    ).toThrow();
  });

  it("accepts hex shorthand #fff", () => {
    const result = CreatePatternSchema.parse({
      slug: "hex-test", name: "Hex", category: "pattern", domain: "geometric", color_palette: ["#fff"],
    });
    expect(result.color_palette).toContain("#fff");
  });

  it("rejects non-semver version", () => {
    expect(() =>
      CreatePatternSchema.parse({ slug: "test", name: "X", category: "pattern", domain: "geometric", version: "v2" }),
    ).toThrow();
  });

  it("rejects version without patch segment", () => {
    expect(() =>
      CreatePatternSchema.parse({ slug: "test", name: "X", category: "pattern", domain: "geometric", version: "1.0" }),
    ).toThrow();
  });

  it("applies correct defaults", () => {
    const result = CreatePatternSchema.parse({ slug: "def-test", name: "D", category: "motif", domain: "floral" });
    expect(result.repeat_behavior).toBe("tile");
    expect(result.scale).toBe("md");
    expect(result.colorizable).toBe(true);
    expect(result.source_type).toBe("original");
    expect(result.status).toBe("draft");
    expect(result.style).toBe("modern");
  });

  it("accepts all valid repeat_behavior values", () => {
    for (const rb of ["tile", "half-drop", "mirror", "brick", "no-repeat"]) {
      expect(() =>
        CreatePatternSchema.parse({ slug: "test", name: "X", category: "pattern", domain: "geometric", repeat_behavior: rb }),
      ).not.toThrow();
    }
  });

  it("accepts all valid scale values", () => {
    for (const sc of ["xs", "sm", "md", "lg", "xl", "full-bleed"]) {
      expect(() =>
        CreatePatternSchema.parse({ slug: "test", name: "X", category: "pattern", domain: "geometric", scale: sc }),
      ).not.toThrow();
    }
  });
});
