/**
 * GalleryV2Page — Team 4 enhanced portfolio gallery.
 * Route: /portfolio-v2  (registered by Team 24 in App.tsx)
 *
 * Features: search, filter, sort, pagination, compare drawer,
 * industry showcase, Brand DNA recs (if workspace token available),
 * before/after feed toggle.
 */
import { useState, useCallback } from 'react';
import { Images, Scale, Columns2 } from 'lucide-react';
import type { GalleryV2Params, PublicPortfolioCard } from '@/hooks/use-gallery-v2';
import {
  useGalleryV2,
  useIndustrySummary,
  useFavoriteIds,
  useBeforeAfterFeed,
} from '@/hooks/use-gallery-v2';
import {
  SearchFilterBar,
  PortfolioCard,
  CompareDrawer,
  PortfolioDetailModal,
  IndustryShowcaseSection,
  BrandDnaRecs,
} from '@/components/creative-portfolio';
import { SEOMeta } from "@/components/SEOMeta";

// Derive token from URL if present (/workspace/:token/portfolio-v2)
function useWorkspaceToken(): string | undefined {
  const parts = window.location.pathname.split('/');
  const wi = parts.indexOf('workspace');
  return wi !== -1 && parts[wi + 1] ? parts[wi + 1] : undefined;
}

