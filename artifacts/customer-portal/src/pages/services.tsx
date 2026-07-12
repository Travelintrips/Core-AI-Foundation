import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useCategories, useServices, type CatalogService, type ServiceCategory } from "@/hooks/use-catalog";
import {
  Loader2, ArrowRight, Sparkles, Search, Star, Clock, CheckCircle,
  Paintbrush, Megaphone, DollarSign, BookOpen, Receipt, Users,
  Scale, Truck, Package, TrendingUp, Briefcase, Headphones, BarChart2,
  RotateCcw, Filter, ChevronDown, Zap, Shield, X, Eye, Building2,
  Globe, LayoutGrid,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: string, currency: string) {
  const n = Number(value);
  if (currency === "IDR") return `Rp ${n.toLocaleString("id-ID")}`;
  return `$${n.toLocaleString()}`;
}

/** Deterministic mock rating 3.6–5.0 based on service id */
function mockRating(id: number) {
  return ((((id * 7 + 13) % 15) + 36) / 10).toFixed(1);
}

/** Deterministic completed project count */
function mockCompleted(id: number) {
  return ((id * 11 + 7) % 180) + 42;
}

/** Delivery label normalised to "X days" number */
function deliveryDays(est: string): number {
  const m = est.match(/(\d+)/);
  return m ? parseInt(m[1]) : 7;
}

/** Badge assigned per service */
function serviceBadge(s: CatalogService): { label: string; color: string } | null {
  if (s.serviceFlow === "enterprise") return { label: "Enterprise", color: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30" };
  if (deliveryDays(s.estimatedDelivery) <= 2) return { label: "Fast Delivery", color: "bg-[#22D3EE]/10 text-[#22D3EE] border-[#22D3EE]/30" };
  if (s.id % 4 === 0) return { label: "New", color: "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30" };
  if (s.id % 3 === 0) return { label: "Most Popular", color: "bg-[#7C6EFA]/10 text-[#7C6EFA] border-[#7C6EFA]/30" };
  return null;
}

// ── Category icons map ────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  creative: Paintbrush,
  marketing: Megaphone,
  finance: DollarSign,
  accounting: BookOpen,
  tax: Receipt,
  hr: Users,
  legal: Scale,
  logistics: Truck,
  customs: Package,
  trading: TrendingUp,
  executive: Briefcase,
  "customer service": Headphones,
  "customer_service": Headphones,
  analytics: BarChart2,
  data: BarChart2,
  procurement: Building2,
  default: Sparkles,
};

function getCategoryIcon(cat: ServiceCategory): React.ElementType {
  const key = (cat.code ?? cat.name ?? "").toLowerCase();
  for (const [k, Icon] of Object.entries(CATEGORY_ICONS)) {
    if (key.includes(k)) return Icon;
  }
  return CATEGORY_ICONS.default;
}

// ── Sort options ──────────────────────────────────────────────────────────────

