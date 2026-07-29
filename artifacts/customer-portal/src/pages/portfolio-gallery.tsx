import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
import { SEOMeta } from "@/components/SEOMeta";
  Briefcase, Globe, Star, Eye, ChevronRight, Search,
  Sparkles, ArrowRight, LayoutTemplate, Filter,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Portfolio {
  id: number;
  title: string;
  slug: string | null;
  industry: string;
  style: string;
  businessType: string | null;
  packageLevel: string | null;
  coverImage: string | null;
  shortDescription: string | null;
  primaryColor: string | null;
  rating: string | null;
  views: number;
  featured: boolean;
  serviceId: number;
  colorTags: string[] | null;
}

interface PortfolioList { items: Portfolio[]; total: number }

interface IndustryShowcaseItem {
  industry: string;
  topTemplate: { id: number; name: string; category: string; colorTheme: { primary: string } | null } | null;
  totalTemplates: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  "All", "Trading", "Healthcare", "Manufacturing", "Export", "Construction",
  "Technology", "Logistics", "F&B", "Education", "Property", "Legal", "Finance", "Retail",
];

const STYLES = ["All", "Modern", "Classic", "Minimalist", "Bold", "Elegant", "Professional", "Corporate", "Creative"];

const INDUSTRY_ICONS: Record<string, string> = {
  Trading: "📦", Healthcare: "🏥", Manufacturing: "🏭", Export: "🌏",
  Construction: "🏗️", Technology: "💻", Logistics: "🚚", "F&B": "🍜",
  Education: "🎓", Property: "🏢", Legal: "⚖️", Finance: "💰", Retail: "🛍️",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function PortfolioCard({ portfolio }: { portfolio: Portfolio }) {
  const color = portfolio.primaryColor ?? portfolio.colorTags?.[0] ?? "#6366F1";
  return (
    <Link href={`/portfolio/${portfolio.slug ?? portfolio.id}`}>
      <div className="group rounded-2xl overflow-hidden border cursor-pointer transition-all hover:shadow-xl hover:-translate-y-1"
        style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
        {/* Cover */}
        <div className="relative h-48 overflow-hidden" style={{ background: color }}>
          {portfolio.coverImage
            ? <img src={portfolio.coverImage} alt={portfolio.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-80" />
            : (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl">{INDUSTRY_ICONS[portfolio.industry] ?? "📋"}</span>
                <p className="text-white/60 text-xs mt-2">{portfolio.industry}</p>
              </div>
            )
          }
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          {/* Badges */}
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
            <span className="text-white font-semibold text-sm">{portfolio.industry}</span>
            {portfolio.featured && (
              <span className="text-xs px-2 py-0.5 rounded-full text-amber-800 bg-amber-400 font-semibold">
                <Star className="w-3 h-3 inline mr-0.5" />Featured
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="p-4 space-y-2.5">
          <h3 className="font-semibold text-sm text-white leading-tight">{portfolio.title}</h3>
          <p className="text-xs text-slate-400">{portfolio.style} · {portfolio.businessType ?? portfolio.packageLevel ?? ""}</p>
          {portfolio.shortDescription && (
            <p className="text-xs text-slate-500 line-clamp-2">{portfolio.shortDescription}</p>
          )}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{portfolio.views}</span>
              {portfolio.rating && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" />{parseFloat(portfolio.rating).toFixed(1)}</span>}
            </div>
            <span className="text-xs font-semibold text-violet-400">View Work →</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function IndustryCard({ item }: { item: IndustryShowcaseItem }) {
  const bgColor = item.topTemplate?.colorTheme?.primary ?? "#6366F1";
  return (
    <Link href={`/template-gallery?industry=${item.industry}`}>
      <div className="group rounded-2xl overflow-hidden border cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5"
        style={{ background: "rgba(15,20,40,0.8)", borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="h-24 flex items-center justify-center relative"
          style={{ background: bgColor }}>
          <span className="text-4xl">{INDUSTRY_ICONS[item.industry] ?? "🏢"}</span>
          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
        </div>
        <div className="p-4">
          <h3 className="font-semibold text-sm text-white">{item.industry}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{item.totalTemplates} templates available</p>
          {item.topTemplate && (
            <p className="text-xs text-violet-400 mt-1 flex items-center gap-1">
              Top: {item.topTemplate.name} <ArrowRight className="w-3 h-3" />
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PortfolioGalleryPage() {
  const [industryFilter, setIndustryFilter] = useState("All");
  const [styleFilter, setStyleFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "rating">("popular");

  // Fetch portfolios from existing portfolio-public route
  const portfolioParams = new URLSearchParams({
    ...(industryFilter !== "All" ? { industry: industryFilter } : {}),
    ...(styleFilter !== "All" ? { style: styleFilter } : {}),
    ...(search ? { search } : {}),
    limit: "24",
  });

  const { data: portfolioData, isLoading: portfolioLoading } = useQuery<PortfolioList>({
    queryKey: ["public-portfolios-gallery", industryFilter, styleFilter, search, sortBy],
    queryFn: () => fetch(`/api/public/portfolio?${portfolioParams.toString()}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  const { data: showcaseData } = useQuery<{ items: IndustryShowcaseItem[] }>({
    queryKey: ["public-industry-showcase"],
    queryFn: () => fetch("/api/public/templates/industry-showcase").then((r) => r.json()),
    staleTime: 120_000,
  });

  const portfolios = portfolioData?.items ?? [];
  const showcase = showcaseData?.items ?? [];

  return (
    <div className="min-h-screen" style={{ background: "#080C1A" }}>
      <SEOMeta
        title="Portfolio Proyek Kreatif"
        description="Lihat portofolio proyek kreatif AI kami — branding, packaging, interior, fashion, dan marketing yang telah diselesaikan untuk klien di Indonesia."
        canonical="/portfolio-gallery"
      />
      {/* Hero */}
      <div className="relative py-16 text-center overflow-hidden px-4"
        style={{ background: "linear-gradient(180deg, rgba(59,130,246,0.15) 0%, transparent 100%)" }}>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4 border"
          style={{ background: "rgba(59,130,246,0.15)", borderColor: "rgba(59,130,246,0.3)", color: "#93C5FD" }}>
          <Briefcase className="w-3.5 h-3.5" />Real Client Results · AI-Generated
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3" style={{ fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
          Portfolio Gallery
        </h1>
        <p className="text-lg text-slate-400 max-w-lg mx-auto mb-8">
          See real results from real clients across 13 industries.
          This is what AI-powered professional design looks like.
        </p>
        <div className="max-w-md mx-auto relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by brand, industry, style…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm text-white placeholder-slate-500 border focus:outline-none"
            style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)" }}
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-16 space-y-12">
        {/* Industry Showcase */}
        {showcase.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-lg text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-400" />Industry Showcase
              </h2>
              <Link href="/template-gallery" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                View All Templates <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {showcase.slice(0, 10).map((item) => (
                <IndustryCard key={item.industry} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Portfolio Filter */}
        <div className="space-y-4">
          <h2 className="font-bold text-lg text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-blue-400" />Client Portfolio
          </h2>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-2 flex-wrap">
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind}
                  onClick={() => setIndustryFilter(ind)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                    industryFilter === ind
                      ? "text-white border-blue-500"
                      : "text-slate-400 border-slate-700 hover:border-slate-500"
                  }`}
                  style={industryFilter === ind ? { background: "linear-gradient(135deg,#3B82F6,#1D4ED8)" } : {}}
                >
                  {ind}
                </button>
              ))}
            </div>
          </div>

          {/* Style + Sort */}
          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={styleFilter}
              onChange={(e) => setStyleFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-sm border focus:outline-none"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)", color: "#CBD5E1" }}
            >
              {STYLES.map((s) => <option key={s} value={s}>{s} Style</option>)}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-1.5 rounded-lg text-sm border focus:outline-none"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)", color: "#CBD5E1" }}
            >
              <option value="popular">Most Popular</option>
              <option value="newest">Newest</option>
              <option value="rating">Highest Rated</option>
            </select>
            <p className="text-xs text-slate-500 ml-auto">{portfolioData?.total ?? 0} portfolios</p>
          </div>
        </div>

        {/* Portfolio Grid */}
        {portfolioLoading && (
          <div className="text-center py-16 text-slate-500">
            <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30 animate-pulse" />
            <p className="text-sm">Loading portfolios…</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {portfolios.map((p) => <PortfolioCard key={p.id} portfolio={p} />)}
        </div>

        {portfolios.length === 0 && !portfolioLoading && (
          <div className="text-center py-16 text-slate-500">
            <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No portfolios found. Try adjusting your filters.</p>
          </div>
        )}

        {/* Bottom CTA */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-2xl p-6 space-y-3"
            style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.2), rgba(95,82,208,0.2))", border: "1px solid rgba(124,110,250,0.3)" }}>
            <LayoutTemplate className="w-6 h-6 text-violet-400" />
            <h3 className="font-bold text-white">Browse Templates</h3>
            <p className="text-sm text-slate-400">See 60+ templates ready for customization with your brand identity.</p>
            <Link href="/template-gallery"
              className="inline-flex items-center gap-2 text-sm font-semibold text-violet-300 hover:text-violet-200">
              View Template Gallery <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="rounded-2xl p-6 space-y-3"
            style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(29,78,216,0.2))", border: "1px solid rgba(59,130,246,0.3)" }}>
            <Sparkles className="w-6 h-6 text-blue-400" />
            <h3 className="font-bold text-white">Start Your Project</h3>
            <p className="text-sm text-slate-400">Choose a service, select a template, and get professional results in days.</p>
            <Link href="/services"
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-300 hover:text-blue-200">
              Get Started <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