// ── Pagination ─────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="px-4 py-2 rounded-xl border border-border text-sm disabled:opacity-40 hover:bg-muted transition-colors">
        ← Prev
      </button>
      <span className="text-sm text-muted-foreground">
        {page} / {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)}
        className="px-4 py-2 rounded-xl border border-border text-sm disabled:opacity-40 hover:bg-muted transition-colors">
        Next →
      </button>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center">
      <Images className="w-10 h-10 mx-auto text-muted-foreground opacity-40 mb-3" />
      <p className="text-sm text-muted-foreground mb-3">Tidak ada portfolio yang cocok dengan filter ini.</p>
      <button onClick={onClear} className="text-sm text-primary hover:underline">Hapus semua filter</button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function GalleryV2Page() {
  const token = useWorkspaceToken();

  const [params, setParams] = useState<GalleryV2Params>({ sort: 'featured', page: 1, pageSize: 24 });
  const [activePortfolio, setActivePortfolio] = useState<PublicPortfolioCard | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareQueue, setCompareQueue] = useState<PublicPortfolioCard[]>([]);
  const [view, setView] = useState<'gallery' | 'before-after'>('gallery');

  const { data, isLoading, isError } = useGalleryV2(params);
  const { data: industriesData } = useIndustrySummary();
  const { data: favoriteData } = useFavoriteIds(token);
  const { data: baData, isLoading: baLoading } = useBeforeAfterFeed(24);

  const favoriteIds = favoriteData?.ids ?? [];
  const industries = industriesData?.items ?? [];

  const handleChange = useCallback((p: GalleryV2Params) => {
    setParams((prev) => ({ ...prev, ...p }));
  }, []);

  function addToCompare(p: PublicPortfolioCard, e: React.MouseEvent) {
    e.stopPropagation();
    if (compareQueue.find((c) => c.id === p.id)) return;
    if (compareQueue.length >= 4) return;
    setCompareQueue((prev) => [...prev, p]);
  }

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const baItems = baData?.items ?? [];

  return (
    <div className="min-h-screen" style={{ background: '#060B18' }}>
      <SEOMeta
        title="Portfolio Karya Terbaik"
        description="Jelajahi portofolio karya creative AI terbaik — filter berdasarkan industri, gaya, dan paket. Bandingkan dan temukan inspirasi untuk proyek Anda."
        canonical="/portfolio-v2"
      />
      <div className="max-w-7xl mx-auto px-4 py-10 space-y-10">

        {/* Page header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Images className="w-8 h-8 text-primary" />
            Portfolio Gallery
          </h1>
          <p className="text-muted-foreground text-sm">
            Jelajahi {pagination?.total ?? '…'} karya nyata dari tim Creative AI Studio.
          </p>
        </div>

        {/* Brand DNA recs (only if logged in workspace) */}
        {token && <BrandDnaRecs token={token} favoriteIds={favoriteIds} />}

        {/* View switcher */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('gallery')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-colors ${view === 'gallery' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
          >
            <Images className="w-4 h-4" /> Gallery
          </button>
          <button
            onClick={() => setView('before-after')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-colors ${view === 'before-after' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
          >
            <Columns2 className="w-4 h-4" /> Before/After
          </button>

          {/* Compare trigger */}
          <button
            onClick={() => setCompareOpen(true)}
            className={`ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-colors ${compareQueue.length > 0 ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
          >
            <Scale className="w-4 h-4" />
            Bandingkan {compareQueue.length > 0 ? `(${compareQueue.length})` : ''}
          </button>
        </div>

        {/* Search + filter */}
        {view === 'gallery' && (
          <SearchFilterBar
            params={params}
            industries={industries.map((i) => i.industry)}
            onChange={handleChange}
          />
        )}

        {/* Before/After view */}
        {view === 'before-after' && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              Portfolio dengan perbandingan sebelum & sesudah pengerjaan.
            </p>
            {baLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-2xl border border-border bg-card animate-pulse aspect-[4/3]" />
                ))}
              </div>
            ) : baItems.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">Belum ada portfolio before/after.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {baItems.map((p) => (
                  <PortfolioCard
                    key={p.id}
                    portfolio={p}
                    onClick={() => setActivePortfolio(p)}
                    onCtaClick={() => setActivePortfolio(p)}
                    isFavorited={favoriteIds.includes(p.id)}
                    token={token}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main gallery */}
        {view === 'gallery' && (
          <>
            {/* Loading skeleton */}
            {isLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-2xl border border-border bg-card animate-pulse aspect-[4/3]" />
                ))}
              </div>
            )}

            {/* Error */}
            {isError && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
                Gagal memuat gallery. Silakan coba lagi.
              </div>
            )}

            {/* Results */}
            {!isLoading && !isError && (
              <>
                {items.length === 0 ? (
                  <EmptyState onClear={() => setParams({ sort: 'featured', page: 1, pageSize: 24 })} />
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground -mt-4">
                      Menampilkan {items.length} dari {pagination?.total ?? 0} portfolio
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                      {items.map((p) => (
                        <div key={p.id} className="relative group/compare">
                          <PortfolioCard
                            portfolio={p}
                            onClick={() => setActivePortfolio(p)}
                            onCtaClick={() => setActivePortfolio(p)}
                            isFavorited={favoriteIds.includes(p.id)}
                            token={token}
                          />
                          {/* Compare add button */}
                          <button
                            onClick={(e) => addToCompare(p, e)}
                            disabled={compareQueue.length >= 4 || Boolean(compareQueue.find((c) => c.id === p.id))}
                            className={`absolute bottom-16 left-3 opacity-0 group-hover/compare:opacity-100 transition-opacity text-[10px] px-2 py-1 rounded-full border ${
                              compareQueue.find((c) => c.id === p.id)
                                ? 'bg-primary/20 border-primary text-primary'
                                : 'bg-black/50 border-white/20 text-white hover:bg-black/70'
                            } disabled:cursor-not-allowed`}
                          >
                            {compareQueue.find((c) => c.id === p.id) ? '✓ Dipilih' : '+ Bandingkan'}
                          </button>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      page={pagination?.page ?? 1}
                      totalPages={pagination?.totalPages ?? 1}
                      onChange={(p) => setParams((prev) => ({ ...prev, page: p }))}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Industry showcase */}
        {view === 'gallery' && industries.length > 0 && !params.q && !params.industry && (
          <IndustryShowcaseSection industries={industries} token={token} favoriteIds={favoriteIds} />
        )}

        {/* Detail modal */}
        {activePortfolio && (
          <PortfolioDetailModal
            portfolio={activePortfolio}
            onClose={() => setActivePortfolio(null)}
            isFavorited={favoriteIds.includes(activePortfolio.id)}
            token={token}
            source="gallery-v2"
          />
        )}

        {/* Compare drawer */}
        {compareOpen && (
          <CompareDrawer
            initialPortfolios={compareQueue}
            onClose={() => setCompareOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
