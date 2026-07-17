/**
 * vendorPortfolioService.test.ts — Team 22 unit tests
 *
 * Tests: public view (approved only), moderation approve/reject,
 *        pending count, portfolio item sanitization.
 *
 * Chain resolution:
 *   listVendorPortfolioPublic  → .where().orderBy().limit()     (limit is terminal)
 *   listVendorPortfolioAdmin   → Promise.all([.offset(), .where()]) (two selects)
 *   mutations                  → .set().where().returning()     (returning is terminal)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVendorDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../schema.js", () => ({
  vendorDb: mockVendorDb,
  vendorPortfolioItemsTable: {
    id: "id", vendorId: "vendor_id", moderationStatus: "moderation_status",
    isFeatured: "is_featured", displayOrder: "display_order", createdAt: "created_at",
  },
  vendorsTable: {},
}));

vi.mock("../vendorService.js", () => ({
  validateExternalUrl: vi.fn((url: unknown) => url ?? undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ __eq: [col, val] })),
  and: vi.fn((...args) => ({ __and: args.filter(Boolean) })),
  desc: vi.fn((col) => ({ __desc: col })),
  asc: vi.fn((col) => ({ __asc: col })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw?.[0] })),
    { join: vi.fn(() => ({})) },
  ),
}));

// ── Chain factories ────────────────────────────────────────────────────────────

/** Public portfolio: .where().orderBy().limit() — limit resolves */
function makeLimitChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(result);
  return c;
}

/** Admin portfolio: .where().orderBy().limit().offset() — offset resolves */
function makeOffsetChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  c.offset = vi.fn().mockResolvedValue(result);
  return c;
}

/** .where() resolves (count query in admin list) */
function makeWhereChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockResolvedValue(result);
  return c;
}

/** Mutation: .set().where().returning() — returning resolves */
function makeUpdateChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.returning = vi.fn().mockResolvedValue(result);
  return c;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const APPROVED_ITEM = {
  id: 1, vendorId: 10, title: "Logo Kopi Senja", description: "Full logo design",
  category: "graphic_designer", coverImageUrl: "https://cdn.example.com/cover.jpg",
  galleryJson: [{ url: "https://cdn.example.com/g1.jpg", caption: "Final logo" }],
  clientIndustry: "F&B", projectDurationDays: 5, tagsJson: ["logo", "coffee", "minimal"],
  moderationStatus: "approved", moderationNote: null, moderatedAt: new Date(),
  isFeatured: true, displayOrder: 1, createdAt: new Date(), updatedAt: new Date(),
};

const PENDING_ITEM = {
  ...APPROVED_ITEM, id: 2, title: "Pending Brochure", moderationStatus: "pending",
  isFeatured: false, displayOrder: 2,
};

// ─────────────────────────────────────────────────────────────────────────────

describe("listVendorPortfolioPublic", () => {
  beforeEach(() => {
    mockVendorDb.select.mockReturnValue(makeLimitChain([APPROVED_ITEM]));
  });

  it("returns only approved portfolio items", async () => {
    const { listVendorPortfolioPublic } = await import("../vendorPortfolioService.js");
    const items = await listVendorPortfolioPublic(10);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Logo Kopi Senja");
    // Confirm moderation fields are stripped from public view
    const item = items[0]! as unknown as Record<string, unknown>;
    expect(item["moderationNote"]).toBeUndefined();
    expect(item["moderatedAt"]).toBeUndefined();
    expect(item["moderationStatus"]).toBeUndefined();
  });

  it("maps gallery JSON correctly", async () => {
    const { listVendorPortfolioPublic } = await import("../vendorPortfolioService.js");
    const items = await listVendorPortfolioPublic(10);
    expect(items[0]!.galleryJson).toEqual([
      { url: "https://cdn.example.com/g1.jpg", caption: "Final logo" },
    ]);
  });

  it("maps tags correctly", async () => {
    const { listVendorPortfolioPublic } = await import("../vendorPortfolioService.js");
    const items = await listVendorPortfolioPublic(10);
    expect(items[0]!.tagsJson).toEqual(["logo", "coffee", "minimal"]);
  });
});

describe("listVendorPortfolioAdmin", () => {
  beforeEach(() => {
    // Promise.all([data query (.offset resolves), count query (.where resolves)])
    mockVendorDb.select
      .mockReturnValueOnce(makeOffsetChain([APPROVED_ITEM, PENDING_ITEM]))
      .mockReturnValueOnce(makeWhereChain([{ count: 2 }]));
  });

  it("returns all items regardless of moderation status", async () => {
    const { listVendorPortfolioAdmin } = await import("../vendorPortfolioService.js");
    const result = await listVendorPortfolioAdmin(10);
    expect(result.items).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });

  it("returns pagination metadata", async () => {
    const { listVendorPortfolioAdmin } = await import("../vendorPortfolioService.js");
    const result = await listVendorPortfolioAdmin(10, undefined, 1, 30);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.pageSize).toBe(30);
  });
});

describe("approvePortfolioItem", () => {
  it("returns the updated item on success", async () => {
    const updated = { ...PENDING_ITEM, moderationStatus: "approved", moderationNote: null };
    mockVendorDb.update.mockReturnValue(makeUpdateChain([updated]));

    const { approvePortfolioItem } = await import("../vendorPortfolioService.js");
    const result = await approvePortfolioItem(10, 2);
    expect(result).not.toBeNull();
    expect(result?.moderationStatus).toBe("approved");
  });

  it("returns null when item not found", async () => {
    mockVendorDb.update.mockReturnValue(makeUpdateChain([]));

    const { approvePortfolioItem } = await import("../vendorPortfolioService.js");
    const result = await approvePortfolioItem(10, 999);
    expect(result).toBeNull();
  });
});

describe("rejectPortfolioItem", () => {
  it("sets moderationStatus to rejected and stores reason", async () => {
    const updated = { ...PENDING_ITEM, moderationStatus: "rejected", moderationNote: "Inappropriate content" };
    mockVendorDb.update.mockReturnValue(makeUpdateChain([updated]));

    const { rejectPortfolioItem } = await import("../vendorPortfolioService.js");
    const result = await rejectPortfolioItem(10, 2, "Inappropriate content");
    expect(result?.moderationStatus).toBe("rejected");
    expect(result?.moderationNote).toBe("Inappropriate content");
  });
});
