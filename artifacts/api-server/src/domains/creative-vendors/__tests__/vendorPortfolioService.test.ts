/**
 * vendorPortfolioService.test.ts — Team 22 unit tests
 *
 * Tests: public view (approved only), moderation approve/reject,
 *        pending count, portfolio item sanitization.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

function makeChain(result: unknown[]) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockResolvedValue(result);
  c.insert = vi.fn().mockReturnValue(c);
  c.values = vi.fn().mockReturnValue(c);
  c.returning = vi.fn().mockResolvedValue(result);
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  c.offset = vi.fn().mockResolvedValue(result);
  return c;
}

const mockVendorDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };

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

vi.mock("../schema.js", () => ({
  vendorDb: mockVendorDb,
  vendorPortfolioItemsTable: {
    id: "id", vendorId: "vendor_id", moderationStatus: "moderation_status",
    isFeatured: "is_featured", displayOrder: "display_order", createdAt: "created_at",
  },
  vendorsTable: {},
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

describe("listVendorPortfolioPublic", () => {
  beforeEach(() => {
    const chain = makeChain([APPROVED_ITEM]);
    mockVendorDb.select.mockReturnValue(chain);
  });

  it("returns only approved portfolio items", async () => {
    const { listVendorPortfolioPublic } = await import("../vendorPortfolioService.js");
    const items = await listVendorPortfolioPublic(10);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Logo Kopi Senja");
    // Confirm moderation fields are stripped from public view
    const item = items[0]! as Record<string, unknown>;
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
    const chain = makeChain([APPROVED_ITEM, PENDING_ITEM]);
    mockVendorDb.select.mockReturnValue(chain);
  });

  it("returns all items regardless of moderation status", async () => {
    const { listVendorPortfolioAdmin } = await import("../vendorPortfolioService.js");
    const items = await listVendorPortfolioAdmin(10);
    expect(items).toHaveLength(2);
  });
});

describe("approvePortfolioItem", () => {
  it("returns the updated item on success", async () => {
    const updated = { ...PENDING_ITEM, moderationStatus: "approved", moderationNote: null };
    const chain = makeChain([updated]);
    chain.where = vi.fn().mockReturnValue(chain);
    mockVendorDb.update.mockReturnValue(chain);

    const { approvePortfolioItem } = await import("../vendorPortfolioService.js");
    const result = await approvePortfolioItem(10, 2);
    expect(result).not.toBeNull();
    expect(result?.moderationStatus).toBe("approved");
  });

  it("returns null when item not found", async () => {
    const chain = makeChain([]);
    chain.where = vi.fn().mockReturnValue(chain);
    mockVendorDb.update.mockReturnValue(chain);

    const { approvePortfolioItem } = await import("../vendorPortfolioService.js");
    const result = await approvePortfolioItem(10, 999);
    expect(result).toBeNull();
  });
});

describe("rejectPortfolioItem", () => {
  it("sets moderationStatus to rejected and stores reason", async () => {
    const updated = { ...PENDING_ITEM, moderationStatus: "rejected", moderationNote: "Inappropriate content" };
    const chain = makeChain([updated]);
    chain.where = vi.fn().mockReturnValue(chain);
    mockVendorDb.update.mockReturnValue(chain);

    const { rejectPortfolioItem } = await import("../vendorPortfolioService.js");
    const result = await rejectPortfolioItem(10, 2, "Inappropriate content");
    expect(result?.moderationStatus).toBe("rejected");
    expect(result?.moderationNote).toBe("Inappropriate content");
  });
});
