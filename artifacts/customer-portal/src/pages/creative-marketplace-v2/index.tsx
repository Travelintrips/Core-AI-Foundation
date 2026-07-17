/**
 * Creative Marketplace V2 — Browse page (customer portal)
 * Route: /creative-marketplace-v2
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Search, Filter, Star, Download, Heart, ShoppingBag,
  CheckCircle, ChevronDown, X, SlidersHorizontal,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Listing {
  id: number; listingCode: string; itemType: string; title: string;
  description: string | null; category: string; tags: string[];
  priceType: "free" | "premium"; priceAmount: string; currency: string;
  licenseType: string; licenseSummary: string; previewUrls: string[];
  thumbnailUrl: string | null; fileFormat: string | null;
  isFeatured: boolean; downloadsCount: number; favoritesCount: number;
  avgRating: string; ratingsCount: number;
  creator: { creatorCode: string; displayName: string; isVerified: boolean; avatarUrl: string | null } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ITEM_TYPES = [
  { value: "", label: "All Types" },
  { value: "blueprint", label: "Blueprint" },
  { value: "template", label: "Template" },
  { value: "pattern", label: "Pattern" },
  { value: "icon", label: "Icon" },
  { value: "illustration", label: "Illustration" },
  { value: "layout", label: "Layout" },
  { value: "typography_pairing", label: "Typography Pairing" },
  { value: "palette", label: "Colour Palette" },
  { value: "interior_material", label: "Interior Material" },
  { value: "furniture_reference", label: "Furniture Reference" },
  { value: "fashion_motif", label: "Fashion Motif" },
  { value: "brand_pack", label: "Brand Pack" },
];

const LICENSE_LABELS: Record<string, string> = {
  standard: "Standard", extended: "Extended", exclusive: "Exclusive",
};

const TYPE_ICONS: Record<string, string> = {
  blueprint: "📐", template: "📄", pattern: "🎨", icon: "🔷",
  illustration: "🖼️", layout: "📐", typography_pairing: "🔤",
  palette: "🎨", interior_material: "🏠", furniture_reference: "🪑",
  fashion_motif: "👗", brand_pack: "📦",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRating({ avg, count }: { avg: string; count: number }) {
  const rating = parseFloat(avg);
  return (
    <span className="flex items-center gap-1 text-xs text-amber-400">
      <Star className="w-3 h-3 fill-amber-400" />
      {rating > 0 ? rating.toFixed(1) : "—"}
      {count > 0 && <span className="text-slate-500">({count})</span>}
    </span>
  );
}

function PriceBadge({ priceType, amount, currency }: { priceType: string; amount: string; currency: string }) {
  if (priceType === "free") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">
        FREE
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-900/50 text-indigo-300 border border-indigo-700/40">
      {currency} {Number(amount).toLocaleString("id-ID")}
    </span>
  );
}

function ListingCard({ listing, token }: { listing: Listing; token?: string }) {
  const favPath = token
    ? `/creative-marketplace-v2/listing/${listing.id}?token=${token}`
    : `/creative-marketplace-v2/listing/${listing.id}`;

  return (
    <Link href={favPath}>
      <div className="group relative bg-slate-800/50 border border-white/8 rounded-xl overflow-hidden hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer">
        {/* Thumbnail */}
        <div className="relative h-44 bg-slate-700/50 flex items-center justify-center overflow-hidden">
          {listing.thumbnailUrl ? (
            <img
              src={listing.thumbnailUrl}
              alt={listing.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <span className="text-5xl select-none">{TYPE_ICONS[listing.itemType] ?? "📁"}</span>
          )}
          {listing.isFeatured && (
            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-black">
              FEATURED
            </span>
          )}
          <div className="absolute top-2 right-2">
            <PriceBadge priceType={listing.priceType} amount={listing.priceAmount} currency={listing.currency} />
          </div>
        </div>

        {/* Body */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-sm font-semibold text-white leading-tight line-clamp-2">{listing.title}</p>
          </div>

          <div className="flex items-center gap-1 mb-2">
            <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">
              {ITEM_TYPES.find((t) => t.value === listing.itemType)?.label ?? listing.itemType}
            </span>
            <span className="text-[10px] text-slate-500">·</span>
            <span className="text-[10px] text-slate-500">{LICENSE_LABELS[listing.licenseType] ?? listing.licenseType}</span>
          </div>

          {listing.creator && (
            <div className="flex items-center gap-1 mb-2">
              <span className="text-[11px] text-slate-400">{listing.creator.displayName}</span>
              {listing.creator.isVerified && (
                <CheckCircle className="w-3 h-3 text-indigo-400" />
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-white/6">
            <StarRating avg={listing.avgRating} count={listing.ratingsCount} />
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-0.5">
                <Download className="w-3 h-3" />{listing.downloadsCount}
              </span>
              <span className="flex items-center gap-0.5">
                <Heart className="w-3 h-3" />{listing.favoritesCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CM2BrowsePage({ params }: { params?: { token?: string } }) {
  const token = params?.token;
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("");
  const [priceType, setPriceType] = useState("");
  const [licenseType, setLicenseType] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "popular" | "rating" | "downloads">("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [activeSearch, setActiveSearch] = useState("");

  const params_ = new URLSearchParams();
  if (activeSearch) params_.set("search", activeSearch);
  if (itemType) params_.set("itemType", itemType);
  if (priceType) params_.set("priceType", priceType);
  if (licenseType) params_.set("licenseType", licenseType);
  params_.set("sortBy", sortBy);
  params_.set("limit", "48");

  const { data, isLoading, isError } = useQuery<{ items: Listing[]; total: number }>({
    queryKey: ["cm2-browse", activeSearch, itemType, priceType, licenseType, sortBy],
    queryFn: () => apiFetch(`/public/cm2/listings?${params_.toString()}`),
  });

  const { data: featured } = useQuery<{ items: Listing[] }>({
    queryKey: ["cm2-featured"],
    queryFn: () => apiFetch("/public/cm2/listings/featured"),
    enabled: !activeSearch && !itemType,
  });

  const handleSearch = useCallback(() => setActiveSearch(search), [search]);

  const clearFilter = (setter: (v: string) => void) => () => setter("");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-white/8 bg-slate-900/80 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <ShoppingBag className="w-6 h-6 text-indigo-400" />
            <h1 className="text-xl font-bold text-white">Creative Marketplace</h1>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-700/40">
              V2
            </span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search blueprints, templates, palettes…"
                className="w-full bg-slate-800 border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {search && (
                <button onClick={() => { setSearch(""); setActiveSearch(""); }} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-slate-500" />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Search
            </button>
            <button
              onClick={() => setShowFilters((f) => !f)}
              className={`px-4 py-2.5 border rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                showFilters ? "border-indigo-500 text-indigo-400 bg-indigo-900/20" : "border-white/10 text-slate-400 hover:border-white/20"
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
            </button>
          </div>

          {/* Filters panel */}
          {showFilters && (
            <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t border-white/6">
              {/* Item type */}
              <div className="relative">
                <select
                  value={itemType}
                  onChange={(e) => setItemType(e.target.value)}
                  className="appearance-none bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 pr-7 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {ITEM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Price */}
              <div className="relative">
                <select
                  value={priceType}
                  onChange={(e) => setPriceType(e.target.value)}
                  className="appearance-none bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 pr-7 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">All Prices</option>
                  <option value="free">Free</option>
                  <option value="premium">Premium</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* License */}
              <div className="relative">
                <select
                  value={licenseType}
                  onChange={(e) => setLicenseType(e.target.value)}
                  className="appearance-none bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 pr-7 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">All Licenses</option>
                  <option value="standard">Standard</option>
                  <option value="extended">Extended</option>
                  <option value="exclusive">Exclusive</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Sort */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="appearance-none bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 pr-7 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="newest">Newest</option>
                  <option value="popular">Most Viewed</option>
                  <option value="rating">Top Rated</option>
                  <option value="downloads">Most Downloaded</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Active filter pills */}
              {itemType && (
                <button onClick={clearFilter(setItemType)} className="flex items-center gap-1 px-2 py-1 bg-indigo-900/40 border border-indigo-700/40 rounded-full text-xs text-indigo-300">
                  {ITEM_TYPES.find((t) => t.value === itemType)?.label}
                  <X className="w-3 h-3" />
                </button>
              )}
              {priceType && (
                <button onClick={clearFilter(setPriceType)} className="flex items-center gap-1 px-2 py-1 bg-emerald-900/40 border border-emerald-700/40 rounded-full text-xs text-emerald-300">
                  {priceType} <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Featured section */}
        {!activeSearch && !itemType && featured && featured.items.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              ⭐ Featured
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {featured.items.slice(0, 6).map((l) => (
                <ListingCard key={l.id} listing={l} token={token} />
              ))}
            </div>
          </section>
        )}

        {/* Type quick-filters */}
        {!activeSearch && !itemType && (
          <div className="flex flex-wrap gap-2 mb-8">
            {ITEM_TYPES.slice(1).map((t) => (
              <button
                key={t.value}
                onClick={() => setItemType(t.value)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-white/8 rounded-full text-xs text-slate-300 hover:border-indigo-500/40 hover:text-indigo-300 transition-colors"
              >
                <span>{TYPE_ICONS[t.value]}</span>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {activeSearch ? `Results for "${activeSearch}"` : itemType ? ITEM_TYPES.find((t) => t.value === itemType)?.label : "All Listings"}
          </h2>
          {data && <span className="text-sm text-slate-500">{data.total} items</span>}
        </div>

        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-slate-800/50 rounded-xl h-64 animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-20">
            <Filter className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">Failed to load listings. Please try again.</p>
          </div>
        )}

        {!isLoading && !isError && data && data.items.length === 0 && (
          <div className="text-center py-20">
            <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No listings found for your filters.</p>
            <button
              onClick={() => { setItemType(""); setPriceType(""); setLicenseType(""); setActiveSearch(""); setSearch(""); }}
              className="mt-3 text-sm text-indigo-400 hover:underline"
            >
              Clear all filters
            </button>
          </div>
        )}

        {!isLoading && !isError && data && data.items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {data.items.map((l) => (
              <ListingCard key={l.id} listing={l} token={token} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