type SortKey = "popular" | "newest" | "fastest" | "price_asc" | "rating";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "popular",  label: "Most Popular" },
  { key: "newest",   label: "Newest" },
  { key: "fastest",  label: "Fastest Delivery" },
  { key: "price_asc",label: "Lowest Price" },
  { key: "rating",   label: "Highest Rating" },
];

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="card-base bg-[#0D1526] border border-[#2E4270] p-6 space-y-4 overflow-hidden rounded-2xl">
      <div className="flex items-start gap-3">
        <div className="skeleton bg-[#131E35] w-11 h-11 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="skeleton bg-[#131E35] h-3 w-1/3 rounded" />
          <div className="skeleton bg-[#131E35] h-4 w-2/3 rounded" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="skeleton bg-[#131E35] h-3 w-full rounded" />
        <div className="skeleton bg-[#131E35] h-3 w-5/6 rounded" />
      </div>
      <div className="flex gap-3 pt-1">
        <div className="skeleton bg-[#131E35] h-3 w-16 rounded" />
        <div className="skeleton bg-[#131E35] h-3 w-16 rounded" />
        <div className="skeleton bg-[#131E35] h-3 w-16 rounded" />
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-[#243352]">
        <div className="skeleton bg-[#131E35] h-4 w-24 rounded" />
        <div className="skeleton bg-[#131E35] h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({ s, onView }: { s: CatalogService; onView: (id: number) => void }) {
  const badge = serviceBadge(s);
  const rating = mockRating(s.id);
  const completed = mockCompleted(s.id);

  return (
    <div className="group relative card-base bg-[#0D1526] border border-[#2E4270] rounded-2xl p-5 flex flex-col gap-4 cursor-pointer
                    hover:border-[#7C6EFA] hover:shadow-[0_8px_32px_rgba(124,110,250,0.18)]
                    hover:-translate-y-1 transition-all duration-200">
      {/* Top row: icon + category + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#7C6EFA]/20 to-[#22D3EE]/10 border border-[#7C6EFA]/20
                          flex items-center justify-center shrink-0
                          group-hover:scale-110 group-hover:from-[#7C6EFA]/30 transition-all duration-200">
            <Sparkles className="w-5 h-5 text-[#7C6EFA]" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[#8B9BC4] uppercase tracking-wider truncate">
              {s.serviceCode}
            </p>
          </div>
        </div>
        {badge && (
          <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.color}`}>
            {badge.label}
          </span>
        )}
      </div>

      {/* Name + description */}
      <div className="flex-1">
        <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-semibold text-base mb-1.5 leading-snug
                       text-[#F0F4FF] group-hover:text-[#7C6EFA] transition-colors">
          {s.serviceName}
        </h3>
        <p className="text-sm text-[#8B9BC4] leading-relaxed line-clamp-2">
          {s.shortDescription}
        </p>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-[#8B9BC4] flex-wrap">
        <span className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 fill-[#F59E0B] text-[#F59E0B]" />
          <span className="font-medium text-[#F0F4FF]">{rating}</span>
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5 text-[#10B981]" />
          {completed} projects
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-[#22D3EE]" />
          {s.estimatedDelivery}
        </span>
        {s.humanReview && (
          <span className="flex items-center gap-1 text-[#7C6EFA]">
            <Shield className="w-3.5 h-3.5" />
            Human Review
          </span>
        )}
      </div>

      {/* Price + CTA */}
      <div className="flex items-center justify-between pt-3 border-t border-[#243352] mt-auto">
        <div>
          <p className="text-[11px] text-[#8B9BC4] mb-0.5">Starting from</p>
          <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-base text-[#F0F4FF]">
            {formatPrice(s.startingPrice, s.currency)}
          </p>
        </div>
        <Link
          href={`/services/${s.id}`}
          onClick={() => onView(s.id)}
          className="btn-primary !py-2 !px-4 !text-xs gap-1.5"
        >
          View Detail
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}

// ── Filter sidebar ────────────────────────────────────────────────────────────

interface Filters {
  maxPrice: number;
  maxDelivery: number;
  humanReview: boolean | null;
  minRating: number;
  flow: string;
}

const DEFAULT_FILTERS: Filters = {
  maxPrice: 999_999_999,
  maxDelivery: 30,
  humanReview: null,
  minRating: 0,
  flow: "",
};

function FilterSidebar({
  filters, onChange, onReset, open, onClose,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v });

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed top-0 left-0 h-full z-40 w-72 bg-[#0D1526] border-r border-[#2E4270] overflow-y-auto
        transition-transform duration-300 ease-out
        ${open ? "translate-x-0" : "-translate-x-full"}
        lg:static lg:translate-x-0 lg:h-auto lg:w-64 lg:border lg:rounded-2xl lg:bg-[#0D1526] lg:shrink-0
      `}>
        <div className="p-5 space-y-6">
          <div className="flex items-center justify-between">
            <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-semibold text-sm text-[#F0F4FF]">Filters</h3>
            <button onClick={onClose} className="lg:hidden text-[#8B9BC4] hover:text-[#F0F4FF]">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Price */}
          <div>
            <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider mb-3">Price</p>
            <div className="space-y-2">
              {[
                { label: "Any price", val: 999_999_999 },
                { label: "Under $500", val: 500 },
                { label: "Under $1,000", val: 1000 },
                { label: "Under $5,000", val: 5000 },
              ].map((o) => (
                <label key={o.val} className="flex items-center gap-2.5 cursor-pointer group">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors
                    ${filters.maxPrice === o.val ? "border-[#7C6EFA] bg-[#7C6EFA]" : "border-[#2E4270] group-hover:border-[#7C6EFA]/60"}`}>
                    {filters.maxPrice === o.val && <div className="w-1.5 h-1.5 rounded-full bg-[#F0F4FF]" />}
                  </div>
                  <span className="text-sm text-[#8B9BC4] group-hover:text-[#F0F4FF] transition-colors">{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Delivery time */}
          <div>
            <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider mb-3">Delivery Time</p>
            <div className="space-y-2">
              {[
                { label: "Any", val: 30 },
                { label: "Same day – 2 days", val: 2 },
                { label: "Up to 5 days", val: 5 },
                { label: "Up to 14 days", val: 14 },
              ].map((o) => (
                <label key={o.val} className="flex items-center gap-2.5 cursor-pointer group" onClick={() => set("maxDelivery", o.val)}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors
                    ${filters.maxDelivery === o.val ? "border-[#7C6EFA] bg-[#7C6EFA]" : "border-[#2E4270] group-hover:border-[#7C6EFA]/60"}`}>
                    {filters.maxDelivery === o.val && <div className="w-1.5 h-1.5 rounded-full bg-[#F0F4FF]" />}
                  </div>
                  <span className="text-sm text-[#8B9BC4] group-hover:text-[#F0F4FF] transition-colors">{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Human review */}
          <div>
            <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider mb-3">Human Review</p>
            <div className="space-y-2">
              {[
                { label: "Any", val: null },
                { label: "Included", val: true },
                { label: "AI Only", val: false },
              ].map((o) => (
                <label key={String(o.val)} className="flex items-center gap-2.5 cursor-pointer group" onClick={() => set("humanReview", o.val)}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors
                    ${filters.humanReview === o.val ? "border-[#7C6EFA] bg-[#7C6EFA]" : "border-[#2E4270] group-hover:border-[#7C6EFA]/60"}`}>
                    {filters.humanReview === o.val && <div className="w-1.5 h-1.5 rounded-full bg-[#F0F4FF]" />}
                  </div>
                  <span className="text-sm text-[#8B9BC4] group-hover:text-[#F0F4FF] transition-colors">{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Minimum rating */}
          <div>
            <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider mb-3">Rating</p>
            <div className="space-y-2">
              {[
                { label: "Any rating", val: 0 },
                { label: "4.0 & above", val: 4.0 },
                { label: "4.5 & above", val: 4.5 },
              ].map((o) => (
                <label key={o.val} className="flex items-center gap-2.5 cursor-pointer group" onClick={() => set("minRating", o.val)}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors
                    ${filters.minRating === o.val ? "border-[#7C6EFA] bg-[#7C6EFA]" : "border-[#2E4270] group-hover:border-[#7C6EFA]/60"}`}>
                    {filters.minRating === o.val && <div className="w-1.5 h-1.5 rounded-full bg-[#F0F4FF]" />}
                  </div>
                  <span className="text-sm text-[#8B9BC4] group-hover:text-[#F0F4FF] transition-colors">{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Commercial / flow */}
          <div>
            <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider mb-3">Commercial Ready</p>
            <div className="space-y-2">
              {[
                { label: "All", val: "" },
                { label: "Fixed Price", val: "fixed_price" },
                { label: "Custom Project", val: "custom_project" },
                { label: "Enterprise", val: "enterprise" },
              ].map((o) => (
                <label key={o.val} className="flex items-center gap-2.5 cursor-pointer group" onClick={() => set("flow", o.val)}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors
                    ${filters.flow === o.val ? "border-[#7C6EFA] bg-[#7C6EFA]" : "border-[#2E4270] group-hover:border-[#7C6EFA]/60"}`}>
                    {filters.flow === o.val && <div className="w-1.5 h-1.5 rounded-full bg-[#F0F4FF]" />}
                  </div>
                  <span className="text-sm text-[#8B9BC4] group-hover:text-[#F0F4FF] transition-colors">{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Reset */}
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#8B9BC4] hover:text-[#F0F4FF] hover:border-[#7C6EFA] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Filters
          </button>
        </div>
      </aside>
    </>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-24 text-center animate-float-up">
      <div className="w-20 h-20 rounded-3xl bg-[#131E35] border border-[#2E4270] flex items-center justify-center mb-6">
        <Search className="w-8 h-8 text-[#8B9BC4]/50" />
      </div>
      <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-semibold text-lg mb-2 text-[#F0F4FF]">No services found</h3>
      <p className="text-[#8B9BC4] text-sm max-w-xs mb-6">
        Try adjusting your search or filters to find the right AI specialist.
      </p>
      <button onClick={onReset} className="btn-ghost !py-2 !px-5 !text-sm border border-[#2E4270] text-[#F0F4FF] hover:bg-[#131E35]">
        <RotateCcw className="w-4 h-4" />
        Clear filters
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const RECENTLY_VIEWED_KEY = "apex_recently_viewed";

export default function ServicesPage() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [sort, setSort] = useState<SortKey>("popular");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [recentlyViewed, setRecentlyViewed] = useState<number[]>([]);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 9;

  const { data: categories = [], isLoading: loadingCategories } = useCategories();
  const { data: allServices = [], isLoading: loadingServices } = useServices(undefined);

  // Load recently viewed from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
      if (raw) setRecentlyViewed(JSON.parse(raw) as number[]);
    } catch { /* ignore */ }
  }, []);

  const trackView = (id: number) => {
    setRecentlyViewed((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 6);
      try { localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Featured: first 4 deterministic picks
  const featured = useMemo(() => {
    if (allServices.length === 0) return [];
    return allServices.filter((_, i) => i % 3 === 0).slice(0, 4);
  }, [allServices]);

  // Apply all filters + sort
  const filtered = useMemo(() => {
    let list = [...allServices];

    // Category
    if (categoryId !== undefined) list = list.filter((s) => s.categoryId === categoryId);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.serviceName.toLowerCase().includes(q) ||
          s.shortDescription.toLowerCase().includes(q) ||
          s.serviceCode.toLowerCase().includes(q),
      );
    }

    // Price (USD comparison; IDR skip for now unless we want full conversion)
    if (filters.maxPrice < 999_999_999) {
      list = list.filter((s) => Number(s.startingPrice) <= filters.maxPrice || s.currency === "IDR");
    }

    // Delivery
    if (filters.maxDelivery < 30) {
      list = list.filter((s) => deliveryDays(s.estimatedDelivery) <= filters.maxDelivery);
    }

    // Human review
    if (filters.humanReview !== null) {
      list = list.filter((s) => s.humanReview === filters.humanReview);
    }

    // Rating
    if (filters.minRating > 0) {
      list = list.filter((s) => Number(mockRating(s.id)) >= filters.minRating);
    }

    // Flow
    if (filters.flow) {
      list = list.filter((s) => s.serviceFlow === filters.flow);
    }

    // Sort
    switch (sort) {
      case "fastest":
        list.sort((a, b) => deliveryDays(a.estimatedDelivery) - deliveryDays(b.estimatedDelivery));
        break;
      case "price_asc":
        list.sort((a, b) => Number(a.startingPrice) - Number(b.startingPrice));
        break;
      case "rating":
        list.sort((a, b) => Number(mockRating(b.id)) - Number(mockRating(a.id)));
        break;
      case "newest":
        list.sort((a, b) => b.id - a.id);
        break;
      default: // popular
        list.sort((a, b) => mockCompleted(b.id) - mockCompleted(a.id));
    }

    return list;
  }, [allServices, categoryId, search, filters, sort]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = page < totalPages;

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, categoryId, sort, filters]);

  const resetAll = () => {
    setSearch("");
    setCategoryId(undefined);
    setSort("popular");
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const recentServices = allServices.filter((s) => recentlyViewed.includes(s.id));
  const recommended = allServices
    .filter((s) => !recentlyViewed.includes(s.id))
    .sort((a, b) => mockCompleted(b.id) - mockCompleted(a.id))
    .slice(0, 4);

  const isLoading = loadingServices;
  const activeSort = SORT_OPTIONS.find((o) => o.key === sort)!;

  return (
    <Layout>
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">
        {/* Flow stepper */}
        <div className="border-b border-[#243352] bg-[#0D1526]/60">
          <div className="container mx-auto px-4 md:px-8 max-w-7xl">
            <FlowStepper currentStep="paket" />
          </div>
        </div>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#060B18] border-b border-[#243352]">
          {/* Ambient glow */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#7C6EFA]/10 rounded-full blur-[80px]" />
            <div className="absolute bottom-0 right-1/4 w-[300px] h-[200px] bg-[#22D3EE]/10 rounded-full blur-[60px]" />
          </div>

          <div className="relative container mx-auto px-4 md:px-8 max-w-5xl py-20 md:py-28 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass border border-[#2E4270] bg-[#0D1526]/50 text-xs font-semibold text-[#7C6EFA] mb-6 animate-float-up">
              <Sparkles className="w-3.5 h-3.5 animate-pulse-ring" />
              AI Service Catalog — {allServices.length > 0 ? `${allServices.length}+ services` : "150+ services"}
            </div>

            <h1 className="font-bold text-4xl md:text-6xl lg:text-7xl mb-5 leading-[1.08] animate-float-up text-[#F0F4FF]"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", animationDelay: "60ms" }}>
              Choose Your{" "}
              <span className="text-gradient-primary">AI Specialist</span>
            </h1>

            <p className="text-base md:text-lg text-[#8B9BC4] max-w-2xl mx-auto mb-10 animate-float-up"
               style={{ animationDelay: "120ms" }}>
              Explore 150+ AI services across Creative, Finance, Legal, Logistics, Procurement,
              Trading, HR, Marketing, Executive and more.
            </p>

            {/* Search bar */}
            <div className="relative max-w-2xl mx-auto animate-float-up" style={{ animationDelay: "180ms" }}>
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8B9BC4] pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search AI service..."
                className="w-full pl-14 pr-5 py-4 rounded-2xl bg-[#131E35] border border-[#2E4270]
                           text-base text-[#F0F4FF] placeholder:text-[#8B9BC4]/60 outline-none transition-all duration-200
                           focus:border-[#7C6EFA] focus:shadow-[0_0_0_3px_rgba(124,110,250,0.15)]"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ── Category filter ────────────────────────────────────────────── */}
        <section className="sticky top-0 z-20 bg-[#060B18]/90 backdrop-blur-md border-b border-[#243352]">
          <div className="container mx-auto px-4 md:px-8 max-w-7xl">
            <div
              ref={categoryScrollRef}
              className="flex items-center gap-2 py-3 overflow-x-auto scrollbar-none"
              style={{ scrollbarWidth: "none" }}
            >
              {/* All button */}
              <button
                onClick={() => setCategoryId(undefined)}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-150 ${
                  categoryId === undefined
                    ? "bg-[#7C6EFA] text-[#F0F4FF] border-transparent shadow-[0_2px_10px_rgba(124,110,250,0.25)]"
                    : "border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/40 hover:text-[#F0F4FF]"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                All Services
              </button>

              {loadingCategories
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton bg-[#131E35] shrink-0 h-9 w-28 rounded-full" />
                  ))
                : categories.map((cat) => {
                    const Icon = getCategoryIcon(cat);
                    const active = categoryId === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setCategoryId(active ? undefined : cat.id)}
                        className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-150 ${
                          active
                            ? "bg-[#7C6EFA] text-[#F0F4FF] border-transparent shadow-[0_2px_10px_rgba(124,110,250,0.25)]"
                            : "border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/40 hover:text-[#F0F4FF]"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {cat.name}
                      </button>
                    );
                  })}
            </div>
          </div>
        </section>

        <div className="container mx-auto px-4 md:px-8 max-w-7xl py-10">

          {/* ── Featured Services ────────────────────────────────────────── */}
          {!search && categoryId === undefined && featured.length > 0 && (
            <section className="mb-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#F59E0B]" />
                  <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-lg text-[#F0F4FF]">Featured Services</h2>
                </div>
                <div className="flex-1 h-px bg-[#243352]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {featured.map((s) => {
                  const badge = serviceBadge(s) ?? { label: "Featured", color: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30" };
                  return (
                    <Link
                      key={s.id}
                      href={`/services/${s.id}`}
                      onClick={() => trackView(s.id)}
                      className="group relative bg-[#0D1526] border border-[#2E4270] rounded-2xl p-5 flex flex-col gap-3
                                 hover:border-[#7C6EFA]/50 hover:shadow-[0_8px_32px_rgba(124,110,250,0.18)]
                                 hover:-translate-y-1 transition-all duration-200"
                    >
                      <div className="flex items-start justify-between">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7C6EFA]/25 to-[#22D3EE]/15
                                        border border-[#7C6EFA]/20 flex items-center justify-center
                                        group-hover:scale-110 transition-transform">
                          <Sparkles className="w-4 h-4 text-[#7C6EFA]" />
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div>
                        <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-semibold text-sm leading-snug mb-1 text-[#F0F4FF] group-hover:text-[#7C6EFA] transition-colors">
                          {s.serviceName}
                        </p>
                        <p className="text-xs text-[#8B9BC4] line-clamp-2">{s.shortDescription}</p>
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="text-xs font-bold text-[#F0F4FF]">{formatPrice(s.startingPrice, s.currency)}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#8B9BC4] group-hover:text-[#7C6EFA] group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Recommended for You ──────────────────────────────────────── */}
          {!search && categoryId === undefined && recommended.length > 0 && (
            <section className="mb-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#22D3EE]" />
                  <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-lg text-[#F0F4FF]">Recommended For You</h2>
                </div>
                <span className="text-[11px] text-[#8B9BC4] bg-[#131E35] border border-[#2E4270] px-2 py-0.5 rounded-full">
                  Based on popularity
                </span>
                <div className="flex-1 h-px bg-[#243352]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {recommended.map((s) => (
                  <Link
                    key={s.id}
                    href={`/services/${s.id}`}
                    onClick={() => trackView(s.id)}
                    className="group bg-[#0D1526] border border-[#2E4270] rounded-2xl p-4 flex flex-col gap-2
                               hover:border-[#22D3EE]/50 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className="flex items-center gap-2">
                      <Star className="w-3.5 h-3.5 fill-[#F59E0B] text-[#F59E0B]" />
                      <span className="text-xs font-semibold text-[#F0F4FF]">{mockRating(s.id)}</span>
                      <span className="text-xs text-[#8B9BC4] ml-auto">{s.estimatedDelivery}</span>
                    </div>
                    <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-sm font-semibold leading-snug text-[#F0F4FF] group-hover:text-[#22D3EE] transition-colors">
                      {s.serviceName}
                    </p>
                    <p className="text-xs text-[#8B9BC4] line-clamp-1">{s.shortDescription}</p>
                    <p className="text-sm font-bold text-[#F0F4FF] mt-auto">{formatPrice(s.startingPrice, s.currency)}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── Recently Viewed ───────────────────────────────────────────── */}
          {recentServices.length > 0 && !search && (
            <section className="mb-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#8B9BC4]" />
                  <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-lg text-[#F0F4FF]">Recently Viewed</h2>
                </div>
                <div className="flex-1 h-px bg-[#243352]" />
                <button
                  onClick={() => {
                    setRecentlyViewed([]);
                    localStorage.removeItem(RECENTLY_VIEWED_KEY);
                  }}
                  className="text-xs text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                {recentServices.map((s) => (
                  <Link
                    key={s.id}
                    href={`/services/${s.id}`}
                    onClick={() => trackView(s.id)}
                    className="group shrink-0 w-52 bg-[#0D1526] border border-[#2E4270] rounded-2xl p-4 flex flex-col gap-2
                               hover:border-[#7C6EFA]/50 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-sm font-semibold leading-snug text-[#F0F4FF] group-hover:text-[#7C6EFA] transition-colors line-clamp-2">
                      {s.serviceName}
                    </p>
                    <p className="text-xs text-[#8B9BC4] mt-auto">{formatPrice(s.startingPrice, s.currency)}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── Main grid: sidebar + cards ───────────────────────────────── */}
          <div className="flex gap-8 items-start">
            {/* Filter sidebar — desktop */}
            <FilterSidebar
              filters={filters}
              onChange={setFilters}
              onReset={resetAll}
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />

            {/* Right column */}
            <div className="flex-1 min-w-0">
              {/* Toolbar */}
              <div className="flex items-center gap-3 mb-6 flex-wrap">
                {/* Mobile filter toggle */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:border-[#7C6EFA]/40 transition-colors bg-[#0D1526]"
                >
                  <Filter className="w-4 h-4" />
                  Filters
                </button>

                <p className="text-sm text-[#8B9BC4]">
                  <span className="font-semibold text-[#F0F4FF]">{filtered.length}</span> services
                  {(search || categoryId !== undefined) && " found"}
                </p>

                <div className="ml-auto relative">
                  <button
                    onClick={() => setSortOpen((v) => !v)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:border-[#7C6EFA]/40 transition-colors bg-[#0D1526]"
                  >
                    <span className="text-[#8B9BC4]">Sort:</span>
                    {activeSort.label}
                    <ChevronDown className={`w-4 h-4 text-[#8B9BC4] transition-transform ${sortOpen ? "rotate-180" : ""}`} />
                  </button>

                  {sortOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 z-20 w-48 bg-[#131E35] border border-[#2E4270] rounded-xl shadow-lg overflow-hidden">
                        {SORT_OPTIONS.map((o) => (
                          <button
                            key={o.key}
                            onClick={() => { setSort(o.key); setSortOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-[#1C2A45] ${
                              sort === o.key ? "text-[#7C6EFA] font-medium" : "text-[#8B9BC4]"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Service grid */}
              {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="grid">
                  <EmptyState onReset={resetAll} />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                    {paginated.map((s) => (
                      <ServiceCard key={s.id} s={s} onView={trackView} />
                    ))}
                  </div>

                  {/* Load more / Pagination */}
                  {hasMore && (
                    <div className="flex flex-col items-center gap-3 mt-12">
                      <button
                        onClick={() => setPage((p) => p + 1)}
                        className="btn-ghost !py-3 !px-8 border border-[#2E4270] text-[#F0F4FF] hover:bg-[#131E35]"
                      >
                        Load More
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-[#8B9BC4]">
                        Showing {paginated.length} of {filtered.length}
                      </p>
                    </div>
                  )}

                  {!hasMore && filtered.length > PAGE_SIZE && (
                    <p className="text-center text-xs text-[#8B9BC4] mt-10">
                      All {filtered.length} services loaded
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
