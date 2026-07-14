/**
 * portfolioGalleryService.test.ts — V4.3 Portfolio Gallery & Live Preview (Team 1)
 *
 * Unit tests for search, industry showcase, compare, favorites, and analytics.
 * @workspace/db and the event bus are mocked; no real DB connection is used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PORTFOLIO_ROWS = [
  {
    id: 1, serviceId: 10, slug: "kopi-senja", title: "Kopi Senja Brand Kit",
    shortDescription: "Minimal coffee brand", description: "Full desc", industry: "food-beverage",
    style: "minimalist", coverImage: "https://cdn.example.com/1.webp", rating: "4.8", views: 120,
    totalClicks: 5, featured: true, packageLabel: "Standard", deliveryTime: "3 hari",
    businessSize: "sme", deliverablesJson: ["logo", "guideline"], toolsUsedJson: ["figma"],
    completedProjects: 3, isDemo: false, trademarkRisk: "low", qcScore: "90", status: "published",
  },
  {
    id: 2, serviceId: 11, slug: "toko-baju", title: "Toko Baju Rebrand",
    shortDescription: "Fashion rebrand", description: "Full desc 2", industry: "fashion",
    style: "bold", coverImage: "https://cdn.example.com/2.webp", rating: "4.5", views: 80,
    totalClicks: 2, featured: false, packageLabel: "Pro", deliveryTime: "5 hari",
    businessSize: "sme", deliverablesJson: ["logo"], toolsUsedJson: ["photoshop"],
    completedProjects: 1, isDemo: false, trademarkRisk: "low", qcScore: "85", status: "published",
  },
];

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.offset = vi.fn().mockResolvedValue(rows);
  // Some call sites `await` right after `.where(...)` or `.orderBy(...)` without `.offset()`
  chain.then = (resolve: (v: unknown) => void) => resolve(rows);
  return chain;
}

let selectRows: unknown[] = PORTFOLIO_ROWS;
let countRows: unknown[] = [{ n: PORTFOLIO_ROWS.length }];

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn((projection?: Record<string, unknown>) => {
        // count(*) queries request a projection with key "n"
        if (projection && "n" in projection) {
          return makeSelectChain(countRows);
        }
        return makeSelectChain(selectRows);
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    },
    aiServicePortfoliosTable: {
      id: "id", serviceId: "service_id", slug: "slug", title: "title",
      shortDescription: "short_description", description: "description", industry: "industry",
      style: "style", coverImage: "cover_image", isDemo: "is_demo", qcScore: "qc_score",
      trademarkRisk: "trademark_risk", status: "status", featured: "featured", views: "views",
      businessType: "business_type", displayOrder: "display_order", createdAt: "created_at",
      rating: "rating",
    },
    aiPortfolioFavoritesTable: {
      id: "id", clientId: "client_id", portfolioId: "portfolio_id", createdAt: "created_at",
    },
    aiEventsTable: {
      id: "id", eventType: "event_type", payloadJson: "payload_json", publishedAt: "published_at",
    },
  };
});

vi.mock("../aiEventBusService.js", () => ({
  publishSafe: vi.fn(),
}));

vi.mock("../creativeBrandIntelligenceService.js", () => ({
  getBrandDNA: vi.fn().mockResolvedValue(null),
}));

vi.mock("../portfolioRecommendationService.js", () => ({
  getPortfolioRecommendations: vi.fn().mockResolvedValue([]),
}));

import {
  searchPortfolios,
  getIndustryShowcase,
  comparePortfolios,
  addFavorite,
  removeFavorite,
  getGalleryAnalytics,
} from "../portfolioGalleryService.js";

describe("portfolioGalleryService", () => {
  beforeEach(() => {
    selectRows = PORTFOLIO_ROWS;
    countRows = [{ n: PORTFOLIO_ROWS.length }];
    vi.clearAllMocks();
  });

  it("searchPortfolios returns mapped gallery cards with pagination", async () => {
    selectRows = PORTFOLIO_ROWS;
    countRows = [{ n: 2 }];
    const result = await searchPortfolios({ q: "coffee" });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: 1, title: "Kopi Senja Brand Kit" });
    expect(result.pagination.total).toBe(2);
  });

  it("getIndustryShowcase groups portfolios by industry", async () => {
    selectRows = PORTFOLIO_ROWS;
    const result = await getIndustryShowcase();
    const industries = result.items.map((i) => i.industry).sort();
    expect(industries).toEqual(["fashion", "food-beverage"]);
    expect(result.items.every((i) => i.totalPortfolios >= 1)).toBe(true);
  });

  it("comparePortfolios rejects fewer than 2 distinct ids", async () => {
    await expect(comparePortfolios([1])).rejects.toThrow(/at least 2/i);
    await expect(comparePortfolios([1, 1])).rejects.toThrow(/at least 2/i);
  });

  it("comparePortfolios returns comparison rows for valid ids", async () => {
    selectRows = PORTFOLIO_ROWS;
    const result = await comparePortfolios([1, 2]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toHaveProperty("deliverables");
  });

  it("addFavorite inserts a favorite row when the portfolio exists", async () => {
    selectRows = [PORTFOLIO_ROWS[0]];
    const result = await addFavorite("client-abc", 1);
    expect(result).toEqual({ ok: true });
  });

  it("addFavorite throws when the portfolio does not exist", async () => {
    selectRows = [];
    await expect(addFavorite("client-abc", 999)).rejects.toThrow(/not found/i);
  });

  it("removeFavorite resolves ok", async () => {
    const result = await removeFavorite("client-abc", 1);
    expect(result).toEqual({ ok: true });
  });

  it("getGalleryAnalytics aggregates counts and top search terms", async () => {
    countRows = [{ n: 3 }];
    selectRows = [
      { payload: { q: "coffee" } },
      { payload: { q: "coffee" } },
      { payload: { q: "fashion" } },
    ];
    const result = await getGalleryAnalytics();
    expect(result).toHaveProperty("totalSearches");
    expect(result).toHaveProperty("topSearchTerms");
    expect(Array.isArray(result.topSearchTerms)).toBe(true);
  });
});
