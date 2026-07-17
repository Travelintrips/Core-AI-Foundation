/**
 * CompareDrawer — side-by-side portfolio comparison panel.
 * Mobile: stacked cards. Desktop: two-column grid.
 * Max 4 portfolios. Uses useComparePortfolios mutation.
 */
import { useState } from 'react';
import { X, Plus, Scale, Star, Clock, Zap, Package, Wrench } from 'lucide-react';
import type { PublicPortfolioCard, CompareItem } from '@/hooks/use-gallery-v2';
import { useComparePortfolios } from '@/hooks/use-gallery-v2';

interface Props {
  /** Preloaded portfolios to compare (up to 4) */
  initialPortfolios?: PublicPortfolioCard[];
  onClose?: () => void;
}

function CompareCard({ item }: { item: CompareItem }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {item.coverImage && (
        <img src={item.coverImage} alt={item.title} className="w-full aspect-video object-cover" />
      )}
      <div className="p-4 space-y-3">
        <p className="font-semibold text-sm">{item.title}</p>
        <div className="space-y-2 text-xs">
          {item.rating && (
            <div className="flex items-center gap-2">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
              <span className="text-muted-foreground">Rating</span>
              <span className="ml-auto font-medium">{item.rating}</span>
            </div>
          )}
          {item.deliveryTime && (
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Durasi</span>
              <span className="ml-auto font-medium">{item.deliveryTime}</span>
            </div>
          )}
          {item.deliveryDays && (
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Hari</span>
              <span className="ml-auto font-medium">{item.deliveryDays} hari</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Deliverables</span>
            <span className="ml-auto font-medium">{item.deliverablesCount} item</span>
          </div>
          <div className="flex items-center gap-2">
            <Wrench className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Tools</span>
            <span className="ml-auto font-medium">{item.toolsCount} tools</span>
          </div>
          {item.completedProjects > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Proyek selesai</span>
              <span className="ml-auto font-medium">{item.completedProjects}</span>
            </div>
          )}
        </div>

        {/* Deliverables list */}
        {item.deliverablesJson && item.deliverablesJson.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5">Deliverable</p>
            <div className="flex flex-wrap gap-1">
              {item.deliverablesJson.map((d, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded-md bg-muted text-xs">{d}</span>
              ))}
            </div>
          </div>
        )}

        {/* Tools list */}
        {item.toolsUsedJson && item.toolsUsedJson.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5">Tools</p>
            <div className="flex flex-wrap gap-1">
              {item.toolsUsedJson.map((t, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded-md bg-muted text-xs">{t}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function CompareDrawer({ initialPortfolios = [], onClose }: Props) {
  const [selected, setSelected] = useState<PublicPortfolioCard[]>(initialPortfolios.slice(0, 4));
  const compare = useComparePortfolios();

  function remove(id: number) {
    setSelected((prev) => prev.filter((p) => p.id !== id));
    compare.reset();
  }

  async function runCompare() {
    if (selected.length < 2) return;
    await compare.mutateAsync(selected.map((p) => p.id));
  }

  const result = compare.data;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col" onClick={onClose}>
      <div
        className="mt-auto bg-background rounded-t-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <span className="font-semibold">Bandingkan Portfolio</span>
            <span className="text-xs text-muted-foreground">({selected.length}/4 dipilih)</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted border border-border text-xs font-medium max-w-[160px]">
                  <span className="truncate">{p.title}</span>
                  <button onClick={() => remove(p.id)} className="shrink-0 hover:text-destructive"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}

          {/* CTA */}
          {selected.length >= 2 && !result && (
            <button
              onClick={runCompare}
              disabled={compare.isPending}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {compare.isPending ? 'Membandingkan…' : `Bandingkan ${selected.length} Portfolio`}
            </button>
          )}

          {selected.length < 2 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Pilih minimal 2 portfolio untuk dibandingkan.
            </p>
          )}

          {/* Results */}
          {result && (
            <>
              <button onClick={compare.reset} className="text-xs text-muted-foreground underline">Reset perbandingan</button>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {result.items.map((item) => <CompareCard key={item.id} item={item} />)}
              </div>
            </>
          )}

          {compare.isError && (
            <p className="text-sm text-destructive text-center">{(compare.error as Error)?.message ?? 'Terjadi kesalahan'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
