import { useState, useRef, useCallback } from "react";
import { Star, Images, Clock, SlidersHorizontal, X, TrendingUp, Sparkles, ChevronDown } from "lucide-react";
import type { Portfolio } from "@/hooks/use-portfolio";
import { useRecordPortfolioView } from "@/hooks/use-portfolio";

// ── Constants ──────────────────────────────────────────────────────────────────

const INDUSTRY_LABELS: Record<string, string> = {
  coffee: "Coffee Shop", restaurant: "Restaurant", hotel: "Hotel",
  manufacturing: "Manufacturing", mining: "Mining", trading: "Trading",
  logistics: "Logistics", construction: "Construction", medical: "Medical",
  education: "Education", retail: "Retail", fashion: "Fashion",
  technology: "Technology", government: "Government", other: "Other",
};

const STYLE_OPTIONS = [
  "Minimalist", "Luxury", "Modern", "Corporate", "Elegant",
  "Creative", "Premium", "Industrial", "Classic", "Bold",
];

const DELIVERABLE_ICONS: Record<string, string> = {
  PNG: "🖼️", SVG: "✏️", AI: "🎨", PSD: "🖌️", PDF: "📄",
  DOCX: "📝", PPTX: "📊", ZIP: "🗜️",
  "Brand Guideline": "📐", "Editable Source": "🔓", "Commercial License": "⚖️",
};

// ── Before/After Drag Slider ───────────────────────────────────────────────────

