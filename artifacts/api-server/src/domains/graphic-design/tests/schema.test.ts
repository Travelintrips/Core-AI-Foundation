/**
 * graphic-design/tests/schema.test.ts — Team 15
 *
 * Tests for all 10 service brief schemas.
 * Verifies validation, defaults, discriminated union dispatch, and rejection of bad input.
 */

import { describe, it, expect } from "vitest";
import {
  GraphicDesignBriefSchema,
  LogoBriefSchema,
  BusinessCardBriefSchema,
  LetterheadBriefSchema,
  FlyerBriefSchema,
  PosterBriefSchema,
  BannerBriefSchema,
  BrochureBriefSchema,
  SocialMediaBriefSchema,
  CertificateBriefSchema,
  StationeryBriefSchema,
  GD_SERVICE_CODES,
  GD_SERVICE_LABELS,
  GdStatusUpdateSchema,
} from "../schema.js";

// ── Shared valid base brief ───────────────────────────────────────────────────

const BASE = {
  clientName:      "PT Maju Bersama",
  brandName:       "MajuBrand",
  industry:        "Manufacturing",
  targetAudience:  "B2B decision-makers in Jakarta",
  stylePreference: "corporate" as const,
  colorPalette:    ["#003DA5", "#FFFFFF"],
  primaryFont:     "Inter",
  urgencyLevel:    "standard" as const,
  language:        "id",
  packageTier:     "standard" as const,
  outputFormat:    "both" as const,
  printQuantity:   0,
  referenceUrls:   [],
};

// ── GD-LOGO ───────────────────────────────────────────────────────────────────

describe("LogoBriefSchema", () => {
  it("parses a valid logo brief", () => {
    const result = LogoBriefSchema.safeParse({ ...BASE, serviceCode: "GD-LOGO" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceCode).toBe("GD-LOGO");
      expect(result.data.conceptVariants).toBe(3);  // default
      expect(result.data.includesDarkVariant).toBe(true);
    }
  });

  it("rejects if conceptVariants > 5", () => {
    const result = LogoBriefSchema.safeParse({ ...BASE, serviceCode: "GD-LOGO", conceptVariants: 6 });
    expect(result.success).toBe(false);
  });

  it("accepts all logo types", () => {
    const types = ["wordmark", "lettermark", "combination", "emblem", "mascot"] as const;
    for (const logoType of types) {
      const result = LogoBriefSchema.safeParse({ ...BASE, serviceCode: "GD-LOGO", logoType });
      expect(result.success).toBe(true);
    }
  });

  it("validates referenceUrls as URLs", () => {
    const bad = LogoBriefSchema.safeParse({ ...BASE, serviceCode: "GD-LOGO", referenceUrls: ["not-a-url"] });
    expect(bad.success).toBe(false);

    const good = LogoBriefSchema.safeParse({ ...BASE, serviceCode: "GD-LOGO", referenceUrls: ["https://example.com/ref"] });
    expect(good.success).toBe(true);
  });
});

// ── GD-BCARD ──────────────────────────────────────────────────────────────────

describe("BusinessCardBriefSchema", () => {
  it("parses with defaults", () => {
    const result = BusinessCardBriefSchema.safeParse({ ...BASE, serviceCode: "GD-BCARD" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cardSize).toBe("standard");
      expect(result.data.sides).toBe("double");
      expect(result.data.orientation).toBe("landscape");
    }
  });

  it("accepts all card sizes", () => {
    const sizes = ["standard", "square", "mini", "euro", "us"] as const;
    for (const cardSize of sizes) {
      expect(BusinessCardBriefSchema.safeParse({ ...BASE, serviceCode: "GD-BCARD", cardSize }).success).toBe(true);
    }
  });

  it("rejects invalid special finish", () => {
    const result = BusinessCardBriefSchema.safeParse({ ...BASE, serviceCode: "GD-BCARD", specialFinish: "rainbow" });
    expect(result.success).toBe(false);
  });
});

// ── GD-LTRHEAD ────────────────────────────────────────────────────────────────

