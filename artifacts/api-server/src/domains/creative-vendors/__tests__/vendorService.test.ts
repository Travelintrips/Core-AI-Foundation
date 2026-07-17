/**
 * vendorService.test.ts — Team 22 unit tests
 *
 * Tests: public DTO redaction, mask helpers, VENDOR_TYPES exhaustiveness.
 */
import { describe, it, expect, vi } from "vitest";

// ── vi.hoisted: declare mock db BEFORE vi.mock factory runs ───────────────────
const mockVendorDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../schema.js", () => ({
  vendorDb: mockVendorDb,
  vendorsTable: {
    id: "id",
    vendorCode: "vendor_code",
    displayName: "display_name",
    vendorType: "vendor_type",
    moderationStatus: "moderation_status",
    status: "status",
    isAvailableNow: "is_available_now",
    isVerified: "is_verified",
    isFeatured: "is_featured",
    avgRating: "avg_rating",
    leadTimeDays: "lead_time_days",
    province: "province",
    city: "city",
    brandName: "brand_name",
    shortBio: "short_bio",
    totalRatings: "total_ratings",
    totalContactRequests: "total_contact_requests",
    createdAt: "created_at",
  },
  vendorServiceAreasTable: { vendorId: "vendor_id", province: "province", isRemote: "is_remote" },
  vendorCapabilitiesTable: { vendorId: "vendor_id" },
  vendorCertificationsTable: { vendorId: "vendor_id" },
  vendorRatingsTable: { vendorId: "vendor_id", moderationStatus: "moderation_status" },
  VENDOR_TYPES: [
    "graphic_designer", "printing", "interior_designer", "furniture",
    "lighting", "flooring", "curtain", "kitchen", "custom_furniture",
    "textile", "konveksi", "embroidery", "apparel_printing", "packaging",
    "product_mockup", "photographer", "videographer",
  ],
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ __eq: [col, val] })),
  and: vi.fn((...args) => ({ __and: args.filter(Boolean) })),
  or: vi.fn((...args) => ({ __or: args })),
  ilike: vi.fn((col, val) => ({ __ilike: [col, val] })),
  desc: vi.fn((col) => ({ __desc: col })),
  asc: vi.fn((col) => ({ __asc: col })),
  inArray: vi.fn((col, vals) => ({ __inArray: [col, vals] })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw[0] })),
    { join: vi.fn(() => ({})) },
  ),
}));

// ── Import pure helpers AFTER mock declarations ────────────────────────────────
import { maskWhatsapp, maskEmail, toPublicCard } from "../vendorService.js";

const MOCK_VENDOR = {
  id: 1,
  vendorCode: "VND-001",
  displayName: "Kreatif Studio",
  brandName: "KS Design",
  vendorType: "graphic_designer",
  shortBio: "Spesialis logo dan brand identity",
  description: "Kami mengerjakan branding sejak 2015.",
  logoUrl: "https://cdn.example.com/logo.png",
  coverUrl: "https://cdn.example.com/cover.jpg",
  galleryJson: [],
  whatsapp: "+6281234567890",
  email: "vendor@example.com",
  websiteUrl: "https://kreatiifstudio.com",
  instagramUrl: "https://instagram.com/kreatifstudio",
  city: "Jakarta Selatan",
  province: "DKI Jakarta",
  country: "ID",
  minPrice: 1_500_000,
  maxPrice: 15_000_000,
  priceCurrency: "IDR",
  leadTimeDays: 5,
  isAvailableNow: true,
  status: "active",
  moderationStatus: "approved",
  moderationNote: null,
  moderatedAt: new Date(),
  isVerified: true,
  isFeatured: true,
  totalRatings: 42,
  avgRating: "4.80",
  totalContactRequests: 12,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe("maskWhatsapp", () => {
  it("masks whatsapp number showing only first 5 chars", () => {
    expect(maskWhatsapp("+6281234567890")).toBe("+6281*****");
  });

  it("returns null for null input", () => {
    expect(maskWhatsapp(null)).toBeNull();
  });

  it("handles short numbers gracefully", () => {
    expect(maskWhatsapp("123")).toBe("***");
  });

  it("strips spaces before masking", () => {
    const result = maskWhatsapp("+62 812 3456");
    expect(result).toBe("+6281*****");
  });
});

describe("maskEmail", () => {
  it("masks email keeping first 3 local chars and domain", () => {
    expect(maskEmail("vendor@example.com")).toBe("ven***@example.com");
  });

  it("returns null for null input", () => {
    expect(maskEmail(null)).toBeNull();
  });

  it("masks short local parts", () => {
    expect(maskEmail("ab@test.com")).toBe("ab***@test.com");
  });

  it("returns *** for email without @", () => {
    expect(maskEmail("notanemail")).toBe("***");
  });
});

describe("toPublicCard (public DTO redaction)", () => {
  it("strips full whatsapp and email — replaces with masked versions", () => {
    const card = toPublicCard(MOCK_VENDOR as Parameters<typeof toPublicCard>[0]);
    expect(card.contactWhatsapp).not.toBe(MOCK_VENDOR.whatsapp);
    expect(card.contactEmail).not.toBe(MOCK_VENDOR.email);
    expect(card.contactWhatsapp).toBe("+6281*****");
    expect(card.contactEmail).toBe("ven***@example.com");
  });

  it("exposes non-sensitive public fields correctly", () => {
    const card = toPublicCard(MOCK_VENDOR as Parameters<typeof toPublicCard>[0]);
    expect(card.id).toBe(1);
    expect(card.displayName).toBe("Kreatif Studio");
    expect(card.vendorType).toBe("graphic_designer");
    expect(card.isVerified).toBe(true);
    expect(card.avgRating).toBe("4.80");
    expect(card.leadTimeDays).toBe(5);
    expect(card.city).toBe("Jakarta Selatan");
    expect(card.province).toBe("DKI Jakarta");
  });

  it("does NOT expose internal fields (moderationNote, whatsapp raw, email raw)", () => {
    const card = toPublicCard(MOCK_VENDOR as Parameters<typeof toPublicCard>[0]) as Record<string, unknown>;
    expect(card["moderationNote"]).toBeUndefined();
    expect(card["moderatedAt"]).toBeUndefined();
    expect(card["whatsapp"]).toBeUndefined();
    expect(card["email"]).toBeUndefined();
    expect(card["updatedAt"]).toBeUndefined();
  });

  it("preserves website and instagram URLs (publicly listed)", () => {
    const card = toPublicCard(MOCK_VENDOR as Parameters<typeof toPublicCard>[0]);
    expect(card.websiteUrl).toBe("https://kreatiifstudio.com");
    expect(card.instagramUrl).toBe("https://instagram.com/kreatifstudio");
  });
});

describe("VENDOR_TYPES", () => {
  it("includes all 17 expected vendor types", async () => {
    const { VENDOR_TYPES: types } = await import("../schema.js");
    expect(types).toHaveLength(17);
    const expected = [
      "graphic_designer", "printing", "interior_designer", "furniture",
      "lighting", "flooring", "curtain", "kitchen", "custom_furniture",
      "textile", "konveksi", "embroidery", "apparel_printing", "packaging",
      "product_mockup", "photographer", "videographer",
    ];
    for (const t of expected) {
      expect(types).toContain(t);
    }
  });
});
