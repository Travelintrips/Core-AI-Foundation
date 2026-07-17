/**
 * vendorRecommendationService.test.ts — Team 22 unit tests
 *
 * Tests: scoring breakdown, area matching, availability scoring,
 *        rating normalization, verification bonus, limit respected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVendorDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../schema.js", () => ({
  vendorDb: mockVendorDb,
  vendorsTable: {
    id: "id",
    vendorType: "vendor_type",
    moderationStatus: "moderation_status",
    status: "status",
    isAvailableNow: "is_available_now",
    leadTimeDays: "lead_time_days",
    province: "province",
    city: "city",
    avgRating: "avg_rating",
    isFeatured: "is_featured",
    isVerified: "is_verified",
    displayName: "display_name",
    createdAt: "created_at",
  },
  vendorServiceAreasTable: {
    vendorId: "vendor_id",
    province: "province",
    isRemote: "is_remote",
  },
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
  inArray: vi.fn((col, vals) => ({ __inArray: [col, vals] })),
  desc: vi.fn((col) => ({ __desc: col })),
  asc: vi.fn((col) => ({ __asc: col })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw?.[0] })),
    { join: vi.fn(() => ({})) },
  ),
}));

const MOCK_GRAPHIC_VENDOR_CARD = {
  id: 1,
  vendorCode: "VND-001",
  displayName: "Kreatif Studio",
  brandName: "KS",
  vendorType: "graphic_designer",
  shortBio: "Spesialis logo",
  logoUrl: null,
  coverUrl: null,
  city: "Jakarta Selatan",
  province: "DKI Jakarta",
  country: "ID",
  contactWhatsapp: "+6281*****",
  contactEmail: "ven***@example.com",
  websiteUrl: null,
  instagramUrl: null,
  minPrice: 1_500_000,
  maxPrice: 10_000_000,
  priceCurrency: "IDR",
  leadTimeDays: 5,
  isAvailableNow: true,
  isVerified: true,
  isFeatured: true,
  avgRating: "4.80",
  totalRatings: 42,
  createdAt: new Date(),
};

const MOCK_SERVICE_AREAS = [
  { id: 1, vendorId: 1, province: "DKI Jakarta", city: "Jakarta Selatan", isRemote: true },
  { id: 2, vendorId: 1, province: "Jawa Barat", city: null, isRemote: false },
];

// Mock vendorService to control the vendor pool returned for scoring
vi.mock("../vendorService.js", () => ({
  searchVendors: vi.fn().mockResolvedValue({
    items: [MOCK_GRAPHIC_VENDOR_CARD],
    pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
  }),
  toPublicCard: vi.fn((v: unknown) => v),
  VENDOR_TYPES: [
    "graphic_designer", "printing", "interior_designer", "furniture",
    "lighting", "flooring", "curtain", "kitchen", "custom_furniture",
    "textile", "konveksi", "embroidery", "apparel_printing", "packaging",
    "product_mockup", "photographer", "videographer",
  ],
}));

// ── Chain factory for queries ending in .where() ──────────────────────────────
function makeWhereChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockResolvedValue(result);
  return c;
}

describe("recommendVendors", () => {
  beforeEach(() => {
    // scoreVendor internally calls vendorDb.select().from(serviceAreasTable).where(...)
    // Each scored vendor triggers one service-areas lookup
    mockVendorDb.select.mockReturnValue(makeWhereChain(MOCK_SERVICE_AREAS));
  });

  it("returns scored vendors sorted by compatibility score", async () => {
    const { recommendVendors } = await import("../vendorRecommendationService.js");
    const results = await recommendVendors({
      vendorType: "graphic_designer",
      province: "DKI Jakarta",
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const scored = results[0]!;
    expect(scored.compatibilityScore).toBeGreaterThan(0);
    expect(scored.compatibilityScore).toBeLessThanOrEqual(100);
    expect(scored.scoreBreakdown).toHaveProperty("categoryMatch");
    expect(scored.scoreBreakdown).toHaveProperty("areaMatch");
    expect(scored.scoreBreakdown).toHaveProperty("availability");
    expect(scored.scoreBreakdown).toHaveProperty("rating");
    expect(scored.scoreBreakdown).toHaveProperty("verification");
  });

  it("gives 30 pts for exact category match", async () => {
    const { recommendVendors } = await import("../vendorRecommendationService.js");
    const results = await recommendVendors({ vendorType: "graphic_designer" });
    expect(results[0]!.scoreBreakdown.categoryMatch).toBe(30);
  });

  it("gives 10 pts for verification badge", async () => {
    const { recommendVendors } = await import("../vendorRecommendationService.js");
    const results = await recommendVendors({ vendorType: "graphic_designer" });
    // MOCK_GRAPHIC_VENDOR_CARD.isVerified = true → 10 pts
    expect(results[0]!.scoreBreakdown.verification).toBe(10);
  });

  it("includes non-empty matchReasons", async () => {
    const { recommendVendors } = await import("../vendorRecommendationService.js");
    const results = await recommendVendors({ vendorType: "graphic_designer" });
    expect(Array.isArray(results[0]!.matchReasons)).toBe(true);
    expect(results[0]!.matchReasons.length).toBeGreaterThan(0);
  });

  it("respects the limit parameter", async () => {
    const { recommendVendors } = await import("../vendorRecommendationService.js");
    const results = await recommendVendors({ vendorType: "graphic_designer", limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("gives area match pts when province matches a service area", async () => {
    // MOCK_SERVICE_AREAS includes DKI Jakarta → servesProvince = true → 25 pts
    const { recommendVendors } = await import("../vendorRecommendationService.js");
    const results = await recommendVendors({
      vendorType: "graphic_designer",
      province: "DKI Jakarta",
    });
    expect(results[0]!.scoreBreakdown.areaMatch).toBe(25);
  });
});
