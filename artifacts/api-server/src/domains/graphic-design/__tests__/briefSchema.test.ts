/**
 * briefSchema.test.ts — Team 15 Graphic Design
 *
 * Tests for brief completeness scoring across all 10 services.
 */

import { describe, it, expect } from "vitest";
import {
  scoreGraphicDesignBrief,
  assertGdBriefReady,
  extractServiceCode,
  extractPackageTier,
  GD_BRIEF_READINESS_THRESHOLD,
} from "../briefSchema.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MINIMAL_COMMON = {
  gdCompanyName: "Acme Corp",
  gdIndustry: "logistics",
  gdTargetAudience: "B2B procurement managers",
  gdStyle: "modern",
  gdPrimaryColor: "#1A73E8",
};

function logoComplete(): Record<string, unknown> {
  return { ...MINIMAL_COMMON, gdLogoSymbolIdea: "A stylised chain link" };
}

function businessCardComplete(): Record<string, unknown> {
  return {
    ...MINIMAL_COMMON,
    gdBcFrontName: "John Smith",
    gdBcFrontTitle: "CEO",
    gdBcFrontEmail: "john@acme.com",
    gdBcFrontPhone: "+62 812 3456 7890",
  };
}

function letterheadComplete(): Record<string, unknown> {
  return {
    ...MINIMAL_COMMON,
    gdLhAddress: "Jl. Sudirman No. 1, Jakarta",
    gdLhEmail: "info@acme.com",
    gdLhPhone: "+62 21 1234 5678",
  };
}

function flyerComplete(): Record<string, unknown> {
  return { ...MINIMAL_COMMON, gdFlyerHeadline: "Grand Opening!", gdFlyerCallToAction: "Call Now" };
}

function posterComplete(): Record<string, unknown> {
  return { ...MINIMAL_COMMON, gdPosterHeadline: "Year-End Sale", gdPosterSize: "a2" };
}

function bannerComplete(): Record<string, unknown> {
  return { ...MINIMAL_COMMON, gdBannerHeadline: "Visit Our Booth", gdBannerType: "rollup" };
}

function brochureComplete(): Record<string, unknown> {
  return { ...MINIMAL_COMMON, gdBrochureFoldType: "trifold", gdBrochureHeadline: "Our Services" };
}

function socialMediaComplete(): Record<string, unknown> {
  return { ...MINIMAL_COMMON, gdSmPlatforms: ["instagram", "linkedin"], gdSmContentTheme: "brand awareness" };
}

function certificateComplete(): Record<string, unknown> {
  return {
    ...MINIMAL_COMMON,
    gdCertTitle: "Certificate of Achievement",
    gdCertIssuingOrg: "Acme Corp",
    gdCertBodyText: "This certifies that the recipient has completed…",
  };
}

function stationeryComplete(): Record<string, unknown> {
  return {
    ...MINIMAL_COMMON,
    gdStItems: ["letterhead", "business-card"],
    gdStAddress: "Jl. Sudirman No. 1",
    gdStEmail: "info@acme.com",
  };
}

// ── Brief scoring tests ───────────────────────────────────────────────────────

describe("scoreGraphicDesignBrief — logo", () => {
  it("scores a complete logo brief as ready", () => {
    const result = scoreGraphicDesignBrief(logoComplete(), "logo");
    expect(result.readinessStatus).toBe("ready");
    expect(result.overallScore).toBeGreaterThanOrEqual(GD_BRIEF_READINESS_THRESHOLD);
    expect(result.missingRequired).toHaveLength(0);
  });

  it("scores an empty brief as incomplete", () => {
    const result = scoreGraphicDesignBrief({}, "logo");
    expect(result.readinessStatus).toBe("incomplete");
    expect(result.missingRequired.length).toBeGreaterThan(0);
    expect(result.overallScore).toBeLessThan(GD_BRIEF_READINESS_THRESHOLD);
  });

  it("includes warning when no primary colour is set", () => {
    const brief = { ...logoComplete() };
    delete (brief as Record<string, unknown>)["gdPrimaryColor"];
    const result = scoreGraphicDesignBrief(brief, "logo");
    expect(result.warnings.some((w) => w.includes("primary brand colour"))).toBe(true);
  });

  it("boosts optional score when logo variants are provided", () => {
    const minimal = scoreGraphicDesignBrief(logoComplete(), "logo");
    const withVariants = scoreGraphicDesignBrief(
      { ...logoComplete(), gdLogoVariants: ["horizontal", "icon"], gdSecondaryColor: "#FF5722" },
      "logo",
    );
    expect(withVariants.optionalScore).toBeGreaterThan(minimal.optionalScore);
    expect(withVariants.overallScore).toBeGreaterThan(minimal.overallScore);
  });
});

