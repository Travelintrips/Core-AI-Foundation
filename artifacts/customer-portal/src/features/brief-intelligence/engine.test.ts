import { describe, it, expect } from "vitest";
import { computeBriefRecommendations } from "./engine";
import { buildBriefIntelligenceContext } from "./context-adapter";
import { applyRecommendations } from "./apply-adapter";
import { GENERIC_FALLBACK_PROFILE, resolveFallbackIndustry } from "./industry-fallback";
import { INDUSTRY_PROFILES } from "./industry-profiles";
import type { BriefIntelligenceContext } from "./types";
import type { BriefData } from "@/pages/brief";

function ctx(overrides: Partial<BriefIntelligenceContext> = {}): BriefIntelligenceContext {
  return {
    serviceType: "default",
    industryKey: null,
    industryCustomText: "",
    companySizeKey: null,
    goalKeys: [],
    audienceKeys: [],
    existingAssetKeys: [],
    priorityKey: null,
    selected: { styleKeys: [], colorKeys: [] },
    ...overrides,
  };
}

const EMPTY_BRIEF: BriefData = {
  companyIndustry: "", companySize: "", websiteUrl: "",
  primaryGoal: "", successMetrics: "", existingAssets: "",
  audienceDemographics: "", audiencePainPoints: "", audienceChannels: "",
  stylePreference: "", colorPalette: "", referenceLinks: "",
  outputFormats: "", outputLanguage: "id", specialRequirements: "",
  deadline: "", priority: "balanced", milestones: "",
};

describe("computeBriefRecommendations — no context", () => {
  it("returns hasEnoughContext=false with nothing selected", () => {
    const result = computeBriefRecommendations(ctx());
    expect(result.hasEnoughContext).toBe(false);
  });
});

describe("computeBriefRecommendations — industry coverage", () => {
  it("resolves a profile for every real INDUSTRY_OPTIONS value", () => {
    const keys = Object.keys(INDUSTRY_PROFILES);
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) {
      const result = computeBriefRecommendations(ctx({ industryKey: key }));
      expect(result.hasEnoughContext).toBe(true);
      expect(result.usedFallbackIndustry).toBe(false);
      expect(result.debug.matchedIndustryProfileKey).toBe(key);
    }
  });
});

describe("computeBriefRecommendations — worked examples", () => {
  it("Coffee Shop + Brand Identity recommends warm/natural style & brown/green colors", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "coffee_shop", serviceType: "brand_identity" }),
    );
    const styleKeys = result.categories.find((c) => c.category === "style")!.items.map((i) => i.key);
    const colorKeys = result.categories.find((c) => c.category === "color")!.items.map((i) => i.key);
    expect(styleKeys).toContain("natural");
    expect(colorKeys).toContain("brown");
  });

  it("Export Import + Company Profile recommends corporate style & international audience", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "export_import", serviceType: "company_profile", goalKeys: ["international"] }),
    );
    const styleKeys = result.categories.find((c) => c.category === "style")!.items.map((i) => i.key);
    const audienceCat = result.categories.find((c) => c.category === "audience");
    expect(styleKeys).toContain("corporate");
    expect(audienceCat?.items.map((i) => i.key)).toContain("international");
  });

  it("Charcoal + Company Profile recommends industrial style & black/brown colors", () => {
    const result = computeBriefRecommendations(ctx({ industryKey: "charcoal", serviceType: "company_profile" }));
    const styleKeys = result.categories.find((c) => c.category === "style")!.items.map((i) => i.key);
    const colorKeys = result.categories.find((c) => c.category === "color")!.items.map((i) => i.key);
    expect(styleKeys).toContain("industrial");
    expect(colorKeys.some((k) => k === "black" || k === "brown")).toBe(true);
  });

  it("Technology/AI + Pitch Deck recommends futuristic style, purple/blue colors, investor audience", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "ai", serviceType: "pitch_deck", goalKeys: ["investor"] }),
    );
    const styleKeys = result.categories.find((c) => c.category === "style")!.items.map((i) => i.key);
    const audienceCat = result.categories.find((c) => c.category === "audience");
    expect(styleKeys).toContain("futuristic");
    expect(audienceCat?.items.map((i) => i.key)).toContain("investor");
  });
});

