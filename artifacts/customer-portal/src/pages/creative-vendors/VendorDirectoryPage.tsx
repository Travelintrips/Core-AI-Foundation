/**
 * VendorDirectoryPage — Team 22
 * Route: /vendors  (registered by Team 24 in App.tsx)
 *
 * Features: search, filter by type/province/availability,
 *           sort, pagination, compatibility score preview.
 */
import { useState, useCallback } from 'react';
import { Search, Filter, Star, MapPin, Clock, CheckCircle, X } from 'lucide-react';
import {
import { SEOMeta } from "@/components/SEOMeta";
  useVendors,
  useVendorCategories,
  VENDOR_TYPE_LABELS,
  type VendorType,
  type PublicVendorCard,
  type VendorSearchParams,
} from '@/hooks/use-vendors';

// ── Price formatter ────────────────────────────────────────────────────────────
function formatPrice(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}jt`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}rb`;
  return String(v);
}

// ── Star rating display ───────────────────────────────────────────────────────
function StarRating({ rating, count }: { rating: string; count: number }) {
  const r = parseFloat(rating);
  return (
    <span className="flex items-center gap-1 text-xs text-amber-400">
      <Star className="w-3 h-3 fill-current" />
      <span className="font-semibold">{r.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
    </span>
  );
}

// ── Vendor card ───────────────────────────────────────────────────────────────
function VendorCard({
  vendor,
  onClick,
}: {
  vendor: PublicVendorCard;
  onClick: (v: PublicVendorCard) => void;
}) {
  return (
    <button
      onClick={() => onClick(vendor)}
      className="group text-left rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-lg transition-all duration-200 overflow-hidden w-full"
    >
      {/* Cover / Logo */}
      <div className="relative h-36 bg-muted overflow-hidden">
        {vendor.coverUrl ? (
          <img src={vendor.coverUrl} alt={vendor.displayName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {vendor.logoUrl ? (
              <img src={vendor.logoUrl} alt={vendor.displayName} className="h-16 w-16 object-contain rounded-xl" />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">{vendor.displayName[0]}</span>
              </div>
            )}
          </div>
        )}
        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1">
          {vendor.isVerified && (
            <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-500/90 text-white text-[10px] font-semibold backdrop-blur-sm">
              <CheckCircle className="w-2.5 h-2.5" /> Verified
            </span>
          )}
          {vendor.isFeatured && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/90 text-white text-[10px] font-semibold backdrop-blur-sm">
              Featured
            </span>
          )}
        </div>
        {/* Availability */}
        <div className="absolute top-2 right-2">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm ${vendor.isAvailableNow ? 'bg-emerald-500/90 text-white' : 'bg-muted-foreground/50 text-white'}`}>
            {vendor.isAvailableNow ? 'Tersedia' : 'Tidak Tersedia'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm leading-tight">{vendor.displayName}</p>
            {vendor.brandName && vendor.brandName !== vendor.displayName && (
              <p className="text-xs text-muted-foreground">{vendor.brandName}</p>
            )}
          </div>
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium">
            {VENDOR_TYPE_LABELS[vendor.vendorType as VendorType] ?? vendor.vendorType}
          </span>
        </div>

        {vendor.shortBio && (
          <p className="text-xs text-muted-foreground line-clamp-2">{vendor.shortBio}</p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          {parseFloat(vendor.avgRating) > 0 && (
            <StarRating rating={vendor.avgRating} count={vendor.totalRatings} />
          )}
          {(vendor.city || vendor.province) && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3" />
              {vendor.city ?? vendor.province}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {vendor.leadTimeDays}h
          </span>
        </div>

        {(vendor.minPrice || vendor.maxPrice) && (
          <p className="text-xs text-muted-foreground">
            Mulai{' '}
            <span className="font-semibold text-foreground">
              Rp {formatPrice(vendor.minPrice ?? vendor.maxPrice ?? 0)}
            </span>
          </p>
        )}
      </div>
    </button>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────────
function FilterBar({
  params,
  onChange,
  categories,
}: {
  params: VendorSearchParams;
  onChange: (p: Partial<VendorSearchParams>) => void;
  categories: Array<{ vendorType: string; count: number }>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-3">
      {/* Search + toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari vendor..."
            value={params.q ?? ''}
            onChange={(e) => onChange({ q: e.target.value || undefined, page: 1 })}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm hover:bg-muted transition-colors"
        >
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </div>

      {/* Sort pills */}
      <div className="flex gap-2 flex-wrap">
        {(['featured', 'rating', 'newest', 'lead_time'] as const).map((s) => (
          <button
            key={s}
            onClick={() => onChange({ sort: s, page: 1 })}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
              (params.sort ?? 'featured') === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s === 'featured' ? '⭐ Featured' : s === 'rating' ? '🏆 Rating' : s === 'newest' ? '🆕 Terbaru' : '⚡ Lead Time'}
          </button>
        ))}
      </div>

      {/* Expanded filters */}
      {expanded && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
          {/* Vendor type */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Jenis Vendor</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onChange({ vendorType: undefined, page: 1 })}
                className={`px-3 py-1 rounded-lg text-xs transition-colors ${!params.vendorType ? 'bg-primary text-primary-foreground' : 'bg-background border border-border hover:bg-muted'}`}
              >
                Semua
              </button>
              {categories.map((c) => (
                <button
                  key={c.vendorType}
                  onClick={() => onChange({ vendorType: c.vendorType as VendorType, page: 1 })}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${params.vendorType === c.vendorType ? 'bg-primary text-primary-foreground' : 'bg-background border border-border hover:bg-muted'}`}
                >
                  {VENDOR_TYPE_LABELS[c.vendorType as VendorType] ?? c.vendorType}{' '}
                  <span className="opacity-60">({c.count})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Province + Availability + Verified */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Provinsi</p>
              <input
                type="text"
                placeholder="mis. DKI Jakarta"
                value={params.province ?? ''}
                onChange={(e) => onChange({ province: e.target.value || undefined, page: 1 })}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.isAvailableNow ?? false}
                  onChange={(e) => onChange({ isAvailableNow: e.target.checked || undefined })}
                  className="rounded"
                />
                Tersedia Sekarang
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.isVerified ?? false}
                  onChange={(e) => onChange({ isVerified: e.target.checked || undefined })}
                  className="rounded"
                />
                Vendor Terverifikasi
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────────
function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="px-4 py-2 rounded-xl border border-border text-sm disabled:opacity-40 hover:bg-muted transition-colors">← Prev</button>
      <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="px-4 py-2 rounded-xl border border-border text-sm disabled:opacity-40 hover:bg-muted transition-colors">Next →</button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function VendorDirectoryPage() {
  const [params, setParams] = useState<VendorSearchParams>({ sort: 'featured', page: 1, pageSize: 24 });
  const [selectedVendor, setSelectedVendor] = useState<PublicVendorCard | null>(null);

  const { data, isLoading, isError } = useVendors(params);
  const { data: categories } = useVendorCategories();

  const update = useCallback((p: Partial<VendorSearchParams>) => {
    setParams((prev) => ({ ...prev, ...p }));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SEOMeta
        title="Direktori Vendor Kreatif"
        description="Temukan vendor kreatif terpercaya di Indonesia — fotografer, illustrator, web developer, motion designer, dan profesional kreatif lainnya."
        canonical="/vendors"
      />
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Direktori Vendor Kreatif</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Temukan vendor terpercaya untuk kebutuhan kreatif Anda
          </p>
        </div>

        {/* Filter */}
        <FilterBar params={params} onChange={update} categories={categories ?? []} />

        {/* Results info */}
        {data && (
          <p className="text-sm text-muted-foreground">
            Menampilkan <span className="font-semibold text-foreground">{data.items.length}</span>{' '}
            dari <span className="font-semibold text-foreground">{data.pagination.total}</span> vendor
          </p>
        )}

        {/* Grid */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card h-64 animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-dashed border-destructive/40 p-12 text-center">
            <p className="text-sm text-destructive">Gagal memuat daftar vendor. Coba lagi.</p>
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <p className="text-sm text-muted-foreground mb-2">Tidak ada vendor yang cocok.</p>
            <button onClick={() => setParams({ sort: 'featured', page: 1, pageSize: 24 })} className="text-sm text-primary hover:underline">
              Reset filter
            </button>
          </div>
        )}

        {data && data.items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((v) => (
              <VendorCard key={v.id} vendor={v} onClick={setSelectedVendor} />
            ))}
          </div>
        )}

        {data && (
          <Pagination
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onChange={(p) => update({ page: p })}
          />
        )}
      </div>

      {/* Detail modal placeholder — opened when card clicked */}
      {selectedVendor && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedVendor(null)}
        >
          <div
            className="bg-card rounded-2xl border border-border w-full max-w-lg p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{selectedVendor.displayName}</h2>
              <button onClick={() => setSelectedVendor(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              {VENDOR_TYPE_LABELS[selectedVendor.vendorType as VendorType] ?? selectedVendor.vendorType}
              {selectedVendor.city ? ` · ${selectedVendor.city}` : ''}
            </p>
            {selectedVendor.shortBio && (
              <p className="text-sm">{selectedVendor.shortBio}</p>
            )}
            <div className="flex gap-2 pt-2">
              {selectedVendor.websiteUrl && (
                <a href={selectedVendor.websiteUrl} target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
                  Kunjungi Website
                </a>
              )}
              <button
                onClick={() => setSelectedVendor(null)}
                className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-muted"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
