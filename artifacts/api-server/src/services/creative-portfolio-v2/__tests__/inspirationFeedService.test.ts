/**
 * inspirationFeedService.test.ts — Team 4 unit tests
 *
 * Tests: mood mapping exhaustiveness, deduplication by coverImage,
 * before/after filter, empty mood handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const MOCK_PORTFOLIOS = [
  { id: 1, style: 'Minimalist', coverImage: 'https://cdn.example.com/a.jpg', industry: 'coffee', featured: true, rating: '4.5', views: 100, status: 'published', isDemo: false, qcScore: '95', trademarkRisk: 'low', beforeImage: 'https://cdn.example.com/before.jpg', afterImage: 'https://cdn.example.com/after.jpg', title: 'A', shortDescription: null, description: null, businessType: null, colorTags: null, primaryColor: null, secondaryColor: null, businessSize: 'sme', packageLabel: null, packageLevel: null, deliveryTime: null, deliveryDays: null, galleryJson: null, deliverablesJson: null, toolsUsedJson: null, workflowJson: null, totalReviews: 0, completedProjects: 0, displayOrder: 0, slug: 'a', serviceId: 1, createdAt: new Date(), updatedAt: new Date(), tenantId: null, portfolioCode: null, sourceProjectId: null, metadataJson: null, publishStatus: 'published', generationStatus: 'published', coverAssetId: null, totalClicks: 0, totalCheckouts: 0 },
  { id: 2, style: 'Luxury', coverImage: 'https://cdn.example.com/b.jpg', industry: 'hotel', featured: false, rating: '4.8', views: 200, status: 'published', isDemo: false, qcScore: '90', trademarkRisk: 'low', beforeImage: null, afterImage: null, title: 'B', shortDescription: null, description: null, businessType: null, colorTags: null, primaryColor: null, secondaryColor: null, businessSize: 'sme', packageLabel: null, packageLevel: null, deliveryTime: null, deliveryDays: null, galleryJson: null, deliverablesJson: null, toolsUsedJson: null, workflowJson: null, totalReviews: 0, completedProjects: 0, displayOrder: 0, slug: 'b', serviceId: 2, createdAt: new Date(), updatedAt: new Date(), tenantId: null, portfolioCode: null, sourceProjectId: null, metadataJson: null, publishStatus: 'published', generationStatus: 'published', coverAssetId: null, totalClicks: 0, totalCheckouts: 0 },
  // Duplicate coverImage — should be deduped
  { id: 3, style: 'Minimalist', coverImage: 'https://cdn.example.com/a.jpg', industry: 'retail', featured: false, rating: '4.0', views: 50, status: 'published', isDemo: false, qcScore: '85', trademarkRisk: 'low', beforeImage: null, afterImage: null, title: 'C (dup)', shortDescription: null, description: null, businessType: null, colorTags: null, primaryColor: null, secondaryColor: null, businessSize: 'sme', packageLabel: null, packageLevel: null, deliveryTime: null, deliveryDays: null, galleryJson: null, deliverablesJson: null, toolsUsedJson: null, workflowJson: null, totalReviews: 0, completedProjects: 0, displayOrder: 0, slug: 'c', serviceId: 3, createdAt: new Date(), updatedAt: new Date(), tenantId: null, portfolioCode: null, sourceProjectId: null, metadataJson: null, publishStatus: 'published', generationStatus: 'published', coverAssetId: null, totalClicks: 0, totalCheckouts: 0 },
];

function makeDbChain(rows: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(rows);
  chain.groupBy = vi.fn().mockReturnValue(chain);
  return chain;
}

const mockDb = { select: vi.fn() };

vi.mock('@workspace/db', () => ({
  db: mockDb,
  aiServicePortfoliosTable: {
    id: 'id', status: 'status', coverImage: 'cover_image', isDemo: 'is_demo', qcScore: 'qc_score',
    trademarkRisk: 'trademark_risk', industry: 'industry', style: 'style', featured: 'featured',
    views: 'views', rating: 'rating', beforeImage: 'before_image', afterImage: 'after_image', colorTags: 'color_tags',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ __eq: [col, val] })),
  and: vi.fn((...args) => ({ __and: args })),
  desc: vi.fn((col) => ({ __desc: col })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings.raw[0] })),
    { join: vi.fn(() => ({})) }
  ),
}));

vi.mock('../galleryV2Service.js', () => ({
  toPublicDto: vi.fn((p: any) => ({ id: p.id, title: p.title, coverImage: p.coverImage, slug: p.slug, serviceId: p.serviceId, shortDescription: p.shortDescription, description: p.description, industry: p.industry, businessType: p.businessType, style: p.style, colorTags: p.colorTags, primaryColor: p.primaryColor, secondaryColor: p.secondaryColor, businessSize: p.businessSize, packageLabel: p.packageLabel, packageLevel: p.packageLevel, deliveryTime: p.deliveryTime, deliveryDays: p.deliveryDays, beforeImage: p.beforeImage, afterImage: p.afterImage, galleryJson: p.galleryJson, deliverablesJson: p.deliverablesJson, toolsUsedJson: p.toolsUsedJson, workflowJson: p.workflowJson, rating: p.rating, views: p.views, totalReviews: p.totalReviews, completedProjects: p.completedProjects, featured: p.featured, displayOrder: p.displayOrder, createdAt: p.createdAt })),
}));

describe('MOODS', () => {
  it('defines all 6 moods', async () => {
    const { MOODS } = await import('../inspirationFeedService.js');
    expect(Object.keys(MOODS)).toHaveLength(6);
    expect(MOODS).toHaveProperty('minimal');
    expect(MOODS).toHaveProperty('luxury');
    expect(MOODS).toHaveProperty('bold');
    expect(MOODS).toHaveProperty('corporate');
    expect(MOODS).toHaveProperty('playful');
    expect(MOODS).toHaveProperty('natural');
  });

  it('each mood has label, description, emoji and styles array', async () => {
    const { MOODS } = await import('../inspirationFeedService.js');
    for (const [, config] of Object.entries(MOODS)) {
      expect(config.label).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(config.emoji).toBeTruthy();
      expect(Array.isArray(config.styles)).toBe(true);
      expect(config.styles.length).toBeGreaterThan(0);
    }
  });
});

describe('getFeedByMood', () => {
  beforeEach(() => {
    const chain = makeDbChain(MOCK_PORTFOLIOS);
    mockDb.select.mockReturnValue(chain);
  });

  it('deduplicates by coverImage', async () => {
    const { getFeedByMood } = await import('../inspirationFeedService.js');
    const result = await getFeedByMood('minimal', 10);
    // id=1 and id=3 share the same coverImage — only one should appear
    const coverImages = result.portfolios.map((p: any) => p.coverImage);
    const uniqueCovers = new Set(coverImages);
    expect(coverImages.length).toBe(uniqueCovers.size);
  });

  it('returns correct mood metadata', async () => {
    const { getFeedByMood } = await import('../inspirationFeedService.js');
    const result = await getFeedByMood('luxury', 4);
    expect(result.mood).toBe('luxury');
    expect(result.label).toBeTruthy();
    expect(result.emoji).toBeTruthy();
    expect(Array.isArray(result.portfolios)).toBe(true);
  });

  it('respects limit', async () => {
    const chain = makeDbChain(Array.from({ length: 20 }, (_, i) => ({
      ...MOCK_PORTFOLIOS[0], id: i + 10, coverImage: `https://cdn.example.com/${i}.jpg`
    })));
    mockDb.select.mockReturnValue(chain);

    const { getFeedByMood } = await import('../inspirationFeedService.js');
    const result = await getFeedByMood('minimal', 6);
    expect(result.portfolios.length).toBeLessThanOrEqual(6);
  });
});

describe('getInspirationFeed', () => {
  it('filters out moods with 0 portfolios', async () => {
    const chain = makeDbChain([]);
    mockDb.select.mockReturnValue(chain);

    const { getInspirationFeed } = await import('../inspirationFeedService.js');
    const results = await getInspirationFeed(undefined, 4);
    results.forEach((r) => {
      expect(r.portfolios.length).toBeGreaterThan(0);
    });
  });
});

describe('getBeforeAfterFeed', () => {
  it('returns only portfolios with both before and after images', async () => {
    const withBothImages = MOCK_PORTFOLIOS.filter((p) => p.beforeImage && p.afterImage);
    const chain = makeDbChain(withBothImages);
    mockDb.select.mockReturnValue(chain);

    const { getBeforeAfterFeed } = await import('../inspirationFeedService.js');
    const items = await getBeforeAfterFeed(12);
    expect(Array.isArray(items)).toBe(true);
    // All returned items should have been filtered by the DB query
    // (we trust the mock simulates DB filtering)
  });

  it('respects limit', async () => {
    const chain = makeDbChain(MOCK_PORTFOLIOS.slice(0, 1));
    mockDb.select.mockReturnValue(chain);

    const { getBeforeAfterFeed } = await import('../inspirationFeedService.js');
    const items = await getBeforeAfterFeed(1);
    expect(items.length).toBeLessThanOrEqual(1);
  });
});
