/**
 * SimilarPortfolios — horizontal rail of similar portfolios.
 */
import { useState } from 'react';
import { Layers } from 'lucide-react';
import type { PublicPortfolioCard } from '@/hooks/use-gallery-v2';
import { useSimilarPortfolios } from '@/hooks/use-gallery-v2';
import { PortfolioCard } from './PortfolioCard';
import { PortfolioDetailModal } from './PortfolioDetailModal';

interface Props {
  portfolioId: number;
  token?: string;
  favoriteIds?: number[];
}

export function SimilarPortfolios({ portfolioId, token, favoriteIds = [] }: Props) {
  const { data, isLoading } = useSimilarPortfolios(portfolioId, 6);
  const [active, setActive] = useState<PublicPortfolioCard | null>(null);

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="shrink-0 w-48 rounded-2xl border border-border bg-card animate-pulse aspect-[3/4]" />
        ))}
      </div>
    );
  }

  if (!data?.items?.length) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Portfolio Serupa</h3>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
        {data.items.map((p) => (
          <div key={p.id} className="shrink-0 w-52">
            <PortfolioCard
              portfolio={p}
              onClick={() => setActive(p)}
              onCtaClick={() => setActive(p)}
              isFavorited={favoriteIds.includes(p.id)}
              token={token}
              showCta={false}
            />
          </div>
        ))}
      </div>

      {active && (
        <PortfolioDetailModal
          portfolio={active}
          onClose={() => setActive(null)}
          isFavorited={favoriteIds.includes(active.id)}
          token={token}
          source="similar"
        />
      )}
    </section>
  );
}
