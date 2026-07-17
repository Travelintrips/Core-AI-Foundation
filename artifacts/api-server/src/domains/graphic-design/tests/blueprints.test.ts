/**
 * graphic-design/tests/blueprints.test.ts — Team 15
 *
 * Tests for blueprint print dimensions, bleed/safe areas, DPI conversions,
 * and variant lookup.
 */

import { describe, it, expect } from "vitest";
import {
  getAllBlueprints,
  getBlueprint,
  getVariantSpec,
  getVariantGroups,
  isPrintSpec,
  mmToPx,
  type PrintSpec,
  type DigitalSpec,
} from "../blueprints.js";
import { GD_SERVICE_CODES } from "../schema.js";

// ── mmToPx ────────────────────────────────────────────────────────────────────

describe("mmToPx", () => {
  it("converts A4 width (210mm) at 300dpi correctly", () => {
    // 210 / 25.4 * 300 = 2480.3… → 2480
    expect(mmToPx(210, 300)).toBe(2480);
  });

  it("converts A4 height (297mm) at 300dpi correctly", () => {
    expect(mmToPx(297, 300)).toBe(3508);
  });

  it("converts A5 width (148mm) at 300dpi", () => {
    expect(mmToPx(148, 300)).toBe(1748);
  });

  it("converts standard business card (90mm) at 300dpi", () => {
    expect(mmToPx(90, 300)).toBe(1063);
  });

  it("rounds to nearest integer", () => {
    // Should never return a fractional pixel
    expect(Number.isInteger(mmToPx(99, 300))).toBe(true);
  });
});

// ── Blueprint coverage ────────────────────────────────────────────────────────

describe("getAllBlueprints", () => {
  it("has an entry for every GD service code", () => {
    const blueprints = getAllBlueprints();
    for (const code of GD_SERVICE_CODES) {
      expect(blueprints[code], `Missing blueprint for ${code}`).toBeDefined();
    }
  });

  it("returns exactly 10 blueprints", () => {
    expect(Object.keys(getAllBlueprints())).toHaveLength(10);
  });
});

describe("getBlueprint", () => {
  it("throws for an unknown service code", () => {
    expect(() => getBlueprint("GD-UNKNOWN" as never)).toThrow();
  });

  it("returns correct service code on the blueprint", () => {
    for (const code of GD_SERVICE_CODES) {
      const bp = getBlueprint(code);
      expect(bp.serviceCode).toBe(code);
    }
  });
});

// ── Print spec integrity ──────────────────────────────────────────────────────