function BeforeAfterSlider({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePos = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setPos(x);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative select-none rounded-xl overflow-hidden aspect-[4/3] cursor-ew-resize mb-5"
      onMouseDown={(e) => { dragging.current = true; updatePos(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) updatePos(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchStart={(e) => updatePos(e.touches[0].clientX)}
      onTouchMove={(e) => updatePos(e.touches[0].clientX)}
    >
      {/* After (base layer) */}
      <img src={after} alt="After" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      {/* Before (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <img src={before} alt="Before" className="w-full h-full object-cover" draggable={false} />
      </div>
      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-none"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center border border-border">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 7H1M1 7L3 5M1 7L3 9M10 7H13M13 7L11 5M13 7L11 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
      {/* Labels */}
      <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs font-medium">Before</span>
      <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">After</span>
    </div>
  );
}

// ── Filter Bar ─────────────────────────────────────────────────────────────────

type Filters = {
  industry: string;
  style: string;
  sort: "popular" | "latest" | "featured";
};

function FilterBar({
  portfolios,
  filters,
  onChange,
}: {
  portfolios: Portfolio[];
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  const [open, setOpen] = useState(false);

  // Derive available industries from actual data
  const industries = Array.from(new Set(portfolios.map((p) => p.industry))).sort();

  const hasActive = filters.industry !== "" || filters.style !== "" || filters.sort !== "featured";

  return (
    <div className="mb-5">
      {/* Top bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            open || hasActive
              ? "border-primary bg-primary/5 text-primary"
              : "border-border hover:border-primary/50"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {hasActive && <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">!</span>}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {/* Sort pills (always visible) */}
        {(["featured", "popular", "latest"] as const).map((s) => (
          <button
            key={s}
            onClick={() => onChange({ ...filters, sort: s })}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
              filters.sort === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary/50"
            }`}
          >
            {s === "popular" && <TrendingUp className="w-3 h-3" />}
            {s === "featured" && <Sparkles className="w-3 h-3" />}
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        {/* Active filter badges */}
        {filters.industry && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border border-border text-xs">
            {INDUSTRY_LABELS[filters.industry] ?? filters.industry}
            <button onClick={() => onChange({ ...filters, industry: "" })} className="hover:text-destructive">
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        {filters.style && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border border-border text-xs">
            {filters.style}
            <button onClick={() => onChange({ ...filters, style: "" })} className="hover:text-destructive">
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        {hasActive && (
          <button
            onClick={() => onChange({ industry: "", style: "", sort: "featured" })}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Expanded filter panel */}
      {open && (
        <div className="mt-3 p-4 rounded-2xl border border-border bg-card space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Industry</p>
            <div className="flex flex-wrap gap-1.5">
              {industries.map((ind) => (
                <button
                  key={ind}
                  onClick={() => onChange({ ...filters, industry: filters.industry === ind ? "" : ind })}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                    filters.industry === ind
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  {INDUSTRY_LABELS[ind] ?? ind}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Style</p>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onChange({ ...filters, style: filters.style === s ? "" : s })}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                    filters.style === s
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/40"
                  }`}
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

// ── Portfolio Modal ────────────────────────────────────────────────────────────

function PortfolioModal({ portfolio, onClose }: { portfolio: Portfolio; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-2xl max-w-3xl w-full max-h-[88vh] overflow-y-auto p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="text-xl font-serif font-medium">{portfolio.title}</h3>
            <p className="text-sm text-muted-foreground">
              {INDUSTRY_LABELS[portfolio.industry] ?? portfolio.industry}
              {portfolio.style ? ` · ${portfolio.style}` : ""}
              {portfolio.packageLabel ? ` · ${portfolio.packageLabel}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Before/After slider or cover image */}
        {portfolio.beforeImage && portfolio.afterImage ? (
          <BeforeAfterSlider before={portfolio.beforeImage} after={portfolio.afterImage} />
        ) : portfolio.coverImage ? (
          <img src={portfolio.coverImage} alt={portfolio.title} className="w-full rounded-xl mb-5 object-cover max-h-80" />
        ) : null}

        {/* Gallery grid */}
        {portfolio.galleryJson && portfolio.galleryJson.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-5">
            {portfolio.galleryJson.map((g, i) =>
              g.type === "image" ? (
                <img key={i} src={g.url} alt={g.caption ?? ""} className="w-full aspect-square object-cover rounded-lg" />
              ) : (
                <a
                  key={i}
                  href={g.url}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full aspect-square rounded-lg border border-border flex items-center justify-center text-xs text-muted-foreground text-center p-2 hover:bg-muted"
                >
                  {g.caption ?? g.type}
                </a>
              )
            )}
          </div>
        )}

        {portfolio.description && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">{portfolio.description}</p>
        )}

        {/* Deliverables */}
        {portfolio.deliverablesJson && portfolio.deliverablesJson.length > 0 && (
          <div className="mb-5">
            <p className="text-sm font-medium mb-2">Deliverable formats</p>
            <div className="flex flex-wrap gap-2">
              {portfolio.deliverablesJson.map((d, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs"
                >
                  <span>{DELIVERABLE_ICONS[d] ?? "📦"}</span>
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Workflow steps (this portfolio's specific process) */}
        {portfolio.workflowJson && portfolio.workflowJson.length > 0 && (
          <div className="mb-5">
            <p className="text-sm font-medium mb-2">How it was made</p>
            <div className="flex flex-wrap gap-2">
              {portfolio.workflowJson.map((w, i) => (
                <span key={i} className="px-3 py-1.5 rounded-full bg-muted text-xs">
                  {i + 1}. {w.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tools */}
        {portfolio.toolsUsedJson && portfolio.toolsUsedJson.length > 0 && (
          <p className="text-xs text-muted-foreground mt-4">
            🔧 Built with {portfolio.toolsUsedJson.join(", ")}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
          {portfolio.rating && (
            <span className="inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {portfolio.rating}
            </span>
          )}
          {portfolio.deliveryTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {portfolio.deliveryTime}
            </span>
          )}
          {portfolio.views > 0 && <span>{portfolio.views} views</span>}
          {portfolio.completedProjects > 0 && <span>{portfolio.completedProjects} completed</span>}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PortfolioGallery({ portfolios }: { portfolios: Portfolio[] }) {
  const [active, setActive] = useState<Portfolio | null>(null);
  const [filters, setFilters] = useState<Filters>({ industry: "", style: "", sort: "featured" });
  const recordView = useRecordPortfolioView();

  if (portfolios.length === 0) return null;

  const openItem = (p: Portfolio) => {
    setActive(p);
    recordView.mutate(p.id);
  };

  // Apply filters
  let filtered = portfolios.filter((p) => {
    if (filters.industry && p.industry !== filters.industry) return false;
    if (filters.style && p.style.toLowerCase() !== filters.style.toLowerCase()) return false;
    return true;
  });

  // Apply sort
  if (filters.sort === "popular") {
    filtered = [...filtered].sort((a, b) => b.views - a.views);
  } else if (filters.sort === "latest") {
    filtered = [...filtered].sort((a, b) => b.displayOrder - a.displayOrder);
  } else {
    // featured: featured first, then display order
    filtered = [...filtered].sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.displayOrder - b.displayOrder;
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Images className="w-5 h-5 text-primary" />
        <h2 className="font-serif text-lg font-medium">Creative Showcase</h2>
        <span className="text-xs text-muted-foreground">({portfolios.length} projects)</span>
      </div>

      <FilterBar portfolios={portfolios} filters={filters} onChange={setFilters} />

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No projects match these filters.{" "}
          <button
            className="underline hover:text-foreground"
            onClick={() => setFilters({ industry: "", style: "", sort: "featured" })}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => openItem(p)}
              className="text-left group rounded-2xl overflow-hidden border border-card-border bg-card hover:shadow-md transition-shadow"
            >
              <div className="aspect-[4/3] bg-muted overflow-hidden relative">
                {p.coverImage ? (
                  <img
                    src={p.coverImage}
                    alt={p.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                    No cover image
                  </div>
                )}
                {p.featured && (
                  <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                    Featured
                  </span>
                )}
                {p.beforeImage && p.afterImage && (
                  <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs">
                    Before/After ↔
                  </span>
                )}
              </div>
              <div className="p-4 space-y-1.5">
                <p className="font-medium">{p.title}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                    {INDUSTRY_LABELS[p.industry] ?? p.industry}
                  </span>
                  {p.style && (
                    <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">
                      {p.style}
                    </span>
                  )}
                  {p.packageLabel && (
                    <span className="px-2 py-0.5 rounded-full border border-border text-xs text-muted-foreground">
                      {p.packageLabel}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
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
                  {p.completedProjects > 0 && (
                    <span>{p.completedProjects} projects</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {active && <PortfolioModal portfolio={active} onClose={() => setActive(null)} />}
    </section>
  );
}
