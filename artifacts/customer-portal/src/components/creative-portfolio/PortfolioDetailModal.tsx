/**
 * PortfolioDetailModal — full portfolio detail overlay with CTA.
 * Shows gallery, before/after slider, deliverables, workflow, reviews, and CTA.
 */
import { X, Star, Clock, Images, ArrowRight } from 'lucide-react';
import type { PublicPortfolioCard } from '@/hooks/use-gallery-v2';
import { BeforeAfterSlider } from './BeforeAfterSlider';
import { FavoriteButton } from './FavoriteButton';
import { useTrackCtaClick } from '@/hooks/use-gallery-v2';
import { useLocation } from 'wouter';

const INDUSTRY_LABELS: Record<string, string> = {
  coffee: 'Coffee Shop', restaurant: 'Restaurant', hotel: 'Hotel',
  manufacturing: 'Manufacturing', mining: 'Mining', trading: 'Trading',
  logistics: 'Logistics', construction: 'Construction', medical: 'Medical',
  education: 'Education', retail: 'Retail', fashion: 'Fashion',
  technology: 'Technology', government: 'Government', other: 'Other',
};

const DELIVERABLE_ICONS: Record<string, string> = {
  PNG: '🖼️', SVG: '✏️', AI: '🎨', PSD: '🖌️', PDF: '📄',
  DOCX: '📝', PPTX: '📊', ZIP: '🗜️',
  'Brand Guideline': '📐', 'Editable Source': '🔓', 'Commercial License': '⚖️',
};

interface Props {
  portfolio: PublicPortfolioCard;
  onClose: () => void;
  isFavorited?: boolean;
  token?: string;
  source?: string;
}

export function PortfolioDetailModal({ portfolio: p, onClose, isFavorited = false, token, source = 'modal' }: Props) {
  const [, navigate] = useLocation();
  const track = useTrackCtaClick();

  async function handleCta(e: React.MouseEvent) {
    e.preventDefault();
    try { await track.mutateAsync({ portfolioId: p.id, source }); } catch { /* ignore */ }
    onClose();
    navigate(`/services/${p.serviceId}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-snug">{p.title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {INDUSTRY_LABELS[p.industry] ?? p.industry}
              {p.style ? ` · ${p.style}` : ''}
              {p.packageLabel ? ` · ${p.packageLabel}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <FavoriteButton portfolioId={p.id} isFavorited={isFavorited} token={token} className="static" />
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Before/After or cover image */}
          {p.beforeImage && p.afterImage ? (
            <BeforeAfterSlider before={p.beforeImage} after={p.afterImage} />
          ) : p.coverImage ? (
            <img src={p.coverImage} alt={p.title} className="w-full rounded-xl object-cover max-h-80" />
          ) : null}

          {/* Gallery grid */}
          {p.galleryJson && p.galleryJson.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Images className="w-4 h-4 text-muted-foreground" /> Gallery
              </p>
              <div className="grid grid-cols-3 gap-2">
                {p.galleryJson.map((g, i) =>
                  g.type === 'image' ? (
                    <img key={i} src={g.url} alt={g.caption ?? ''} className="w-full aspect-square object-cover rounded-lg" />
                  ) : (
                    <a key={i} href={g.url} target="_blank" rel="noreferrer"
                      className="w-full aspect-square rounded-lg border border-border flex items-center justify-center text-xs text-muted-foreground text-center p-2 hover:bg-muted">
                      {g.caption ?? g.type}
                    </a>
                  )
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {(p.shortDescription || p.description) && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {p.shortDescription ?? p.description}
            </p>
          )}

          {/* Deliverables */}
          {p.deliverablesJson && p.deliverablesJson.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Deliverable</p>
              <div className="flex flex-wrap gap-2">
                {p.deliverablesJson.map((d, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs">
                    <span>{DELIVERABLE_ICONS[d] ?? '📦'}</span>{d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Workflow */}
          {p.workflowJson && p.workflowJson.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Proses Pengerjaan</p>
              <div className="flex flex-wrap gap-2">
                {p.workflowJson.map((w, i) => (
                  <span key={i} className="px-3 py-1.5 rounded-full bg-muted text-xs">
                    {i + 1}. {w.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tools */}
          {p.toolsUsedJson && p.toolsUsedJson.length > 0 && (
            <p className="text-xs text-muted-foreground">🔧 {p.toolsUsedJson.join(', ')}</p>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-4">
            {p.rating && (
              <span className="inline-flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{p.rating}
              </span>
            )}
            {p.deliveryTime && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />{p.deliveryTime}
              </span>
            )}
            {p.views > 0 && <span>{p.views} views</span>}
            {p.completedProjects > 0 && <span>{p.completedProjects} selesai</span>}
            {p.totalReviews > 0 && <span>{p.totalReviews} ulasan</span>}
          </div>

          {/* CTA */}
          <button
            onClick={handleCta}
            disabled={track.isPending}
            className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <ArrowRight className="w-5 h-5" />
            Mulai Proyek Serupa
          </button>
        </div>
      </div>
    </div>
  );
}
