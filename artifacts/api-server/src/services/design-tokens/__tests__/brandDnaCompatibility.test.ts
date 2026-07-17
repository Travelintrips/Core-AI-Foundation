// Team 10 — Brand DNA Compatibility unit tests (pure logic, no DB)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB-dependent services ────────────────────────────────────────────────

vi.mock("../fontPairService.js", () => ({
  listFontPairs: vi.fn(),
  getFontPairWithRoles: vi.fn(),
}));

vi.mock("../colorPaletteService.js", () => ({
  listColorPalettes: vi.fn(),
  getColorPaletteWithRoles: vi.fn(),
}));

import { listFontPairs } from "../fontPairService.js";
import { listColorPalettes, getColorPaletteWithRoles } from "../colorPaletteService.js";
import { getCompatibleFontPairs, getCompatiblePalettes, scoreSpecificCombination } from "../brandDnaCompatibilityService.js";
import { getFontPairWithRoles } from "../fontPairService.js";

const MOCK_PAIRS = [
  { id: 1, name: "Modern Sans", slug: "modern-sans", mood: ["modern", "professional"], industries: ["technology"], active: true },
  { id: 2, name: "Playful Round", slug: "playful-round", mood: ["playful", "friendly"], industries: ["retail"], active: true },
  { id: 3, name: "Elegant Serif", slug: "elegant-serif", mood: ["elegant", "traditional"], industries: ["finance"], active: true },
];

const MOCK_PALETTES = [
  { id: 1, name: "Tech Blue", slug: "tech-blue", mood: ["modern"], industries: ["technology"], colors: ["#0066cc", "#ffffff", "#333333"], accessible: true, active: true },
  { id: 2, name: "Warm Earthy", slug: "warm-earthy", mood: ["friendly"], industries: ["retail"], colors: ["#c8813a", "#f5e6d0", "#3d2b1f"], accessible: false, active: true },
];

