import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { useCategories, useServices, type CatalogService, type ServiceCategory } from "@/hooks/use-catalog";
import {
  Loader2, ArrowRight, Sparkles, Search, Star, Clock, CheckCircle,
  Paintbrush, Megaphone, DollarSign, BookOpen, Receipt, Users,
  Scale, Truck, Package, TrendingUp, Briefcase, Headphones, BarChart2,
  RotateCcw, Filter, ChevronDown, Zap, Shield, X, Eye, Building2,
  Globe, LayoutGrid, ChevronRight, Award, Flame, BadgeCheck, Lock,
  ChevronUp, SlidersHorizontal, History, Hash, Cpu, ArrowLeft,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: string, currency: string) {
  const n = Number(value);
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
  const m = est.match(/(\d+)/);
  return m ? parseInt(m[1]) : 7;
}

type BadgeKind = "Enterprise" | "Fast Delivery" | "New" | "Most Popular" | "Trending" | "Human Reviewed" | "Commercial Ready";

function serviceBadge(s: CatalogService): { label: BadgeKind; color: string } | null {
  if (s.serviceFlow === "enterprise") return { label: "Enterprise", color: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30" };
  if (s.humanReview && s.id % 5 === 1) return { label: "Human Reviewed", color: "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30" };
  if (deliveryDays(s.estimatedDelivery) <= 2) return { label: "Fast Delivery", color: "bg-[#22D3EE]/10 text-[#22D3EE] border-[#22D3EE]/30" };
  if (s.id % 7 === 0) return { label: "Trending", color: "bg-[#F97316]/10 text-[#F97316] border-[#F97316]/30" };
  if (s.id % 4 === 0) return { label: "New", color: "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30" };
  if (s.id % 3 === 0) return { label: "Most Popular", color: "bg-[#7C6EFA]/10 text-[#7C6EFA] border-[#7C6EFA]/30" };
  if (s.serviceFlow === "fixed_price" && s.id % 2 === 0) return { label: "Commercial Ready", color: "bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/30" };
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
const SORT_OPTIONS: { key: SortKey; label: string; icon: React.ElementType }[] = [
  { key: "popular",   label: "Most Popular",      icon: Flame },
  { key: "newest",    label: "Newest",             icon: Sparkles },
  { key: "fastest",   label: "Fastest Delivery",   icon: Zap },
  { key: "price_asc", label: "Lowest Price",       icon: DollarSign },
  { key: "rating",    label: "Highest Rating",     icon: Star },
];

// ── Search constants ──────────────────────────────────────────────────────────

const RECENT_SEARCH_KEY = "apex_recent_searches";
const RECENTLY_VIEWED_KEY = "apex_recently_viewed";
const POPULAR_SEARCHES = [
  "Brand Strategy", "Legal Document", "Finance Report",
  "Marketing Campaign", "HR Analytics", "Logistics AI",
];

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
    <div className="bg-[#0D1526] border border-[#2E4270] p-5 space-y-4 overflow-hidden rounded-2xl" style={{ minHeight: 260 }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#131E35] animate-pulse shrink-0" />
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
      <div className="flex gap-3 pt-1">
        <div className="h-3 w-14 bg-[#131E35] rounded animate-pulse" />
        <div className="h-3 w-20 bg-[#131E35] rounded animate-pulse" />
        <div className="h-3 w-16 bg-[#131E35] rounded animate-pulse" />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-[#243352]">
        <div className="h-4 w-20 bg-[#131E35] rounded animate-pulse" />
        <div className="h-8 w-24 bg-[#131E35] rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

// ── Quick Preview Panel ───────────────────────────────────────────────────────

function QuickPreview({ s, onView }: { s: CatalogService; onView: (id: number) => void }) {
  const deliverables = [
    s.humanReview ? "Human-reviewed output" : "AI-generated output",
    `Delivered in ${s.estimatedDelivery}`,
    s.serviceFlow === "fixed_price" ? "Fixed price, no surprises" : "Custom scoped project",
    "Commercial license included",
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="absolute inset-0 z-10 flex flex-col justify-between rounded-2xl overflow-hidden"
      style={{ background: "linear-gradient(160deg, #111C38 0%, #0D1526 100%)", border: "1px solid rgba(124,110,250,0.5)" }}
    >
      {/* Glow border */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: "inset 0 0 0 1px rgba(124,110,250,0.3), 0 8px 32px rgba(124,110,250,0.2)" }} />

      <div className="p-5 flex flex-col gap-3 flex-1">
        <p className="text-[10px] font-bold text-[#7C6EFA] uppercase tracking-widest mb-1">Quick Preview</p>
        <div className="space-y-2">
          {deliverables.map((d, i) => (
            <div key={i} className="flex items-start gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-[#10B981] mt-0.5 shrink-0" />
              <span className="text-xs text-[#C8D5F0] leading-snug">{d}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-auto flex-wrap">
          {s.humanReview && (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#7C6EFA]/15 text-[#7C6EFA] border border-[#7C6EFA]/25">
              <Shield className="w-3 h-3" /> Human Reviewed
            </span>
          )}
          {s.serviceFlow === "fixed_price" && (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/25">
              <BadgeCheck className="w-3 h-3" /> Commercial
            </span>
          )}
        </div>
      </div>

      <div className="p-4 pt-0">
        <Link
          href={`/services/${s.id}`}
          onClick={() => onView(s.id)}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-150"
          style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", color: "#fff" }}
        >
          View Detail
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </motion.div>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({ s, onView }: { s: CatalogService; onView: (id: number) => void }) {
  const badge = serviceBadge(s);
  const rating = mockRating(s.id);
  const completed = mockCompleted(s.id);
  const [hovered, setHovered] = useState(false);
  const CategoryIcon = getCategoryIcon({ id: s.categoryId, name: s.serviceCode, code: s.serviceCode } as ServiceCategory);

  return (
    <motion.div
      variants={cardVariant}
      className="group relative rounded-2xl cursor-pointer overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ minHeight: 260 }}
    >
      {/* Gradient border glow on hover */}
      <div
        className="absolute inset-0 rounded-2xl transition-opacity duration-300 pointer-events-none z-0"
        style={{
          background: "linear-gradient(135deg, rgba(124,110,250,0.5) 0%, rgba(34,211,238,0.3) 100%)",
          opacity: hovered ? 1 : 0,
          padding: 1,
        }}
      />

      <div className="relative z-[1] bg-[#0D1526] rounded-2xl p-5 flex flex-col gap-4 h-full"
           style={{ border: hovered ? "1px solid transparent" : "1px solid #2E4270", boxShadow: hovered ? "0 8px 32px rgba(124,110,250,0.2)" : "none" }}>

        {/* Top row: icon + category + badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={{ scale: hovered ? 1.1 : 1, rotate: hovered ? 5 : 0 }}
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
            className="font-semibold text-base mb-1.5 leading-snug transition-colors duration-200"
            style={{ color: hovered ? "#7C6EFA" : "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {s.serviceName}
          </h3>
          <p className="text-sm text-[#8B9BC4] leading-relaxed line-clamp-2">{s.shortDescription}</p>
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
              Human
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
            className="btn-primary !py-2 !px-4 !text-xs gap-1.5 flex items-center"
            aria-label={`View detail for ${s.serviceName}`}
          >
            View Detail
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Quick preview overlay — desktop only */}
      <AnimatePresence>
        {hovered && (
          <div className="hidden md:block absolute inset-0 z-20">
            <QuickPreview s={s} onView={onView} />
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Filter Sidebar ────────────────────────────────────────────────────────────

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

function countActiveFilters(f: Filters): number {
  let n = 0;
  if (f.maxPrice < 999_999_999) n++;
  if (f.maxDelivery < 30) n++;
  if (f.humanReview !== null) n++;
  if (f.minRating > 0) n++;
  if (f.flow) n++;
  return n;
}

function AccordionSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-1 mb-2 group"
        aria-expanded={open}
      >
        <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider group-hover:text-[#F0F4FF] transition-colors">
          {title}
        </p>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-[#8B9BC4]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#8B9BC4]" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RadioOption({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group py-0.5" onClick={onClick}>
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors
        ${checked ? "border-[#7C6EFA] bg-[#7C6EFA]" : "border-[#2E4270] group-hover:border-[#7C6EFA]/60"}`}>
        {checked && <div className="w-1.5 h-1.5 rounded-full bg-[#F0F4FF]" />}
      </div>
      <span className="text-sm text-[#8B9BC4] group-hover:text-[#F0F4FF] transition-colors">{label}</span>
    </label>
  );
}

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
  const activeCount = countActiveFilters(filters);

  return (
    <>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed top-0 left-0 h-full z-40 w-72 bg-[#0A1225] border-r border-[#2E4270] overflow-y-auto
        transition-transform duration-300 ease-out
        ${open ? "translate-x-0" : "-translate-x-full"}
        lg:static lg:translate-x-0 lg:h-auto lg:w-64 lg:border lg:border-[#2E4270] lg:rounded-2xl lg:bg-[#0D1526] lg:shrink-0 lg:sticky lg:top-[120px]
      `}>
        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#7C6EFA]" />
              <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-semibold text-sm text-[#F0F4FF]">Filters</h3>
              {activeCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#7C6EFA] text-white min-w-[18px] text-center">
                  {activeCount}
                </span>
              )}
            </div>
            <button onClick={onClose} className="lg:hidden text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors" aria-label="Close filters">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <AccordionSection title="Price">
              <div className="space-y-1 mb-2">
                {[
                  { label: "Any price", val: 999_999_999 },
                  { label: "Under $500", val: 500 },
                  { label: "Under $1,000", val: 1000 },
                  { label: "Under $5,000", val: 5000 },
                ].map((o) => (
                  <RadioOption key={o.val} label={o.label} checked={filters.maxPrice === o.val} onClick={() => set("maxPrice", o.val)} />
                ))}
              </div>
            </AccordionSection>

            <div className="h-px bg-[#243352]" />

            <AccordionSection title="Delivery Time">
              <div className="space-y-1 mb-2">
                {[
                  { label: "Any", val: 30 },
                  { label: "Same day – 2 days", val: 2 },
                  { label: "Up to 5 days", val: 5 },
                  { label: "Up to 14 days", val: 14 },
                ].map((o) => (
                  <RadioOption key={o.val} label={o.label} checked={filters.maxDelivery === o.val} onClick={() => set("maxDelivery", o.val)} />
                ))}
              </div>
            </AccordionSection>

            <div className="h-px bg-[#243352]" />

            <AccordionSection title="Human Review">
              <div className="space-y-1 mb-2">
                {[
                  { label: "Any", val: null },
                  { label: "Included", val: true },
                  { label: "AI Only", val: false },
                ].map((o) => (
                  <RadioOption key={String(o.val)} label={o.label} checked={filters.humanReview === o.val} onClick={() => set("humanReview", o.val)} />
                ))}
              </div>
            </AccordionSection>

            <div className="h-px bg-[#243352]" />

            <AccordionSection title="Rating">
              <div className="space-y-1 mb-2">
                {[
                  { label: "Any rating", val: 0 },
                  { label: "4.0 & above", val: 4.0 },
                  { label: "4.5 & above", val: 4.5 },
                ].map((o) => (
                  <RadioOption key={o.val} label={o.label} checked={filters.minRating === o.val} onClick={() => set("minRating", o.val)} />
                ))}
              </div>
            </AccordionSection>

            <div className="h-px bg-[#243352]" />

            <AccordionSection title="Commercial Ready" defaultOpen={false}>
              <div className="space-y-1 mb-2">
                {[
                  { label: "All", val: "" },
                  { label: "Fixed Price", val: "fixed_price" },
                  { label: "Custom Project", val: "custom_project" },
                  { label: "Enterprise", val: "enterprise" },
                ].map((o) => (
                  <RadioOption key={o.val} label={o.label} checked={filters.flow === o.val} onClick={() => set("flow", o.val)} />
                ))}
              </div>
            </AccordionSection>
          </div>

          {activeCount > 0 && (
            <button
              onClick={onReset}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#8B9BC4] hover:text-[#F0F4FF] hover:border-[#7C6EFA] transition-all duration-150"
              aria-label="Reset all filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear {activeCount} filter{activeCount > 1 ? "s" : ""}
            </button>
          )}
        </div>
      </aside>
    </>
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
              <History className="w-3 h-3" /> Recent Searches
            </p>
            <button onClick={onClearRecent} className="text-[11px] text-[#8B9BC4] hover:text-[#7C6EFA] transition-colors">
              Clear
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
          <Flame className="w-3 h-3 text-[#F97316]" /> Popular Searches
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
        <span>to close</span>
        <span className="mx-1">·</span>
        <kbd className="px-1.5 py-0.5 rounded bg-[#131E35] border border-[#2E4270] font-mono text-[10px]">/</kbd>
        <span>to focus search</span>
      </div>
    </motion.div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="col-span-full flex flex-col items-center justify-center py-24 text-center"
    >
      {/* SVG Illustration */}
      <div className="mb-8 relative">
        <div className="w-24 h-24 rounded-3xl border border-[#2E4270] flex items-center justify-center"
             style={{ background: "linear-gradient(135deg, #0D1526 0%, #131E35 100%)" }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="22" cy="22" r="14" stroke="#2E4270" strokeWidth="2" />
            <circle cx="22" cy="22" r="14" stroke="url(#srGrad)" strokeWidth="2" strokeDasharray="4 2" />
            <path d="M32 32L40 40" stroke="#7C6EFA" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M18 22H26M22 18V26" stroke="#8B9BC4" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
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
        No services found
      </h3>
      <p className="text-[#8B9BC4] text-sm max-w-xs mb-8 leading-relaxed">
        Try adjusting your search terms or filters. We have 150+ AI services that might fit your needs.
      </p>
      <div className="flex items-center gap-3 flex-wrap justify-center">
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#F0F4FF] hover:bg-[#131E35] hover:border-[#7C6EFA]/40 transition-all duration-150"
        >
          <RotateCcw className="w-4 h-4" />
          Reset all filters
        </button>
        <Link href="/services" className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
              style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", color: "#fff" }}>
          <Sparkles className="w-4 h-4" />
          Browse all services
        </Link>
      </div>
    </motion.div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  iconColor,
  title,
  badge,
  children,
}: {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      className="flex items-center gap-3 mb-6 flex-wrap"
    >
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: iconColor }} />
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-lg text-[#F0F4FF]">{title}</h2>
      </div>
      {badge && badge}
      <div className="flex-1 h-px bg-[#243352] min-w-[20px]" />
      {children}
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [sort, setSort] = useState<SortKey>("popular");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [recentlyViewed, setRecentlyViewed] = useState<number[]>([]);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const PAGE_SIZE = 9;

  const { data: categories = [], isLoading: loadingCategories } = useCategories();
  const { data: allServices = [], isLoading: loadingServices } = useServices(undefined);

  // Load persisted state
  useEffect(() => {
    try {
      const rv = localStorage.getItem(RECENTLY_VIEWED_KEY);
      if (rv) setRecentlyViewed(JSON.parse(rv) as number[]);
      const rs = localStorage.getItem(RECENT_SEARCH_KEY);
      if (rs) setRecentSearches(JSON.parse(rs) as string[]);
    } catch { /* ignore */ }
  }, []);

  // Keyboard shortcut: "/" to focus search
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

  const handleSearchBlur = () => {
    // Delay so clicks on dropdown items register first
    setTimeout(() => setSearchFocused(false), 200);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      addRecentSearch(search.trim());
      setSearchFocused(false);
    }
  };

  const featured = useMemo(() => {
    if (allServices.length === 0) return [];
    return allServices.filter((_, i) => i % 3 === 0).slice(0, 4);
  }, [allServices]);

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

    if (filters.maxPrice < 999_999_999) {
      list = list.filter((s) => Number(s.startingPrice) <= filters.maxPrice || s.currency === "IDR");
    }

    if (filters.maxDelivery < 30) {
      list = list.filter((s) => deliveryDays(s.estimatedDelivery) <= filters.maxDelivery);
    }

    if (filters.humanReview !== null) {
      list = list.filter((s) => s.humanReview === filters.humanReview);
    }

    if (filters.minRating > 0) {
      list = list.filter((s) => Number(mockRating(s.id)) >= filters.minRating);
    }

    if (filters.flow) {
      list = list.filter((s) => s.serviceFlow === filters.flow);
    }

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
      default:
        list.sort((a, b) => mockCompleted(b.id) - mockCompleted(a.id));
    }

    return list;
  }, [allServices, categoryId, search, filters, sort]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = page < totalPages;

  useEffect(() => { setPage(1); }, [search, categoryId, sort, filters]);

  const resetAll = () => {
    setSearch("");
    setCategoryId(undefined);
    setSort("popular");
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const handleLoadMore = () => {
    setLoadingMore(true);
    setTimeout(() => {
      setPage((p) => p + 1);
      setLoadingMore(false);
    }, 500);
  };

  const recentServices = allServices.filter((s) => recentlyViewed.includes(s.id));
  const recommended = allServices
    .filter((s) => !recentlyViewed.includes(s.id))
    .sort((a, b) => mockCompleted(b.id) - mockCompleted(a.id))
    .slice(0, 4);

  const isLoading = loadingServices;
  const activeSort = SORT_OPTIONS.find((o) => o.key === sort)!;
  const activeFilterCount = countActiveFilters(filters);
  const showDropdown = searchFocused && !search.trim();

  return (
    <Layout>
      <div className="bg-[#060B18] text-[#F0F4FF] min-h-screen">
        <div className="container mx-auto px-4 pt-6 max-w-5xl">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm transition-colors group" style={{ color: '#8B9BC4' }}>
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Kembali
          </Link>
        </div>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#060B18] border-b border-[#243352]">
          {/* Animated ambient background */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <motion.div
              animate={{ scale: [1, 1.1, 1], opacity: [0.08, 0.14, 0.08] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full"
              style={{ background: "radial-gradient(ellipse, #7C6EFA 0%, transparent 70%)", filter: "blur(60px)" }}
            />
            <motion.div
              animate={{ scale: [1, 1.15, 1], opacity: [0.06, 0.1, 0.06] }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
              className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full"
              style={{ background: "radial-gradient(ellipse, #22D3EE 0%, transparent 70%)", filter: "blur(50px)" }}
            />
            {/* Subtle grid */}
            <div className="absolute inset-0 opacity-[0.025]"
                 style={{ backgroundImage: "linear-gradient(#7C6EFA 1px, transparent 1px), linear-gradient(90deg, #7C6EFA 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
          </div>

          <div className="relative container mx-auto px-4 md:px-8 max-w-5xl py-16 md:py-24 text-center">
            {/* Enterprise badge */}
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex items-center justify-center gap-3 mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2E4270] bg-[#0D1526]/70 text-xs font-semibold text-[#7C6EFA]">
                <Sparkles className="w-3.5 h-3.5" />
                AI Service Catalog — {allServices.length > 0 ? `${allServices.length}+ services` : "150+ services"}
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/8 text-xs font-semibold text-[#F59E0B]">
                <Award className="w-3.5 h-3.5" />
                Enterprise Grade
              </div>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="show"
              style={{ animationDelay: "60ms", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              className="font-bold text-4xl md:text-6xl lg:text-7xl mb-5 leading-[1.08] text-[#F0F4FF]"
            >
              Choose Your{" "}
              <span className="text-gradient-primary">AI Specialist</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="show"
              style={{ animationDelay: "120ms" }}
              className="text-base md:text-lg text-[#8B9BC4] max-w-2xl mx-auto mb-10"
            >
              Explore AI services across Creative, Finance, Legal, Logistics, Procurement,
              Trading, HR, Marketing, Executive and more.
            </motion.p>

            {/* Search bar */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              style={{ animationDelay: "180ms" }}
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
                  placeholder="Search AI services…"
                  aria-label="Search AI services"
                  className="w-full pl-14 pr-16 py-4 rounded-2xl bg-[#131E35] border border-[#2E4270]
                             text-base text-[#F0F4FF] placeholder:text-[#8B9BC4]/60 outline-none transition-all duration-200
                             focus:border-[#7C6EFA] focus:shadow-[0_0_0_3px_rgba(124,110,250,0.15)]"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {search ? (
                    <button
                      onClick={() => setSearch("")}
                      className="text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors"
                      aria-label="Clear search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : (
                    <kbd className="hidden sm:flex px-1.5 py-0.5 rounded bg-[#0D1526] border border-[#2E4270] font-mono text-[10px] text-[#8B9BC4] items-center gap-0.5">
                      /
                    </kbd>
                  )}
                </div>
              </div>

              {/* Search Dropdown */}
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

            {/* Quick category shortcuts */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="show"
              style={{ animationDelay: "240ms" }}
              className="flex items-center justify-center gap-2 mt-5 flex-wrap"
            >
              <span className="text-xs text-[#8B9BC4]">Quick:</span>
              {["Creative AI", "Finance AI", "Legal AI", "Marketing AI"].map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleSearchSelect(tag.replace(" AI", ""))}
                  className="text-xs px-3 py-1 rounded-full border border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/50 hover:text-[#7C6EFA] transition-all duration-150"
                >
                  {tag}
                </button>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ── Category filter ────────────────────────────────────────────── */}
        <section className="sticky top-0 z-20 bg-[#060B18]/90 backdrop-blur-md border-b border-[#243352]">
          <div className="container mx-auto px-4 md:px-8 max-w-7xl">
            <div
              ref={categoryScrollRef}
              className="flex items-center gap-2 py-3 overflow-x-auto"
              style={{ scrollbarWidth: "none" }}
              role="navigation"
              aria-label="Service categories"
            >
              <button
                onClick={() => setCategoryId(undefined)}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 ${
                  categoryId === undefined
                    ? "bg-[#7C6EFA] text-[#F0F4FF] border-transparent shadow-[0_2px_12px_rgba(124,110,250,0.3)]"
                    : "border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/40 hover:text-[#F0F4FF]"
                }`}
                aria-pressed={categoryId === undefined}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                All Services
              </button>

              {loadingCategories
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="shrink-0 h-9 w-28 rounded-full bg-[#131E35] animate-pulse" />
                  ))
                : categories.map((cat) => {
                    const Icon = getCategoryIcon(cat);
                    const active = categoryId === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setCategoryId(active ? undefined : cat.id)}
                        aria-pressed={active}
                        className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 ${
                          active
                            ? "bg-[#7C6EFA] text-[#F0F4FF] border-transparent shadow-[0_2px_12px_rgba(124,110,250,0.3)] scale-105"
                            : "border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/40 hover:text-[#F0F4FF] hover:scale-105"
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
              <SectionHeader icon={Zap} iconColor="#F59E0B" title="Featured Services" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* First card: hero size spanning 2 cols */}
                {featured[0] && (() => {
                  const s = featured[0];
                  const badge = serviceBadge(s) ?? { label: "Featured", color: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30" };
                  return (
                    <motion.div
                      key={s.id}
                      variants={fadeUp}
                      initial="hidden"
                      whileInView="show"
                      viewport={{ once: true }}
                      className="sm:col-span-2 lg:col-span-2"
                    >
                      <Link
                        href={`/services/${s.id}`}
                        onClick={() => trackView(s.id)}
                        className="group relative block rounded-2xl p-6 h-full transition-all duration-200 hover:-translate-y-1 overflow-hidden"
                        style={{ background: "linear-gradient(135deg, #111C38 0%, #0D1526 100%)", border: "1px solid #2E4270" }}
                      >
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                             style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.1) 0%, rgba(34,211,238,0.05) 100%)", boxShadow: "inset 0 0 0 1px rgba(124,110,250,0.3)" }} />
                        <div className="relative z-[1]">
                          <div className="flex items-start justify-between mb-4">
                            <div className="w-14 h-14 rounded-2xl border border-[#7C6EFA]/20 flex items-center justify-center"
                                 style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.25) 0%, rgba(34,211,238,0.15) 100%)" }}>
                              <Sparkles className="w-6 h-6 text-[#7C6EFA] group-hover:scale-110 transition-transform duration-200" />
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
                              {badge.label}
                            </span>
                          </div>
                          <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-xl leading-snug mb-2 text-[#F0F4FF] group-hover:text-[#7C6EFA] transition-colors">
                            {s.serviceName}
                          </p>
                          <p className="text-sm text-[#8B9BC4] leading-relaxed mb-6 line-clamp-3">{s.shortDescription}</p>
                          <div className="flex items-center gap-4 text-xs text-[#8B9BC4] mb-4">
                            <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-[#F59E0B] text-[#F59E0B]" />{mockRating(s.id)}</span>
                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-[#22D3EE]" />{s.estimatedDelivery}</span>
                            {s.humanReview && <span className="flex items-center gap-1 text-[#7C6EFA]"><Shield className="w-3.5 h-3.5" />Human Review</span>}
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[11px] text-[#8B9BC4] mb-0.5">Starting from</p>
                              <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-bold text-lg text-[#F0F4FF]">{formatPrice(s.startingPrice, s.currency)}</p>
                            </div>
                            <div className="flex items-center gap-2 text-sm font-semibold text-[#7C6EFA] group-hover:gap-3 transition-all">
                              View Detail <ArrowRight className="w-4 h-4" />
                            </div>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })()}

                {/* Remaining 3 cards */}
                {featured.slice(1).map((s, idx) => {
                  const badge = serviceBadge(s) ?? { label: "Featured", color: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30" };
                  return (
                    <motion.div
                      key={s.id}
                      variants={fadeUp}
                      initial="hidden"
                      whileInView="show"
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <Link
                        href={`/services/${s.id}`}
                        onClick={() => trackView(s.id)}
                        className="group block bg-[#0D1526] border border-[#2E4270] rounded-2xl p-5 h-full flex flex-col gap-3 hover:border-[#7C6EFA]/50 hover:shadow-[0_8px_24px_rgba(124,110,250,0.15)] hover:-translate-y-1 transition-all duration-200"
                      >
                        <div className="flex items-start justify-between">
                          <div className="w-10 h-10 rounded-xl border border-[#7C6EFA]/20 flex items-center justify-center"
                               style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.25) 0%, rgba(34,211,238,0.15) 100%)" }}>
                            <Sparkles className="w-4 h-4 text-[#7C6EFA] group-hover:scale-110 transition-transform" />
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>{badge.label}</span>
                        </div>
                        <div className="flex-1">
                          <p style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="font-semibold text-sm leading-snug mb-1 text-[#F0F4FF] group-hover:text-[#7C6EFA] transition-colors">{s.serviceName}</p>
                          <p className="text-xs text-[#8B9BC4] line-clamp-2">{s.shortDescription}</p>
                        </div>
                        <div className="mt-auto flex items-center justify-between pt-2 border-t border-[#243352]">
                          <span className="text-xs font-bold text-[#F0F4FF]">{formatPrice(s.startingPrice, s.currency)}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-[#8B9BC4] group-hover:text-[#7C6EFA] group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Recommended for You ──────────────────────────────────────── */}
          {!search && categoryId === undefined && recommended.length > 0 && (
            <section className="mb-14">
              <SectionHeader
                icon={TrendingUp}
                iconColor="#22D3EE"
                title="Recommended For You"
                badge={
                  <span className="text-[11px] text-[#8B9BC4] bg-[#131E35] border border-[#2E4270] px-2 py-0.5 rounded-full">
                    Based on popularity
                  </span>
                }
              />
              <motion.div
                variants={staggerGrid}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              >
                {recommended.map((s) => (
                  <motion.div key={s.id} variants={cardVariant}>
                    <Link
                      href={`/services/${s.id}`}
                      onClick={() => trackView(s.id)}
                      className="group block bg-[#0D1526] border border-[#2E4270] rounded-2xl p-4 flex flex-col gap-2 hover:border-[#22D3EE]/50 hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(34,211,238,0.1)] transition-all duration-200"
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
                  </motion.div>
                ))}
              </motion.div>
            </section>
          )}

          {/* ── Recently Viewed ───────────────────────────────────────────── */}
          {recentServices.length > 0 && !search && (
            <section className="mb-14">
              <SectionHeader icon={Eye} iconColor="#8B9BC4" title="Recently Viewed">
                <button
                  onClick={() => {
                    setRecentlyViewed([]);
                    localStorage.removeItem(RECENTLY_VIEWED_KEY);
                  }}
                  className="text-xs text-[#8B9BC4] hover:text-[#F0F4FF] transition-colors ml-2"
                  aria-label="Clear recently viewed"
                >
                  Clear
                </button>
              </SectionHeader>
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

          {/* ── Main grid: sidebar + cards ───────────────────────────────── */}
          <div className="flex gap-8 items-start">
            <FilterSidebar
              filters={filters}
              onChange={setFilters}
              onReset={resetAll}
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />

            <div className="flex-1 min-w-0">
              {/* Toolbar */}
              <div className="flex items-center gap-3 mb-6 flex-wrap">
                {/* Mobile filter toggle */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:border-[#7C6EFA]/40 transition-colors bg-[#0D1526] relative"
                  aria-label="Open filters"
                >
                  <Filter className="w-4 h-4" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#7C6EFA] text-[10px] font-bold text-white flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </button>

                {/* Active filter badges */}
                {activeFilterCount > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {filters.maxPrice < 999_999_999 && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#7C6EFA]/10 border border-[#7C6EFA]/30 text-[11px] text-[#7C6EFA]">
                        Price
                        <button onClick={() => setFilters(f => ({ ...f, maxPrice: DEFAULT_FILTERS.maxPrice }))} className="hover:text-white ml-0.5" aria-label="Remove price filter"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    )}
                    {filters.maxDelivery < 30 && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22D3EE]/10 border border-[#22D3EE]/30 text-[11px] text-[#22D3EE]">
                        Delivery
                        <button onClick={() => setFilters(f => ({ ...f, maxDelivery: DEFAULT_FILTERS.maxDelivery }))} className="hover:text-white ml-0.5" aria-label="Remove delivery filter"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    )}
                    {filters.humanReview !== null && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 text-[11px] text-[#10B981]">
                        Human Review
                        <button onClick={() => setFilters(f => ({ ...f, humanReview: null }))} className="hover:text-white ml-0.5" aria-label="Remove human review filter"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    )}
                    {filters.flow && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[11px] text-[#8B5CF6]">
                        {filters.flow.replace(/_/g, " ")}
                        <button onClick={() => setFilters(f => ({ ...f, flow: "" }))} className="hover:text-white ml-0.5" aria-label="Remove flow filter"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    )}
                  </div>
                )}

                <p className="text-sm text-[#8B9BC4]">
                  <span className="font-semibold text-[#F0F4FF]">{filtered.length}</span> services
                  {(search || categoryId !== undefined) && " found"}
                </p>

                {/* Sort dropdown */}
                <div className="ml-auto relative">
                  <button
                    onClick={() => setSortOpen((v) => !v)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#2E4270] text-sm font-medium text-[#F0F4FF] hover:border-[#7C6EFA]/40 transition-colors bg-[#0D1526]"
                    aria-expanded={sortOpen}
                    aria-label="Sort services"
                  >
                    <activeSort.icon className="w-3.5 h-3.5 text-[#8B9BC4]" />
                    <span className="text-[#8B9BC4] hidden sm:inline">Sort:</span>
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
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[#131E35] ${
                                  sort === o.key ? "text-[#7C6EFA] font-semibold bg-[#7C6EFA]/5" : "text-[#8B9BC4]"
                                }`}
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
                  <motion.div
                    variants={staggerGrid}
                    initial="hidden"
                    animate="show"
                    key={`${search}-${categoryId}-${sort}-${JSON.stringify(filters)}`}
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
                          <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                        ) : (
                          <><ChevronDown className="w-4 h-4" /> Load More</>
                        )}
                      </button>
                      <p className="text-xs text-[#8B9BC4]">
                        Showing {paginated.length} of {filtered.length} services
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
                      All {filtered.length} services loaded
                    </motion.p>
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