describe("LetterheadBriefSchema", () => {
  it("parses valid letterhead brief", () => {
    const result = LetterheadBriefSchema.safeParse({
      ...BASE, serviceCode: "GD-LTRHEAD", includesEnvelope: true, includesComplimentarySlip: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pageSize).toBe("A4");
  });

  it("accepts all page sizes", () => {
    for (const pageSize of ["A4", "letter", "legal"] as const) {
      expect(LetterheadBriefSchema.safeParse({ ...BASE, serviceCode: "GD-LTRHEAD", pageSize }).success).toBe(true);
    }
  });
});

// ── GD-FLYER ─────────────────────────────────────────────────────────────────

describe("FlyerBriefSchema", () => {
  it("parses with defaults", () => {
    const result = FlyerBriefSchema.safeParse({ ...BASE, serviceCode: "GD-FLYER" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe("A5");
      expect(result.data.orientation).toBe("portrait");
      expect(result.data.purposeType).toBe("promotion");
    }
  });

  it("accepts key messages up to 5", () => {
    const keyMessages = ["Fast delivery", "Best price", "Quality assured", "Call now", "Limited offer"];
    const result = FlyerBriefSchema.safeParse({ ...BASE, serviceCode: "GD-FLYER", keyMessages });
    expect(result.success).toBe(true);
  });

  it("rejects key messages > 5", () => {
    const keyMessages = new Array(6).fill("msg");
    expect(FlyerBriefSchema.safeParse({ ...BASE, serviceCode: "GD-FLYER", keyMessages }).success).toBe(false);
  });
});

// ── GD-POSTER ─────────────────────────────────────────────────────────────────

describe("PosterBriefSchema", () => {
  it("defaults to A3 portrait at 300dpi", () => {
    const result = PosterBriefSchema.safeParse({ ...BASE, serviceCode: "GD-POSTER" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paperSize).toBe("A3");
      expect(result.data.resolution).toBe("300dpi");
    }
  });

  it("accepts custom dimensions when paperSize is 'custom'", () => {
    const result = PosterBriefSchema.safeParse({
      ...BASE, serviceCode: "GD-POSTER", paperSize: "custom", customWidthMm: 600, customHeightMm: 800,
    });
    expect(result.success).toBe(true);
  });

  it("rejects custom dimensions exceeding max", () => {
    const result = PosterBriefSchema.safeParse({
      ...BASE, serviceCode: "GD-POSTER", paperSize: "custom", customWidthMm: 5000,
    });
    expect(result.success).toBe(false);
  });
});

// ── GD-BANNER ─────────────────────────────────────────────────────────────────

describe("BannerBriefSchema", () => {
  it("parses rollup banner with defaults", () => {
    const result = BannerBriefSchema.safeParse({ ...BASE, serviceCode: "GD-BANNER" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.bannerType).toBe("rollup");
  });

  it("accepts digital banner with size", () => {
    const result = BannerBriefSchema.safeParse({
      ...BASE, serviceCode: "GD-BANNER", bannerType: "digital_web", digitalSize: "728x90",
    });
    expect(result.success).toBe(true);
  });
});

// ── GD-BROCHURE ───────────────────────────────────────────────────────────────

describe("BrochureBriefSchema", () => {
  it("defaults to trifold A4 6-page", () => {
    const result = BrochureBriefSchema.safeParse({ ...BASE, serviceCode: "GD-BROCHURE" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.foldType).toBe("trifold");
      expect(result.data.pageCount).toBe(6);
    }
  });

  it("only accepts valid page counts", () => {
    const valid   = [2, 4, 6, 8, 12, 16] as const;
    const invalid = [3, 5, 7, 10, 20];

    for (const pc of valid) {
      expect(BrochureBriefSchema.safeParse({ ...BASE, serviceCode: "GD-BROCHURE", pageCount: pc }).success).toBe(true);
    }
    for (const pc of invalid) {
      expect(BrochureBriefSchema.safeParse({ ...BASE, serviceCode: "GD-BROCHURE", pageCount: pc }).success).toBe(false);
    }
  });
});

// ── GD-SOCIAL ─────────────────────────────────────────────────────────────────

describe("SocialMediaBriefSchema", () => {
  it("requires at least one platform", () => {
    const none = SocialMediaBriefSchema.safeParse({ ...BASE, serviceCode: "GD-SOCIAL", platforms: [], contentTypes: ["post_square"] });
    expect(none.success).toBe(false);
  });

  it("requires at least one content type", () => {
    const none = SocialMediaBriefSchema.safeParse({ ...BASE, serviceCode: "GD-SOCIAL", platforms: ["instagram"], contentTypes: [] });
    expect(none.success).toBe(false);
  });

  it("accepts full multi-platform brief", () => {
    const result = SocialMediaBriefSchema.safeParse({
      ...BASE, serviceCode: "GD-SOCIAL",
      platforms: ["instagram", "facebook", "linkedin"],
      contentTypes: ["post_square", "story", "cover"],
      variantsPerType: 5,
    });
    expect(result.success).toBe(true);
  });
});

// ── GD-CERT ───────────────────────────────────────────────────────────────────

describe("CertificateBriefSchema", () => {
  it("defaults to landscape A4 achievement cert", () => {
    const result = CertificateBriefSchema.safeParse({ ...BASE, serviceCode: "GD-CERT" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orientation).toBe("landscape");
      expect(result.data.certificateType).toBe("achievement");
      expect(result.data.hasSignatureLine).toBe(true);
    }
  });

  it("signatoryCount is capped at 5", () => {
    const bad = CertificateBriefSchema.safeParse({ ...BASE, serviceCode: "GD-CERT", signatoryCount: 6 });
    expect(bad.success).toBe(false);
  });
});

// ── GD-STATIONERY ─────────────────────────────────────────────────────────────

describe("StationeryBriefSchema", () => {
  it("requires at least one item", () => {
    const none = StationeryBriefSchema.safeParse({ ...BASE, serviceCode: "GD-STATIONERY", items: [] });
    expect(none.success).toBe(false);
  });

  it("accepts a full stationery set", () => {
    const result = StationeryBriefSchema.safeParse({
      ...BASE, serviceCode: "GD-STATIONERY",
      items: ["letterhead", "envelope_dl", "business_card", "notepad_a5", "presentation_folder"],
    });
    expect(result.success).toBe(true);
  });
});

// ── Discriminated union dispatch ──────────────────────────────────────────────

describe("GraphicDesignBriefSchema (union)", () => {
  it("dispatches to correct schema for every service code", () => {
    const perService: Record<string, object> = {
      "GD-LOGO":       { ...BASE, serviceCode: "GD-LOGO" },
      "GD-BCARD":      { ...BASE, serviceCode: "GD-BCARD" },
      "GD-LTRHEAD":    { ...BASE, serviceCode: "GD-LTRHEAD" },
      "GD-FLYER":      { ...BASE, serviceCode: "GD-FLYER" },
      "GD-POSTER":     { ...BASE, serviceCode: "GD-POSTER" },
      "GD-BANNER":     { ...BASE, serviceCode: "GD-BANNER" },
      "GD-BROCHURE":   { ...BASE, serviceCode: "GD-BROCHURE" },
      "GD-SOCIAL":     { ...BASE, serviceCode: "GD-SOCIAL", platforms: ["instagram"], contentTypes: ["post_square"] },
      "GD-CERT":       { ...BASE, serviceCode: "GD-CERT" },
      "GD-STATIONERY": { ...BASE, serviceCode: "GD-STATIONERY", items: ["letterhead"] },
    };

    for (const [code, input] of Object.entries(perService)) {
      const result = GraphicDesignBriefSchema.safeParse(input);
      expect(result.success, `Failed for ${code}: ${!result.success ? JSON.stringify((result as { error: unknown }).error) : ""}`).toBe(true);
    }
  });

  it("rejects an unknown service code", () => {
    const result = GraphicDesignBriefSchema.safeParse({ ...BASE, serviceCode: "GD-UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("covers all 10 GD_SERVICE_CODES", () => {
    expect(GD_SERVICE_CODES).toHaveLength(10);
    expect(Object.keys(GD_SERVICE_LABELS)).toHaveLength(10);
  });
});

// ── Status update schema ──────────────────────────────────────────────────────

describe("GdStatusUpdateSchema", () => {
  it("accepts valid status transitions", () => {
    for (const s of ["approved", "in_production", "completed", "cancelled"]) {
      expect(GdStatusUpdateSchema.safeParse({ status: s }).success).toBe(true);
    }
  });

  it("rejects unknown statuses", () => {
    expect(GdStatusUpdateSchema.safeParse({ status: "launched" }).success).toBe(false);
  });

  it("accepts optional note", () => {
    const r = GdStatusUpdateSchema.safeParse({ status: "approved", note: "LGTM" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.note).toBe("LGTM");
  });
});
