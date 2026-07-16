/**
 * Fashion & Apparel Design — Unit Tests (Team 18)
 *
 * Tests for:
 * - validatePanelConstraints: panel size min/max enforcement
 * - validateNumbering: 0–99 range, numeric check
 * - validateMotifRepeat: scale 0–10
 * - checkTrademark: brand blocklist coverage
 */

import { describe, it, expect } from "vitest";
import {
  validatePanelConstraints,
  validateNumbering,
  validateMotifRepeat,
  checkTrademark,
  validateServiceType,
  validateStatus,
} from "../../services/fashionDesignService.js";

// ── validatePanelConstraints ──────────────────────────────────────────────────

describe("validatePanelConstraints", () => {
  it("passes valid panel sizes", () => {
    const result = validatePanelConstraints({
      front: { size: { w: 400, h: 600 } },
      "logo-area": { size: { w: 100, h: 100 } },
      number: { size: { w: 120, h: 150 } },
    });
    expect(result.violations).toHaveLength(0);
  });

  it("reports violation when width too small", () => {
    const result = validatePanelConstraints({
      front: { size: { w: 100, h: 600 } }, // minW is 300
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/front.*width.*100px/);
  });

  it("reports violation when width too large", () => {
    const result = validatePanelConstraints({
      "logo-area": { size: { w: 500, h: 100 } }, // maxW is 300
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/logo-area.*width.*500px/);
  });

  it("reports violation when height too small", () => {
    const result = validatePanelConstraints({
      sleeves: { size: { w: 100, h: 50 } }, // minH is 200
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(/sleeves.*height.*50px/);
  });

  it("accumulates multiple violations", () => {
    const result = validatePanelConstraints({
      front: { size: { w: 10, h: 10 } },    // both too small
      back: { size: { w: 1000, h: 1000 } }, // both too large
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("skips panels with no size", () => {
    const result = validatePanelConstraints({
      front: { enabled: true } as any,
    });
    expect(result.violations).toHaveLength(0);
  });

  it("skips unknown panels", () => {
    const result = validatePanelConstraints({
      "unknown-panel": { size: { w: 1, h: 1 } },
    });
    expect(result.violations).toHaveLength(0);
  });
});

// ── validateNumbering ─────────────────────────────────────────────────────────

describe("validateNumbering", () => {
  it("passes valid jersey numbers", () => {
    expect(validateNumbering("0")).toEqual({ valid: true });
    expect(validateNumbering("10")).toEqual({ valid: true });
    expect(validateNumbering("99")).toEqual({ valid: true });
    expect(validateNumbering("7")).toEqual({ valid: true });
  });

  it("passes when no number provided", () => {
    expect(validateNumbering(undefined)).toEqual({ valid: true });
    expect(validateNumbering(null)).toEqual({ valid: true });
    expect(validateNumbering("")).toEqual({ valid: true });
  });

  it("fails for non-numeric value", () => {
    const result = validateNumbering("abc");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/numeric/i);
  });

  it("fails for number > 99", () => {
    const result = validateNumbering("100");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/0.*99/);
  });

  it("fails for negative number", () => {
    const result = validateNumbering("-1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/0.*99/);
  });
});

// ── validateMotifRepeat ───────────────────────────────────────────────────────

describe("validateMotifRepeat", () => {
  it("passes valid scale values", () => {
    expect(validateMotifRepeat({ scale: 1 })).toEqual({ valid: true });
    expect(validateMotifRepeat({ scale: 5 })).toEqual({ valid: true });
    expect(validateMotifRepeat({ scale: 10 })).toEqual({ valid: true });
    expect(validateMotifRepeat({ scale: 0.5 })).toEqual({ valid: true });
  });

  it("passes when no motif config", () => {
    expect(validateMotifRepeat(undefined)).toEqual({ valid: true });
    expect(validateMotifRepeat(null)).toEqual({ valid: true });
    expect(validateMotifRepeat({})).toEqual({ valid: true });
  });

  it("fails for scale > 10", () => {
    const result = validateMotifRepeat({ scale: 11 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/scale/i);
  });

  it("fails for scale <= 0", () => {
    const result = validateMotifRepeat({ scale: 0 });
    expect(result.valid).toBe(false);
  });

  it("fails for negative scale", () => {
    const result = validateMotifRepeat({ scale: -1 });
    expect(result.valid).toBe(false);
  });
});

// ── checkTrademark ────────────────────────────────────────────────────────────

describe("checkTrademark", () => {
  it("passes clean names", () => {
    const result = checkTrademark({
      orderName: "Jersey Tim Futsal Garuda 2026",
      description: "Desain batik khas Jawa dengan warna merah putih",
    });
    expect(result.safe).toBe(true);
    expect(result.flags).toHaveLength(0);
    expect(result.checkedFields).toContain("orderName");
  });

  it("flags Nike reference", () => {
    const result = checkTrademark({ orderName: "Nike Style Jersey" });
    expect(result.safe).toBe(false);
    expect(result.flags.some((f) => f.includes("nike"))).toBe(true);
  });

  it("flags Adidas reference (case-insensitive)", () => {
    const result = checkTrademark({ orderName: "ADIDAS inspired hoodie" });
    expect(result.safe).toBe(false);
    expect(result.flags.some((f) => f.includes("adidas"))).toBe(true);
  });

  it("flags well-known sports club names", () => {
    const result = checkTrademark({ sponsor_0: "Manchester United" });
    expect(result.safe).toBe(false);
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    const result1 = checkTrademark({ name: "GUCCI" });
    const result2 = checkTrademark({ name: "gucci" });
    const result3 = checkTrademark({ name: "Gucci" });
    expect(result1.safe).toBe(false);
    expect(result2.safe).toBe(false);
    expect(result3.safe).toBe(false);
  });

  it("reports all checked field names", () => {
    const result = checkTrademark({ orderName: "clean", description: "clean too" });
    expect(result.checkedFields).toContain("orderName");
    expect(result.checkedFields).toContain("description");
  });

  it("accumulates multiple flags across fields", () => {
    const result = checkTrademark({
      orderName: "Nike hoodie",
      description: "Adidas inspired",
    });
    expect(result.safe).toBe(false);
    expect(result.flags.length).toBeGreaterThanOrEqual(2);
  });
});

// ── validateServiceType ───────────────────────────────────────────────────────

describe("validateServiceType", () => {
  it("passes all valid service types", () => {
    const validTypes = ["t-shirt", "jersey", "hoodie", "uniform", "jacket", "dress", "batik-inspired", "merchandise"];
    for (const t of validTypes) {
      expect(() => validateServiceType(t)).not.toThrow();
    }
  });

  it("throws for invalid service type", () => {
    expect(() => validateServiceType("sneakers")).toThrow(/Invalid service type/);
    expect(() => validateServiceType("pants")).toThrow(/Invalid service type/);
    expect(() => validateServiceType("")).toThrow(/Invalid service type/);
  });
});

// ── validateStatus ────────────────────────────────────────────────────────────

describe("validateStatus", () => {
  it("passes all valid statuses", () => {
    const validStatuses = ["draft", "blueprint_ready", "generating", "review", "approved", "delivered", "trademark_flagged", "cancelled"];
    for (const s of validStatuses) {
      expect(() => validateStatus(s)).not.toThrow();
    }
  });

  it("throws for invalid status", () => {
    expect(() => validateStatus("pending")).toThrow(/Invalid status/);
    expect(() => validateStatus("done")).toThrow(/Invalid status/);
  });
});
