/**
 * ComparePage — standalone compare tool page.
 * Route: /portfolio-compare  (registered by Team 24 in App.tsx)
 *
 * Users can paste portfolio IDs (from URL params ?ids=1,2,3) or select
 * manually from a mini gallery search.
 */
import { useState, useEffect } from 'react';
import { Scale, Search, X, ArrowLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import type { PublicPortfolioCard } from '@/hooks/use-gallery-v2';
import { useGalleryV2, useComparePortfolios } from '@/hooks/use-gallery-v2';
import { PortfolioCard, CompareDrawer } from '@/components/creative-portfolio';

export default function ComparePage() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selected, setSelected] = useState<PublicPortfolioCard[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400);
    return () => clearTimeout(t);
  }, [q]);

  // Parse ?ids= from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = params.get('ids');
    if (ids) {
      // Pre-populate IDs as display only — compare drawer handles the fetch
      // (just open the compare drawer with the parsed ids string for now)
      setCompareOpen(true);
    }
  }, []);

  const { data, isLoading } = useGalleryV2({ q: debouncedQ || undefined, pageSize: 12, sort: 'featured' });
  const items = data?.items ?? [];

  function toggle(p: PublicPortfolioCard) {
    if (selected.find((s) => s.id === p.id)) {
      setSelected((prev) => prev.filter((s) => s.id !== p.id));
    } else if (selected.length < 4) {
      setSelected((prev) => [...prev, p]);
    }
  }

  const isSelected = (id: number) => Boolean(selected.find((s) => s.id === id));

  return (
    <div className="min-h-screen" style={{ background: '#060B18' }}>
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/portfolio-v2')} className="p-2 rounded-xl hover:bg-muted text-muted-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Scale className="w-6 h-6 text-primary" /> Bandingkan Portfolio
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Pilih 2–4 portfolio untuk dibandingkan secara detail.</p>
          </div>
        </div>

        {/* Selected tray */}
        {selected.length > 0 && (
          <div className="p-4 rounded-2xl border border-primary/20 bg-primary/5 space-y-3">
            <p className="text-sm font-medium text-primary">{selected.length} portfolio dipilih (maks. 4)</p>
            <div className="flex flex-wrap gap-2">
              {selected.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border text-xs font-medium max-w-[200px]">
                  <span className="truncate">{p.title}</span>
                  <button onClick={() => toggle(p)} className="shrink-0 hover:text-destructive"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            {selected.length >= 2 && (
              <button
                onClick={() => setCompareOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Bandingkan Sekarang →
              </button>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari portfolio untuk dibandingkan…"
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card animate-pulse aspect-[4/3]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {items.map((p) => (
              <div
                key={p.id}
                onClick={() => toggle(p)}
                className={`cursor-pointer transition-all ${isSelected(p.id) ? 'ring-2 ring-primary rounded-2xl' : ''} ${selected.length >= 4 && !isSelected(p.id) ? 'opacity-40 pointer-events-none' : ''}`}
              >
                <PortfolioCard
                  portfolio={p}
                  showCta={false}
                />
                {isSelected(p.id) && (
                  <div className="mt-1 text-center text-xs text-primary font-medium">✓ Dipilih</div>
                )}
              </div>
            ))}
          </div>
        )}

        {items.length === 0 && !isLoading && (
          <p className="text-center text-sm text-muted-foreground py-12">Tidak ada hasil ditemukan.</p>
        )}
      </div>

      {compareOpen && (
        <CompareDrawer
          initialPortfolios={selected}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  );
}
