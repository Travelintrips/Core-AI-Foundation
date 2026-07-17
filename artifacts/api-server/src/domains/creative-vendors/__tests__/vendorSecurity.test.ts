/**
 * vendorSecurity.test.ts — Team 22 Security Tests
 *
 * Covers:
 *   P0: URL validation (SSRF-safe storage), rating deduplication,
 *       pageSize cap enforcement, bounded list queries
 *   P1: N+1 avoidance (batch service-area load in recommendations)
 *
 * NOTE: vi.resetAllMocks() runs before each test to prevent stale
 *       mockReturnValueOnce entries from leaking across tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: declare mock db BEFORE vi.mock factory runs ──────────────────
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
    websiteUrl: "website_url",
    instagramUrl: "instagram_url",
    whatsapp: "whatsapp",
    email: "email",
    updatedAt: "updated_at",
  },
  vendorPortfolioItemsTable: {
    id: "id",
    vendorId: "vendor_id",
    moderationStatus: "moderation_status",
    isFeatured: "is_featured",
    displayOrder: "display_order",
    createdAt: "created_at",
    updatedAt: "updated_at",
    coverImageUrl: "cover_image_url",
  },
  vendorRatingsTable: {
    id: "id",
    vendorId: "vendor_id",
    clientEmailHash: "client_email_hash",
    rating: "rating",
    moderationStatus: "moderation_status",
    createdAt: "created_at",
  },
  vendorServiceAreasTable: {
    vendorId: "vendor_id",
    province: "province",
    city: "city",
    isRemote: "is_remote",
  },
  vendorContactRequestsTable: {
    id: "id",
    vendorId: "vendor_id",
    requesterEmailHash: "requester_email_hash",
    status: "status",
    createdAt: "created_at",
  },
  vendorCapabilitiesTable: { vendorId: "vendor_id" },
  vendorCertificationsTable: { vendorId: "vendor_id" },
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
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw?.[0] })),
    { join: vi.fn(() => ({})) },
  ),
}));

// ── Reset all mocks before each test to prevent Once-entry leakage ────────────
beforeEach(() => {
  vi.resetAllMocks();
});

// ── Chain factories ────────────────────────────────────────────────────────────

/** .where() resolves directly */
function makeWhereChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockResolvedValue(result);
  return c;
}

/**
 * Full chain: .select().from().where().orderBy().limit() — limit resolves.
 * Used for: listVendorPortfolioPublic, getMyContactRequests
 */
function makeLimitChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(result);
  return c;
}

/**
 * Full chain: .select().from().where().orderBy().limit().offset() — offset resolves.
 * Used for: searchVendors (data query), listContactRequestsAdmin
 */
function makeOffsetChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  c.offset = vi.fn().mockResolvedValue(result);
  return c;
}

