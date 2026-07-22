/**
 * Universal Design Component & Object Library — ComponentBrowser (Team 22)
 *
 * Domain-neutral browser UI for searching, filtering, and previewing
 * component definitions. Works with any domain — no hardcoded graphic/interior/fashion/packaging.
 *
 * Props-driven: receives ComponentDefinition[] from the parent so it is
 * decoupled from any specific API endpoint. Team 24 wires the data source.
 *
 * Supports:
 *  - search (label, description, tags, category)
 *  - category filter
 *  - source filter (builtin / plugin)
 *  - compatible domain filter
 *  - tag filter
 *  - variant preview
 *  - selected state (controlled)
 *  - unavailable / deprecated visual states
 *  - permission gating (surface locked state)
 *  - empty / loading / error states
 */

import { useState, useMemo } from "react";
import { Search, Layers, Lock, AlertTriangle, ChevronDown, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ─────────────────────────────────────────────────────────────────────────────
// Local type mirrors (avoids importing from lib directly in frontend build)
// ─────────────────────────────────────────────────────────────────────────────

export type ComponentStatus = "active" | "deprecated" | "unavailable";
export type SourceKind = "builtin" | "plugin";

export interface ComponentSource {
  kind: SourceKind;
  pluginId?: string;
  ownerLabel?: string;
}

export interface ComponentCategory {
  id: string;
  label: string;
  parentId?: string;
}

export interface ComponentVariant {
  id: string;
  label: string;
  description?: string;
  previewUrl?: string;
  parameterOverrides: Record<string, unknown>;
}

export interface ComponentCompatibility {
  domains: string[];
  requiredCapabilities: string[];
  dependencies: string[];
  incompatibleWith: string[];
}

export interface ComponentDefinition {
  id: string;
  version: string;
  label: string;
  description: string;
  category: ComponentCategory;
  source: ComponentSource;
  status: ComponentStatus;
  deprecationMessage?: string;
  replacedBy?: string;
  compatibility: ComponentCompatibility;
  parameters: Record<string, { kind: string; label: string; required?: boolean }>;
  variants: ComponentVariant[];
  defaultVariantId?: string;
  assets: Array<{ assetId: string; role: string; url?: string; mimeType?: string }>;
  tags: string[];
  permissions?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentBrowserProps {
  components: ComponentDefinition[];
  /** Component IDs the caller has selected */
  selectedIds?: Set<string>;
  /** Caller-held permission keys — components requiring missing perms show as locked */
  callerPermissions?: string[];
  /** Callback when a component card is clicked */
  onSelect?: (def: ComponentDefinition) => void;
  /** Show loading skeleton */
  loading?: boolean;
  /** Error message to display instead of results */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function callerHasPermission(def: ComponentDefinition, perms: string[]): boolean {
  if (!def.permissions || def.permissions.length === 0) return true;
  const permSet = new Set(perms);
  return def.permissions.every((p) => permSet.has(p));
}

function matchesSearch(def: ComponentDefinition, q: string): boolean {
  if (!q) return true;
  const hay = [
    def.id,
    def.label,
    def.description,
    def.category.label,
    ...def.tags,
    ...def.variants.map((v) => v.label),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ComponentStatus }) {
  if (status === "active") return null;
  if (status === "deprecated") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
        <AlertTriangle className="w-2.5 h-2.5" />
        deprecated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
      unavailable
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VariantTabs
// ─────────────────────────────────────────────────────────────────────────────

function VariantTabs({ variants, defaultId }: { variants: ComponentVariant[]; defaultId?: string }) {
  const [active, setActive] = useState(defaultId ?? variants[0]?.id ?? "");
  if (variants.length === 0) return null;
  const current = variants.find((v) => v.id === active) ?? variants[0];

  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-gray-500 mb-1.5">Variants</p>
      <div className="flex gap-1 flex-wrap mb-2">
        {variants.map((v) => (
          <button
            key={v.id}
            onClick={() => setActive(v.id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              active === v.id
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {current?.previewUrl && (
        <img
          src={current.previewUrl}
          alt={current.label}
          className="w-full max-h-40 object-contain rounded border border-gray-100 bg-gray-50"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {current?.description && (
        <p className="text-xs text-gray-400 mt-1">{current.description}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentCard
// ─────────────────────────────────────────────────────────────────────────────

function ComponentCard({
  def,
  selected,
  locked,
  onSelect,
}: {
  def: ComponentDefinition;
  selected: boolean;
  locked: boolean;
  onSelect?: (def: ComponentDefinition) => void;
}) {
  const [open, setOpen] = useState(false);
  const isUnavailable = def.status === "unavailable";
  const paramCount = Object.keys(def.parameters).length;
  const requiredCount = Object.values(def.parameters).filter(
    (p) => p.required,
  ).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={`rounded-lg border transition-all ${
          isUnavailable || locked
            ? "opacity-50 cursor-not-allowed border-gray-100"
            : selected
              ? "border-gray-900 ring-1 ring-gray-900 bg-gray-50"
              : "border-gray-200 hover:border-gray-300 bg-white cursor-pointer"
        }`}
        onClick={() => {
          if (!isUnavailable && !locked && onSelect) onSelect(def);
        }}
        role="button"
        tabIndex={isUnavailable || locked ? -1 : 0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !isUnavailable && !locked && onSelect) {
            onSelect(def);
          }
        }}
        aria-disabled={isUnavailable || locked}
        aria-selected={selected}
      >
        {/* Header */}
        <div className="px-3 py-2.5 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {def.label}
              </span>
              <StatusBadge status={def.status} />
              {locked && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
                  <Lock className="w-2.5 h-2.5" />
                  locked
                </span>
              )}
              {selected && (
                <CheckCircle2 className="w-3.5 h-3.5 text-gray-900 flex-shrink-0" />
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                {def.category.label}
              </span>
              {def.source.kind === "plugin" && (
                <span className="text-[11px] text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-100">
                  plugin:{" "}
                  {def.source.ownerLabel ?? def.source.pluginId ?? "unknown"}
                </span>
              )}
              {def.compatibility.domains.slice(0, 3).map((d) => (
                <span
                  key={d}
                  className="text-[10px] text-blue-600 bg-blue-50 px-1 py-0.5 rounded"
                >
                  {d}
                </span>
              ))}
              {def.compatibility.domains.length > 3 && (
                <span className="text-[10px] text-gray-400">
                  +{def.compatibility.domains.length - 3}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
              {def.description}
            </p>

            {def.status === "deprecated" && def.deprecationMessage && (
              <p className="text-xs text-amber-700 mt-1">
                ⚠ {def.deprecationMessage}
              </p>
            )}
          </div>

          {/* Expand toggle */}
          <CollapsibleTrigger asChild>
            <button
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0 mt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
        </div>

        {/* Expanded detail */}
        <CollapsibleContent>
          <div
            className="px-3 pb-3 border-t border-gray-100 pt-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Tags */}
            {def.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2.5">
                {def.tags.map((t) => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            )}

            {/* Parameters summary */}
            <div className="text-xs text-gray-500 mb-2">
              <span className="font-medium text-gray-700">{paramCount}</span>{" "}
              parameters ({requiredCount} required)
            </div>
            <div className="grid grid-cols-2 gap-1 mb-2">
              {Object.entries(def.parameters)
                .slice(0, 6)
                .map(([key, schema]) => (
                  <div
                    key={key}
                    className="flex items-center gap-1 text-[10px] text-gray-600"
                  >
                    <code className="font-mono bg-gray-100 px-1 rounded">
                      {key}
                    </code>
                    <span className="text-gray-400">{schema.kind}</span>
                    {schema.required && (
                      <span className="text-red-500">*</span>
                    )}
                  </div>
                ))}
              {paramCount > 6 && (
                <span className="text-[10px] text-gray-400 col-span-2">
                  +{paramCount - 6} more
                </span>
              )}
            </div>

            {/* Capabilities */}
            {def.compatibility.requiredCapabilities.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-gray-500 mb-1">Required capabilities</p>
                <div className="flex flex-wrap gap-1">
                  {def.compatibility.requiredCapabilities.map((cap) => (
                    <span
                      key={cap}
                      className="text-[10px] text-orange-700 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Variants */}
            <VariantTabs
              variants={def.variants}
              defaultId={def.defaultVariantId}
            />

            {/* Footer */}
            <p className="text-[10px] text-gray-300 mt-3">
              v{def.version} · {def.id}
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-gray-100 p-3 animate-pulse">
      <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-2/3 mb-1" />
      <div className="h-3 bg-gray-100 rounded w-1/2" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentBrowser
// ─────────────────────────────────────────────────────────────────────────────

export function ComponentBrowser({
  components,
  selectedIds = new Set(),
  callerPermissions = [],
  onSelect,
  loading = false,
  error,
}: ComponentBrowserProps) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [domainFilter, setDomainFilter] = useState<string>("__all__");
  const [sourceFilter, setSourceFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("active");

  // Derive filter options from the component list
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of components) {
      if (!seen.has(c.category.id)) seen.set(c.category.id, c.category.label);
    }
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
  }, [components]);

  const domains = useMemo(() => {
    const seen = new Set<string>();
    for (const c of components) {
      for (const d of c.compatibility.domains) seen.add(d);
    }
    return Array.from(seen).sort();
  }, [components]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return components.filter((def) => {
      if (statusFilter !== "__all__" && def.status !== statusFilter) return false;
      if (categoryFilter !== "__all__" && def.category.id !== categoryFilter) return false;
      if (domainFilter !== "__all__" && !def.compatibility.domains.includes(domainFilter)) return false;
      if (sourceFilter !== "__all__" && def.source.kind !== sourceFilter) return false;
      return matchesSearch(def, q);
    });
  }, [components, query, categoryFilter, domainFilter, sourceFilter, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    const active = components.filter((c) => c.status === "active").length;
    const deprecated = components.filter((c) => c.status === "deprecated").length;
    const unavailable = components.filter((c) => c.status === "unavailable").length;
    return { total: components.length, active, deprecated, unavailable };
  }, [components]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-gray-900">
            Universal Component Library
          </h2>
          <p className="text-xs text-gray-500">
            {stats.total} components · {stats.active} active
            {stats.deprecated > 0 && ` · ${stats.deprecated} deprecated`}
            {stats.unavailable > 0 && ` · ${stats.unavailable} unavailable`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <Input
          className="pl-9 h-8 text-sm"
          placeholder="Search components…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="deprecated">Deprecated</SelectItem>
            <SelectItem value="unavailable">Unavailable</SelectItem>
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={domainFilter} onValueChange={setDomainFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Domain" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All domains</SelectItem>
            {domains.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All sources</SelectItem>
            <SelectItem value="builtin">Built-in</SelectItem>
            <SelectItem value="plugin">Plugin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reset */}
      {(query || categoryFilter !== "__all__" || domainFilter !== "__all__" || sourceFilter !== "__all__" || statusFilter !== "active") && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start h-6 text-xs text-gray-400 hover:text-gray-700 px-0"
          onClick={() => {
            setQuery("");
            setCategoryFilter("__all__");
            setDomainFilter("__all__");
            setSourceFilter("__all__");
            setStatusFilter("active");
          }}
        >
          Clear filters
        </Button>
      )}

      {/* Results */}
      <div className="space-y-2">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}

        {error && !loading && (
          <div className="text-center py-12">
            <p className="text-sm font-medium text-red-600 mb-1">
              Failed to load components
            </p>
            <p className="text-xs text-gray-400">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {query
              ? `No components match "${query}"`
              : "No components match the selected filters."}
          </div>
        )}

        {!loading &&
          !error &&
          filtered.map((def) => (
            <ComponentCard
              key={def.id}
              def={def}
              selected={selectedIds.has(def.id)}
              locked={!callerHasPermission(def, callerPermissions)}
              onSelect={onSelect}
            />
          ))}
      </div>
    </div>
  );
}