describe("getCompatibleFontPairs", () => {
  beforeEach(() => {
    vi.mocked(listFontPairs).mockResolvedValue(MOCK_PAIRS as any);
  });

  it("returns scored font pairs sorted by score descending", async () => {
    const brandDna = {
      clientId: "client-1",
      brandPersonality: ["innovative", "professional"],
      detectedColors: { primary: "#0066cc", palette: ["#ffffff"] },
      confidenceScore: 0.8,
    };

    const results = await getCompatibleFontPairs(brandDna, 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
  });

  it("'Modern Sans' ranks highest for innovative/professional brand", async () => {
    const brandDna = {
      clientId: "client-2",
      brandPersonality: ["innovative", "professional"],
      detectedColors: { primary: null, palette: [] },
      confidenceScore: 0.9,
    };

    const results = await getCompatibleFontPairs(brandDna, 10);
    const topResult = results[0];
    expect(topResult.slug).toBe("modern-sans");
  });

  it("adds confidence warning when confidence is low", async () => {
    const brandDna = {
      clientId: "client-3",
      brandPersonality: ["playful"],
      detectedColors: { primary: null, palette: [] },
      confidenceScore: 0.3,
    };

    const results = await getCompatibleFontPairs(brandDna, 10);
    const withWarnings = results.filter((r) => r.warnings.length > 0);
    expect(withWarnings.length).toBeGreaterThan(0);
  });

  it("respects limit parameter", async () => {
    const brandDna = {
      clientId: "client-4",
      brandPersonality: ["modern"],
      detectedColors: { primary: null, palette: [] },
      confidenceScore: 0.7,
    };

    const results = await getCompatibleFontPairs(brandDna, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("getCompatiblePalettes", () => {
  beforeEach(() => {
    vi.mocked(listColorPalettes).mockResolvedValue(MOCK_PALETTES as any);
  });

  it("returns scored palettes sorted by score descending", async () => {
    const brandDna = {
      clientId: "client-5",
      brandPersonality: ["innovative"],
      detectedColors: { primary: "#0066cc", palette: [] },
      confidenceScore: 0.8,
    };

    const results = await getCompatiblePalettes(brandDna, 10);
    expect(results.length).toBeGreaterThan(0);
    // Sorted descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("warns about inaccessible palettes", async () => {
    const brandDna = {
      clientId: "client-6",
      brandPersonality: ["friendly"],
      detectedColors: { primary: "#c8813a", palette: [] },
      confidenceScore: 0.9,
    };

    const results = await getCompatiblePalettes(brandDna, 10);
    const warmEarthy = results.find((r) => r.slug === "warm-earthy");
    // warm-earthy palette is not accessible (mock has accessible: false)
    if (warmEarthy) {
      expect(warmEarthy.warnings.some((w) => w.includes("WCAG"))).toBe(true);
    }
  });

  it("scores exact colour match higher than colour mismatch", async () => {
    const exactMatchDna = {
      clientId: "client-7",
      brandPersonality: ["modern"],
      detectedColors: { primary: "#0066cc", palette: [] }, // matches tech-blue
      confidenceScore: 0.9,
    };

    const mismatchDna = {
      clientId: "client-8",
      brandPersonality: ["modern"],
      detectedColors: { primary: "#ff00ff", palette: [] }, // no match
      confidenceScore: 0.9,
    };

    const exact = await getCompatiblePalettes(exactMatchDna, 10);
    const mismatch = await getCompatiblePalettes(mismatchDna, 10);
    const exactTechBlue = exact.find((r) => r.slug === "tech-blue");
    const mismatchTechBlue = mismatch.find((r) => r.slug === "tech-blue");
    if (exactTechBlue && mismatchTechBlue) {
      expect(exactTechBlue.score).toBeGreaterThan(mismatchTechBlue.score);
    }
  });
});

describe("scoreSpecificCombination", () => {
  beforeEach(() => {
    vi.mocked(getFontPairWithRoles).mockResolvedValue({
      id: 1, name: "Modern Sans", slug: "modern-sans",
      mood: ["modern"], industries: ["technology"],
      typographyRoles: [],
    } as any);

    vi.mocked(getColorPaletteWithRoles).mockResolvedValue({
      id: 1, name: "Tech Blue", slug: "tech-blue",
      mood: ["modern"], colors: ["#0066cc", "#ffffff"],
      accessible: true, semanticRoles: [],
    } as any);
  });

  it("returns scores for both pair and palette", async () => {
    const brandDna = {
      clientId: "client-9",
      brandPersonality: ["innovative"],
      detectedColors: { primary: null, palette: [] },
      confidenceScore: 0.7,
    };

    const result = await scoreSpecificCombination(1, 1, brandDna);
    expect(result.fontPair).toBeDefined();
    expect(result.palette).toBeDefined();
    expect(result.combinedScore).toBeGreaterThanOrEqual(0);
    expect(result.combinedScore).toBeLessThanOrEqual(100);
    expect(typeof result.recommendation).toBe("string");
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it("throws when font pair not found", async () => {
    vi.mocked(getFontPairWithRoles).mockResolvedValue(null);
    await expect(scoreSpecificCombination(999, 1, {
      clientId: "x", brandPersonality: [], detectedColors: { primary: null, palette: [] }, confidenceScore: 0.5,
    })).rejects.toThrow("999");
  });

  it("throws when color palette not found", async () => {
    vi.mocked(getFontPairWithRoles).mockResolvedValue({ id: 1, name: "X", slug: "x", mood: [], typographyRoles: [] } as any);
    vi.mocked(getColorPaletteWithRoles).mockResolvedValue(null);
    await expect(scoreSpecificCombination(1, 999, {
      clientId: "x", brandPersonality: [], detectedColors: { primary: null, palette: [] }, confidenceScore: 0.5,
    })).rejects.toThrow("999");
  });
});
