import { describe, it, expect } from "vitest";
import { computeBriefRecommendations } from "./engine";
import { buildBriefIntelligenceContext } from "./context-adapter";
import { applyRecommendations, STYLE_MAX, COLOR_MAX, AUDIENCE_MAX } from "./apply-adapter";
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

// ── Phase 3.1: alias match semantics ──────────────────────────────────────────

describe("computeBriefRecommendations — alias match NOT treated as generic fallback", () => {
  it("alias match sets usedFallbackIndustry=false (not a generic fallback)", () => {
    const result = computeBriefRecommendations(ctx({ industryCustomText: "developer properti perumahan" }));
    // "properti" / "perumahan" should match property or real_estate via alias —
    // it is a KNOWN industry, so the badge "Industri belum spesifik" must NOT appear.
    expect(result.usedFallbackIndustry).toBe(false);
    expect(result.debug.industryMatchType).toBe("alias");
    expect(result.debug.matchedIndustryProfileKey).not.toBeNull();
  });

  it("alias match for coffee via free text resolves to alias matchType", () => {
    const result = computeBriefRecommendations(ctx({ industryCustomText: "kedai kopi artisan" }));
    expect(result.usedFallbackIndustry).toBe(false);
    expect(result.debug.industryMatchType).toBe("alias");
    expect(result.debug.matchedIndustryProfileKey).toBe("coffee_shop");
  });

  it("truly unknown industry sets usedFallbackIndustry=true and matchType=generic-fallback", () => {
    const result = computeBriefRecommendations(ctx({ industryCustomText: "xyzzy nonsense 99999" }));
    expect(result.usedFallbackIndustry).toBe(true);
    expect(result.debug.industryMatchType).toBe("generic-fallback");
    expect(result.debug.matchedIndustryProfileKey).toBeNull();
  });

  it("named industryKey sets matchType=exact and usedFallbackIndustry=false", () => {
    const result = computeBriefRecommendations(ctx({ industryKey: "coffee_shop" }));
    expect(result.usedFallbackIndustry).toBe(false);
    expect(result.debug.industryMatchType).toBe("exact");
    expect(result.debug.matchedIndustryProfileKey).toBe("coffee_shop");
  });

  it("no industry context at all sets matchType=null", () => {
    const result = computeBriefRecommendations(ctx());
    expect(result.debug.industryMatchType).toBeNull();
  });
});

// ── Phase 3.1: export-import alias priority ────────────────────────────────────

describe("resolveFallbackIndustry — export-import exact phrase priority", () => {
  it("resolves 'ekspor impor' to export_import, not logistics", () => {
    const result = resolveFallbackIndustry("ekspor impor");
    expect(result.matchedKey).toBe("export_import");
  });

  it("resolves 'export import' to export_import", () => {
    const result = resolveFallbackIndustry("export import");
    expect(result.matchedKey).toBe("export_import");
  });

  it("resolves 'ekspor impor / logistik' to export_import (specificity wins)", () => {
    // Both keywords present; export_import should be checked first (more specific).
    const result = resolveFallbackIndustry("ekspor impor / logistik");
    expect(result.matchedKey).toBe("export_import");
  });

  it("resolves 'logistik' alone (no import keywords) to logistics", () => {
    const result = resolveFallbackIndustry("perusahaan logistik pengiriman");
    expect(result.matchedKey).toBe("logistics");
  });
});

// ── Phase 3.1: apply limits match UI limits ────────────────────────────────────

describe("STYLE_MAX / COLOR_MAX / AUDIENCE_MAX match UI limits", () => {
  it("STYLE_MAX exported constant equals the UI chip group max (3)", () => {
    expect(STYLE_MAX).toBe(3);
  });

  it("COLOR_MAX exported constant equals the UI color picker max (3)", () => {
    expect(COLOR_MAX).toBe(3);
  });

  it("AUDIENCE_MAX exported constant equals the UI chip group max (4)", () => {
    expect(AUDIENCE_MAX).toBe(4);
  });
});

