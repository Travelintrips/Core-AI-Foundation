import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Star, Clock, SlidersHorizontal, X, TrendingUp, Sparkles, ChevronDown, ArrowRight, Images, Loader2, ArrowLeft } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type GalleryItem = { type: string; url: string; caption?: string };

type PublicPortfolio = {
  id: number;
  serviceId: number;
  slug: string | null;
  title: string;
  shortDescription: string | null;
  industry: string;
  style: string;
  packageLabel: string | null;
  packageLevel: string | null;
  coverImage: string | null;
  galleryJson: GalleryItem[] | null;
  beforeImage: string | null;
  afterImage: string | null;
  deliverablesJson: string[] | null;
  workflowJson: Array<{ step: string; label: string }> | null;
  deliveryTime: string | null;
  rating: string | null;
  views: number;
  completedProjects: number;
  featured: boolean;
  isDemo: boolean;
};

type Filters = { industry: string; style: string; sort: "featured" | "popular" | "latest" | "rating" };

// ── Constants ─────────────────────────────────────────────────────────────────

const INDUSTRY_LABELS: Record<string, string> = {
  coffee: "Coffee Shop", restaurant: "Restaurant", hotel: "Hotel",
  logistics: "Logistics", "freight-forwarding": "Freight Forwarding",
  mining: "Mining", "palm-oil": "Palm Oil", trading: "Trading",
  "export-import": "Export Import", manufacturing: "Manufacturing",
  construction: "Construction", property: "Property", fashion: "Fashion",
  furniture: "Furniture", medical: "Medical", beauty: "Beauty",
  education: "Education", technology: "Technology", automotive: "Automotive",
  retail: "Retail", government: "Government", other: "Other",
};

// ── Before/After Slider ───────────────────────────────────────────────────────

function BeforeAfterSlider({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div
      className="relative select-none rounded-xl overflow-hidden aspect-[4/3] cursor-ew-resize mb-4"
      onMouseMove={(e) => {
        if (e.buttons !== 1) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setPos(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
      }}
      onTouchMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos(Math.max(0, Math.min(100, ((e.touches[0].clientX - rect.left) / rect.width) * 100)));
      }}
    >
      <img src={after} alt="After" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} alt="Before" className="w-full h-full object-cover" draggable={false} />
      </div>
      <div className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none" style={{ left: `${pos}%` }}>
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center border border-border">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M4 7H1M1 7L3 5M1 7L3 9M10 7H13M13 7L11 5M13 7L11 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      </div>
      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs">Before</span>
      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs">After</span>
    </div>
  );
}

// ── Portfolio Detail Modal ────────────────────────────────────────────────────

