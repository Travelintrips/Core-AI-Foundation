/**
 * vendorRecommendationService.test.ts — Team 22 unit tests
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: KEPT — recommendation logic is a new concept.
 * Updated: uses creative_vendor_profiles + marketplace_creators JOIN.
 *
 * Tests: scoring algorithm, area matching, batch service area load
 *        (N+1 avoidance), limit cap enforcement, empty results.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock db (hoisted) ──────────────────────────────────────────────────────────
const mockVendorDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../schema.js", () => ({
  vendorDb: mockVendorDb,
  creativeVendorProfilesTable: {
    id: "id",
    creatorId: "creator_id",
    vendorType: "vendor_type",
    moderationStatus: "moderation_status",
    isAvailableNow: "is_available_now",
    isFeatured: "is_featured",
    leadTimeDays: "lead_time_days",
    province: "province",
    city: "city",
    createdAt: "created_at",
  },
  vendorServiceAreasTable: {
    profileId: "profile_id",
    vendorId: "vendor_id", // compat alias used in some tests
    province: "province",
    city: "city",
    isRemote: "is_remote",
  },
  VENDOR_TYPES: [
    "graphic_designer", "printing", "interior_designer", "furniture",
    "lighting", "flooring", "curtain", "kitchen", "custom_furniture",
    "textile", "konveksi", "embroidery", "apparel_printing", "packaging",
    "product_mockup", "photographer", "videographer",
  ],
}));

vi.mock("@workspace/db", () => ({
  marketplaceCreatorsTable: {
    id: "id",
    creatorCode: "creator_code",
    displayName: "display_name",
    bio: "bio",
    avatarUrl: "avatar_url",
    websiteUrl: "website_url",
    isVerified: "is_verified",
    isActive: "is_active",
    avgRating: "avg_rating",
    createdAt: "created_at",
  },
  pool: {},
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => mockVendorDb),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ __eq: [col, val] })),
  and: vi.fn((...args) => ({ __and: args.filter(Boolean) })),
  desc: vi.fn((col) => ({ __desc: col })),
  asc: vi.fn((col) => ({ __asc: col })),
  inArray: vi.fn((col, vals) => ({ __inArray: [col, vals] })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw?.[0] })),
    { join: vi.fn(() => ({})) },
  ),
}));

// ── searchVendors mock (returns PublicVendorCards) ────────────────────────────
vi.mock("../vendorService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vendorService.js")>();
  return {
    ...actual,
    searchVendors: vi.fn(),
  };
});

import { recommendVendors } from "../vendorRecommendationService.js";
import { searchVendors } from "../vendorService.js";

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<{
  id: number; profileId: number; vendorType: string; province: string;
  isAvailableNow: boolean; leadTimeDays: number; isVerified: boolean; avgRating: string;
}> = {}) {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 100,
    creatorCode: "CRE-001",
    displayName: "Test Vendor",
    avatarUrl: null,
    isVerified: overrides.isVerified ?? false,
    avgRating: overrides.avgRating ?? "0",
    vendorType: overrides.vendorType ?? "printing",
    brandName: null,
    city: null,
    province: overrides.province ?? "DKI Jakarta",
    country: "ID",
    contactWhatsapp: null,
    websiteUrl: null,
    instagramUrl: null,
    minPrice: null,
    maxPrice: null,
    priceCurrency: null,
    leadTimeDays: overrides.leadTimeDays ?? 7,
    isAvailableNow: overrides.isAvailableNow ?? true,
    isFeatured: false,
    moderationStatus: "approved",
    createdAt: new Date(),
  };
}

// ── Chain factory for vendorDb.select (service area query) ────────────────────
function makeServiceAreaChain(areas: object[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockResolvedValue(areas);
  return c;
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("recommendVendors — scoring algorithm", () => {
  it("awards 30 pts for category match", async () => {
    const card = makeCard({ vendorType: "printing", province: "DKI Jakarta" });
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: [card],
      pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
    });
    // No service areas for simplicity
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const results = await recommendVendors({ vendorType: "printing" });
    expect(results).toHaveLength(1);
    expect(results[0]!.scoreBreakdown.categoryMatch).toBe(30);
  });

  it("awards verification bonus from marketplace_creators.isVerified", async () => {
    const card = makeCard({ isVerified: true, avgRating: "0" });
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: [card],
      pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
    });
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const results = await recommendVendors({ vendorType: card.vendorType });
    expect(results[0]!.scoreBreakdown.verification).toBe(10);
    expect(results[0]!.matchReasons).toContain("Vendor terverifikasi");
  });

  it("normalises rating from avgRating (0-5 → 0-15 pts)", async () => {
    const card = makeCard({ avgRating: "5.00" });
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: [card],
      pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
    });
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const results = await recommendVendors({ vendorType: card.vendorType });
    expect(results[0]!.scoreBreakdown.rating).toBe(15);
  });
});

describe("recommendVendors — area matching", () => {
  it("awards 25 pts when vendor province matches request", async () => {
    const card = makeCard({ province: "DKI Jakarta" });
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: [card],
      pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
    });
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const results = await recommendVendors({ vendorType: card.vendorType, province: "DKI Jakarta" });
    expect(results[0]!.scoreBreakdown.areaMatch).toBe(25);
  });

  it("awards 15 pts for remote-capable vendor when isRemoteOk=true", async () => {
    const card = makeCard({ province: "Jawa Barat" });
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: [card],
      pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
    });
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { profileId: 100, province: "Jawa Barat", city: null, isRemote: true },
        ]),
      }),
    });

    const results = await recommendVendors({
      vendorType: card.vendorType,
      province: "DKI Jakarta",
      isRemoteOk: true,
    });
    expect(results[0]!.scoreBreakdown.areaMatch).toBe(15);
    expect(results[0]!.matchReasons).toContain("Dapat bekerja remote");
  });

  it("awards 0 area pts when no province match and remote not ok", async () => {
    const card = makeCard({ province: "Jawa Barat" });
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: [card],
      pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
    });
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const results = await recommendVendors({
      vendorType: card.vendorType,
      province: "DKI Jakarta",
      isRemoteOk: false,
    });
    if (results.length > 0) {
      expect(results[0]!.scoreBreakdown.areaMatch).toBe(0);
    }
  });
});

describe("recommendVendors — N+1 avoidance (batch service area load)", () => {
  it("calls select only ONCE for service areas regardless of candidate count", async () => {
    const cards = [
      makeCard({ id: 1, profileId: 101, vendorType: "printing" }),
      makeCard({ id: 2, profileId: 102, vendorType: "printing" }),
      makeCard({ id: 3, profileId: 103, vendorType: "printing" }),
    ];
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: cards,
      pagination: { page: 1, pageSize: 200, total: 3, totalPages: 1 },
    });

    const selectSpy = vi.fn();
    const fromSpy = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    selectSpy.mockReturnValue({ from: fromSpy });
    mockVendorDb.select = selectSpy;

    await recommendVendors({ vendorType: "printing" });

    // One batch select for all service areas — not one per vendor
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });
});

describe("recommendVendors — limit cap", () => {
  it("caps results at requested limit", async () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({ id: i + 1, profileId: 100 + i, vendorType: "printing" }),
    );
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: cards,
      pagination: { page: 1, pageSize: 200, total: 10, totalPages: 1 },
    });
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const results = await recommendVendors({ vendorType: "printing", limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("caps limit at 50 even if caller requests more", async () => {
    const cards = Array.from({ length: 100 }, (_, i) =>
      makeCard({ id: i + 1, profileId: 100 + i, vendorType: "printing" }),
    );
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: cards,
      pagination: { page: 1, pageSize: 200, total: 100, totalPages: 1 },
    });
    mockVendorDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const results = await recommendVendors({ vendorType: "printing", limit: 999 });
    expect(results.length).toBeLessThanOrEqual(50);
  });
});

describe("recommendVendors — empty results", () => {
  it("returns empty array when no vendors found", async () => {
    vi.mocked(searchVendors).mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, pageSize: 200, total: 0, totalPages: 0 },
    });

    const results = await recommendVendors({ vendorType: "printing" });
    expect(results).toEqual([]);
  });
});
