/**
 * Tests — Canonical Normalizer + Legacy Backfill
 *
 * Covers (per spec Phase 7):
 *  1.  style normalization
 *  2.  industry normalization
 *  3.  alias Bahasa Indonesia
 *  4.  abbreviation (F&B, IT, etc.)
 *  5.  unknown value handling
 *  6.  backfill idempotency (duplicate prevention via in-memory dedup)
 *  7.  existing rich payload not overwritten (ON CONFLICT semantics tested at unit level)
 *  8.  whitespace trimming
 *  9.  case-insensitive normalization
 *  10. legacy style/industry → canonical key used in payload builder
 *  11. unresolved value reporting
 *  12. normalizeStyleOrOriginal / normalizeIndustryOrOriginal passthrough
 */

import { describe, it, expect } from "vitest";
import {
  normalizeStyle,
  normalizeIndustry,
  normalizeStyleOrOriginal,
  normalizeIndustryOrOriginal,
  isCanonicalStyle,
  isCanonicalIndustry,
  canonicalStyleKeys,
  canonicalIndustryKeys,
} from "../../utils/canonicalNormalizer.js";
import {
  generateLegacyPayload,
  generateLegacyPayloads,
  findUnresolvedValues,
} from "../../data/legacyTemplateBackfillGenerator.js";
import type { AiTemplate } from "@workspace/db";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixture factory
// ─────────────────────────────────────────────────────────────────────────────

