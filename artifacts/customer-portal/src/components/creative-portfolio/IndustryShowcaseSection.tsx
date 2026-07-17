/**
 * IndustryShowcaseSection — horizontal scrolling industry cards with deep-dive.
 */
import { useState } from 'react';
import { Building2, ChevronRight, Star } from 'lucide-react';
import type { IndustrySummary, IndustryDeepDive, PublicPortfolioCard } from '@/hooks/use-gallery-v2';
import { useIndustryDeepDive } from '@/hooks/use-gallery-v2';
import { PortfolioCard } from './PortfolioCard';
import { PortfolioDetailModal } from './PortfolioDetailModal';

interface IndustryCardProps {
  item: IndustrySummary;
  selected: boolean;
  onClick: () => void;
}

function IndustryChip({ item, selected, onClick }: IndustryCardProps) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all ${
        selected
          ? 'border-primary bg-primary text-primary-foreground shadow-md'
          : 'border-border bg-card hover:border-primary/50 text-foreground'
      }`}
    >
      <Building2 className="w-3.5 h-3.5 shrink-0" />
      <span className="font-medium">{item.label}</span>
      <span className={`text-xs ${selected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
        {item.totalPortfolios}
      </span>
    </button>
  );
}

function DeepDivePanel({ industry, token, favoriteIds = [] }: { industry: string; token?: string; favoriteIds?: number[] }) {
  const { data, isLoading, isError } = useIndustryDeepDive(industry);
  const [active, setActive] = useState<PublicPortfolioCard | null>(null);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card animate-pulse aspect-[4/3]" />
        ))}
      </div>
    );
  }

  if (isError || !data) return null;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{data.label}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span>{data.totalPortfolios} portfolio</span>
            {data.topRating && (
              <span className="inline-flex items-center gap-1">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                Avg {data.topRating}
              </span>
            )}
            {data.styles.length > 0 && (
              <span>Style: {data.styles.slice(0, 3).join(', ')}{data.styles.length > 3 ? '…' : ''}</span>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {data.featured.map((p) => (
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
          source="industry-showcase"
        />
      )}
    </>
  );
}

interface Props {
  industries: IndustrySummary[];
  token?: string;
  favoriteIds?: number[];
}

export function IndustryShowcaseSection({ industries, token, favoriteIds = [] }: Props) {
  const [selected, setSelected] = useState<string | null>(industries[0]?.industry ?? null);

  if (industries.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2">
        <Building2 className="w-5 h-5 text-primary" />
        <h2 className="font-semibold text-lg">Portfolio by Industri</h2>
      </div>

      {/* Horizontal scrolling chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
        {industries.map((item) => (
          <IndustryChip
            key={item.industry}
            item={item}
            selected={selected === item.industry}
            onClick={() => setSelected(item.industry)}
          />
        ))}
      </div>

      {/* Deep dive panel */}
      {selected && (
        <DeepDivePanel industry={selected} token={token} favoriteIds={favoriteIds} />
      )}
    </section>
  );
}
