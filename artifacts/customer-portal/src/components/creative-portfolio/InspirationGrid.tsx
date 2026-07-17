/**
 * InspirationGrid — inspiration feed grouped by mood.
 */
import { useState } from 'react';
import type { MoodFeedItem, PublicPortfolioCard, Mood } from '@/hooks/use-gallery-v2';
import { PortfolioCard } from './PortfolioCard';
import { PortfolioDetailModal } from './PortfolioDetailModal';

const MOOD_ORDER: Mood[] = ['minimal', 'luxury', 'bold', 'corporate', 'playful', 'natural'];

interface Props {
  moods: MoodFeedItem[];
  token?: string;
  favoriteIds?: number[];
  onMoodSelect?: (mood: Mood) => void;
}

export function InspirationGrid({ moods, token, favoriteIds = [], onMoodSelect }: Props) {
  const [active, setActive] = useState<PublicPortfolioCard | null>(null);

  if (moods.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p className="text-4xl mb-3">✨</p>
        <p className="text-sm">Belum ada konten inspirasi tersedia.</p>
      </div>
    );
  }

  // Sort moods by the canonical order
  const sorted = [...moods].sort((a, b) => {
    const ia = MOOD_ORDER.indexOf(a.mood as Mood);
    const ib = MOOD_ORDER.indexOf(b.mood as Mood);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return (
    <div className="space-y-10">
      {sorted.map((moodItem) => (
        <section key={moodItem.mood}>
          {/* Section header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <span className="text-xl">{moodItem.emoji}</span>
                {moodItem.label}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">{moodItem.description}</p>
            </div>
            {moodItem.totalAvailable > moodItem.portfolios.length && (
              <button
                onClick={() => onMoodSelect?.(moodItem.mood as Mood)}
                className="text-xs text-primary hover:underline shrink-0"
              >
                Lihat semua ({moodItem.totalAvailable}) →
              </button>
            )}
          </div>

          {/* Portfolio grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {moodItem.portfolios.map((p) => (
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
        </section>
      ))}

      {active && (
        <PortfolioDetailModal
          portfolio={active}
          onClose={() => setActive(null)}
          isFavorited={favoriteIds.includes(active.id)}
          token={token}
          source="inspiration"
        />
      )}
    </div>
  );
}