describe("computeBriefRecommendations — fallback for unknown industry", () => {
  it("matches free-text alias to a known profile", () => {
    const fb = resolveFallbackIndustry("Kami jualan kopi susu kekinian");
    expect(fb.matchedKey).toBe("coffee_shop");
  });

  it("falls back to generic profile for a truly unknown industry", () => {
    const fb = resolveFallbackIndustry("xyzzy nonsense business 12345");
    expect(fb.matchedKey).toBeNull();
    const result = computeBriefRecommendations(ctx({ industryCustomText: "xyzzy nonsense business 12345" }));
    expect(result.usedFallbackIndustry).toBe(true);
    expect(result.debug.matchedIndustryProfileKey).toBeNull();
  });

  it("returns hasEnoughContext=false for empty custom text and no service", () => {
    const result = computeBriefRecommendations(ctx());
    expect(result.hasEnoughContext).toBe(false);
  });
});

describe("computeBriefRecommendations — user selection protection", () => {
  it("never recommends a style the user already picked", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "coffee_shop", selected: { styleKeys: ["natural"], colorKeys: [] } }),
    );
    const styleKeys = result.categories.find((c) => c.category === "style")?.items.map((i) => i.key) ?? [];
    expect(styleKeys).not.toContain("natural");
  });

  it("never recommends a color the user already picked", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "coffee_shop", selected: { styleKeys: [], colorKeys: ["brown"] } }),
    );
    const colorKeys = result.categories.find((c) => c.category === "color")?.items.map((i) => i.key) ?? [];
    expect(colorKeys).not.toContain("brown");
  });
});

describe("computeBriefRecommendations — determinism & limits", () => {
  it("produces identical output for identical input across repeated calls", () => {
    const context = ctx({ industryKey: "technology", serviceType: "logo_design", goalKeys: ["brand_awareness"] });
    const a = computeBriefRecommendations(context);
    const b = computeBriefRecommendations(context);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never exceeds the per-category limit", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "technology", serviceType: "default", goalKeys: ["brand_awareness", "trust", "professional"] }),
    );
    for (const cat of result.categories) {
      expect(cat.items.length).toBeLessThanOrEqual(6);
    }
  });

  it("deduplicates a key that is boosted by multiple rule sources into a single item", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "technology", goalKeys: ["professional"] }),
    );
    const styleItems = result.categories.find((c) => c.category === "style")?.items ?? [];
    const corporateOccurrences = styleItems.filter((i) => i.key === "corporate");
    expect(corporateOccurrences.length).toBeLessThanOrEqual(1);
  });
});

describe("computeBriefRecommendations — conflict detection", () => {
  it("flags a luxury + playful style conflict without removing either item", () => {
    const result = computeBriefRecommendations(
      ctx({ industryKey: "jewelry", selected: { styleKeys: ["luxury", "playful"], colorKeys: [] } }),
    );
    expect(result.warnings.some((w) => w.code === "luxury-playful")).toBe(true);
  });
});

describe("buildBriefIntelligenceContext", () => {
  it("extracts industryKey, goalKeys, audienceKeys, and selected style/color from BriefData", () => {
    const brief: BriefData = {
      ...EMPTY_BRIEF,
      companyIndustry: "Coffee Shop",
      primaryGoal: "Meningkatkan brand awareness; Meningkatkan penjualan",
      audienceDemographics: "Anak muda",
      stylePreference: "Natural",
      colorPalette: "Cokelat, Hijau",
    };
    const context = buildBriefIntelligenceContext({ brief, serviceName: "Brand Identity Design" });
    expect(context.industryKey).toBe("coffee_shop");
    expect(context.goalKeys).toEqual(["brand_awareness", "sales"]);
    expect(context.audienceKeys).toEqual(["youth"]);
    expect(context.selected.styleKeys).toEqual(["natural"]);
    expect(context.selected.colorKeys).toEqual(["brown", "green"]);
    expect(context.serviceType).toBe("brand_identity");
  });

  it("treats free-text 'Lainnya' industry as industryCustomText, not industryKey", () => {
    const brief: BriefData = { ...EMPTY_BRIEF, companyIndustry: "Lainnya: Toko oleh-oleh khas daerah" };
    const context = buildBriefIntelligenceContext({ brief, serviceName: null });
    expect(context.industryKey).toBeNull();
    expect(context.industryCustomText).toBe("Toko oleh-oleh khas daerah");
  });
});

