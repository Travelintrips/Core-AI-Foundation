/**
 * Team 13 — Dynamic Design Composition Engine
 * Tests: fallbackHandler.ts — no-asset and partial-input cases
 */

import { describe, it, expect } from "vitest";
import { applyFallbacks, DEFAULT_BLUEPRINT, DEFAULT_LAYOUT, DEFAULT_PALETTE, DEFAULT_TYPOGRAPHY, DEFAULT_PATTERN, DEFAULT_DECORATION, DEFAULT_MATERIAL, DEFAULT_MOTIF, DEFAULT_COMPONENTS } from "../fallbackHandler.js";
import type { BrandDnaInput } from "../types.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("applyFallbacks", () => {
  describe("no-asset case — all inputs missing", () => {
    it("applies defaults for every field when nothing is provided", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      expect(result.blueprint).toEqual(DEFAULT_BLUEPRINT);
      expect(result.layoutPlan).toEqual(DEFAULT_LAYOUT);
      expect(result.pattern).toEqual(DEFAULT_PATTERN);
      expect(result.decoration).toEqual(DEFAULT_DECORATION);
      expect(result.material).toEqual(DEFAULT_MATERIAL);
    });

    it("records a fallback record for each missing field", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      const fields = result.fallbacks.map((f) => f.field);
      expect(fields).toContain("blueprint");
      expect(fields).toContain("layoutPlan");
      expect(fields).toContain("components");
      expect(fields).toContain("pattern");
      expect(fields).toContain("palette");
      expect(fields).toContain("typography");
      expect(fields).toContain("decoration");
      expect(fields).toContain("material");
      expect(fields).toContain("motif");
    });

    it("all fallback records have reason 'missing'", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      expect(result.fallbacks.every((f) => f.reason === "missing")).toBe(true);
    });

    it("default components include header, hero, cta, footer", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      const types = result.components.map((c) => c.type);
      expect(types).toContain("header");
      expect(types).toContain("hero");
      expect(types).toContain("cta");
      expect(types).toContain("footer");
    });
  });

  describe("brand DNA fallback injection", () => {
    const brandDnaWithColors: BrandDnaInput = {
      clientId: "client-001",
      detectedColors: {
        primary: "#FF0000",
        secondary: "#00FF00",
        accent: "#0000FF",
      },
      detectedTypography: {
        heading: "Playfair Display",
        body: "Lato",
        style: "serif",
      },
      industry: "technology",
      brandPersonality: ["Innovative"],
      riskProfile: "Innovative",
    };

    it("derives palette from Brand DNA detected colors when no palette provided", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        brandDnaWithColors,
      );
      expect(result.palette.primary).toBe("#FF0000");
      expect(result.palette.secondary).toBe("#00FF00");
      expect(result.palette.accent).toBe("#0000FF");
    });

    it("derives typography from Brand DNA when no typography provided", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        brandDnaWithColors,
      );
      expect(result.typography.headingFont).toBe("Playfair Display");
      expect(result.typography.bodyFont).toBe("Lato");
    });

    it("derives motif from industry when no motif provided", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        brandDnaWithColors,
      );
      // technology industry → technology motif
      expect(result.motif.theme).toBe("technology");
    });

    it("marks brand-dna fallbacks with correct source", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        brandDnaWithColors,
      );
      const dnaSourced = result.fallbacks.filter((f) => f.fallbackSource === "brand-dna");
      expect(dnaSourced.length).toBeGreaterThan(0);
    });

    it("uses industry-specific palette when no Brand DNA colors but industry provided", () => {
      const dnaWithIndustryOnly: BrandDnaInput = { industry: "finance" };
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        dnaWithIndustryOnly,
      );
      // Finance industry palette uses navy/gold tones
      expect(result.palette.primary).not.toBe(DEFAULT_PALETTE.primary);
    });

    it("falls back to layout strategy from Brand DNA layoutStyle", () => {
      const dnaWithLayout: BrandDnaInput = { layoutStyle: "minimal" };
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        dnaWithLayout,
      );
      expect(result.layoutPlan.strategy).toBe("minimal");
    });
  });

  describe("partial-input case — some inputs provided", () => {
    it("does not overwrite provided blueprint", () => {
      const customBlueprint = {
        name: "Custom",
        columns: 6,
        rows: 4,
        gutter: 16,
        maxWidth: 960,
        orientation: "landscape" as const,
        medium: "print" as const,
      };
      const result = applyFallbacks(
        customBlueprint, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      expect(result.blueprint).toEqual(customBlueprint);
      expect(result.fallbacks.some((f) => f.field === "blueprint")).toBe(false);
    });

    it("does not overwrite provided components", () => {
      const customComponents = [
        { type: "testimonial" as const, required: false, zone: "middle" as const },
      ];
      const result = applyFallbacks(
        undefined, undefined, customComponents, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      expect(result.components).toEqual(customComponents);
      expect(result.fallbacks.some((f) => f.field === "components")).toBe(false);
    });

    it("handles empty components array by applying defaults", () => {
      const result = applyFallbacks(
        undefined, undefined, [], undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      expect(result.components).toEqual(DEFAULT_COMPONENTS);
      expect(result.fallbacks.some((f) => f.field === "components")).toBe(true);
    });
  });

  describe("fallback record integrity", () => {
    it("every fallback has a non-empty fallbackValue", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      expect(result.fallbacks.every((f) => f.fallbackValue !== null && f.fallbackValue !== undefined)).toBe(true);
    });

    it("every fallback has a valid fallbackSource", () => {
      const result = applyFallbacks(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined,
      );
      const validSources = ["default", "brand-dna", "compatibility-rule"];
      expect(result.fallbacks.every((f) => validSources.includes(f.fallbackSource))).toBe(true);
    });
  });
});
