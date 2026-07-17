/**
 * use-gallery-v2.ts — Team 4 / creative-portfolio-v2
 * React Query hooks for all /api/public/portfolio-v2/* endpoints.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const b = await res.json(); if (b?.error) msg = String(b.error); } catch { /* */ }
    const e = new Error(msg) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type SortOption = 'featured' | 'popular' | 'latest' | 'rating' | 'fastest';
export type Mood = 'minimal' | 'luxury' | 'bold' | 'corporate' | 'playful' | 'natural';

export interface PublicPortfolioCard {
  id: number;
  slug: string | null;
  serviceId: number;
  title: string;
  shortDescription: string | null;
  description: string | null;
  industry: string;
  businessType: string | null;
  style: string;
  colorTags: string[] | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  businessSize: string | null;
  packageLabel: string | null;
  packageLevel: string | null;
  deliveryTime: string | null;
  deliveryDays: number | null;
  coverImage: string | null;
  galleryJson: Array<{ type: string; url: string; caption?: string }> | null;
  beforeImage: string | null;
  afterImage: string | null;
  deliverablesJson: string[] | null;
  toolsUsedJson: string[] | null;
  workflowJson: Array<{ step: string; label: string }> | null;
  rating: string | null;
  views: number;
  totalReviews: number;
  completedProjects: number;
  featured: boolean;
  displayOrder: number;
  createdAt: string;
}

