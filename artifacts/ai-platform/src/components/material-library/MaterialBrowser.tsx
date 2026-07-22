/**
 * MaterialBrowser — main material browsing UI with grid/list, search, filter, pagination.
 * Fetches from /api/ai/materials and /api/ai/materials/categories.
 */
import { useState, useEffect, useCallback } from "react";
import { LayoutGrid, List, Loader2, AlertCircle, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MaterialCard } from "./MaterialCard";
import { MaterialFilterBar } from "./MaterialFilterBar";
import { MaterialDetailPanel } from "./MaterialDetailPanel";
import type {
  MaterialDefinition,
  MaterialCategory,
  MaterialSearchFilter,
  MaterialSort,
  MaterialListResult,
} from "./types";

const BASE = import.meta.env.BASE_URL ?? "/";
const API = (path: string) => `${BASE.replace(/\/$/, "")}${path}`;

type ViewMode = "grid" | "list";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

interface Props {
  /** If set, a domain filter is pre-applied and locked. */
  domain?: string;
  /** If provided, the "Assign" button is shown and calls this handler. */
  onAssign?: (material: MaterialDefinition) => void;
  /** Optional: restrict to platform-only materials. */
  platformOnly?: boolean;
}

export function MaterialBrowser({ domain, onAssign, platformOnly }: Props) {
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [result, setResult] = useState<MaterialListResult | null>(null);
  const [filter, setFilter] = useState<MaterialSearchFilter>({
    domain,
    platformOnly,
  });
  const [sort, setSort] = useState<MaterialSort>("name_asc");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<MaterialDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load categories once
  useEffect(() => {
    const url = API(`/api/ai/materials/categories${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`);
    fetchJson<{ categories: MaterialCategory[] }>(url)
      .then((d) => setCategories(d.categories))
      .catch(() => {}); // non-fatal
  }, [domain]);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.q) params.set("q", filter.q);
      if (filter.categoryIds?.length) params.set("categoryIds", filter.categoryIds.join(","));
      if (filter.tags?.length) params.set("tags", filter.tags.join(","));
      if (filter.source) params.set("source", filter.source);
      if (filter.domain) params.set("domain", filter.domain);
      if (filter.status) params.set("status", filter.status);
      if (filter.includeInactive) params.set("includeInactive", "true");
      if (filter.platformOnly || platformOnly) params.set("platformOnly", "true");
      params.set("sort", sort);
      params.set("page", String(page));
      params.set("pageSize", "24");

      const data = await fetchJson<MaterialListResult>(API(`/api/ai/materials?${params}`));
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load materials");
    } finally {
      setLoading(false);
    }
  }, [filter, sort, page, platformOnly]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  function handleFilterChange(newFilter: MaterialSearchFilter, newSort: MaterialSort) {
    setFilter(newFilter);
    setSort(newSort);
    setPage(1);
    setSelected(null);
  }

  const categoryMap = Object.fromEntries(categories.map((c) => [c.categoryId, c]));

  return (
    <div className="flex h-full min-h-0">
      {/* Main panel */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Filter bar */}
        <div className="px-4 pt-4">
          <MaterialFilterBar
            filter={filter}
            sort={sort}
            categories={categories}
            onChange={handleFilterChange}
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-xs text-muted-foreground">
            {result ? `${result.total} material${result.total === 1 ? "" : "s"}` : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode("grid")}
              className={cn("p-1.5 rounded", viewMode === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
              aria-label="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn("p-1.5 rounded", viewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading materials…</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-destructive">
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={loadMaterials}>Retry</Button>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && result && result.items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <PackageOpen className="w-10 h-10" />
              <p className="text-sm">No materials found</p>
              <p className="text-xs">Try adjusting your search or filters</p>
            </div>
          )}

          {/* Grid view */}
          {!loading && !error && result && result.items.length > 0 && viewMode === "grid" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {result.items.map((m) => (
                <MaterialCard
                  key={m.materialId}
                  material={m}
                  selected={selected?.materialId === m.materialId}
                  onClick={() => setSelected(selected?.materialId === m.materialId ? null : m)}
                  categoryName={categoryMap[m.categoryId]?.name}
                />
              ))}
            </div>
          )}

          {/* List view */}
          {!loading && !error && result && result.items.length > 0 && viewMode === "list" && (
            <div className="space-y-2">
              {result.items.map((m) => (
                <button
                  key={m.materialId}
                  onClick={() => setSelected(selected?.materialId === m.materialId ? null : m)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                    "hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30",
                    selected?.materialId === m.materialId ? "border-primary bg-primary/5" : "border-border bg-card",
                  )}
                >
                  {/* Swatch */}
                  <div
                    className="w-10 h-10 rounded-lg border border-border shrink-0 overflow-hidden bg-muted"
                    style={m.preview.swatchColor ? { backgroundColor: m.preview.swatchColor } : {}}
                  >
                    {m.preview.thumbnailUrl && (
                      <img src={m.preview.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{categoryMap[m.categoryId]?.name ?? m.categoryId}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">{m.source}</span>
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {result && result.total > result.pageSize && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {Math.ceil(result.total / result.pageSize)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!result.hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <MaterialDetailPanel
          material={selected}
          category={categoryMap[selected.categoryId]}
          onClose={() => setSelected(null)}
          onAssign={onAssign}
        />
      )}
    </div>
  );
}