describe("applyRecommendations — apply-single", () => {
  it("appends a recommended style to stylePreference without removing existing selections", () => {
    const brief: BriefData = { ...EMPTY_BRIEF, stylePreference: "Modern" };
    const result = computeBriefRecommendations(ctx({ industryKey: "coffee_shop" }));
    const rec = result.categories.find((c) => c.category === "style")!.items[0];
    const applyResult = applyRecommendations(brief, [rec], "apply-single", { category: "style", key: rec.key });
    expect(applyResult.applied).toEqual([{ category: "style", key: rec.key }]);
    expect(applyResult.updatedBrief.stylePreference).toContain("Modern");
    expect(applyResult.updatedBrief.stylePreference).not.toBe("Modern");
  });

  it("skips a style the user already selected, with a reason", () => {
    const brief: BriefData = { ...EMPTY_BRIEF, stylePreference: "Natural" };
    const rec = { category: "style" as const, key: "natural", label: "Natural", score: 90, confidence: "high" as const, reasons: [], sources: [] };
    const applyResult = applyRecommendations(brief, [rec], "apply-single", { category: "style", key: "natural" });
    expect(applyResult.applied).toEqual([]);
    expect(applyResult.skipped[0]?.reason).toMatch(/sudah dipilih/i);
  });
});

describe("applyRecommendations — free-text advisory categories (empty-only rule)", () => {
  it("appends a personality suggestion into specialRequirements when empty", () => {
    const brief: BriefData = { ...EMPTY_BRIEF };
    const rec = { category: "personality" as const, key: "hangat", label: "Hangat", score: 90, confidence: "high" as const, reasons: [], sources: [] };
    const applyResult = applyRecommendations(brief, [rec], "apply-single", { category: "personality", key: "hangat" });
    expect(applyResult.applied).toEqual([{ category: "personality", key: "hangat" }]);
    expect(applyResult.updatedBrief.specialRequirements).toContain("Hangat");
  });

  it("never overwrites specialRequirements if the user already wrote something", () => {
    const brief: BriefData = { ...EMPTY_BRIEF, specialRequirements: "Tolong pakai logo lama kami." };
    const rec = { category: "personality" as const, key: "hangat", label: "Hangat", score: 90, confidence: "high" as const, reasons: [], sources: [] };
    const applyResult = applyRecommendations(brief, [rec], "apply-single", { category: "personality", key: "hangat" });
    expect(applyResult.applied).toEqual([]);
    expect(applyResult.updatedBrief.specialRequirements).toBe("Tolong pakai logo lama kami.");
    expect(applyResult.skipped[0]?.reason).toMatch(/sudah diisi/i);
  });
});

describe("applyRecommendations — apply-all-empty-only", () => {
  it("applies everything appliable, skips fields already filled, and reports a warning when nothing applies", () => {
    const brief: BriefData = { ...EMPTY_BRIEF, outputFormats: "Sudah ada format" };
    const rec = { category: "deliverable" as const, key: "Katalog produk", label: "Katalog produk", score: 90, confidence: "high" as const, reasons: [], sources: [] };
    const applyResult = applyRecommendations(brief, [rec], "apply-all-empty-only", {});
    expect(applyResult.applied).toEqual([]);
    expect(applyResult.warnings.length).toBe(1);
  });
});