describe("Print specs — dimension integrity", () => {
  it("A4 letterhead portrait has correct pixel dims at 300dpi with 3mm bleed", () => {
    const bp = getBlueprint("GD-LTRHEAD");
    const spec = bp.printVariants["a4_portrait"] as PrintSpec;
    expect(spec).toBeDefined();
    expect(spec.widthMm).toBe(210);
    expect(spec.heightMm).toBe(297);
    expect(spec.bleedMm).toBe(3);
    // Width with bleed: (210 + 6) mm × 300/25.4 = 216 × 11.811 = 2551
    expect(spec.widthPxWithBleed).toBe(mmToPx(216, 300));
    expect(spec.heightPxWithBleed).toBe(mmToPx(303, 300));
    expect(spec.widthPxTrim).toBe(mmToPx(210, 300));
    expect(spec.heightPxTrim).toBe(mmToPx(297, 300));
  });

  it("Standard business card has correct dims (90×55mm)", () => {
    const bp   = getBlueprint("GD-BCARD");
    const spec = bp.printVariants["standard_landscape"] as PrintSpec;
    expect(spec.widthMm).toBe(90);
    expect(spec.heightMm).toBe(55);
    expect(spec.bleedMm).toBe(3);
    expect(spec.safeAreaMm).toBe(5);
    expect(spec.resolutionDpi).toBe(300);
    expect(spec.colorMode).toBe("CMYK");
  });

  it("all print specs have widthPxWithBleed > widthPxTrim", () => {
    const all = getAllBlueprints();
    for (const bp of Object.values(all)) {
      for (const [name, spec] of Object.entries(bp.printVariants)) {
        const ps = spec as PrintSpec;
        expect(ps.widthPxWithBleed, `${bp.serviceCode}/${name} widthPxWithBleed`).toBeGreaterThan(ps.widthPxTrim);
        expect(ps.heightPxWithBleed, `${bp.serviceCode}/${name} heightPxWithBleed`).toBeGreaterThan(ps.heightPxTrim);
      }
    }
  });

  it("all print specs have CMYK color mode", () => {
    for (const bp of Object.values(getAllBlueprints())) {
      for (const [name, spec] of Object.entries(bp.printVariants)) {
        const ps = spec as PrintSpec;
        expect(["CMYK", "both"], `${bp.serviceCode}/${name} colorMode`).toContain(ps.colorMode);
      }
    }
  });

  it("bleedMm is at least 3 for all print specs", () => {
    for (const bp of Object.values(getAllBlueprints())) {
      for (const [name, spec] of Object.entries(bp.printVariants)) {
        expect((spec as PrintSpec).bleedMm, `${bp.serviceCode}/${name} bleedMm`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("safeAreaMm is greater than bleedMm for all print specs", () => {
    for (const bp of Object.values(getAllBlueprints())) {
      for (const [name, spec] of Object.entries(bp.printVariants)) {
        const ps = spec as PrintSpec;
        expect(ps.safeAreaMm, `${bp.serviceCode}/${name} safeAreaMm`).toBeGreaterThan(ps.bleedMm);
      }
    }
  });
});

// ── Digital spec integrity ────────────────────────────────────────────────────

describe("Digital specs — integrity", () => {
  it("Instagram post is 1080×1080", () => {
    const bp   = getBlueprint("GD-SOCIAL");
    const spec = bp.digitalVariants["ig_post_1080x1080"] as DigitalSpec;
    expect(spec.widthPx).toBe(1080);
    expect(spec.heightPx).toBe(1080);
    expect(spec.bleedPx).toBe(0);
    expect(spec.colorMode).toMatch(/sRGB|RGB/);
  });

  it("all digital specs have bleedPx === 0", () => {
    for (const bp of Object.values(getAllBlueprints())) {
      for (const [name, spec] of Object.entries(bp.digitalVariants)) {
        expect((spec as DigitalSpec).bleedPx, `${bp.serviceCode}/${name} bleedPx`).toBe(0);
      }
    }
  });
});

// ── GD-SOCIAL has no print variants ──────────────────────────────────────────

describe("GD-SOCIAL", () => {
  it("is digital-only (no print variants)", () => {
    const bp = getBlueprint("GD-SOCIAL");
    expect(bp.medium).toBe("digital");
    expect(Object.keys(bp.printVariants)).toHaveLength(0);
    expect(Object.keys(bp.digitalVariants).length).toBeGreaterThan(5);
  });
});

// ── Variant spec lookup ───────────────────────────────────────────────────────

describe("getVariantSpec", () => {
  it("returns print spec for known print variant", () => {
    const spec = getVariantSpec("GD-FLYER", "a5_portrait");
    expect(isPrintSpec(spec as PrintSpec | DigitalSpec)).toBe(true);
  });

  it("returns digital spec for known digital variant", () => {
    const spec = getVariantSpec("GD-SOCIAL", "ig_post_1080x1080");
    expect(isPrintSpec(spec as PrintSpec | DigitalSpec)).toBe(false);
  });

  it("throws for an unknown variant", () => {
    expect(() => getVariantSpec("GD-FLYER", "non_existent_variant")).toThrow();
  });
});

// ── Variant groups ────────────────────────────────────────────────────────────

describe("getVariantGroups", () => {
  it("returns separate print and digital arrays", () => {
    const groups = getVariantGroups("GD-BCARD");
    expect(groups.print.length).toBeGreaterThan(0);
    expect(groups.digital.length).toBeGreaterThan(0);
  });

  it("GD-SOCIAL returns empty print array", () => {
    const groups = getVariantGroups("GD-SOCIAL");
    expect(groups.print).toHaveLength(0);
    expect(groups.digital.length).toBeGreaterThan(0);
  });

  it("all variants in groups are found by getVariantSpec", () => {
    for (const code of GD_SERVICE_CODES) {
      const { print, digital } = getVariantGroups(code);
      for (const v of [...print, ...digital]) {
        expect(() => getVariantSpec(code, v)).not.toThrow();
      }
    }
  });
});

// ── isPrintSpec type guard ────────────────────────────────────────────────────

describe("isPrintSpec", () => {
  it("returns true for a print spec", () => {
    const spec = getVariantSpec("GD-POSTER", "a3_portrait");
    expect(isPrintSpec(spec as PrintSpec | DigitalSpec)).toBe(true);
  });

  it("returns false for a digital spec", () => {
    const spec = getVariantSpec("GD-SOCIAL", "ig_story_1080x1920");
    expect(isPrintSpec(spec as PrintSpec | DigitalSpec)).toBe(false);
  });
});