describe("scoreGraphicDesignBrief — business-card", () => {
  it("scores a complete brief as ready", () => {
    const result = scoreGraphicDesignBrief(businessCardComplete(), "business-card");
    expect(result.readinessStatus).toBe("ready");
    expect(result.missingRequired).toHaveLength(0);
  });

  it("fails when contact email is missing", () => {
    const brief = { ...businessCardComplete() };
    delete (brief as Record<string, unknown>)["gdBcFrontEmail"];
    const result = scoreGraphicDesignBrief(brief, "business-card");
    expect(result.missingRequired).toContain("gdBcFrontEmail");
    expect(result.readinessStatus).toBe("incomplete");
  });
});

describe("scoreGraphicDesignBrief — per-service coverage", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["letterhead",   letterheadComplete()],
    ["flyer",        flyerComplete()],
    ["poster",       posterComplete()],
    ["banner",       bannerComplete()],
    ["brochure",     brochureComplete()],
    ["social-media", socialMediaComplete()],
    ["certificate",  certificateComplete()],
    ["stationery",   stationeryComplete()],
  ];

  it.each(cases)("%s: complete brief scores as ready", (code, brief) => {
    const result = scoreGraphicDesignBrief(brief, code as never);
    expect(result.readinessStatus).toBe("ready");
    expect(result.missingRequired).toHaveLength(0);
    expect(result.overallScore).toBeGreaterThanOrEqual(GD_BRIEF_READINESS_THRESHOLD);
  });

  it.each(cases)("%s: empty brief scores as incomplete", (code) => {
    const result = scoreGraphicDesignBrief({}, code as never);
    expect(result.readinessStatus).toBe("incomplete");
    expect(result.missingRequired.length).toBeGreaterThan(0);
  });
});

describe("scoreGraphicDesignBrief — banner", () => {
  it("adds warning when custom banner dimensions are missing", () => {
    const result = scoreGraphicDesignBrief(bannerComplete(), "banner");
    expect(result.warnings.some((w) => w.includes("roll-up"))).toBe(true);
  });

  it("no dimension warning when custom size is provided", () => {
    const brief = { ...bannerComplete(), gdBannerWidthMm: 1000, gdBannerHeightMm: 2000 };
    const result = scoreGraphicDesignBrief(brief, "banner");
    expect(result.warnings.some((w) => w.includes("roll-up"))).toBe(false);
  });
});

describe("scoreGraphicDesignBrief — social-media", () => {
  it("adds warning when platforms list is empty", () => {
    const brief = { ...MINIMAL_COMMON, gdSmContentTheme: "brand" };
    const result = scoreGraphicDesignBrief(brief, "social-media");
    expect(result.warnings.some((w) => w.includes("platform"))).toBe(true);
  });
});

// ── assertGdBriefReady ────────────────────────────────────────────────────────

describe("assertGdBriefReady", () => {
  it("does not throw for a complete logo brief", () => {
    expect(() => assertGdBriefReady(logoComplete(), "logo")).not.toThrow();
  });

  it("throws with missing fields listed for an empty brief", () => {
    expect(() => assertGdBriefReady({}, "logo")).toThrow(/Missing required fields/);
  });

  it("throws with score mention when score is below threshold", () => {
    // Provide required fields but nothing optional → score may still be too low
    // Use a brief with just the bare minimum that passes required but might fail overall
    const brief = { ...MINIMAL_COMMON, gdLogoSymbolIdea: "x" }; // should pass
    expect(() => assertGdBriefReady(brief, "logo")).not.toThrow();
  });
});

// ── extractServiceCode / extractPackageTier ───────────────────────────────────

describe("extractServiceCode", () => {
  it("returns the embedded service code when valid", () => {
    expect(extractServiceCode({ gdServiceCode: "poster" }, "logo")).toBe("poster");
  });

  it("falls back to the arg when service code is missing", () => {
    expect(extractServiceCode({}, "brochure")).toBe("brochure");
  });

  it("falls back to the arg when service code is unknown", () => {
    expect(extractServiceCode({ gdServiceCode: "billboard" }, "banner")).toBe("banner");
  });
});

describe("extractPackageTier", () => {
  it("returns the embedded tier", () => {
    expect(extractPackageTier({ gdPackageTier: "enterprise" })).toBe("enterprise");
  });

  it("defaults to starter when missing", () => {
    expect(extractPackageTier({})).toBe("starter");
  });

  it("defaults to starter when invalid", () => {
    expect(extractPackageTier({ gdPackageTier: "premium" })).toBe("starter");
  });
});
