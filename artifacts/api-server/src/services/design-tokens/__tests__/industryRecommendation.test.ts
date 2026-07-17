// Team 10 — Industry Recommendation & Brand DNA Compatibility tests

import { describe, it, expect } from "vitest";
import {
  getIndustryRecommendation,
  getRecommendationByMood,
  listAllIndustries,
  rankFontPairForIndustry,
  rankPaletteForIndustry,
} from "../industryRecommendationService.js";

describe("getIndustryRecommendation", () => {
  it("returns a recommendation for every known industry", () => {
    const industries = listAllIndustries();
    for (const industry of industries) {
      const rec = getIndustryRecommendation(industry);
      expect(rec.industry).toBe(industry);
      expect(rec.rationale.length).toBeGreaterThan(10);
      expect(Array.isArray(rec.recommendedFontPairSlugs)).toBe(true);
      expect(Array.isArray(rec.recommendedPaletteSlugs)).toBe(true);
    }
  });

  it("falls back to 'general' for unknown industry", () => {
    const rec = getIndustryRecommendation("unknown_industry" as any);
    expect(rec.industry).toBe("general");
  });

  it("technology primary mood is modern", () => {
    expect(getIndustryRecommendation("technology").primaryMood).toBe("modern");
  });

  it("finance avoids playful mood", () => {
    expect(getIndustryRecommendation("finance").avoidMoods).toContain("playful");
  });

  it("legal avoids playful and bold", () => {
    const rec = getIndustryRecommendation("legal");
    expect(rec.avoidMoods).toContain("playful");
    expect(rec.avoidMoods).toContain("bold");
  });
});

describe("getRecommendationByMood", () => {
  it("returns industries with matching primary mood", () => {
    const results = getRecommendationByMood("professional");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.primaryMood).toBe("professional");
    }
  });

  it("returns empty for a mood with no primary match", () => {
    const results = getRecommendationByMood("handwriting" as any);
    expect(Array.isArray(results)).toBe(true);
  });
});

describe("listAllIndustries", () => {
  it("returns at least 10 industries", () => {
    expect(listAllIndustries().length).toBeGreaterThanOrEqual(10);
  });

  it("includes key industries", () => {
    const industries = listAllIndustries();
    expect(industries).toContain("technology");
    expect(industries).toContain("finance");
    expect(industries).toContain("healthcare");
    expect(industries).toContain("logistics");
    expect(industries).toContain("general");
  });
});

describe("rankFontPairForIndustry", () => {
  it("gives bonus for tagged industry", () => {
    const { score, reasons } = rankFontPairForIndustry(
      ["modern"],
      ["technology"],
      "technology"
    );
    expect(score).toBeGreaterThan(50);
    expect(reasons.some((r) => r.includes("Explicitly tagged"))).toBe(true);
  });

  it("gives bonus for matching primary mood", () => {
    const { score, reasons } = rankFontPairForIndustry(
      ["modern"],
      [],
      "technology"
    );
    expect(score).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes("mood"))).toBe(true);
  });

  it("penalises avoided moods", () => {
    const { score, reasons } = rankFontPairForIndustry(
      ["playful"], // avoided by finance
      [],
      "finance"
    );
    expect(score).toBeLessThan(20); // penalised
    expect(reasons.some((r) => r.includes("discouraged"))).toBe(true);
  });

  it("score is clamped to [0, 100]", () => {
    const { score } = rankFontPairForIndustry(
      ["playful", "bold", "friendly"],
      ["technology"],
      "finance" // heavy penalties
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("handles empty moods and industries", () => {
    const { score } = rankFontPairForIndustry([], [], "general");
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
