/**
 * BrandDnaRecs — Brand DNA-based portfolio recommendations widget.
 * Shows a "For You" section based on the client's brand profile.
 */
import { useState } from 'react';
import { Sparkles, Brain } from 'lucide-react';
import type { PublicPortfolioCard } from '@/hooks/use-gallery-v2';
import { useBrandDnaRecs } from '@/hooks/use-gallery-v2';
import { PortfolioCard } from './PortfolioCard';
import { PortfolioDetailModal } from './PortfolioDetailModal';

interface Props {
  token: string;
  favoriteIds?: number[];
}

export function BrandDnaRecs({ token, favoriteIds = [] }: Props) {
  const { data, isLoading, isError } = useBrandDnaRecs(token, 6);
  const [active, setActive] = useState<PublicPortfolioCard | null>(null);

  if (isLoading) {
    return (
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary animate-pulse" />
          <h2 className="font-semibold text-lg">Rekomendasi untuk Anda</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card animate-pulse aspect-[4/3]" />
          ))}
        </div>
      </section>
    );
  }

  if (isError || !data || data.items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="w-5 h-5 text-primary" />
        <h2 className="font-semibold text-lg">Rekomendasi untuk Anda</h2>
        {data.basedOnBrandDna && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
            <Sparkles className="w-3 h-3" /> Brand DNA
          </span>
        )}
      </div>

      {data.basedOnBrandDna && data.brandProfile && (
        <p className="text-xs text-muted-foreground">
          Berdasarkan brand profile Anda
          {data.brandProfile.industry ? ` · ${data.brandProfile.industry}` : ''}
          {data.brandProfile.style ? ` · ${data.brandProfile.style}` : ''}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {data.items.map((p) => (
          <PortfolioCard
            key={p.id}
            portfolio={p}
            onClick={() => setActive(p)}
            onCtaClick={() => setActive(p)}
            isFavorited={favoriteIds.includes(p.id)}
            token={token}
            showCta={false}
          />
        ))}
      </div>

      {active && (
        <PortfolioDetailModal
          portfolio={active}
          onClose={() => setActive(null)}
          isFavorited={favoriteIds.includes(active.id)}
          token={token}
          source="brand-dna-recs"
        />
      )}
    </section>
  );
}
