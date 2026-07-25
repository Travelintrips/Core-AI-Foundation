/**
 * Seed data integrity tests — Task 1 verification.
 *
 * Asserts:
 *   - total seed records >= 500
 *   - all materialCode values are unique
 *   - category count is exactly 13
 *
 * These run in the existing vitest node environment without a live DB.
 */

import { describe, it, expect } from "vitest";
import { ALL_MATERIALS } from "../domains/material-library/seedData.js";

describe("Seed data integrity", () => {
  it("contains at least 500 material records", () => {
    expect(ALL_MATERIALS.length).toBeGreaterThanOrEqual(500);
  });

  it("all materialCode values are unique", () => {
    const codes = ALL_MATERIALS.map((m) => m.materialCode);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("covers exactly 13 distinct categories", () => {
    const categories = new Set(ALL_MATERIALS.map((m) => m.category));
    expect(categories.size).toBe(13);
  });

  it("materialCode format is MAT-XXX-NNN for all records", () => {
    const pattern = /^MAT-[A-Z]{2,4}-\d{3}$/;
    const invalid = ALL_MATERIALS.filter((m) => !pattern.test(m.materialCode));
    expect(invalid).toHaveLength(0);
  });

  it("every record has a non-empty name, slug, and category", () => {
    const bad = ALL_MATERIALS.filter(
      (m) => !m.name.trim() || !m.slug.trim() || !m.category.trim(),
    );
    expect(bad).toHaveLength(0);
  });

  it("priceTier is one of the four allowed values for every record", () => {
    const allowed = new Set(["Budget", "Standard", "Premium", "Luxury"]);
    const bad = ALL_MATERIALS.filter((m) => !allowed.has(m.priceTier));
    expect(bad).toHaveLength(0);
  });
});