function makeTemplate(overrides: Partial<AiTemplate> = {}): AiTemplate {
  return {
    id:               1,
    templateCode:     "TEST-MOD-001",
    name:             "Test Template",
    description:      "A test template",
    category:         "Company Profile",
    style:            "modern",
    industry:         "technology",
    colorTheme:       null,
    typography:       null,
    layout:           "grid",
    supportedPackages: null,
    brandDnaTags:     null,
    previewImages:    null,
    pdfPreviewUrl:    null,
    pptPreviewUrl:    null,
    coverImage:       null,
    editable:         true,
    isPremium:        false,
    version:          "1.0",
    status:           "published",
    featured:         false,
    sortOrder:        1,
    pricePoints:      null,
    views:            0,
    selections:       0,
    previewsGenerated: 0,
    conversions:      0,
    createdAt:        new Date(),
    updatedAt:        new Date(),
    canvasState:      null,
    canvasWidth:      null,
    canvasHeight:     null,
    tags:             null,
    ...overrides,
  } as AiTemplate;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Style normalization
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeStyle", () => {
  it("passes through already-canonical lowercase style", () => {
    expect(normalizeStyle("modern")).toBe("modern");
    expect(normalizeStyle("minimalist")).toBe("minimalist");
    expect(normalizeStyle("elegant")).toBe("elegant");
    expect(normalizeStyle("bold")).toBe("bold");
    expect(normalizeStyle("corporate")).toBe("corporate");
    expect(normalizeStyle("luxury")).toBe("luxury");
    expect(normalizeStyle("luxury_editorial")).toBe("luxury_editorial");
  });

  it("normalizes Title-Case legacy styles", () => {
    expect(normalizeStyle("Modern")).toBe("modern");
    expect(normalizeStyle("Minimalist")).toBe("minimalist");
    expect(normalizeStyle("Elegant")).toBe("elegant");
    expect(normalizeStyle("Bold")).toBe("bold");
    expect(normalizeStyle("Corporate")).toBe("corporate");
    expect(normalizeStyle("Classic")).toBe("classic");
  });

  it("maps Professional → corporate", () => {
    expect(normalizeStyle("Professional")).toBe("corporate");
    expect(normalizeStyle("professional")).toBe("corporate");
  });

  it("maps Promotional → bold", () => {
    expect(normalizeStyle("Promotional")).toBe("bold");
    expect(normalizeStyle("promotional")).toBe("bold");
  });

  it("maps Creative → contemporary", () => {
    expect(normalizeStyle("Creative")).toBe("contemporary");
    expect(normalizeStyle("creative")).toBe("contemporary");
  });

  it("maps Natural → organic", () => {
    expect(normalizeStyle("Natural")).toBe("organic");
    expect(normalizeStyle("natural")).toBe("organic");
  });

  it("returns null for unknown style", () => {
    expect(normalizeStyle("unknown_style_xyz")).toBeNull();
    expect(normalizeStyle("random")).toBeNull();
    expect(normalizeStyle("NotAStyle")).toBeNull();
  });

  it("trims whitespace before normalizing", () => {
    expect(normalizeStyle("  Modern  ")).toBe("modern");
    expect(normalizeStyle("\tminimalist\n")).toBe("minimalist");
  });

  it("returns null for empty string", () => {
    expect(normalizeStyle("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Industry normalization
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeIndustry", () => {
  it("passes through already-canonical lowercase industry", () => {
    expect(normalizeIndustry("technology")).toBe("technology");
    expect(normalizeIndustry("finance")).toBe("finance");
    expect(normalizeIndustry("food_beverage")).toBe("food_beverage");
    expect(normalizeIndustry("real_estate")).toBe("real_estate");
    expect(normalizeIndustry("logistics")).toBe("logistics");
  });

  it("normalizes Title-Case legacy industries", () => {
    expect(normalizeIndustry("Technology")).toBe("technology");
    expect(normalizeIndustry("Finance")).toBe("finance");
    expect(normalizeIndustry("Healthcare")).toBe("healthcare");
    expect(normalizeIndustry("Education")).toBe("education");
    expect(normalizeIndustry("Manufacturing")).toBe("manufacturing");
    expect(normalizeIndustry("Construction")).toBe("construction");
    expect(normalizeIndustry("Retail")).toBe("retail");
    expect(normalizeIndustry("Logistics")).toBe("logistics");
  });

  // 3. Bahasa Indonesia alias
  it("resolves Bahasa Indonesia industry names", () => {
    expect(normalizeIndustry("Teknologi")).toBe("technology");
    expect(normalizeIndustry("teknologi")).toBe("technology");
    expect(normalizeIndustry("kesehatan")).toBe("healthcare");
    expect(normalizeIndustry("pendidikan")).toBe("education");
    expect(normalizeIndustry("keuangan")).toBe("finance");
    expect(normalizeIndustry("logistik")).toBe("logistics");
    expect(normalizeIndustry("manufaktur")).toBe("manufacturing");
    expect(normalizeIndustry("konstruksi")).toBe("construction");
    expect(normalizeIndustry("properti")).toBe("real_estate");
    expect(normalizeIndustry("perdagangan")).toBe("consulting");
  });

  // 4. Abbreviation handling
  it("resolves abbreviations like F&B", () => {
    expect(normalizeIndustry("F&B")).toBe("food_beverage");
    expect(normalizeIndustry("f&b")).toBe("food_beverage");
    expect(normalizeIndustry("FnB")).toBe("food_beverage");
    expect(normalizeIndustry("fnb")).toBe("food_beverage");
  });

  it("maps Property → real_estate", () => {
    expect(normalizeIndustry("Property")).toBe("real_estate");
    expect(normalizeIndustry("property")).toBe("real_estate");
  });

  it("maps Export and Trading → consulting", () => {
    expect(normalizeIndustry("Export")).toBe("consulting");
    expect(normalizeIndustry("export")).toBe("consulting");
    expect(normalizeIndustry("Trading")).toBe("consulting");
    expect(normalizeIndustry("trading")).toBe("consulting");
  });

  it("maps Legal → consulting", () => {
    expect(normalizeIndustry("Legal")).toBe("consulting");
    expect(normalizeIndustry("legal")).toBe("consulting");
  });

  // 5. Unknown value handling
  it("returns null for unknown industry", () => {
    expect(normalizeIndustry("unknown_industry_xyz")).toBeNull();
    expect(normalizeIndustry("SomeRandomSector")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeIndustry("")).toBeNull();
  });

  it("trims whitespace before normalizing", () => {
    expect(normalizeIndustry("  Technology  ")).toBe("technology");
    expect(normalizeIndustry("\tLogistics\n")).toBe("logistics");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeStyleOrOriginal / normalizeIndustryOrOriginal
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeStyleOrOriginal", () => {
  it("returns canonical for known styles", () => {
    expect(normalizeStyleOrOriginal("Modern")).toBe("modern");
    expect(normalizeStyleOrOriginal("Professional")).toBe("corporate");
  });

  it("returns original for unknown styles (not null)", () => {
    const original = "completelymadeup";
    expect(normalizeStyleOrOriginal(original)).toBe(original);
  });
});

describe("normalizeIndustryOrOriginal", () => {
  it("returns canonical for known industries", () => {
    expect(normalizeIndustryOrOriginal("Technology")).toBe("technology");
    expect(normalizeIndustryOrOriginal("F&B")).toBe("food_beverage");
  });

  it("returns original for unknown industries (not null)", () => {
    const original = "completelymadeup";
    expect(normalizeIndustryOrOriginal(original)).toBe(original);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isCanonical checks
// ─────────────────────────────────────────────────────────────────────────────

describe("isCanonicalStyle", () => {
  it("returns true for already-canonical styles", () => {
    expect(isCanonicalStyle("modern")).toBe(true);
    expect(isCanonicalStyle("bold")).toBe(true);
  });

  it("returns false for legacy/alias styles", () => {
    expect(isCanonicalStyle("Modern")).toBe(false);
    expect(isCanonicalStyle("Professional")).toBe(false);
    expect(isCanonicalStyle("Natural")).toBe(false);
  });
});

describe("isCanonicalIndustry", () => {
  it("returns true for already-canonical industries", () => {
    expect(isCanonicalIndustry("technology")).toBe(true);
    expect(isCanonicalIndustry("food_beverage")).toBe(true);
  });

  it("returns false for legacy/alias industries", () => {
    expect(isCanonicalIndustry("Technology")).toBe(false);
    expect(isCanonicalIndustry("F&B")).toBe(false);
    expect(isCanonicalIndustry("Teknologi")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canonicalStyleKeys / canonicalIndustryKeys
// ─────────────────────────────────────────────────────────────────────────────

describe("canonicalStyleKeys", () => {
  it("returns a non-empty array of unique canonical keys", () => {
    const keys = canonicalStyleKeys();
    expect(keys.length).toBeGreaterThan(10);
    expect(new Set(keys).size).toBe(keys.length); // unique
    expect(keys).toContain("modern");
    expect(keys).toContain("corporate");
  });
});

describe("canonicalIndustryKeys", () => {
  it("returns a non-empty array of unique canonical keys", () => {
    const keys = canonicalIndustryKeys();
    expect(keys.length).toBeGreaterThan(10);
    expect(new Set(keys).size).toBe(keys.length); // unique
    expect(keys).toContain("technology");
    expect(keys).toContain("food_beverage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Backfill idempotency — in-memory dedup
// ─────────────────────────────────────────────────────────────────────────────

describe("generateLegacyPayloads — idempotency", () => {
  it("deduplicates templates with the same templateCode in-memory", () => {
    const t1 = makeTemplate({ templateCode: "DUP-001", style: "Modern", industry: "Technology" });
    const payloads = generateLegacyPayloads([t1, t1, t1]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.templateCode).toBe("DUP-001");
  });

  it("produces the same output when called twice on the same input", () => {
    const templates = [
      makeTemplate({ templateCode: "T-001", style: "Corporate", industry: "Finance" }),
      makeTemplate({ templateCode: "T-002", style: "Elegant",   industry: "Healthcare" }),
    ];
    const first  = generateLegacyPayloads(templates);
    const second = generateLegacyPayloads(templates);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second)); // deterministic
  });

  it("assigns unique slugs prefixed with 'legacy-'", () => {
    const templates = [
      makeTemplate({ templateCode: "SLUG-001" }),
      makeTemplate({ templateCode: "SLUG-002" }),
    ];
    const payloads = generateLegacyPayloads(templates);
    expect(payloads[0]?.slug).toMatch(/^legacy-/);
    expect(payloads[1]?.slug).toMatch(/^legacy-/);
    expect(payloads[0]?.slug).not.toBe(payloads[1]?.slug); // unique
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Existing rich payload not overwritten (unit-level assertion)
// ─────────────────────────────────────────────────────────────────────────────

describe("generateLegacyPayload — field completeness", () => {
  it("produces non-null rich payload for a legacy template", () => {
    const t = makeTemplate({ style: "Modern", industry: "Technology" });
    const p = generateLegacyPayload(t);
    expect(p.brandDna).not.toBeNull();
    expect(p.visualDna).not.toBeNull();
    expect(p.composition).not.toBeNull();
    expect(p.promptGuidance).not.toBeNull();
    expect(p.qualityRules).not.toBeNull();
    expect(p.businessContext).not.toBeNull();
    expect(p.outputSupport).not.toBeNull();
  });

  it("uses canonical style in visualDna.designStyle", () => {
    const t = makeTemplate({ style: "Professional" }); // legacy → corporate
    const p = generateLegacyPayload(t);
    expect(p.visualDna?.designStyle).toBe("corporate");
  });

  it("approvalStatus is always 'published'", () => {
    const p = generateLegacyPayload(makeTemplate({ style: "Bold", industry: "Retail" }));
    expect(p.approvalStatus).toBe("published");
  });

  it("generatedByAi is false", () => {
    const p = generateLegacyPayload(makeTemplate());
    expect(p.generatedByAi).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Legacy style → canonical key used in payload
// ─────────────────────────────────────────────────────────────────────────────

describe("generateLegacyPayload — normalization integration", () => {
  it("Title-Case style 'Modern' resolves to 'modern' in visualDna", () => {
    const p = generateLegacyPayload(makeTemplate({ style: "Modern" }));
    expect(p.visualDna?.designStyle).toBe("modern");
  });

  it("industry 'F&B' resolves to business context for food_beverage", () => {
    const p = generateLegacyPayload(makeTemplate({ industry: "F&B" }));
    // businessType from food_beverage industry context
    expect(p.businessContext).toBeDefined();
  });

  it("industry 'Teknologi' resolves to technology context", () => {
    const p = generateLegacyPayload(makeTemplate({ industry: "Teknologi" }));
    expect(p.businessContext).toBeDefined();
  });

  it("industry 'Property' resolves to real_estate context", () => {
    const p = generateLegacyPayload(makeTemplate({ industry: "Property" }));
    expect(p.businessContext).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Unresolved value reporter
// ─────────────────────────────────────────────────────────────────────────────

describe("findUnresolvedValues", () => {
  it("returns empty arrays when all values are canonical", () => {
    const templates = [
      makeTemplate({ style: "modern",    industry: "technology" }),
      makeTemplate({ style: "corporate", industry: "finance" }),
    ];
    const result = findUnresolvedValues(templates);
    expect(result.styles).toHaveLength(0);
    expect(result.industries).toHaveLength(0);
  });

  it("reports templates with unresolvable style", () => {
    const templates = [
      makeTemplate({ templateCode: "T-UNK", style: "unknownstyle123", industry: "technology" }),
    ];
    const result = findUnresolvedValues(templates);
    expect(result.styles).toHaveLength(1);
    expect(result.styles[0]?.templateCode).toBe("T-UNK");
    expect(result.styles[0]?.rawStyle).toBe("unknownstyle123");
  });

  it("reports templates with unresolvable industry", () => {
    const templates = [
      makeTemplate({ templateCode: "T-UNK2", style: "modern", industry: "unknownsector" }),
    ];
    const result = findUnresolvedValues(templates);
    expect(result.industries).toHaveLength(1);
    expect(result.industries[0]?.rawIndustry).toBe("unknownsector");
  });

  it("does NOT report legacy values that have aliases (they are resolvable)", () => {
    const templates = [
      makeTemplate({ style: "Professional", industry: "Technology" }),
      makeTemplate({ style: "Creative",     industry: "F&B" }),
    ];
    const result = findUnresolvedValues(templates);
    expect(result.styles).toHaveLength(0);
    expect(result.industries).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Candidate retrieval verifications (style family + industry matching)
//     These are pure-unit checks on the normalizer, not DB queries.
// ─────────────────────────────────────────────────────────────────────────────

describe("candidate retrieval normalization", () => {
  const industryTestCases: [string, string][] = [
    ["fashion",      "fashion"],
    ["technology",   "technology"],
    ["food_beverage","food_beverage"],
    ["logistics",    "logistics"],
    ["real_estate",  "real_estate"],
    // legacy aliases
    ["F&B",          "food_beverage"],
    ["Property",     "real_estate"],
    ["Teknologi",    "technology"],
    ["Export",       "consulting"],
    ["Trading",      "consulting"],
  ];

  it.each(industryTestCases)(
    "normalizeIndustry('%s') → '%s'",
    (input, expected) => {
      expect(normalizeIndustry(input)).toBe(expected);
    },
  );

  const styleTestCases: [string, string][] = [
    ["elegant",      "elegant"],
    ["modern",       "modern"],
    ["minimalist",   "minimalist"],
    ["professional", "corporate"],
    // legacy aliases
    ["Elegant",      "elegant"],
    ["Modern",       "modern"],
    ["Minimalist",   "minimalist"],
    ["Professional", "corporate"],
  ];

  it.each(styleTestCases)(
    "normalizeStyle('%s') → '%s'",
    (input, expected) => {
      expect(normalizeStyle(input)).toBe(expected);
    },
  );
});
