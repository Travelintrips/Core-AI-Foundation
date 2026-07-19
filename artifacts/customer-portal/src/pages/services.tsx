import { Link, useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { useCategories, useServices, type CatalogService, type ServiceCategory } from "@/hooks/use-catalog";
import {
  Loader2, ArrowRight, Sparkles, Search, Star, Clock, CheckCircle,
  Paintbrush, Megaphone, DollarSign, BookOpen, Receipt, Users,
  Scale, Truck, Package, TrendingUp, Briefcase, Headphones, BarChart2,
  RotateCcw, ChevronDown, Zap, Shield, X,
  Globe, ChevronRight, Award, Flame,
  History, Hash, ArrowLeft, Calculator,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "@/lib/i18n";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: string | number, currency: string) {
  const n = typeof value === "string" ? Number(value) : value;
  if (currency === "IDR") return `Rp ${n.toLocaleString("id-ID")}`;
  return `$${n.toLocaleString()}`;
}

function mockRating(id: number) {
  return ((((id * 7 + 13) % 15) + 36) / 10).toFixed(1);
}

function mockCompleted(id: number) {
  return ((id * 11 + 7) % 180) + 42;
}

function deliveryDays(est: string): number {
  const m = est.toLowerCase().match(/(\d+)(?:\s*[-–]\s*\d+)?\s*(menit|jam|hari|minggu|bulan)/);
  if (!m) return 7;
  const value = parseInt(m[1], 10);
  switch (m[2]) {
    case "menit": return value / (24 * 60);
    case "jam": return value / 24;
    case "minggu": return value * 7;
    case "bulan": return value * 30;
    default: return value;
  }
}

type BadgeKind = "Enterprise" | "Pengiriman Cepat" | "Baru" | "Terpopuler" | "Trending" | "Direview Manusia" | "Siap Komersial";

function serviceBadge(s: CatalogService): { label: BadgeKind; color: string } | null {
  if (s.serviceFlow === "enterprise") return { label: "Enterprise", color: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30" };
  if (s.humanReview && s.id % 5 === 1) return { label: "Direview Manusia", color: "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30" };
  if (deliveryDays(s.estimatedDelivery) <= 2) return { label: "Pengiriman Cepat", color: "bg-[#22D3EE]/10 text-[#22D3EE] border-[#22D3EE]/30" };
  if (s.id % 7 === 0) return { label: "Trending", color: "bg-[#F97316]/10 text-[#F97316] border-[#F97316]/30" };
  if (s.id % 4 === 0) return { label: "Baru", color: "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30" };
  if (s.id % 3 === 0) return { label: "Terpopuler", color: "bg-[#7C6EFA]/10 text-[#7C6EFA] border-[#7C6EFA]/30" };
  return null;
}

// ── Category icons ────────────────────────────────────────────────────────────

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
  customer_service: Headphones,
  analytics: BarChart2,
  data: BarChart2,
  procurement: Globe,
  default: Sparkles,
};

function getCategoryIcon(cat: ServiceCategory): React.ElementType {
  const key = (cat.code ?? cat.name ?? "").toLowerCase();
  for (const [k, Icon] of Object.entries(CATEGORY_ICONS)) {
    if (key.includes(k)) return Icon;
  }
  return CATEGORY_ICONS.default;
}

// ── Category accent colours (one per slot, loops) ────────────────────────────

const CAT_ACCENTS = [
  { glow: "rgba(124,110,250,0.18)", border: "rgba(124,110,250,0.50)", icon: "#7C6EFA", bg: "rgba(124,110,250,0.12)" },
  { glow: "rgba(34,211,238,0.14)", border: "rgba(34,211,238,0.45)", icon: "#22D3EE", bg: "rgba(34,211,238,0.10)" },
  { glow: "rgba(249,115,22,0.14)", border: "rgba(249,115,22,0.45)", icon: "#F97316", bg: "rgba(249,115,22,0.10)" },
  { glow: "rgba(16,185,129,0.14)", border: "rgba(16,185,129,0.45)", icon: "#10B981", bg: "rgba(16,185,129,0.10)" },
  { glow: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.45)", icon: "#F59E0B", bg: "rgba(245,158,11,0.10)" },
  { glow: "rgba(139,92,246,0.14)", border: "rgba(139,92,246,0.45)", icon: "#8B5CF6", bg: "rgba(139,92,246,0.10)" },
];

// ── Sort options ──────────────────────────────────────────────────────────────

type SortKey = "popular" | "newest" | "fastest" | "price_asc" | "rating";
const SORT_KEYS: { key: SortKey; tKey: string; icon: React.ElementType }[] = [
  { key: "popular",   tKey: "services.sort.popular",   icon: Flame },
  { key: "newest",    tKey: "services.sort.newest",    icon: Sparkles },
  { key: "fastest",   tKey: "services.sort.fastest",   icon: Zap },
  { key: "price_asc", tKey: "services.sort.price_asc", icon: DollarSign },
  { key: "rating",    tKey: "services.sort.rating",    icon: Star },
];

const RECENT_SEARCH_KEY   = "apex_recent_searches";
const RECENTLY_VIEWED_KEY = "apex_recently_viewed";
const POPULAR_SEARCHES    = ["Strategi Brand", "Dokumen Legal", "Laporan Keuangan", "Kampanye Marketing", "Analitik HR", "Logistics AI"];

// ── Animation variants ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};
const staggerGrid = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.06 } },
};
const cardVariant = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
};

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-[#0D1526] border border-[#2E4270] p-5 space-y-4 overflow-hidden rounded-2xl" style={{ minHeight: 220 }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#131E35] animate-pulse shrink-0" />
          <div className="space-y-2">
            <div className="h-2.5 w-20 bg-[#131E35] rounded animate-pulse" />
            <div className="h-3 w-28 bg-[#131E35] rounded animate-pulse" />
          </div>
        </div>
        <div className="h-5 w-16 bg-[#131E35] rounded-full animate-pulse shrink-0" />
      </div>
      <div className="space-y-2.5">
        <div className="h-4 w-3/4 bg-[#131E35] rounded animate-pulse" />
        <div className="h-3 w-full bg-[#131E35] rounded animate-pulse" />
        <div className="h-3 w-5/6 bg-[#131E35] rounded animate-pulse" />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-[#243352]">
        <div className="h-4 w-20 bg-[#131E35] rounded animate-pulse" />
        <div className="h-8 w-24 bg-[#131E35] rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

// ── Category Card ─────────────────────────────────────────────────────────────

function CategoryCard({
  category,
  services,
  accentIdx,
  onSelect,
}: {
  category: ServiceCategory;
  services: CatalogService[];
  accentIdx: number;
  onSelect: (id: number) => void;
}) {
  const Icon = getCategoryIcon(category);
  const accent = CAT_ACCENTS[accentIdx % CAT_ACCENTS.length];
  const count = services.length;
  const prices = services.map((s) => Number(s.startingPrice)).filter((p) => p > 0);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const currency = services[0]?.currency ?? "IDR";
  const avgRating =
    count > 0
      ? (services.reduce((acc, s) => acc + Number(mockRating(s.id)), 0) / count).toFixed(1)
      : "0.0";
  const fastestService = [...services].sort(
    (a, b) => deliveryDays(a.estimatedDelivery) - deliveryDays(b.estimatedDelivery),
  )[0];

  return (
    <motion.button
      variants={cardVariant}
      onClick={() => onSelect(category.id)}
      className="group relative w-full text-left rounded-2xl cursor-pointer overflow-hidden"
      style={{ minHeight: 200 }}
      aria-label={`Lihat layanan ${category.name}`}
    >
      <div
        className="relative bg-[#0D1526] rounded-2xl p-6 flex flex-col gap-4 h-full transition-all duration-200"
        style={{ border: "1.5px solid #2E4270" }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = accent.border;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${accent.glow}`;
          (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = "#2E4270";
          (e.currentTarget as HTMLElement).style.boxShadow = "none";
          (e.currentTarget as HTMLElement).style.transform = "";
        }}
      >
        {/* Icon + count badge */}
        <div className="flex items-start justify-between">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110"
            style={{ background: accent.bg, border: `1px solid ${accent.border}` }}
          >
            <Icon className="w-6 h-6" style={{ color: accent.icon }} />
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#131E35] border border-[#2E4270] text-[#8B9BC4]">
            {count} {count === 1 ? "layanan" : "layanan"}
          </span>
        </div>

        {/* Name + description */}
        <div className="flex-1">
          <h3
            className="font-semibold text-base mb-1.5 leading-snug transition-colors duration-200"
            style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {category.name}
          </h3>
          <p className="text-sm text-[#8B9BC4] leading-relaxed line-clamp-2">
            {category.description ?? `Solusi ${category.name} berbasis AI untuk kebutuhan bisnis Anda`}
          </p>
        </div>

        {/* Stats row */}
        {count > 0 && (
          <div className="flex items-center gap-4 text-xs text-[#8B9BC4]">
            <span className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-[#F59E0B] text-[#F59E0B]" />
              <span className="font-medium text-[#F0F4FF]">{avgRating}</span>
            </span>
            {fastestService && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#22D3EE]" />
                {fastestService.estimatedDelivery}
              </span>
            )}
          </div>
        )}

        {/* Price + CTA */}
        <div className="flex items-center justify-between pt-3 border-t border-[#243352] mt-auto">
          {minPrice > 0 ? (
            <div>
              <p className="text-[11px] text-[#8B9BC4] mb-0.5">Mulai dari</p>
              <p
                className="font-bold text-sm text-[#F0F4FF]"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {formatPrice(minPrice, currency)}
              </p>
            </div>
          ) : (
            <div />
          )}
          <div
            className="flex items-center gap-1 text-xs font-semibold transition-all duration-200 group-hover:gap-2"
            style={{ color: accent.icon }}
          >
            Lihat Layanan <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </motion.button>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({ s, onView }: { s: CatalogService; onView: (id: number) => void }) {
  const { t } = useTranslation();
  const badge = serviceBadge(s);
  const rating = mockRating(s.id);
  const completed = mockCompleted(s.id);
  const CategoryIcon = getCategoryIcon({ id: s.categoryId, name: s.serviceCode, code: s.serviceCode } as ServiceCategory);

  return (
    <motion.div
      variants={cardVariant}
      className="group relative rounded-2xl cursor-pointer overflow-hidden"
      style={{ minHeight: 220 }}
    >
      <div
        className="relative bg-[#0D1526] rounded-2xl p-5 flex flex-col gap-4 h-full transition-all duration-200 group-hover:shadow-[0_8px_32px_rgba(124,110,250,0.18)] group-hover:-translate-y-0.5"
        style={{ border: "1px solid #2E4270" }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "rgba(124,110,250,0.5)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "#2E4270")}
      >
        {/* Top row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              whileHover={{ scale: 1.1, rotate: 5 }}
              transition={{ duration: 0.2 }}
              className="w-11 h-11 rounded-xl border border-[#7C6EFA]/20 flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.2) 0%, rgba(34,211,238,0.1) 100%)" }}
            >
              <CategoryIcon className="w-5 h-5 text-[#7C6EFA]" />
            </motion.div>
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
          <h3
            className="font-semibold text-base mb-1.5 leading-snug transition-colors duration-200 group-hover:text-[#7C6EFA]"
            style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {s.serviceName}
          </h3>
          <p className="text-sm text-[#8B9BC4] leading-relaxed line-clamp-2">{s.shortDescription}</p>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-[#8B9BC4] flex-wrap">
          <span className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 fill-[#F59E0B] text-[#F59E0B]" />
            <span className="font-medium text-[#F0F4FF]">{rating}</span>
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-[#10B981]" />
            {completed} {t("services.card.projects")}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-[#22D3EE]" />
            {s.estimatedDelivery}
          </span>
          {s.humanReview && (
            <span className="flex items-center gap-1 text-[#7C6EFA]">
              <Shield className="w-3.5 h-3.5" />
              {t("services.preview.humanReviewed")}
            </span>
          )}
        </div>

        {/* Price + CTA */}
        <div className="flex items-center justify-between pt-3 border-t border-[#243352] mt-auto">
          <div>
            <p className="text-[11px] text-[#8B9BC4] mb-0.5">{t("services.card.startingFrom")}</p>
            <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-base text-[#F0F4FF]">
              {formatPrice(s.startingPrice, s.currency)}
            </p>
          </div>
          <Link
            href={`/services/${s.id}`}
            onClick={() => onView(s.id)}
            className="btn-primary !py-2 !px-4 !text-xs gap-1.5 flex items-center"
            aria-label={`Lihat detail untuk ${s.serviceName}`}
          >
            {t("services.card.viewDetail")}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

// ── Search Dropdown ───────────────────────────────────────────────────────────

function SearchDropdown({
  recentSearches,
  onSelect,
  onClearRecent,
}: {
  recentSearches: string[];
  onSelect: (q: string) => void;
  onClearRecent: () => void;
}) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full left-0 right-0 mt-2 rounded-2xl border border-[#2E4270] overflow-hidden z-50"
      style={{ background: "#0D1526", boxShadow: "0 16px 40px rgba(0,0,0,0.5)" }}
    >
      {recentSearches.length > 0 && (
        <div className="p-4 border-b border-[#243352]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-[#8B9BC4] uppercase tracking-wider flex items-center gap-1.5">
              <History className="w-3 h-3" /> {t("services.search.recent")}
            </p>
            <button onClick={onClearRecent} className="text-[11px] text-[#8B9BC4] hover:text-[#7C6EFA] transition-colors">
              {t("services.search.clear")}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.slice(0, 5).map((q) => (
              <button
                key={q}
                onClick={() => onSelect(q)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2E4270] text-xs text-[#C8D5F0] hover:border-[#7C6EFA]/50 hover:text-[#7C6EFA] transition-all duration-150"
              >
                <History className="w-3 h-3 text-[#8B9BC4]" />
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="p-4">
        <p className="text-[11px] font-semibold text-[#8B9BC4] uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Flame className="w-3 h-3 text-[#F97316]" /> {t("services.search.popular")}
        </p>
        <div className="flex flex-wrap gap-2">
          {POPULAR_SEARCHES.map((q) => (
            <button
              key={q}
              onClick={() => onSelect(q)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2E4270] text-xs text-[#C8D5F0] hover:border-[#7C6EFA]/50 hover:text-[#F0F4FF] hover:bg-[#131E35] transition-all duration-150"
            >
              <Hash className="w-3 h-3 text-[#8B9BC4]" />
              {q}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 pb-3 flex items-center gap-1.5 text-[11px] text-[#8B9BC4]/60">
        <kbd className="px-1.5 py-0.5 rounded bg-[#131E35] border border-[#2E4270] font-mono text-[10px]">Esc</kbd>
        <span>{t("services.search.close")}</span>
        <span className="mx-1">·</span>
        <kbd className="px-1.5 py-0.5 rounded bg-[#131E35] border border-[#2E4270] font-mono text-[10px]">/</kbd>
        <span>{t("services.search.focus")}</span>
      </div>
    </motion.div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="col-span-full flex flex-col items-center justify-center py-24 text-center"
    >
      <div className="mb-8 relative">
        <div
          className="w-24 h-24 rounded-3xl border border-[#2E4270] flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #0D1526 0%, #131E35 100%)" }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="22" cy="22" r="14" stroke="#2E4270" strokeWidth="2" />
            <circle cx="22" cy="22" r="14" stroke="url(#srGrad)" strokeWidth="2" strokeDasharray="4 2" />
            <path d="M32 32L40 40" stroke="#7C6EFA" strokeWidth="2.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="srGrad" x1="8" y1="8" x2="36" y2="36" gradientUnits="userSpaceOnUse">
                <stop stopColor="#7C6EFA" />
                <stop offset="1" stopColor="#22D3EE" stopOpacity="0.5" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center justify-center">
          <X className="w-3 h-3 text-[#F59E0B]" />
        </div>
      </div>
      <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-semibold text-xl mb-2 text-[#F0F4FF]">
        {t("services.empty.title")}
      </h3>
      <p className="text-[#8B9BC4] text-sm max-w-xs mb-8 leading-relaxed">
        {t("services.empty.desc")}
      </p>
      <div className="flex items-center gap-3 flex-wrap justify-center">
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#F0F4FF] hover:bg-[#131E35] hover:border-[#7C6EFA]/40 transition-all duration-150"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Pencarian
        </button>
      </div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const { t } = useTranslation();
  const searchQuery = useSearch();

  const SORT_OPTIONS = SORT_KEYS.map((o) => ({ ...o, label: t(o.tKey) }));

  const [search, setSearch]                     = useState("");
  const [searchFocused, setSearchFocused]       = useState(false);
  const [recentSearches, setRecentSearches]     = useState<string[]>([]);
  const [categoryId, setCategoryId]             = useState<number | undefined>(undefined);
  const [sort, setSort]                         = useState<SortKey>("popular");
  const [maxDelivery, setMaxDelivery]           = useState(30);
  const [sortOpen, setSortOpen]                 = useState(false);
  const [page, setPage]                         = useState(1);
  const [loadingMore, setLoadingMore]           = useState(false);
  const [recentlyViewed, setRecentlyViewed]     = useState<number[]>([]);
  const [templateSeed, setTemplateSeed]         = useState<{ templateId: number; templateName: string; category: string; style: string } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const PAGE_SIZE = 9;

  const { data: categories = [], isLoading: loadingCategories } = useCategories();
  const { data: allServices = [], isLoading: loadingServices }  = useServices(undefined);

  // Read template seed from sessionStorage
  useEffect(() => {
    const params = new URLSearchParams(searchQuery);
    const templateId = params.get("templateId");
    if (!templateId) return;
    try {
      const raw = sessionStorage.getItem("template-selection-seed");
      if (raw) {
        const parsed = JSON.parse(raw) as { templateId: number; templateName: string; category: string; style: string };
        if (String(parsed.templateId) === templateId) setTemplateSeed(parsed);
      }
    } catch { /* ignore */ }
  }, [searchQuery]);

  useEffect(() => {
    if (!templateSeed || categories.length === 0) return;
    const match = categories.find(
      (c) =>
        c.name.toLowerCase() === templateSeed.category.toLowerCase() ||
        templateSeed.category.toLowerCase().includes(c.name.toLowerCase()) ||
        c.name.toLowerCase().includes(templateSeed.category.toLowerCase()),
    );
    if (match) setCategoryId(match.id);
  }, [templateSeed, categories]);

  // Load persisted state
  useEffect(() => {
    try {
      const rv = localStorage.getItem(RECENTLY_VIEWED_KEY);
      if (rv) setRecentlyViewed(JSON.parse(rv) as number[]);
      const rs = localStorage.getItem(RECENT_SEARCH_KEY);
      if (rs) setRecentSearches(JSON.parse(rs) as string[]);
    } catch { /* ignore */ }
  }, []);

  // "/" keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSearchFocused(false);
        searchRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const trackView = (id: number) => {
    setRecentlyViewed((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 6);
      try { localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const addRecentSearch = useCallback((q: string) => {
    if (!q.trim()) return;
    setRecentSearches((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, 8);
      try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleSearchSelect = (q: string) => {
    setSearch(q);
    addRecentSearch(q);
    setSearchFocused(false);
    searchRef.current?.blur();
  };

  const handleSearchBlur = () => { setTimeout(() => setSearchFocused(false), 200); };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      addRecentSearch(search.trim());
      setSearchFocused(false);
    }
  };

  // Services grouped by category (for category cards)
  const servicesByCategory = useMemo(() => {
    const map: Record<number, CatalogService[]> = {};
    for (const s of allServices) {
      if (!map[s.categoryId]) map[s.categoryId] = [];
      map[s.categoryId].push(s);
    }
    return map;
  }, [allServices]);

  // Filtered services for search / category view
  const filtered = useMemo(() => {
    let list = [...allServices];

    if (categoryId !== undefined) list = list.filter((s) => s.categoryId === categoryId);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.serviceName.toLowerCase().includes(q) ||
          s.shortDescription.toLowerCase().includes(q) ||
          s.serviceCode.toLowerCase().includes(q),
      );
    }

    if (maxDelivery < 30) {
      list = list.filter((s) => deliveryDays(s.estimatedDelivery) <= maxDelivery);
    }

    switch (sort) {
      case "fastest":   list.sort((a, b) => deliveryDays(a.estimatedDelivery) - deliveryDays(b.estimatedDelivery)); break;
      case "price_asc": list.sort((a, b) => Number(a.startingPrice) - Number(b.startingPrice)); break;
      case "rating":    list.sort((a, b) => Number(mockRating(b.id)) - Number(mockRating(a.id))); break;
      case "newest":    list.sort((a, b) => b.id - a.id); break;
      default:          list.sort((a, b) => mockCompleted(b.id) - mockCompleted(a.id));
    }

    return list;
  }, [allServices, categoryId, search, maxDelivery, sort]);

  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated   = filtered.slice(0, page * PAGE_SIZE);
  const hasMore     = page < totalPages;

  useEffect(() => { setPage(1); }, [search, categoryId, sort, maxDelivery]);

  const resetAll = () => {
    setSearch("");
    setCategoryId(undefined);
    setSort("popular");
    setMaxDelivery(30);
    setPage(1);
  };

  const handleLoadMore = () => {
    setLoadingMore(true);
    setTimeout(() => { setPage((p) => p + 1); setLoadingMore(false); }, 500);
  };

  const recentServices     = allServices.filter((s) => recentlyViewed.includes(s.id));
  const isLoading          = loadingServices || loadingCategories;
  const activeSort         = SORT_OPTIONS.find((o) => o.key === sort)!;
  const showDropdown       = searchFocused && !search.trim();
  const selectedCategory   = categories.find((c) => c.id === categoryId);
  const hasFilters         = maxDelivery < 30 || search.trim().length > 0;

  // Determine view mode
  // "categories" = default landing grid
  // "services"   = showing service cards (when category selected OR search active)
  const mode = (categoryId !== undefined || search.trim().length > 0) ? "services" : "categories";

  return (
    <Layout>
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">

        {/* ── Template seed banner ─────────────────────────────────────── */}
        {templateSeed && (
          <div className="container mx-auto px-4 pt-4 max-w-5xl">
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border"
              style={{ background: "rgba(124,110,250,0.08)", borderColor: "rgba(124,110,250,0.3)" }}
            >
              <p className="text-sm text-[#C9BFFF]">
                <span className="font-semibold">Dari template:</span> {templateSeed.templateName} ({templateSeed.category} · {templateSeed.style})
              </p>
              <button
                onClick={() => { setTemplateSeed(null); setCategoryId(undefined); }}
                className="text-xs text-[#8B9BC4] hover:text-white transition-colors flex-shrink-0"
              >
                Bersihkan
              </button>
            </div>
          </div>
        )}

        {/* ── Hero / Search ─────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#060B18] border-b border-[#243352]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <motion.div
              animate={{ scale: [1, 1.1, 1], opacity: [0.08, 0.14, 0.08] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full"
              style={{ background: "radial-gradient(ellipse, #7C6EFA 0%, transparent 70%)", filter: "blur(60px)" }}
            />
            <div
              className="absolute inset-0 opacity-[0.025]"
              style={{
                backgroundImage:
                  "linear-gradient(#7C6EFA 1px, transparent 1px), linear-gradient(90deg, #7C6EFA 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />
          </div>

          <div className="relative container mx-auto px-4 md:px-8 max-w-5xl py-12 md:py-16 text-center">
            {/* Badge */}
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex items-center justify-center gap-2 mb-5">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2E4270] bg-[#0D1526]/70 text-xs font-semibold text-[#7C6EFA]">
                <Sparkles className="w-3.5 h-3.5" />
                AI Service Catalog
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/8 text-xs font-semibold text-[#F59E0B]">
                <Award className="w-3.5 h-3.5" />
                {t("services.enterpriseGrade")}
              </div>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="show"
              style={{ animationDelay: "60ms", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              className="font-bold text-3xl md:text-5xl mb-3 leading-tight text-[#F0F4FF]"
            >
              Temukan Layanan yang Tepat
            </motion.h1>
            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="show"
              style={{ animationDelay: "100ms" }}
              className="text-sm md:text-base text-[#8B9BC4] max-w-xl mx-auto mb-8"
            >
              Pilih kategori, konfigurasikan paket, dan AI kami siap mengerjakan.
            </motion.p>

            {/* Search bar */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              style={{ animationDelay: "160ms" }}
              className="relative max-w-2xl mx-auto"
            >
              <div className="relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8B9BC4] pointer-events-none" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={handleSearchBlur}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t("services.search.placeholder")}
                  aria-label={t("services.search.placeholder")}
                  className="w-full pl-14 pr-16 py-4 rounded-2xl bg-[#131E35] border border-[#2E4270]
                             text-base text-[#F0F4FF] placeholder:text-[#8B9BC4]/60 outline-none transition-all duration-200
                             focus:border-[#7C6EFA] focus:shadow-[0_0_0_3px_rgba(124,110,250,0.15)]"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {search ? (
                    <button
                      onClick={() => setSearch("")}
                      className="text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
                      aria-label="Hapus pencarian"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : (
                    <kbd className="hidden sm:flex px-1.5 py-0.5 rounded bg-[#0D1526] border border-[#2E4270] font-mono text-[10px] text-[#8B9BC4] items-center">/</kbd>
                  )}
                </div>
              </div>
              <AnimatePresence>
                {showDropdown && (
                  <SearchDropdown
                    recentSearches={recentSearches}
                    onSelect={handleSearchSelect}
                    onClearRecent={() => {
                      setRecentSearches([]);
                      try { localStorage.removeItem(RECENT_SEARCH_KEY); } catch { /* ignore */ }
                    }}
                  />
                )}
              </AnimatePresence>
            </motion.div>

            {/* Shortcuts */}
            {categories.length > 0 && (
              <motion.div
                variants={fadeUp}
                initial="hidden"
                animate="show"
                style={{ animationDelay: "200ms" }}
                className="flex items-center justify-center gap-2 mt-4 flex-wrap"
              >
                <span className="text-xs text-[#8B9BC4]">Kategori:</span>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryId(cat.id)}
                    className="text-xs px-3 py-1 rounded-full border border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/50 hover:text-[#7C6EFA] transition-all duration-150"
                  >
                    {cat.name}
                  </button>
                ))}
                <Link
                  href="/tarif-kalkulator"
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-all duration-150"
                  style={{ borderColor: "rgba(34,211,238,0.40)", color: "#22D3EE", background: "rgba(34,211,238,0.06)" }}
                >
                  <Calculator className="w-3 h-3" />
                  Customs &amp; PPJK AI
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded-full" style={{ background: "rgba(34,211,238,0.18)", color: "#22D3EE" }}>Baru</span>
                </Link>
              </motion.div>
            )}
          </div>
        </section>

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="container mx-auto px-4 md:px-8 max-w-7xl py-10">

          {/* ── Breadcrumb (service view) ─────────────────────────────── */}
          <AnimatePresence>
            {mode === "services" && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-2 mb-8 text-sm"
              >
                <button
                  onClick={resetAll}
                  className="flex items-center gap-1.5 text-[#8B9BC4] hover:text-[#7C6EFA] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Semua Kategori
                </button>
                {selectedCategory && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-[#4F6494]" />
                    <span className="font-semibold text-[#F0F4FF]">{selectedCategory.name}</span>
                  </>
                )}
                {search.trim() && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-[#4F6494]" />
                    <span className="text-[#8B9BC4]">Hasil: "<span className="text-[#F0F4FF]">{search}</span>"</span>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {isLoading ? (
            /* ── Loading skeleton ──────────────────────────────────────── */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>

          ) : mode === "categories" ? (
            /* ── Category Grid ─────────────────────────────────────────── */
            <>
              {/* Recently Viewed */}
              {recentServices.length > 0 && (
                <section className="mb-12">
                  <div className="flex items-center gap-3 mb-5">
                    <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-base text-[#F0F4FF]">
                      Terakhir Dilihat
                    </h2>
                    <div className="flex-1 h-px bg-[#243352]" />
                    <button
                      onClick={() => {
                        setRecentlyViewed([]);
                        localStorage.removeItem(RECENTLY_VIEWED_KEY);
                      }}
                      className="text-xs text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
                    >
                      Hapus
                    </button>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                    {recentServices.map((s) => (
                      <Link
                        key={s.id}
                        href={`/services/${s.id}`}
                        onClick={() => trackView(s.id)}
                        className="group shrink-0 w-52 bg-[#0D1526] border border-[#2E4270] rounded-2xl p-4 flex flex-col gap-2 hover:border-[#7C6EFA]/50 hover:-translate-y-0.5 transition-all duration-200"
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

              {/* Category section header */}
              <div className="flex items-center gap-3 mb-6">
                <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-lg text-[#F0F4FF]">
                  Pilih Kategori Layanan
                </h2>
                <div className="flex-1 h-px bg-[#243352]" />
                <span className="text-xs text-[#8B9BC4] bg-[#131E35] border border-[#2E4270] px-2.5 py-1 rounded-full">
                  {categories.length} kategori
                </span>
              </div>

              {categories.length === 0 ? (
                <div className="py-24 text-center text-[#8B9BC4]">
                  <Sparkles className="w-10 h-10 mx-auto mb-4 opacity-30" />
                  <p>Tidak ada kategori tersedia.</p>
                </div>
              ) : (
                <motion.div
                  variants={staggerGrid}
                  initial="hidden"
                  animate="show"
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
                >
                  {categories.map((cat, idx) => (
                    <CategoryCard
                      key={cat.id}
                      category={cat}
                      services={servicesByCategory[cat.id] ?? []}
                      accentIdx={idx}
                      onSelect={(id) => setCategoryId(id)}
                    />
                  ))}
                </motion.div>
              )}
            </>

          ) : (
            /* ── Service Grid ──────────────────────────────────────────── */
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-3 mb-6 flex-wrap">
                <p className="text-sm text-[#8B9BC4]">
                  <span className="font-semibold text-[#F0F4FF]">{filtered.length}</span> {t("services.servicesLabel")}
                  {search.trim() && ` ditemukan`}
                </p>

                <div className="ml-auto flex items-center gap-2">
                  {/* Delivery filter */}
                  <div className="relative">
                    <select
                      value={maxDelivery}
                      onChange={(e) => setMaxDelivery(Number(e.target.value))}
                      aria-label="Filter waktu pengerjaan"
                      className="appearance-none flex items-center gap-2 pl-3 pr-8 py-2 rounded-xl border border-[#2E4270] text-sm text-[#8B9BC4] bg-[#0D1526] hover:border-[#7C6EFA]/40 hover:text-[#F0F4FF] transition-colors cursor-pointer focus:outline-none focus:border-[#7C6EFA]/60"
                    >
                      <option value={30}>Semua Waktu</option>
                      <option value={2}>Hari ini</option>
                      <option value={5}>Maks 5 hari</option>
                      <option value={14}>Maks 2 minggu</option>
                    </select>
                    <Clock className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8B9BC4] pointer-events-none" />
                  </div>

                  {/* Reset button */}
                  {hasFilters && (
                    <button
                      onClick={resetAll}
                      aria-label="Reset filter"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#2E4270] text-xs text-[#8B9BC4] hover:text-[#F0F4FF] hover:border-[#7C6EFA]/40 transition-colors bg-[#0D1526]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  )}

                  {/* Sort dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setSortOpen((v) => !v)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:border-[#7C6EFA]/40 transition-colors bg-[#0D1526]"
                      aria-expanded={sortOpen}
                    >
                      <activeSort.icon className="w-3.5 h-3.5 text-[#8B9BC4]" />
                      <span className="text-[#8B9BC4] hidden sm:inline">{t("services.sortLabel")}</span>
                      {activeSort.label}
                      <ChevronDown className={`w-4 h-4 text-[#8B9BC4] transition-transform duration-200 ${sortOpen ? "rotate-180" : ""}`} />
                    </button>

                    <AnimatePresence>
                      {sortOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 z-20 w-52 rounded-xl border border-[#2E4270] overflow-hidden"
                            style={{ background: "#0D1526", boxShadow: "0 16px 40px rgba(0,0,0,0.4)" }}
                          >
                            {SORT_OPTIONS.map((o) => {
                              const Icon = o.icon;
                              return (
                                <button
                                  key={o.key}
                                  onClick={() => { setSort(o.key); setSortOpen(false); }}
                                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[#131E35] ${sort === o.key ? "text-[#7C6EFA] font-semibold bg-[#7C6EFA]/5" : "text-[#8B9BC4]"}`}
                                >
                                  <Icon className={`w-3.5 h-3.5 ${sort === o.key ? "text-[#7C6EFA]" : "text-[#8B9BC4]"}`} />
                                  {o.label}
                                  {sort === o.key && <CheckCircle className="w-3.5 h-3.5 ml-auto text-[#7C6EFA]" />}
                                </button>
                              );
                            })}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* Grid */}
              {filtered.length === 0 ? (
                <div className="grid">
                  <EmptyState onReset={resetAll} />
                </div>
              ) : (
                <>
                  <motion.div
                    variants={staggerGrid}
                    initial="hidden"
                    animate="show"
                    key={`${search}-${categoryId}-${sort}-${maxDelivery}`}
                    className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5"
                  >
                    {paginated.map((s) => (
                      <ServiceCard key={s.id} s={s} onView={trackView} />
                    ))}
                  </motion.div>

                  {/* Load more */}
                  {hasMore && (
                    <div className="flex flex-col items-center gap-3 mt-12">
                      <button
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="flex items-center gap-2 py-3 px-8 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:bg-[#131E35] hover:border-[#7C6EFA]/40 transition-all duration-150 disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {loadingMore ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> {t("services.loading")}</>
                        ) : (
                          <><ChevronDown className="w-4 h-4" /> {t("services.loadMore")}</>
                        )}
                      </button>
                      <p className="text-xs text-[#8B9BC4]">
                        {t("services.showing", { shown: String(paginated.length), total: String(filtered.length) })}
                      </p>
                    </div>
                  )}

                  {!hasMore && filtered.length > PAGE_SIZE && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center text-xs text-[#8B9BC4] mt-10 flex items-center justify-center gap-2"
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-[#10B981]" />
                      {t("services.allLoaded", { total: String(filtered.length) })}
                    </motion.p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