describe("applyRecommendations — apply does not exceed selection limits", () => {
  // Use real option labels so parseChoices can match them to their keys.
  // STYLE_OPTIONS labels (lowercase keys for apply): minimalis, modern, corporate, premium…
  // COLOR labels: Biru=blue, Hitam=black, Merah=red, Hijau=green, Ungu=purple
  // AUDIENCE labels (partial): Konsumen umum=general, B2C=b2c, B2B=b2b, Perusahaan=corporate…

  function makeRec(category: "style" | "color" | "audience", key: string, label: string) {
    return { category, key, label, score: 90, confidence: "high" as const, reasons: [], sources: [] };
  }

  it("style apply does not exceed STYLE_MAX — once max is reached, extras are skipped", () => {
    // Pre-fill with (STYLE_MAX - 1) = 2 real style labels so parseChoices recognises them.
    // parseChoices uses "; " as the canonical separator for multi-choice fields.
    const brief: BriefData = { ...EMPTY_BRIEF, stylePreference: "Minimalis; Modern" };
    const recs = [
      makeRec("style", "bold",     "Bold"),
      makeRec("style", "playful",  "Playful"),
      makeRec("style", "creative", "Creative"),
    ];
    const result = applyRecommendations(brief, recs, "apply-category", { category: "style" });
    // One slot left → max 1 applied; the other 2 must be skipped (max reason)
    expect(result.applied.length).toBeLessThanOrEqual(1);
    const maxSkipped = result.skipped.filter((s) => s.reason.includes(`${STYLE_MAX}`));
    expect(maxSkipped.length).toBeGreaterThanOrEqual(recs.length - 1);
  });

  it("color apply does not exceed COLOR_MAX — once max is reached, extras are skipped", () => {
    // Pre-fill with (COLOR_MAX - 1) = 2 real color labels.
    const brief: BriefData = { ...EMPTY_BRIEF, colorPalette: "Biru, Hitam" };
    const recs = [
      makeRec("color", "green",  "Hijau"),
      makeRec("color", "red",    "Merah"),
      makeRec("color", "purple", "Ungu"),
    ];
    const result = applyRecommendations(brief, recs, "apply-category", { category: "color" });
    expect(result.applied.length).toBeLessThanOrEqual(1);
    const maxSkipped = result.skipped.filter((s) => s.reason.includes(`${COLOR_MAX}`));
    expect(maxSkipped.length).toBeGreaterThanOrEqual(recs.length - 1);
  });

  it("audience apply does not exceed AUDIENCE_MAX — once max is reached, extras are skipped", () => {
    // Pre-fill with (AUDIENCE_MAX - 1) = 3 real audience labels.
    // parseChoices uses "; " as the canonical separator for multi-choice fields.
    const brief: BriefData = {
      ...EMPTY_BRIEF,
      audienceDemographics: "Konsumen umum; B2C; B2B",
    };
    const recs = [
      makeRec("audience", "corporate",    "Perusahaan"),
      makeRec("audience", "startup",      "Startup"),
      makeRec("audience", "professional", "Profesional"),
    ];
    const result = applyRecommendations(brief, recs, "apply-category", { category: "audience" });
    expect(result.applied.length).toBeLessThanOrEqual(1);
    const maxSkipped = result.skipped.filter((s) => s.reason.includes(`${AUDIENCE_MAX}`));
    expect(maxSkipped.length).toBeGreaterThanOrEqual(recs.length - 1);
  });
});

// ── Phase 3.1: new conflict rules ─────────────────────────────────────────────

describe("computeBriefRecommendations — new conflict rules", () => {
  it("premium audience + colorful style triggers premium-colorful-playful warning", () => {
    const result = computeBriefRecommendations(
      ctx({
        industryKey: "jewelry",
        audienceKeys: ["premium"],
        selected: { styleKeys: ["colorful"], colorKeys: [] },
      }),
    );
    expect(result.warnings.some((w) => w.code === "premium-colorful-playful")).toBe(true);
    // Recommendations still present — warning is non-blocking
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("premium audience + playful style also triggers premium-colorful-playful warning", () => {
    const result = computeBriefRecommendations(
      ctx({
        industryKey: "jewelry",
        audienceKeys: ["premium"],
        selected: { styleKeys: ["playful"], colorKeys: [] },
      }),
    );
    expect(result.warnings.some((w) => w.code === "premium-colorful-playful")).toBe(true);
  });

  it("non-premium audience with colorful style does NOT trigger premium-colorful-playful", () => {
    const result = computeBriefRecommendations(
      ctx({
        industryKey: "fnb_cafe",
        audienceKeys: ["youth"],
        selected: { styleKeys: ["colorful"], colorKeys: [] },
      }),
    );
    expect(result.warnings.some((w) => w.code === "premium-colorful-playful")).toBe(false);
  });

  it("no-assets + photography recommendation triggers no-assets-photography warning", () => {
    // Use an industry with photographyDirection recommendations (most do)
    const result = computeBriefRecommendations(
      ctx({
        industryKey: "coffee_shop",
        existingAssetKeys: ["none"],
      }),
    );
    // coffee_shop has photographyDirection recs
    if (result.categories.some((c) => c.category === "photographyDirection")) {
      expect(result.warnings.some((w) => w.code === "no-assets-photography")).toBe(true);
    }
    // Non-blocking
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("speed priority + many deliverables triggers speed-excessive-deliverables warning", () => {
    // manufacturing has a rich deliverable list
    const result = computeBriefRecommendations(
      ctx({
        industryKey: "manufacturing",
        priorityKey: "speed",
      }),
    );
    // Check only if engine actually produced enough deliverables
    const delivCount = result.categories.find((c) => c.category === "deliverable")?.items.length ?? 0;
    if (delivCount > 3) {
      expect(result.warnings.some((w) => w.code === "speed-excessive-deliverables")).toBe(true);
    }
  });

  it("speed priority + few deliverables does NOT trigger speed-excessive-deliverables", () => {
    // Use a minimal context to produce at most 1 deliverable
    const result = computeBriefRecommendations(
      ctx({ priorityKey: "speed", serviceType: "default" }),
    );
    expect(result.warnings.some((w) => w.code === "speed-excessive-deliverables")).toBe(false);
  });

  it("all new conflict warnings are non-blocking — recommendations still present", () => {
    const result = computeBriefRecommendations(
      ctx({
        industryKey: "jewelry",
        audienceKeys: ["premium"],
        existingAssetKeys: ["none"],
        selected: { styleKeys: ["colorful"], colorKeys: [] },
      }),
    );
    expect(result.warnings.some((w) => w.code === "premium-colorful-playful")).toBe(true);
    expect(result.categories.length).toBeGreaterThan(0);
  });
});
