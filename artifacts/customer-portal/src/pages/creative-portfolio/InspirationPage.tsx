/**
 * InspirationPage — curated inspiration feed by mood.
 * Route: /inspiration  (registered by Team 24 in App.tsx)
 */
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Mood } from '@/hooks/use-gallery-v2';
import { useInspirationFeed, useFavoriteIds } from '@/hooks/use-gallery-v2';
import { InspirationGrid } from '@/components/creative-portfolio';
import { SEOMeta } from "@/components/SEOMeta";

function useWorkspaceToken(): string | undefined {
  const parts = window.location.pathname.split('/');
  const wi = parts.indexOf('workspace');
  return wi !== -1 && parts[wi + 1] ? parts[wi + 1] : undefined;
}

const MOOD_EMOJIS: Record<string, string> = {
  minimal: '◻️', luxury: '✨', bold: '⚡', corporate: '🏢', playful: '🎨', natural: '🌿',
};

export default function InspirationPage() {
  const token = useWorkspaceToken();
  const [selectedMood, setSelectedMood] = useState<Mood | undefined>(undefined);

  const { data, isLoading, isError } = useInspirationFeed(undefined, 6);
  const { data: favData } = useFavoriteIds(token);
  const favoriteIds = favData?.ids ?? [];

  return (
    <div className="min-h-screen" style={{ background: '#060B18' }}>
      <SEOMeta
        title="Inspirasi Desain & Kreasi"
        description="Temukan inspirasi desain terkurasi berdasarkan mood — minimal, luxury, bold, corporate, playful, dan natural. Galeri karya creative AI pilihan."
        canonical="/inspiration"
      />
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-10">

        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-primary" />
            Inspiration Feed
          </h1>
          <p className="text-sm text-muted-foreground">
            Temukan inspirasi desain berdasarkan mood & gaya brand Anda.
          </p>
        </div>

        {/* Mood filter pills */}
        {data?.availableMoods && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedMood(undefined)}
              className={`px-4 py-2 rounded-full border text-sm transition-colors ${!selectedMood ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
            >
              Semua
            </button>
            {data.availableMoods.map((m) => (
              <button
                key={m.mood}
                onClick={() => setSelectedMood(m.mood === selectedMood ? undefined : m.mood)}
                className={`px-4 py-2 rounded-full border text-sm transition-colors ${selectedMood === m.mood ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
              >
                {MOOD_EMOJIS[m.mood] ?? '🎨'} {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="h-5 w-40 rounded-lg bg-muted animate-pulse" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="rounded-2xl border border-border bg-card animate-pulse aspect-[4/3]" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="py-12 text-center text-destructive text-sm">
            Gagal memuat inspiration feed. Silakan coba lagi.
          </div>
        )}

        {/* Feed */}
        {data && !isLoading && (
          <InspirationGrid
            moods={selectedMood ? data.moods.filter((m) => m.mood === selectedMood) : data.moods}
            token={token}
            favoriteIds={favoriteIds}
            onMoodSelect={setSelectedMood}
          />
        )}
      </div>
    </div>
  );
}
