/**
 * SearchFilterBar — enhanced search bar with sort and filter pills.
 * Supports: q, industry, style, sort (featured/popular/latest/rating/fastest),
 * colorTag, packageLevel, hasBeforeAfter.
 */
import { useState } from 'react';
import { Search, SlidersHorizontal, X, ChevronDown, TrendingUp, Sparkles, Clock, Star, Zap } from 'lucide-react';
import type { SortOption, GalleryV2Params } from '@/hooks/use-gallery-v2';

const INDUSTRY_LABELS: Record<string, string> = {
  coffee: 'Coffee Shop', restaurant: 'Restaurant', hotel: 'Hotel',
  manufacturing: 'Manufacturing', mining: 'Mining', trading: 'Trading',
  logistics: 'Logistics', construction: 'Construction', medical: 'Medical',
  education: 'Education', retail: 'Retail', fashion: 'Fashion',
  technology: 'Technology', government: 'Government', other: 'Other',
};

const STYLE_OPTIONS = [
  'Minimalist', 'Luxury', 'Modern', 'Corporate', 'Elegant',
  'Creative', 'Premium', 'Industrial', 'Classic', 'Bold', 'Natural', 'Playful',
];

const PACKAGE_LEVELS = ['starter', 'standard', 'professional', 'enterprise'];

const SORT_CONFIG: { value: SortOption; label: string; icon: React.ReactNode }[] = [
  { value: 'featured',  label: 'Featured',   icon: <Sparkles className="w-3 h-3" /> },
  { value: 'popular',   label: 'Popular',    icon: <TrendingUp className="w-3 h-3" /> },
  { value: 'latest',    label: 'Terbaru',    icon: <Clock className="w-3 h-3" /> },
  { value: 'rating',    label: 'Rating',     icon: <Star className="w-3 h-3" /> },
  { value: 'fastest',   label: 'Tercepat',   icon: <Zap className="w-3 h-3" /> },
];

interface Props {
  params: GalleryV2Params;
  industries?: string[];
  onChange: (p: GalleryV2Params) => void;
}

export function SearchFilterBar({ params, industries = [], onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(params.q ?? '');

  const hasFilters = Boolean(params.industry || params.style || params.colorTag || params.packageLevel || params.hasBeforeAfter);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onChange({ ...params, q: draft.trim() || undefined, page: 1 });
  }

  function clearAll() {
    setDraft('');
    onChange({ sort: params.sort ?? 'featured', page: 1 });
  }

  const industryList = industries.length
    ? industries
    : Object.keys(INDUSTRY_LABELS);

  return (
    <div className="space-y-3 mb-6">
      {/* Search input */}
      <form onSubmit={submit} className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Cari portfolio, industri, style…"
          className="w-full pl-10 pr-16 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {draft && (
          <button type="button" onClick={() => { setDraft(''); onChange({ ...params, q: undefined, page: 1 }); }}
            className="absolute right-10 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary font-medium">
          Go
        </button>
      </form>

      {/* Sort + filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sort pills */}
        {SORT_CONFIG.map(({ value, label, icon }) => (
          <button
            key={value}
            onClick={() => onChange({ ...params, sort: value, page: 1 })}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
              (params.sort ?? 'featured') === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:border-primary/50 text-muted-foreground hover:text-foreground'
            }`}
          >
            {icon}{label}
          </button>
        ))}

        {/* Filter toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            open || hasFilters ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filter
          {hasFilters && <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">!</span>}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Active filter badges */}
        {params.industry && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border text-xs">
            {INDUSTRY_LABELS[params.industry] ?? params.industry}
            <button onClick={() => onChange({ ...params, industry: undefined, page: 1 })} className="hover:text-destructive"><X className="w-3 h-3" /></button>
          </span>
        )}
        {params.style && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border text-xs">
            {params.style}
            <button onClick={() => onChange({ ...params, style: undefined, page: 1 })} className="hover:text-destructive"><X className="w-3 h-3" /></button>
          </span>
        )}
        {params.hasBeforeAfter && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border text-xs">
            Before/After only
            <button onClick={() => onChange({ ...params, hasBeforeAfter: false, page: 1 })} className="hover:text-destructive"><X className="w-3 h-3" /></button>
          </span>
        )}
        {hasFilters && (
          <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline">
            Clear all
          </button>
        )}
      </div>

      {/* Expanded filter panel */}
      {open && (
        <div className="p-4 rounded-2xl border border-border bg-card space-y-4">
          {/* Industry */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Industri</p>
            <div className="flex flex-wrap gap-1.5">
              {industryList.map((ind) => (
                <button key={ind}
                  onClick={() => onChange({ ...params, industry: params.industry === ind ? undefined : ind, page: 1 })}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${params.industry === ind ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40 text-muted-foreground'}`}>
                  {INDUSTRY_LABELS[ind] ?? ind}
                </button>
              ))}
            </div>
          </div>

          {/* Style */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Style</p>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_OPTIONS.map((s) => (
                <button key={s}
                  onClick={() => onChange({ ...params, style: params.style === s ? undefined : s, page: 1 })}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${params.style === s ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40 text-muted-foreground'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Package level */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Paket</p>
            <div className="flex flex-wrap gap-1.5">
              {PACKAGE_LEVELS.map((p) => (
                <button key={p}
                  onClick={() => onChange({ ...params, packageLevel: params.packageLevel === p ? undefined : p, page: 1 })}
                  className={`px-2.5 py-1 rounded-full border text-xs capitalize transition-colors ${params.packageLevel === p ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40 text-muted-foreground'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Before/After toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(params.hasBeforeAfter)}
              onChange={(e) => onChange({ ...params, hasBeforeAfter: e.target.checked, page: 1 })}
              className="rounded border-border"
            />
            <span className="text-xs text-foreground">Hanya portfolio dengan Before/After</span>
          </label>
        </div>
      )}
    </div>
  );
}
