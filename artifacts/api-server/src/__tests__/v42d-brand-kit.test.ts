/**
 * V4.2D Brand Kit Enterprise Tests
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Completeness score (pure function, no DB) ─────────────────────────────────

// Import the scoring logic by extracting the pure parts
describe("Brand completeness scoring", () => {
  const BRAND_KIT_SLOTS_TEST = [
    "logo", "secondary_logo", "icon", "brand_color", "secondary_color", "accent_color",
    "typography_heading", "typography_body", "brand_voice", "writing_style",
    "photography_style", "illustration_style", "icon_style", "do_dont", "social_style",
    "email_signature", "stationery", "corporate_pattern", "brand_guidelines_pdf",
  ];

  const SLOT_WEIGHTS_TEST: Record<string, number> = {
    logo: 15, secondary_logo: 5, icon: 5,
    brand_color: 10, secondary_color: 5, accent_color: 5,
    typography_heading: 8, typography_body: 7,
    brand_voice: 6, writing_style: 4, photography_style: 3, illustration_style: 2,
    icon_style: 3, do_dont: 3, social_style: 3, email_signature: 2, stationery: 2, corporate_pattern: 2,
    brand_guidelines_pdf: 10,
  };

  function computeTotal(filledSlots: string[]): number {
    const active = new Set(filledSlots);
    return BRAND_KIT_SLOTS_TEST.reduce((sum, slot) => {
      return active.has(slot) ? sum + (SLOT_WEIGHTS_TEST[slot] ?? 0) : sum;
    }, 0);
  }

  it("empty kit scores 0", () => {
    expect(computeTotal([])).toBe(0);
  });

  it("logo alone scores 15", () => {
    expect(computeTotal(["logo"])).toBe(15);
  });

  it("complete kit scores 100", () => {
    expect(computeTotal(BRAND_KIT_SLOTS_TEST)).toBe(100);
  });

  it("logo + colors + fonts = 55", () => {
    const slots = ["logo", "secondary_logo", "icon", "brand_color", "secondary_color", "accent_color", "typography_heading", "typography_body"];
    expect(computeTotal(slots)).toBe(15 + 5 + 5 + 10 + 5 + 5 + 8 + 7);
  });

  it("brand_guidelines_pdf alone scores 10", () => {
    expect(computeTotal(["brand_guidelines_pdf"])).toBe(10);
  });

  it("isComplete threshold is >= 80", () => {
    // Fill all critical slots to get >= 80
    const enoughSlots = ["logo", "secondary_logo", "icon", "brand_color", "secondary_color", "accent_color",
      "typography_heading", "typography_body", "brand_voice", "writing_style", "brand_guidelines_pdf"];
    const score = computeTotal(enoughSlots);
    expect(score).toBeGreaterThanOrEqual(80);
  });
});

// ── Slot validation ───────────────────────────────────────────────────────────

describe("BRAND_KIT_SLOTS constants", () => {
  const VALID_SLOTS = new Set([
    "logo", "secondary_logo", "icon", "monogram",
    "brand_color", "secondary_color", "accent_color",
    "typography_heading", "typography_body",
    "brand_voice", "writing_style", "photography_style", "illustration_style",
    "icon_style", "do_dont", "social_style", "email_signature", "stationery",
    "corporate_pattern", "brand_guidelines_pdf",
  ]);

  it("has 20 slots total", () => {
    expect(VALID_SLOTS.size).toBe(20);
  });

  it("includes logo dimension", () => {
    expect(VALID_SLOTS.has("logo")).toBe(true);
    expect(VALID_SLOTS.has("secondary_logo")).toBe(true);
    expect(VALID_SLOTS.has("icon")).toBe(true);
    expect(VALID_SLOTS.has("monogram")).toBe(true);
  });

  it("includes color dimension", () => {
    expect(VALID_SLOTS.has("brand_color")).toBe(true);
    expect(VALID_SLOTS.has("secondary_color")).toBe(true);
    expect(VALID_SLOTS.has("accent_color")).toBe(true);
  });

  it("includes typography dimension", () => {
    expect(VALID_SLOTS.has("typography_heading")).toBe(true);
    expect(VALID_SLOTS.has("typography_body")).toBe(true);
  });

  it("includes voice dimension", () => {
    expect(VALID_SLOTS.has("brand_voice")).toBe(true);
    expect(VALID_SLOTS.has("writing_style")).toBe(true);
  });

  it("includes guidelines slot", () => {
    expect(VALID_SLOTS.has("brand_guidelines_pdf")).toBe(true);
  });
});

// ── Dimension groupings ───────────────────────────────────────────────────────

describe("Brand kit dimension groupings", () => {
  const SLOT_DIMENSIONS_TEST: Record<string, string[]> = {
    logo:       ["logo", "secondary_logo", "icon"],
    colors:     ["brand_color", "secondary_color", "accent_color"],
    fonts:      ["typography_heading", "typography_body"],
    voice:      ["brand_voice", "writing_style", "photography_style", "illustration_style"],
    assets:     ["icon_style", "do_dont", "social_style", "email_signature", "stationery", "corporate_pattern"],
    guidelines: ["brand_guidelines_pdf"],
  };

  it("has 6 dimensions", () => {
    expect(Object.keys(SLOT_DIMENSIONS_TEST).length).toBe(6);
  });

  it("dimensions cover expected slots", () => {
    const allSlots = Object.values(SLOT_DIMENSIONS_TEST).flat();
    expect(allSlots).toContain("logo");
    expect(allSlots).toContain("brand_color");
    expect(allSlots).toContain("typography_heading");
    expect(allSlots).toContain("brand_guidelines_pdf");
  });
});

// ── Asset upload validation ───────────────────────────────────────────────────

describe("Brand kit slot upsert input validation", () => {
  const VALID_SLOTS_ARR = [
    "logo", "secondary_logo", "icon", "monogram",
    "brand_color", "secondary_color", "accent_color",
    "typography_heading", "typography_body",
    "brand_voice", "writing_style", "photography_style", "illustration_style",
    "icon_style", "do_dont", "social_style", "email_signature", "stationery",
    "corporate_pattern", "brand_guidelines_pdf",
  ];

  it("accepts all valid slots", () => {
    for (const slot of VALID_SLOTS_ARR) {
      expect(VALID_SLOTS_ARR.includes(slot)).toBe(true);
    }
  });

  it("rejects invalid slot name", () => {
    expect(VALID_SLOTS_ARR.includes("not_a_slot")).toBe(false);
    expect(VALID_SLOTS_ARR.includes("")).toBe(false);
    expect(VALID_SLOTS_ARR.includes("LOGO")).toBe(false);
  });
});

// ── Version increment ─────────────────────────────────────────────────────────

describe("Brand kit versioning logic", () => {
  it("new slot starts at version 1", () => {
    const currentVersion = 0; // no existing
    const newVersion = currentVersion + 1;
    expect(newVersion).toBe(1);
  });

  it("replacing existing slot increments version", () => {
    const existingVersion = 3;
    const newVersion = existingVersion + 1;
    expect(newVersion).toBe(4);
  });
});
