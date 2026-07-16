/**
 * PortfolioCard — enhanced gallery card with favorite button + CTA.
 */
import { Star, Clock, ArrowRight, Images } from 'lucide-react';
import type { PublicPortfolioCard } from '@/hooks/use-gallery-v2';
import { FavoriteButton } from './FavoriteButton';

const INDUSTRY_LABELS: Record<string, string> = {
  coffee: 'Coffee Shop', restaurant: 'Restaurant', hotel: 'Hotel',
  manufacturing: 'Manufacturing', mining: 'Mining', trading: 'Trading',
  logistics: 'Logistics', construction: 'Construction', medical: 'Medical',
  education: 'Education', retail: 'Retail', fashion: 'Fashion',
  technology: 'Technology', government: 'Government', other: 'Other',
};

interface Props {
  portfolio: PublicPortfolioCard;
  onClick?: () => void;
  onCtaClick?: () => void;
  isFavorited?: boolean;
  token?: string;
  showCta?: boolean;
}

export function PortfolioCard({ portfolio: p, onClick, onCtaClick, isFavorited = false, token, showCta = true }: Props) {
  return (
    <div
      onClick={onClick}
      className="group rounded-2xl overflow-hidden border border-border bg-card hover:shadow-lg hover:border-primary/20 transition-all cursor-pointer relative"
    >
      {/* Cover image */}
      <div className="aspect-[4/3] bg-muted overflow-hidden relative">
        {p.coverImage ? (
          <img
            src={p.coverImage}
            alt={p.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Images className="w-8 h-8 opacity-30" />
          </div>
        )}

        {/* Overlay badges */}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {p.featured && (
            <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">
              Featured
            </span>
          )}
          {p.beforeImage && p.afterImage && (
            <span className="px-2 py-0.5 rounded-full bg-black/60 text-white text-xs">↔ B/A</span>
          )}
        </div>

        {/* Favorite button */}
        <div className="absolute top-3 right-3">
          <FavoriteButton portfolioId={p.id} isFavorited={isFavorited} token={token} />
        </div>

        {/* Gallery count badge */}
        {p.galleryJson && p.galleryJson.length > 1 && (
          <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs">
            +{p.galleryJson.length} gambar
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="p-4 space-y-2">
        <p className="font-medium text-sm leading-snug line-clamp-2">{p.title}</p>

        {/* Tags */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
            {INDUSTRY_LABELS[p.industry] ?? p.industry}
          </span>
          {p.style && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">{p.style}</span>
          )}
          {p.packageLabel && (
            <span className="px-2 py-0.5 rounded-full border border-border text-xs text-muted-foreground">{p.packageLabel}</span>
          )}
        </div>

        {/* Metrics row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {p.rating && (
            <span className="inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {p.rating}
            </span>
          )}
          {p.deliveryTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {p.deliveryTime}
            </span>
          )}
          {p.completedProjects > 0 && <span>{p.completedProjects} proyek</span>}
        </div>

        {/* Short description */}
        {p.shortDescription && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{p.shortDescription}</p>
        )}

        {/* CTA */}
        {showCta && (
          <button
            onClick={(e) => { e.stopPropagation(); onCtaClick?.(); }}
            className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-primary text-primary text-xs font-medium hover:bg-primary/5 transition-colors"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Mulai Proyek Ini
          </button>
        )}
      </div>
    </div>
  );
}