/** insert().values().returning() */
function makeInsertChain(result: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(result),
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SSRF-safe URL Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("validateExternalUrl (SSRF-safe URL validation)", () => {
  it("accepts valid http URL", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(validateExternalUrl("http://example.com")).toBe("http://example.com");
  });

  it("accepts valid https URL", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(validateExternalUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("returns undefined for null/undefined/empty input", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(validateExternalUrl(null)).toBeUndefined();
    expect(validateExternalUrl(undefined)).toBeUndefined();
    expect(validateExternalUrl("")).toBeUndefined();
  });

  it("throws for file:// protocol", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("file:///etc/passwd")).toThrow("not allowed");
  });

  it("throws for javascript: protocol", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("javascript:alert(1)")).toThrow();
  });

  it("throws for localhost", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("http://localhost/api/internal")).toThrow(
      "restricted host",
    );
  });

  it("throws for 127.0.0.1 (loopback)", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("http://127.0.0.1:8080/secret")).toThrow(
      "private or reserved",
    );
  });

  it("throws for 10.x.x.x (private class A)", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("http://10.0.0.1/admin")).toThrow(
      "private or reserved",
    );
  });

  it("throws for 192.168.x.x (private class C)", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("http://192.168.1.1/router")).toThrow(
      "private or reserved",
    );
  });

  it("throws for 172.16.x.x (private class B)", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("http://172.16.0.1/internal")).toThrow(
      "private or reserved",
    );
  });

  it("throws for 169.254.x.x (link-local / AWS metadata endpoint)", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() =>
      validateExternalUrl("http://169.254.169.254/latest/meta-data"),
    ).toThrow("private or reserved");
  });

  it("throws for invalid URL string", async () => {
    const { validateExternalUrl } = await import("../vendorService.js");
    expect(() => validateExternalUrl("not-a-url")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rating Deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe("submitRating — deduplication (P0: one rating per emailHash per vendor)", () => {
  it("throws when same clientEmailHash already rated this vendor", async () => {
    mockVendorDb.select.mockReturnValue(makeWhereChain([{ id: 99 }]));

    const { submitRating } = await import("../vendorService.js");
    await expect(
      submitRating(1, "existinghash@example.com", 5),
    ).rejects.toThrow("Rating already submitted for this vendor");
  });

  it("allows submission when no prior rating exists", async () => {
    const newRating = {
      id: 1, vendorId: 1, clientEmailHash: "newhash", rating: 4,
      review: null, projectContext: null, moderationStatus: "pending", createdAt: new Date(),
    };
    // First select: dedup check → empty
    mockVendorDb.select.mockReturnValueOnce(makeWhereChain([]));
    // Second select: recalcAvgRating stats
    mockVendorDb.select.mockReturnValueOnce(makeWhereChain([{ avg: "0.00", count: 0 }]));
    mockVendorDb.insert.mockReturnValue(makeInsertChain([newRating]));
    mockVendorDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const { submitRating } = await import("../vendorService.js");
    const result = await submitRating(1, "newhash", 4);
    expect(result.rating).toBe(4);
  });

  it("throws when rating is out of range (< 1)", async () => {
    const { submitRating } = await import("../vendorService.js");
    await expect(submitRating(1, "hash", 0)).rejects.toThrow("Rating must be 1–5");
  });

  it("throws when rating is out of range (> 5)", async () => {
    const { submitRating } = await import("../vendorService.js");
    await expect(submitRating(1, "hash", 6)).rejects.toThrow("Rating must be 1–5");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pageSize cap enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("searchVendors — pageSize cap (P0: service-layer enforcement)", () => {
  it("caps pageSize at 48 even when caller passes 9999", async () => {
    // Two selects: data (.offset resolves) + count (.where resolves)
    mockVendorDb.select
      .mockReturnValueOnce(makeOffsetChain([]))
      .mockReturnValueOnce(makeWhereChain([{ count: 0 }]));

    const { searchVendors } = await import("../vendorService.js");
    const result = await searchVendors({ pageSize: 9999 });
    expect(result.pagination.pageSize).toBe(48);
  });

  it("normalises page to minimum 1 for negative input", async () => {
    mockVendorDb.select
      .mockReturnValueOnce(makeOffsetChain([]))
      .mockReturnValueOnce(makeWhereChain([{ count: 0 }]));

    const { searchVendors } = await import("../vendorService.js");
    const result = await searchVendors({ page: -5, pageSize: 10 });
    expect(result.pagination.page).toBe(1);
  });
});

describe("listContactRequestsAdmin — pageSize cap (P0)", () => {
  it("caps pageSize at 100 even when caller passes 9999", async () => {
    const chain = makeOffsetChain([]);
    mockVendorDb.select.mockReturnValue(chain);

    const { listContactRequestsAdmin } = await import("../vendorContactService.js");
    const result = await listContactRequestsAdmin({ pageSize: 9999 });

    expect(Array.isArray(result)).toBe(true);
    // Verify .limit was called with 100 (the service-layer cap)
    expect(chain.limit).toHaveBeenCalledWith(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bounded list queries
// ─────────────────────────────────────────────────────────────────────────────

describe("listVendorPortfolioPublic — bounded query (P0)", () => {
  it("applies PUBLIC_PORTFOLIO_LIMIT of 100 to prevent unbounded scan", async () => {
    // .where().orderBy().limit() — limit resolves
    const chain = makeLimitChain([]);
    mockVendorDb.select.mockReturnValue(chain);

    const { listVendorPortfolioPublic } = await import("../vendorPortfolioService.js");
    await listVendorPortfolioPublic(1);

    expect(chain.limit).toHaveBeenCalledWith(100);
  });
});

describe("getMyContactRequests — bounded query (P0)", () => {
  it("applies limit of 200 to prevent unbounded scan", async () => {
    // .from().innerJoin().where().orderBy().limit() — limit resolves
    const chain = makeLimitChain([]);
    mockVendorDb.select.mockReturnValue(chain);

    const { getMyContactRequests } = await import("../vendorContactService.js");
    await getMyContactRequests("somehash");

    expect(chain.limit).toHaveBeenCalledWith(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N+1 avoidance
// ─────────────────────────────────────────────────────────────────────────────

describe("recommendVendors — N+1 avoidance (P1: batch service-area load)", () => {
  it("uses inArray to batch-load service areas (single DB query for all vendors)", async () => {
    // inArray is called once for the batch load
    const { inArray } = await import("drizzle-orm");
    vi.mocked(inArray).mockClear();

    // Batch service-area query: .where() resolves
    mockVendorDb.select.mockReturnValue(makeWhereChain([]));

    // Mock searchVendors to return two candidates
    const { searchVendors } = await import("../vendorService.js");
    vi.spyOn({ searchVendors }, "searchVendors"); // spy without replacing

    // Override searchVendors for this test
    const vendorServiceMod = await import("../vendorService.js");
    vi.spyOn(vendorServiceMod, "searchVendors").mockResolvedValueOnce({
      items: [
        {
          id: 1, vendorType: "graphic_designer", province: "DKI Jakarta",
          isAvailableNow: true, leadTimeDays: 5, isVerified: true,
          avgRating: "4.5", isFeatured: true, vendorCode: "VND-001",
          displayName: "Studio A", brandName: null, shortBio: null,
          logoUrl: null, coverUrl: null, city: null, country: "ID",
          contactWhatsapp: null, contactEmail: null, websiteUrl: null,
          instagramUrl: null, minPrice: null, maxPrice: null,
          priceCurrency: null, totalRatings: 0, createdAt: new Date(),
        },
        {
          id: 2, vendorType: "graphic_designer", province: "Jawa Barat",
          isAvailableNow: false, leadTimeDays: 14, isVerified: false,
          avgRating: "3.0", isFeatured: false, vendorCode: "VND-002",
          displayName: "Studio B", brandName: null, shortBio: null,
          logoUrl: null, coverUrl: null, city: null, country: "ID",
          contactWhatsapp: null, contactEmail: null, websiteUrl: null,
          instagramUrl: null, minPrice: null, maxPrice: null,
          priceCurrency: null, totalRatings: 0, createdAt: new Date(),
        },
      ],
      pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
    });

    const { recommendVendors } = await import("../vendorRecommendationService.js");
    await recommendVendors({ vendorType: "graphic_designer" });

    // inArray called once (batch) not N times (per-vendor)
    expect(inArray).toHaveBeenCalledTimes(1);
    // mockVendorDb.select called once (the batch service-area load)
    expect(mockVendorDb.select).toHaveBeenCalledTimes(1);
  });
});