function PortfolioModal({ portfolio, onClose, onStartProject }: {
  portfolio: PublicPortfolio;
  onClose: () => void;
  onStartProject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-xl font-serif font-medium">{portfolio.title}</h3>
              {portfolio.isDemo && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">AI Demo</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {INDUSTRY_LABELS[portfolio.industry] ?? portfolio.industry}
              {portfolio.style ? ` · ${portfolio.style}` : ""}
              {portfolio.packageLabel ? ` · ${portfolio.packageLabel}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {portfolio.beforeImage && portfolio.afterImage ? (
          <BeforeAfterSlider before={portfolio.beforeImage} after={portfolio.afterImage} />
        ) : portfolio.coverImage ? (
          <img src={portfolio.coverImage} alt={portfolio.title} className="w-full rounded-xl mb-5 object-cover max-h-80" />
        ) : null}

        {portfolio.galleryJson && portfolio.galleryJson.length > 1 && (
          <div className="grid grid-cols-3 gap-2 mb-5">
            {portfolio.galleryJson.slice(1, 7).map((g, i) =>
              g.type === "image" ? (
                <img key={i} src={g.url} alt={g.caption ?? ""} className="w-full aspect-square object-cover rounded-lg" />
              ) : (
                <div key={i} className="w-full aspect-square rounded-lg border border-border flex items-center justify-center text-xs text-muted-foreground">{g.caption ?? g.type}</div>
              )
            )}
          </div>
        )}

        {portfolio.shortDescription && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">{portfolio.shortDescription}</p>
        )}

        {portfolio.deliverablesJson && portfolio.deliverablesJson.length > 0 && (
          <div className="mb-5">
            <p className="text-sm font-medium mb-2">Deliverables</p>
            <div className="flex flex-wrap gap-2">
              {portfolio.deliverablesJson.map((d, i) => (
                <span key={i} className="px-2.5 py-1 rounded-md border border-border text-xs">📦 {d}</span>
              ))}
            </div>
          </div>
        )}

        {portfolio.workflowJson && portfolio.workflowJson.length > 0 && (
          <div className="mb-5">
            <p className="text-sm font-medium mb-2">Process</p>
            <div className="flex flex-wrap gap-2">
              {portfolio.workflowJson.map((w, i) => (
                <span key={i} className="px-3 py-1.5 rounded-full bg-muted text-xs">{i + 1}. {w.label}</span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 pt-4 border-t border-border text-xs text-muted-foreground mb-5">
          {portfolio.rating && <span className="inline-flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{portfolio.rating}</span>}
          {portfolio.deliveryTime && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{portfolio.deliveryTime}</span>}
          {portfolio.views > 0 && <span>{portfolio.views.toLocaleString()} views</span>}
          {portfolio.completedProjects > 0 && <span>{portfolio.completedProjects} completed</span>}
        </div>

        {portfolio.isDemo && (
          <p className="text-xs text-muted-foreground mb-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
            ⚠️ AI Demo Project — This is a conceptual example using a fictional brand, not a real client project.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onStartProject}
            className="px-4 py-3 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            Start Similar Project
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-full border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            Browse More
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────

function FilterBar({ filters, industries, styles, onChange }: {
  filters: Filters;
  industries: string[];
  styles: string[];
  onChange: (f: Filters) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasActive = filters.industry !== "" || filters.style !== "" || filters.sort !== "featured";

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${open || hasActive ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50"}`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters {hasActive && <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">!</span>}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {(["featured", "popular", "latest", "rating"] as const).map((s) => (
          <button key={s} onClick={() => onChange({ ...filters, sort: s })}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${filters.sort === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50"}`}
          >
            {s === "popular" && <TrendingUp className="w-3 h-3" />}
            {s === "featured" && <Sparkles className="w-3 h-3" />}
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        {filters.industry && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border text-xs">
            {INDUSTRY_LABELS[filters.industry] ?? filters.industry}
            <button onClick={() => onChange({ ...filters, industry: "" })}><X className="w-3 h-3" /></button>
          </span>
        )}
        {filters.style && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border text-xs">
            {filters.style}
            <button onClick={() => onChange({ ...filters, style: "" })}><X className="w-3 h-3" /></button>
          </span>
        )}
        {hasActive && (
          <button onClick={() => onChange({ industry: "", style: "", sort: "featured" })} className="text-xs text-muted-foreground underline">
            Clear all
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 p-4 rounded-2xl border border-border bg-card space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Industry</p>
            <div className="flex flex-wrap gap-1.5">
              {industries.map((ind) => (
                <button key={ind} onClick={() => onChange({ ...filters, industry: filters.industry === ind ? "" : ind })}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${filters.industry === ind ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}
                >
                  {INDUSTRY_LABELS[ind] ?? ind}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Style</p>
            <div className="flex flex-wrap gap-1.5">
              {styles.map((s) => (
                <button key={s} onClick={() => onChange({ ...filters, style: filters.style === s ? "" : s })}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${filters.style === s ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Portfolio Page ───────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [, setLocation] = useLocation();
  const [portfolios, setPortfolios] = useState<PublicPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({ industry: "", style: "", sort: "featured" });
  const [filterOptions, setFilterOptions] = useState<{ industries: string[]; styles: string[] }>({ industries: [], styles: [] });
  const [activePortfolio, setActivePortfolio] = useState<PublicPortfolio | null>(null);
  const PAGE_SIZE = 24;

  // Load filter options once
  useEffect(() => {
    fetch("/api/public/portfolio/filters")
      .then((r) => r.json())
      .then((data) => setFilterOptions({ industries: data.industries ?? [], styles: data.styles ?? [] }))
      .catch(() => {});
  }, []);

  // Load portfolios when filters/page change
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: filters.sort });
    if (filters.industry) params.set("industry", filters.industry);
    if (filters.style) params.set("style", filters.style);

    fetch(`/api/public/portfolio?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPortfolios(data.items ?? []);
        setTotal(data.pagination?.total ?? 0);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load portfolio. Please try again.");
        setLoading(false);
      });
  }, [filters, page]);

  const handleFilterChange = (f: Filters) => {
    setFilters(f);
    setPage(1);
  };

  const openPortfolio = (p: PublicPortfolio) => {
    setActivePortfolio(p);
    fetch(`/api/public/portfolio/${p.id}/view`, { method: "POST" }).catch(() => {});
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 pt-6 max-w-5xl">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group">
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Kembali ke Beranda
        </Link>
      </div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/5 via-background to-secondary/5 border-b border-border px-4 pt-16 pb-12">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            AI Creative Studio
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium mb-4">Our Creative Portfolio</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg mb-8">
            Browse real AI-generated creative work across industries and styles. See what's possible before starting your project.
          </p>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <span>{total} projects</span>
            <span>·</span>
            <span>{filterOptions.industries.length} industries</span>
            <span>·</span>
            <span>{filterOptions.styles.length} styles</span>
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="max-w-6xl mx-auto px-4 py-10">
        <FilterBar
          filters={filters}
          industries={filterOptions.industries}
          styles={filterOptions.styles}
          onChange={handleFilterChange}
        />

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Loading portfolio…</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">{error}</div>
        ) : portfolios.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Images className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">No portfolios found</p>
            <p className="text-sm text-muted-foreground mb-4">Try adjusting your filters or clearing them.</p>
            <button onClick={() => handleFilterChange({ industry: "", style: "", sort: "featured" })} className="px-4 py-2 rounded-full border border-border text-sm hover:bg-muted transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {portfolios.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openPortfolio(p)}
                  className="text-left group rounded-2xl overflow-hidden border border-card-border bg-card hover:shadow-md transition-shadow"
                >
                  <div className="aspect-[4/3] bg-muted overflow-hidden relative">
                    {p.coverImage ? (
                      <img src={p.coverImage} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">No image</div>
                    )}
                    {p.featured && (
                      <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">Featured</span>
                    )}
                    {p.isDemo && (
                      <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-amber-500 text-white text-xs">AI Demo</span>
                    )}
                    {p.beforeImage && p.afterImage && (
                      <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs">Before/After ↔</span>
                    )}
                  </div>
                  <div className="p-4 space-y-1.5">
                    <p className="font-medium leading-snug">{p.title}</p>
                    {p.shortDescription && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{p.shortDescription}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                        {INDUSTRY_LABELS[p.industry] ?? p.industry}
                      </span>
                      {p.style && <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">{p.style}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                      {p.rating && <span className="inline-flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{p.rating}</span>}
                      {p.deliveryTime && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{p.deliveryTime}</span>}
                      {p.completedProjects > 0 && <span>{p.completedProjects} projects</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-10">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-4 py-2 rounded-full border border-border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-4 py-2 rounded-full border border-border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-muted/30 px-4 py-16">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-serif font-medium mb-3">Ready to create something like this?</h2>
          <p className="text-muted-foreground mb-8">Browse our services and get a personalized AI preview for free before committing.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button onClick={() => setLocation("/services")}
              className="px-6 py-3 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              Browse Services
            </button>
            <button onClick={() => setLocation("/")}
              className="px-6 py-3 rounded-full border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              Start a Project
            </button>
          </div>
        </div>
      </section>

      {activePortfolio && (
        <PortfolioModal
          portfolio={activePortfolio}
          onClose={() => setActivePortfolio(null)}
          onStartProject={() => {
            setActivePortfolio(null);
            setLocation("/services");
          }}
        />
      )}
    </div>
  );
}
