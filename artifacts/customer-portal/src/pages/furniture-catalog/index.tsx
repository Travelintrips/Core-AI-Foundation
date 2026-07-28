/**
 * WP-02 — Furniture Catalog — Customer-facing browse page
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, Filter, X, Package } from "lucide-react";

interface FurnitureItem {
  id: string;
  code: string;
  name: string;
  nameId: string;
  slug: string;
  description?: string | null;
  furnitureType?: string | null;
  style?: string | null;
  priceTier: string;
  thumbnailUrl?: string | null;
  primaryMaterials: string[];
  colors: string[];
  dimensions: { widthCm: number; depthCm: number; heightCm: number };
}

interface Category { id: string; name: string; nameId: string; slug: string; icon: string; }
interface PaginationMeta { total: number; page: number; pageSize: number; hasNext: boolean; }
interface ListResult { data: FurnitureItem[]; pagination: PaginationMeta; }

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRICE_TIER_LABELS: Record<string, string> = {
  budget: "Budget", mid: "Mid-Range", premium: "Premium", luxury: "Luxury",
};
const PRICE_TIER_COLORS: Record<string, string> = {
  budget:  "bg-green-100 text-green-800",
  mid:     "bg-sky-100 text-sky-800",
  premium: "bg-purple-100 text-purple-800",
  luxury:  "bg-amber-100 text-amber-800",
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export default function FurnitureCatalogPage() {
  const [, navigate] = useLocation();

  const [items, setItems]           = useState<FurnitureItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 20, hasNext: false });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading]       = useState(true);

  const [search, setSearch]             = useState("");
  const [categoryFilter, setCategory]   = useState("");
  const [priceTierFilter, setPriceTier] = useState("");
  const [page, setPage]                 = useState(1);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (priceTierFilter) params.set("priceTier", priceTierFilter);
      const result = await fetchJson<ListResult>(`${BASE}api/ai/furniture-catalog/items?${params}`);
      setItems(result.data);
      setPagination(result.pagination);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [page, search, categoryFilter, priceTierFilter]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => {
    fetchJson<{ data: Category[] }>(`${BASE}api/ai/furniture-catalog/categories`)
      .then(r => setCategories(r.data))
      .catch(() => {});
  }, []);

  const clearFilters = () => { setSearch(""); setCategory(""); setPriceTier(""); setPage(1); };
  const hasFilters = search || categoryFilter || priceTierFilter;

  return (
    <div className="min-h-screen" style={{ background: "#060B18", color: "#F0F4FF" }}>
      {/* Header */}
      <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(12,17,32,0.95)" }}>
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#7C6EFA,#5F52D0)" }}>
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                Furniture Catalog
              </h1>
              <p className="text-sm" style={{ color: "#8B9BC4" }}>
                {pagination.total > 0 ? `${pagination.total} items` : "Browse our curated collection"}
              </p>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[240px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#8B9BC4" }} />
              <input
                type="text"
                placeholder="Search furniture…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              />
            </div>
            <select
              value={categoryFilter}
              onChange={e => { setCategory(e.target.value); setPage(1); }}
              className="px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
            >
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
            <select
              value={priceTierFilter}
              onChange={e => { setPriceTier(e.target.value); setPage(1); }}
              className="px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
            >
              <option value="">All Price Tiers</option>
              <option value="budget">Budget</option>
              <option value="mid">Mid-Range</option>
              <option value="premium">Premium</option>
              <option value="luxury">Luxury</option>
            </select>
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#8B9BC4" }}>
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl animate-pulse" style={{ height: 300, background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20" style={{ color: "#8B9BC4" }}>
            <Package className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No furniture items found</p>
            <p className="text-sm mt-1">Try adjusting your filters.</p>
            {hasFilters && <button onClick={clearFilters} className="mt-4 px-4 py-2 rounded-xl text-sm"
              style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA", border: "1px solid rgba(124,110,250,0.3)" }}>
              Clear filters
            </button>}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => navigate(`/furniture-catalog/${item.id}`)}
                className="text-left rounded-2xl overflow-hidden transition-transform hover:-translate-y-1 hover:shadow-xl group"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {/* Image area */}
                <div className="aspect-[4/3] relative overflow-hidden" style={{ background: "rgba(124,110,250,0.08)" }}>
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-12 h-12 opacity-20" style={{ color: "#7C6EFA" }} />
                    </div>
                  )}
                  <div className="absolute top-2 right-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRICE_TIER_COLORS[item.priceTier] ?? ""}`}>
                      {PRICE_TIER_LABELS[item.priceTier] ?? item.priceTier}
                    </span>
                  </div>
                </div>

                {/* Info */}
                <div className="p-3 space-y-1">
                  <p className="font-semibold text-sm line-clamp-2 leading-snug" style={{ color: "#F0F4FF" }}>
                    {item.name}
                  </p>
                  {item.nameId && item.nameId !== item.name && (
                    <p className="text-xs" style={{ color: "#8B9BC4" }}>{item.nameId}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {item.style && (
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA" }}>
                        {item.style}
                      </span>
                    )}
                    {item.furnitureType && (
                      <span className="text-xs capitalize" style={{ color: "#8B9BC4" }}>
                        {item.furnitureType.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: "#8B9BC4" }}>
                    {item.dimensions.widthCm} × {item.dimensions.depthCm} × {item.dimensions.heightCm} cm
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.total > pagination.pageSize && (
          <div className="flex items-center justify-center gap-4 mt-10">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-30"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
            >
              Previous
            </button>
            <span className="text-sm" style={{ color: "#8B9BC4" }}>
              Page {pagination.page} · {pagination.total} items
            </span>
            <button
              disabled={!pagination.hasNext}
              onClick={() => setPage(p => p + 1)}
              className="px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-30"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
