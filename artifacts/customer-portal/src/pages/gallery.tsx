/**
 * gallery.tsx — V4.3 Portfolio Gallery & Live Preview (Team 1)
 *
 * Public, no-auth "browse before you buy" surface built on the new
 * Team-1-owned /api/public/portfolio-gallery/* endpoints. Purely additive:
 * a new route (/gallery) alongside the existing /portfolio-gallery page,
 * not a replacement for it.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
import { SEOMeta } from "@/components/SEOMeta";
  Search, Sparkles, Star, Eye, Globe, Scale, X, Loader2,
} from "lucide-react";

interface GalleryCard {
  id: number;
  serviceId: number;
  slug: string | null;
  title: string;
  shortDescription: string | null;
  industry: string;
  style: string;
  coverImage: string | null;
  rating: string | null;
  views: number;
  featured: boolean;
  packageLabel: string | null;
  deliveryTime: string | null;
}

interface SearchResult {
  items: GalleryCard[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface IndustryShowcaseItem {
  industry: string;
  totalPortfolios: number;
  topPortfolio: GalleryCard | null;
}

interface CompareItem extends GalleryCard {
  businessSize: string | null;
  deliveryDays: number | null;
  deliverables: string[];
  tools: string[];
  completedProjects: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function Card({ item, onToggleCompare, selected }: { item: GalleryCard; onToggleCompare: (id: number) => void; selected: boolean }) {
  return (
    <div className="group rounded-2xl overflow-hidden border border-card-border bg-card hover:shadow-lg transition-all">
      <Link href={`/portfolio/${item.slug ?? item.id}`}>
        <div className="relative h-40 bg-muted overflow-hidden cursor-pointer">
          {item.coverImage ? (
            <img src={item.coverImage} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">{item.industry}</div>
          )}
          {item.featured && (
            <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 font-semibold flex items-center gap-1">
              <Star className="w-3 h-3" /> Featured
            </span>
          )}
        </div>
      </Link>
      <div className="p-3.5 space-y-2">
        <h3 className="font-semibold text-sm leading-tight">{item.title}</h3>
        <p className="text-xs text-muted-foreground">{item.industry} · {item.style}</p>
        {item.shortDescription && <p className="text-xs text-muted-foreground line-clamp-2">{item.shortDescription}</p>}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{item.views}</span>
            {item.rating && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" />{parseFloat(item.rating).toFixed(1)}</span>}
          </div>
          <button
            onClick={() => onToggleCompare(item.id)}
            className={`text-[11px] px-2 py-1 rounded-md border font-medium flex items-center gap-1 ${selected ? "bg-primary text-primary-foreground border-primary" : "border-card-border text-muted-foreground hover:border-primary/40"}`}
          >
            <Scale className="w-3 h-3" /> {selected ? "Selected" : "Compare"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState<string | undefined>(undefined);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareResult, setCompareResult] = useState<CompareItem[] | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (industry) p.set("industry", industry);
    p.set("pageSize", "24");
    return p.toString();
  }, [q, industry]);

  const { data: searchData, isLoading } = useQuery<SearchResult>({
    queryKey: ["portfolio-gallery-search", q, industry],
    queryFn: () => fetchJson(`/api/public/portfolio-gallery/search?${params}`),
    staleTime: 30_000,
  });

  const { data: showcaseData } = useQuery<{ featured: GalleryCard[]; industries: IndustryShowcaseItem[] }>({
    queryKey: ["portfolio-gallery-showcase"],
    queryFn: () => fetchJson("/api/public/portfolio-gallery/showcase"),
    staleTime: 60_000,
  });

  const compareMutation = useMutation({
    mutationFn: () => fetchJson<{ items: CompareItem[] }>("/api/public/portfolio-gallery/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: compareIds }),
    }),
    onSuccess: (data) => setCompareResult(data.items),
  });

  function toggleCompare(id: number) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  const items = searchData?.items ?? [];
  const industries = showcaseData?.industries ?? [];

  return (
    <div className="min-h-screen bg-background">
      <SEOMeta
        title="Galeri Karya Kreatif"
        description="Jelajahi galeri karya kreatif terbaik dari platform Creative Studio — inspirasi untuk proyek branding, desain, dan marketing Anda."
        canonical="/gallery"
      />
      <div className="border-b border-card-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-4 bg-primary/10 text-primary">
            <Sparkles className="w-3.5 h-3.5" /> Real Results, Before You Buy
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-semibold mb-3">Portfolio Gallery</h1>
          <p className="text-muted-foreground max-w-lg mx-auto mb-6">
            Search, browse by industry, and compare finished work side by side before you commit.
          </p>
          <div className="max-w-md mx-auto relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by brand, industry, style…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-card-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 space-y-10">
        {industries.length > 0 && (
          <div>
            <h2 className="font-semibold text-sm mb-3 flex items-center gap-2 text-muted-foreground">
              <Globe className="w-4 h-4" /> Browse by industry
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setIndustry(undefined)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border ${!industry ? "bg-primary text-primary-foreground border-primary" : "border-card-border text-muted-foreground"}`}
              >
                All
              </button>
              {industries.map((i) => (
                <button
                  key={i.industry}
                  onClick={() => setIndustry(i.industry)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border ${industry === i.industry ? "bg-primary text-primary-foreground border-primary" : "border-card-border text-muted-foreground"}`}
                >
                  {i.industry} ({i.totalPortfolios})
                </button>
              ))}
            </div>
          </div>
        )}

        {compareIds.length >= 2 && (
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="text-sm">{compareIds.length} portfolios selected for comparison</p>
            <button
              onClick={() => compareMutation.mutate()}
              disabled={compareMutation.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground flex items-center gap-1.5"
            >
              {compareMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scale className="w-3 h-3" />} Compare
            </button>
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground text-center py-10">Loading portfolios…</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {items.map((item) => (
            <Card key={item.id} item={item} onToggleCompare={toggleCompare} selected={compareIds.includes(item.id)} />
          ))}
        </div>

        {!isLoading && items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">No portfolios matched your search.</p>
        )}
      </div>

      {compareResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setCompareResult(null)}>
          <div
            className="bg-card rounded-2xl max-w-4xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Comparison</h3>
              <button onClick={() => setCompareResult(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${compareResult.length}, minmax(0, 1fr))` }}>
              {compareResult.map((c) => (
                <div key={c.id} className="border border-card-border rounded-xl p-3 space-y-2 text-sm">
                  <h4 className="font-semibold">{c.title}</h4>
                  <p className="text-xs text-muted-foreground">{c.industry} · {c.style}</p>
                  <p><strong>Package:</strong> {c.packageLabel ?? "-"}</p>
                  <p><strong>Delivery:</strong> {c.deliveryDays ?? c.deliveryTime ?? "-"}</p>
                  <p><strong>Completed projects:</strong> {c.completedProjects}</p>
                  <p><strong>Deliverables:</strong> {c.deliverables.join(", ") || "-"}</p>
                  <p><strong>Tools:</strong> {c.tools.join(", ") || "-"}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
