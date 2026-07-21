/**
 * MaterialFilterBar — search + filter bar for the Material Browser.
 * Domain-neutral: no category-specific logic; categories come from the API.
 */
import { useState } from "react";
import { Search, SlidersHorizontal, X, ChevronDown } from "lucide-react";
import type { MaterialSearchFilter, MaterialSort } from "./types";

export const MATERIAL_SORT_OPTIONS: { value: MaterialSort; label: string }[] = [
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "created_desc", label: "Newest" },
  { value: "updated_desc", label: "Recently Updated" },
  { value: "category_asc", label: "Category" },
];

interface MaterialCategory {
  categoryId: string;
  name: string;
}

interface Props {
  filter: MaterialSearchFilter;
  sort: MaterialSort;
  categories: MaterialCategory[];
  onChange: (filter: MaterialSearchFilter, sort: MaterialSort) => void;
}

export function MaterialFilterBar({ filter, sort, categories, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filter.q ?? "");

  const hasFilters = !!(filter.categoryIds?.length || filter.tags?.length || filter.domain || filter.source);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onChange({ ...filter, q: draft.trim() || undefined }, sort);
  }

  function clearAll() {
    setDraft("");
    onChange({ includeInactive: filter.includeInactive }, sort);
  }

  function toggleCategory(id: string) {
    const current = filter.categoryIds ?? [];
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    onChange({ ...filter, categoryIds: next.length ? next : undefined }, sort);
  }

  return (
    <div className="space-y-3 mb-6">
      {/* Search row */}
      <form onSubmit={submit} className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search materials by name, tag, or description…"
          className="w-full pl-10 pr-24 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {draft && (
          <button
            type="button"
            onClick={() => { setDraft(""); onChange({ ...filter, q: undefined }, sort); }}
            className="absolute right-16 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary font-medium">
          Search
        </button>
      </form>

      {/* Sort + filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => onChange(filter, e.target.value as MaterialSort)}
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
        >
          {MATERIAL_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* includeInactive toggle */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={!!filter.includeInactive}
            onChange={(e) => onChange({ ...filter, includeInactive: e.target.checked }, sort)}
            className="rounded border-border"
          />
          Show inactive
        </label>

        {/* Filter toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            open || hasFilters
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {hasFilters && (
            <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">!</span>
          )}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {/* Active filter badges */}
        {(filter.categoryIds ?? []).map((id) => (
          <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border text-xs">
            {categories.find((c) => c.categoryId === id)?.name ?? id}
            <button onClick={() => toggleCategory(id)} className="hover:text-destructive">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {filter.domain && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted border text-xs">
            Domain: {filter.domain}
            <button onClick={() => onChange({ ...filter, domain: undefined }, sort)} className="hover:text-destructive">
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        {hasFilters && (
          <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline">
            Clear all
          </button>
        )}
      </div>

      {/* Expanded filter panel */}
      {open && (
        <div className="p-4 rounded-2xl border border-border bg-card space-y-4">
          {/* Categories */}
          {categories.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Category</p>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => {
                  const active = (filter.categoryIds ?? []).includes(cat.categoryId);
                  return (
                    <button
                      key={cat.categoryId}
                      onClick={() => toggleCategory(cat.categoryId)}
                      className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                        active
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/40 text-muted-foreground"
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Source */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Source</p>
            <div className="flex flex-wrap gap-1.5">
              {(["platform", "tenant", "plugin", "uploaded", "external"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onChange({ ...filter, source: filter.source === s ? undefined : s }, sort)}
                  className={`px-2.5 py-1 rounded-full border text-xs capitalize transition-colors ${
                    filter.source === s
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/40 text-muted-foreground"
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
