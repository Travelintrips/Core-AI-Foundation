/**
 * MaterialSelectorDialog — Phase 1 Material Library picker for the Interior Design editor.
 *
 * Opens as a Dialog showing searchable, filterable material grid.
 * When a material is selected and confirmed, calls onSelect(material).
 */

import { useState, useEffect, useCallback } from "react";
import { Search, X, Loader2, PackageOpen, AlertCircle, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LibraryMaterial {
  id: number;
  materialCode: string;
  name: string;
  slug: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  materialType: string | null;
  color: string | null;
  finish: string | null;
  texture: string | null;
  pattern: string | null;
  description: string | null;
  priceTier: string;
  thumbnailUrl: string | null;
  status: string;
}

interface LibraryCategory {
  id: number;
  name: string;
  icon: string;
  displayOrder: number;
}

interface SearchResult {
  items: LibraryMaterial[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

interface RankedSearchResult {
  items: Array<{
    material: LibraryMaterial;
    score: { total: number };
    matchReasons: string[];
  }>;
  total: number;
}

interface Suggestion {
  value: string;
  type: string;
}

interface SimilarResult {
  items: Array<{
    material: LibraryMaterial;
    similarityScore: number;
    matchReasons: string[];
  }>;
}

// ── API helpers ───────────────────────────────────────────────────────────────

// API routes are mounted at the shared /api path, not under the /admin/
// frontend artifact base. Keep this aligned with the existing catalog calls.
const API = (path: string) => path;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Price tier colours ────────────────────────────────────────────────────────

const TIER_COLOURS: Record<string, string> = {
  Budget:   "bg-green-500/10 text-green-400 border-green-500/20",
  Standard: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Premium:  "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Luxury:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Category to pre-filter (e.g. "Floor", "Wall"). */
  initialCategory?: string;
  onSelect: (material: LibraryMaterial) => void;
}

export function MaterialSelectorDialog({ open, onOpenChange, initialCategory, onSelect }: Props) {
  const [categories, setCategories] = useState<LibraryCategory[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LibraryMaterial | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [similar, setSimilar] = useState<SimilarResult | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);

  // Filters
  const [search, setSearch]     = useState("");
  const [category, setCategory] = useState(initialCategory ?? "");
  const [priceTier, setPriceTier] = useState("");
  const [page, setPage]         = useState(1);

  // Load categories once
  useEffect(() => {
    if (!open) return;
    fetchJson<{ categories: LibraryCategory[] }>(API("/api/material-library/categories"))
      .then((d) => setCategories(d.categories))
      .catch(() => {});
  }, [open]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setSearch("");
      setCategory(initialCategory ?? "");
      setPriceTier("");
      setPage(1);
      setSelected(null);
      setSuggestions([]);
      setSimilar(null);
    }
  }, [open, initialCategory]);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (category)  params.set("category", category);
      if (priceTier) params.set("priceTier", priceTier);
      if (search.trim()) {
        params.set("q", search.trim());
        params.set("mode", "hybrid");
        const ranked = await fetchJson<RankedSearchResult>(API(`/api/material-library/search?${params}`));
        setResult({
          items: ranked.items.map((item) => item.material),
          total: ranked.total,
          page: 1,
          pageSize: ranked.items.length,
          totalPages: 1,
          hasMore: false,
        });
      } else {
        const data = await fetchJson<SearchResult>(API(`/api/material-library?${params}`));
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load materials");
    } finally {
      setLoading(false);
    }
  }, [search, category, priceTier, page]);

  useEffect(() => {
    if (open) loadMaterials();
  }, [open, loadMaterials]);

  useEffect(() => {
    if (!open || !search.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      fetchJson<{ suggestions: Suggestion[] }>(
        API(`/api/material-library/suggestions?q=${encodeURIComponent(search.trim())}&limit=8`),
      )
        .then((data) => setSuggestions(data.suggestions))
        .catch(() => setSuggestions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, search]);

  useEffect(() => {
    if (!selected) {
      setSimilar(null);
      return;
    }
    setSimilarLoading(true);
    fetchJson<SimilarResult>(API(`/api/material-library/${selected.id}/similar?limit=6`))
      .then(setSimilar)
      .catch(() => setSimilar(null))
      .finally(() => setSimilarLoading(false));
  }, [selected]);

  function handleSelect() {
    if (!selected) return;
    onSelect(selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-semibold">Select from Material Library</DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30 shrink-0 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search materials..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="h-8 pl-8 text-xs"
            />
            {suggestions.length > 0 && (
              <div className="absolute z-20 top-9 left-0 right-0 rounded-md border border-border bg-popover p-1 shadow-md">
                {suggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.type}-${suggestion.value}`}
                    type="button"
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => {
                      setSearch(suggestion.value);
                      setSuggestions([]);
                      setPage(1);
                    }}
                  >
                    <span>{suggestion.value}</span>
                    <span className="text-[10px] text-muted-foreground">{suggestion.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Select value={category || "all"} onValueChange={(v) => { setCategory(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.name} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priceTier || "all"} onValueChange={(v) => { setPriceTier(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="h-8 text-xs w-32">
              <SelectValue placeholder="All Tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Tiers</SelectItem>
              {["Budget", "Standard", "Premium", "Luxury"].map((t) => (
                <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(search || category || priceTier) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => { setSearch(""); setCategory(""); setPriceTier(""); setPage(1); }}>
              <X className="w-3 h-3" /> Clear
            </Button>
          )}
        </div>

        {/* Results area */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading materials…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-destructive">
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={loadMaterials}>Retry</Button>
            </div>
          )}

          {!loading && !error && result?.items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <PackageOpen className="w-10 h-10" />
              <p className="text-sm">No materials found</p>
              <p className="text-xs">Try adjusting your search or filters</p>
            </div>
          )}

          {!loading && !error && result && result.items.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">
                  {result.total} material{result.total !== 1 ? "s" : ""} found
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {result.items.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelected(selected?.id === m.id ? null : m)}
                    className={cn(
                      "relative flex flex-col text-left rounded-xl border p-3 gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30",
                      selected?.id === m.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border hover:border-primary/40 bg-card hover:bg-muted/20",
                    )}
                  >
                    {/* Selected checkmark */}
                    {selected?.id === m.id && (
                      <span className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-0.5">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}

                    {/* Thumbnail / swatch placeholder */}
                    <div className="w-full h-16 rounded-lg bg-gradient-to-br from-muted to-muted/60 border border-border/30 overflow-hidden flex items-center justify-center">
                      {m.thumbnailUrl ? (
                        <img src={m.thumbnailUrl} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-muted-foreground font-mono">{m.category}</span>
                      )}
                    </div>

                    {/* Name */}
                    <p className="text-xs font-medium text-foreground line-clamp-2 leading-tight">{m.name}</p>

                    {/* Meta */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {m.brand && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{m.brand}</span>
                      )}
                      <Badge
                        variant="outline"
                        className={cn("text-[9px] px-1 h-3.5 font-mono shrink-0", TIER_COLOURS[m.priceTier] ?? "")}
                      >
                        {m.priceTier}
                      </Badge>
                    </div>

                    {/* Specs */}
                    {(m.color || m.finish) && (
                      <p className="text-[10px] text-muted-foreground line-clamp-1">
                        {[m.color, m.finish].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {selected && (
                <div className="mt-4 rounded-md border border-border/50 bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                    Similar materials
                  </div>
                  {similarLoading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Finding similar materials…
                    </div>
                  )}
                  {!similarLoading && similar?.items.length === 0 && (
                    <p className="text-xs text-muted-foreground">No similar materials found.</p>
                  )}
                  {!similarLoading && similar && similar.items.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {similar.items.map((item) => (
                        <button
                          key={item.material.id}
                          type="button"
                          className="rounded border border-border/50 px-2 py-1 text-left text-[11px] hover:border-primary/50"
                          onClick={() => setSelected(item.material)}
                        >
                          <span className="block font-medium">{item.material.name}</span>
                          <span className="text-muted-foreground">
                            {Math.round(item.similarityScore * 100)}% similar
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Pagination */}
              {result.totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {result.totalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={!result.hasMore} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border/50 shrink-0 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex-1">
            {selected ? (
              <span className="text-foreground font-medium">{selected.name}</span>
            ) : (
              "Click a material to select it"
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" disabled={!selected} onClick={handleSelect}>
              Use This Material
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
