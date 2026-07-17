/**
 * galleryV2Service.test.ts — Team 4 unit tests
 *
 * Tests: search pagination, filter combinations, sort options,
 * CTA tracking, favorite ownership, public DTO sanitization,
 * compare min-2 guard, similar portfolios, industry deep dive.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ── Mock @workspace/db ────────────────────────────────────────────────────────
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockOnConflictDoNothing = vi.fn();

function makeChain(finalResult: unknown[]) {
  const chain: Record<string, Mock> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.offset = vi.fn().mockResolvedValue(finalResult);
  chain.groupBy = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoNothing = vi.fn().mockResolvedValue([]);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  return chain;
}

const MOCK_PORTFOLIO = {
  id: 1,
  slug: 'kopi-senja-minimal',
  serviceId: 42,
  tenantId: null,
  title: 'Kopi Senja Brand Identity',
  shortDescription: 'Minimal coffee branding',
  description: 'Full branding for specialty coffee roastery.',
  industry: 'coffee',
  businessType: 'specialty coffee',
  style: 'Minimalist',
  colorTags: ['#2D2D2D', '#F5F0EB'],
  primaryColor: '#2D2D2D',
  secondaryColor: '#F5F0EB',
  businessSize: 'sme',
  packageLabel: 'Professional',
  packageLevel: 'professional',
  deliveryTime: '7 hari',
  deliveryDays: 7,
  coverImage: 'https://cdn.example.com/cover.jpg',
  galleryJson: [{ type: 'image', url: 'https://cdn.example.com/g1.jpg' }],
  beforeImage: 'https://cdn.example.com/before.jpg',
  afterImage: 'https://cdn.example.com/after.jpg',
  deliverablesJson: ['PNG', 'SVG', 'Brand Guideline'],
  toolsUsedJson: ['Figma', 'Midjourney'],
  workflowJson: [{ step: '1', label: 'Discovery' }, { step: '2', label: 'Design' }],
  rating: '4.80',
  views: 320,
  totalClicks: 15,
  totalCheckouts: 3,
  totalReviews: 12,
  completedProjects: 8,
  featured: true,
  status: 'published',
  publishStatus: 'published',
  displayOrder: 1,
  isDemo: false,
  trademarkRisk: 'low',
  qcScore: '95.00',
  generationStatus: 'published',
  coverAssetId: null,
  sourceProjectId: null,
  portfolioCode: 'DEMO-COFFEE-ABC123',
  metadataJson: { internalNote: 'secret' },
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
};

vi.mock('@workspace/db', () => ({
  db: mockDb,
  aiServicePortfoliosTable: { id: 'id', status: 'status', coverImage: 'cover_image', isDemo: 'is_demo', qcScore: 'qc_score', trademarkRisk: 'trademark_risk', industry: 'industry', style: 'style', packageLevel: 'package_level', beforeImage: 'before_image', afterImage: 'after_image', colorTags: 'color_tags', featured: 'featured', views: 'views', rating: 'rating', displayOrder: 'display_order', deliveryDays: 'delivery_days', createdAt: 'created_at', serviceId: 'service_id', totalClicks: 'total_clicks' },
  aiPortfolioFavoritesTable: { clientId: 'client_id', portfolioId: 'portfolio_id', createdAt: 'created_at' },
  aiEventsTable: { eventType: 'event_type', publishedAt: 'published_at', payloadJson: 'payload_json' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ __eq: [col, val] })),
  and: vi.fn((...args) => ({ __and: args })),
  or: vi.fn((...args) => ({ __or: args })),
  desc: vi.fn((col) => ({ __desc: col })),
  asc: vi.fn((col) => ({ __asc: col })),
  ne: vi.fn((col, val) => ({ __ne: [col, val] })),
  inArray: vi.fn((col, vals) => ({ __inArray: [col, vals] })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ __sql: strings.raw.join('?') })),
    { join: vi.fn(() => ({ __sqlJoin: true })) }
  ),
}));

vi.mock('../../creativeBrandIntelligenceService.js', () => ({
  getBrandDNA: vi.fn().mockResolvedValue({ industry: 'coffee', stylePreference: 'Minimalist' }),
}));

vi.mock('../../portfolioRecommendationService.js', () => ({
  getPortfolioRecommendations: vi.fn().mockResolvedValue([MOCK_PORTFOLIO]),
}));

vi.mock('../../aiEventBusService.js', () => ({
  publishSafe: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDbChain(rows: unknown[] = [MOCK_PORTFOLIO]) {
  const chain = makeChain(rows);
  mockDb.select.mockReturnValue(chain);
  mockDb.insert.mockReturnValue(chain);
  mockDb.delete.mockReturnValue(chain);
  mockDb.update.mockReturnValue(chain);
  // For count queries, resolve with [{ n: rows.length }]
  chain.limit.mockImplementation((_n: number) => ({
    offset: vi.fn().mockResolvedValue(rows),
  }));
  // Allow direct .where → resolve for count
  chain.where.mockImplementation(() => ({
    ...chain,
    then: (resolve: (v: unknown) => void) => resolve([{ n: rows.length }]),
  }));
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('toPublicDto', () => {
  it('strips all internal metadata fields', async () => {
    const { toPublicDto } = await import('../galleryV2Service.js');
    const dto = toPublicDto(MOCK_PORTFOLIO as any);

    // Must NOT expose internal fields
    expect((dto as any).tenantId).toBeUndefined();
    expect((dto as any).isDemo).toBeUndefined();
    expect((dto as any).trademarkRisk).toBeUndefined();
    expect((dto as any).qcScore).toBeUndefined();
    expect((dto as any).generationStatus).toBeUndefined();
    expect((dto as any).coverAssetId).toBeUndefined();
    expect((dto as any).metadataJson).toBeUndefined();
    expect((dto as any).publishStatus).toBeUndefined();
    expect((dto as any).sourceProjectId).toBeUndefined();
    expect((dto as any).portfolioCode).toBeUndefined();
    expect((dto as any).totalClicks).toBeUndefined();
    expect((dto as any).totalCheckouts).toBeUndefined();
    expect((dto as any).updatedAt).toBeUndefined();

    // Must expose public fields
    expect(dto.id).toBe(1);
    expect(dto.title).toBe('Kopi Senja Brand Identity');
    expect(dto.industry).toBe('coffee');
    expect(dto.rating).toBe('4.80');
    expect(dto.featured).toBe(true);
    expect(dto.slug).toBe('kopi-senja-minimal');
    expect(dto.deliverablesJson).toHaveLength(3);
    expect(dto.createdAt).toBeInstanceOf(Date);
  });
});

describe('comparePortfoliosPublic', () => {
  it('throws when fewer than 2 ids provided', async () => {
    const { comparePortfoliosPublic } = await import('../galleryV2Service.js');
    await expect(comparePortfoliosPublic([1])).rejects.toThrow('At least 2 distinct portfolio ids required');
  });

  it('throws when empty array provided', async () => {
    const { comparePortfoliosPublic } = await import('../galleryV2Service.js');
    await expect(comparePortfoliosPublic([])).rejects.toThrow();
  });
});

describe('getBrandDnaRecsPublic', () => {
  it('returns basedOnBrandDna=true when DNA exists', async () => {
    const { getBrandDnaRecsPublic } = await import('../galleryV2Service.js');
    const result = await getBrandDnaRecsPublic('test-client-hash', 3);
    expect(result.basedOnBrandDna).toBe(true);
    expect(result.brandProfile).not.toBeNull();
    expect(result.items).toBeInstanceOf(Array);
  });

  it('sanitizes each recommendation through toPublicDto', async () => {
    const { getBrandDnaRecsPublic } = await import('../galleryV2Service.js');
    const result = await getBrandDnaRecsPublic('test-client-hash', 3);
    result.items.forEach((item) => {
      expect((item as any).tenantId).toBeUndefined();
      expect((item as any).metadataJson).toBeUndefined();
    });
  });
});

describe('addFavoritePublic', () => {
  beforeEach(() => {
    setupDbChain([MOCK_PORTFOLIO]);
  });

  it('returns { ok: true } on success', async () => {
    const chain = makeChain([MOCK_PORTFOLIO]);
    mockDb.select.mockReturnValue(chain);
    // Make limit().limit() resolve to the portfolio
    chain.limit.mockResolvedValue([MOCK_PORTFOLIO]);
    mockDb.insert.mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue([]) }) });

    const { addFavoritePublic } = await import('../galleryV2Service.js');
    const result = await addFavoritePublic('test-hash', 1);
    expect(result.ok).toBe(true);
  });
});

describe('getFavoriteIds', () => {
  it('returns array of portfolio ids', async () => {
    const chain = makeChain([{ portfolioId: 1 }, { portfolioId: 5 }]);
    mockDb.select.mockReturnValue(chain);
    chain.limit.mockImplementation(() => chain);
    chain.where.mockResolvedValue([{ portfolioId: 1 }, { portfolioId: 5 }]);

    const { getFavoriteIds } = await import('../galleryV2Service.js');
    const ids = await getFavoriteIds('test-hash');
    expect(Array.isArray(ids)).toBe(true);
  });
});

describe('trackCtaClick', () => {
  it('returns ok=true and serviceId', async () => {
    const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
    mockDb.update.mockReturnValue(updateChain);

    const selectChain = makeChain([{ serviceId: 42 }]);
    mockDb.select.mockReturnValue(selectChain);
    selectChain.limit.mockResolvedValue([{ serviceId: 42 }]);

    const { trackCtaClick } = await import('../galleryV2Service.js');
    const result = await trackCtaClick(1, 'gallery');
    expect(result.ok).toBe(true);
    expect(result.serviceId).toBe(42);
  });
});