export interface GallerySearchResult {
  items: PublicPortfolioCard[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  appliedFilters: { q: string | null; industry: string | null; style: string | null; sort: SortOption; colorTag: string | null };
}

export interface IndustrySummary {
  industry: string;
  label: string;
  totalPortfolios: number;
  topViews: number;
}

export interface IndustryDeepDive {
  industry: string;
  label: string;
  totalPortfolios: number;
  featured: PublicPortfolioCard[];
  styles: string[];
  topRating: string | null;
}

export interface MoodFeedItem {
  mood: Mood;
  label: string;
  description: string;
  emoji: string;
  portfolios: PublicPortfolioCard[];
  totalAvailable: number;
}

export interface InspirationFeedResult {
  moods: MoodFeedItem[];
  availableMoods: Array<{ mood: Mood; label: string; description: string; emoji: string; styles: string[] }>;
}

export interface CompareItem extends PublicPortfolioCard {
  deliveryDays: number | null;
  deliverablesCount: number;
  toolsCount: number;
}

export interface BrandDnaRecsResult {
  basedOnBrandDna: boolean;
  brandProfile: { industry: string | null; style: string | null } | null;
  items: PublicPortfolioCard[];
}

export interface FavoritesResult {
  items: PublicPortfolioCard[];
  totalFavorites: number;
}

// ── Gallery Search ─────────────────────────────────────────────────────────────

export interface GalleryV2Params {
  q?: string;
  industry?: string;
  style?: string;
  sort?: SortOption;
  colorTag?: string;
  packageLevel?: string;
  hasBeforeAfter?: boolean;
  page?: number;
  pageSize?: number;
}

export function useGalleryV2(params: GalleryV2Params) {
  const qs = new URLSearchParams();
  if (params.q)            qs.set('q', params.q);
  if (params.industry)     qs.set('industry', params.industry);
  if (params.style)        qs.set('style', params.style);
  if (params.sort)         qs.set('sort', params.sort);
  if (params.colorTag)     qs.set('colorTag', params.colorTag);
  if (params.packageLevel) qs.set('packageLevel', params.packageLevel);
  if (params.hasBeforeAfter) qs.set('hasBeforeAfter', 'true');
  if (params.page)         qs.set('page', String(params.page));
  if (params.pageSize)     qs.set('pageSize', String(params.pageSize));

  return useQuery({
    queryKey: ['gallery-v2', 'search', params],
    queryFn: ({ signal }) => fetchJson<GallerySearchResult>(`/api/public/portfolio-v2/gallery?${qs}`, { signal }),
    staleTime: 30_000,
  });
}

// ── Industries ─────────────────────────────────────────────────────────────────

export function useIndustrySummary() {
  return useQuery({
    queryKey: ['gallery-v2', 'industries'],
    queryFn: ({ signal }) => fetchJson<{ items: IndustrySummary[] }>('/api/public/portfolio-v2/industries', { signal }),
    staleTime: 60_000,
  });
}

export function useIndustryDeepDive(industry: string | undefined) {
  return useQuery({
    enabled: Boolean(industry),
    queryKey: ['gallery-v2', 'industry', industry],
    queryFn: ({ signal }) => fetchJson<IndustryDeepDive>(`/api/public/portfolio-v2/industries/${industry}`, { signal }),
    staleTime: 60_000,
  });
}

// ── Inspiration Feed ───────────────────────────────────────────────────────────

export function useInspirationFeed(moods?: Mood[], perMood?: number) {
  const qs = new URLSearchParams();
  if (moods?.length) qs.set('moods', moods.join(','));
  if (perMood)       qs.set('perMood', String(perMood));

  return useQuery({
    queryKey: ['gallery-v2', 'inspiration', 'feed', moods, perMood],
    queryFn: ({ signal }) => fetchJson<InspirationFeedResult>(`/api/public/portfolio-v2/inspiration/feed?${qs}`, { signal }),
    staleTime: 120_000,
  });
}

export function useMoodFeed(mood: Mood | undefined, limit?: number) {
  return useQuery({
    enabled: Boolean(mood),
    queryKey: ['gallery-v2', 'inspiration', mood, limit],
    queryFn: ({ signal }) => fetchJson<MoodFeedItem>(`/api/public/portfolio-v2/inspiration/${mood}?limit=${limit ?? 8}`, { signal }),
    staleTime: 120_000,
  });
}

// ── Before/After ───────────────────────────────────────────────────────────────

export function useBeforeAfterFeed(limit?: number) {
  return useQuery({
    queryKey: ['gallery-v2', 'before-after', limit],
    queryFn: ({ signal }) => fetchJson<{ items: PublicPortfolioCard[] }>(`/api/public/portfolio-v2/before-after?limit=${limit ?? 12}`, { signal }),
    staleTime: 60_000,
  });
}

// ── Portfolio Detail ───────────────────────────────────────────────────────────

export function usePortfolioDetailV2(idOrSlug: string | undefined) {
  return useQuery({
    enabled: Boolean(idOrSlug),
    queryKey: ['gallery-v2', 'detail', idOrSlug],
    queryFn: ({ signal }) => fetchJson<PublicPortfolioCard>(`/api/public/portfolio-v2/${idOrSlug}`, { signal }),
    staleTime: 60_000,
  });
}

export function useSimilarPortfolios(portfolioId: number | undefined, limit?: number) {
  return useQuery({
    enabled: Boolean(portfolioId),
    queryKey: ['gallery-v2', 'similar', portfolioId, limit],
    queryFn: ({ signal }) => fetchJson<{ items: PublicPortfolioCard[] }>(`/api/public/portfolio-v2/${portfolioId}/similar?limit=${limit ?? 6}`, { signal }),
    staleTime: 60_000,
  });
}

// ── Compare ────────────────────────────────────────────────────────────────────

export function useComparePortfolios() {
  return useMutation({
    mutationFn: (ids: number[]) =>
      fetchJson<{ items: CompareItem[] }>('/api/public/portfolio-v2/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }),
  });
}

// ── CTA ────────────────────────────────────────────────────────────────────────

export function useTrackCtaClick() {
  return useMutation({
    mutationFn: ({ portfolioId, source }: { portfolioId: number; source?: string }) =>
      fetchJson<{ ok: boolean; serviceId: number | null }>(`/api/public/portfolio-v2/${portfolioId}/cta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source ?? 'gallery' }),
      }),
  });
}

// ── Workspace: Recommendations ────────────────────────────────────────────────

export function useBrandDnaRecs(token: string | undefined, limit?: number) {
  return useQuery({
    enabled: Boolean(token),
    queryKey: ['gallery-v2', 'recs', token, limit],
    queryFn: ({ signal }) =>
      fetchJson<BrandDnaRecsResult>(`/api/public/customer/workspace/${token}/portfolio-v2/recommended?limit=${limit ?? 6}`, { signal }),
    staleTime: 60_000,
  });
}

// ── Workspace: Favorites ──────────────────────────────────────────────────────

export function useFavoriteIds(token: string | undefined) {
  return useQuery({
    enabled: Boolean(token),
    queryKey: ['gallery-v2', 'favorite-ids', token],
    queryFn: ({ signal }) =>
      fetchJson<{ ids: number[] }>(`/api/public/customer/workspace/${token}/portfolio-v2/favorite-ids`, { signal }),
    staleTime: 30_000,
  });
}

export function useFavoritesV2(token: string | undefined) {
  return useQuery({
    enabled: Boolean(token),
    queryKey: ['gallery-v2', 'favorites', token],
    queryFn: ({ signal }) =>
      fetchJson<FavoritesResult>(`/api/public/customer/workspace/${token}/portfolio-v2/favorites`, { signal }),
    staleTime: 30_000,
  });
}

export function useToggleFavorite(token: string | undefined) {
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (portfolioId: number) =>
      fetchJson<{ ok: boolean }>(`/api/public/customer/workspace/${token}/portfolio-v2/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery-v2', 'favorites', token] });
      queryClient.invalidateQueries({ queryKey: ['gallery-v2', 'favorite-ids', token] });
    },
  });
  const remove = useMutation({
    mutationFn: (portfolioId: number) =>
      fetchJson<{ ok: boolean }>(`/api/public/customer/workspace/${token}/portfolio-v2/favorites/${portfolioId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery-v2', 'favorites', token] });
      queryClient.invalidateQueries({ queryKey: ['gallery-v2', 'favorite-ids', token] });
    },
  });
  return { add, remove };
}
