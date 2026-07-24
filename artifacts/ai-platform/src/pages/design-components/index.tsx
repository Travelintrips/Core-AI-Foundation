/**
 * Universal Creative Component Library — Admin Page (Team 8)
 *
 * Browse and search all 29 component definitions across four domains.
 * This page is NOT registered in App.tsx / sidebar — Team 24 wires it.
 * Route: /design-components  (relative to /admin)
 */

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Search, Layers, Package, Shirt, Home, Image } from "lucide-react";

// ── Static registry import ─────────────────────────────────────────────────────
// These types mirror the backend types.ts — kept in sync manually.

type ComponentDomain = "graphic" | "interior" | "fashion" | "packaging";

interface FieldDefinition {
  type: string;
  label: string;
  required: boolean;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  description?: string;
}

interface ComponentDefinition {
  type: string;
  domain: ComponentDomain;
  name: string;
  slug: string;
  description: string;
  version: string;
  supportedDomains: ComponentDomain[];
  properties: Record<string, FieldDefinition>;
  constraints: Array<{ name: string; description: string; rule: string }>;
  tags: string[];
}

// ── Domain metadata ────────────────────────────────────────────────────────────

const DOMAIN_META: Record<
  ComponentDomain,
  { label: string; color: string; icon: React.ReactNode; bg: string }
> = {
  graphic: {
    label: "Graphic",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    bg: "bg-blue-50",
    icon: <Image className="w-4 h-4" />,
  },
  interior: {
    label: "Interior",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    bg: "bg-amber-50",
    icon: <Home className="w-4 h-4" />,
  },
  fashion: {
    label: "Fashion",
    color: "bg-rose-100 text-rose-800 border-rose-200",
    bg: "bg-rose-50",
    icon: <Shirt className="w-4 h-4" />,
  },
  packaging: {
    label: "Packaging",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    bg: "bg-emerald-50",
    icon: <Package className="w-4 h-4" />,
  },
};

const FIELD_TYPE_BADGE: Record<string, string> = {
  string: "bg-slate-100 text-slate-700",
  number: "bg-violet-100 text-violet-700",
  boolean: "bg-green-100 text-green-700",
  color: "bg-pink-100 text-pink-700",
  url: "bg-sky-100 text-sky-700",
  enum: "bg-orange-100 text-orange-700",
  font: "bg-indigo-100 text-indigo-700",
  textarea: "bg-slate-100 text-slate-700",
  json: "bg-yellow-100 text-yellow-700",
  mm: "bg-teal-100 text-teal-700",
  pt: "bg-cyan-100 text-cyan-700",
  px: "bg-cyan-100 text-cyan-700",
};

// ── Component card ────────────────────────────────────────────────────────────

function FieldRow({ fieldKey, def }: { fieldKey: string; def: FieldDefinition }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono text-gray-800">{fieldKey}</code>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${FIELD_TYPE_BADGE[def.type] ?? "bg-gray-100 text-gray-600"}`}
          >
            {def.type}
          </span>
          {def.required && (
            <span className="text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              required
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{def.label}</p>
        {def.description && (
          <p className="text-xs text-gray-400 italic">{def.description}</p>
        )}
        {def.options && (
          <p className="text-xs text-gray-400 mt-0.5">
            Options: {def.options.slice(0, 6).join(" · ")}
            {def.options.length > 6 && ` +${def.options.length - 6} more`}
          </p>
        )}
        {(def.min !== undefined || def.max !== undefined) && (
          <p className="text-xs text-gray-400">
            Range:{" "}
            {def.min !== undefined ? def.min : "–"} →{" "}
            {def.max !== undefined ? def.max : "∞"}
          </p>
        )}
      </div>
      {def.default !== undefined && (
        <span className="text-xs text-gray-400 whitespace-nowrap">
          default: <code className="bg-gray-100 px-1 rounded">{String(def.default)}</code>
        </span>
      )}
    </div>
  );
}

function ComponentCard({ def }: { def: ComponentDefinition }) {
  const [open, setOpen] = useState(false);
  const meta = DOMAIN_META[def.domain];
  const propertyCount = Object.keys(def.properties).length;
  const requiredCount = Object.values(def.properties).filter((f) => f.required).length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden border border-gray-100 hover:border-gray-200 transition-colors">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <CardTitle className="text-sm font-semibold text-gray-900">
                    {def.name}
                  </CardTitle>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.color}`}
                  >
                    {meta.icon}
                    {meta.label}
                  </span>
                  {def.supportedDomains.length > 1 && (
                    <span className="text-[11px] text-gray-400">
                      +{def.supportedDomains.length - 1} more domain
                      {def.supportedDomains.length > 2 ? "s" : ""}
                    </span>
                  )}
                </div>
                <CardDescription className="text-xs">{def.description}</CardDescription>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-[11px]">
                    {def.type}
                  </span>
                  <span>{propertyCount} fields</span>
                  <span>{requiredCount} required</span>
                  <span>{def.constraints.length} constraints</span>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            {/* Tags */}
            {def.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {def.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Supported domains */}
            {def.supportedDomains.length > 1 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Supported in</p>
                <div className="flex flex-wrap gap-1">
                  {def.supportedDomains.map((d) => (
                    <span
                      key={d}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${DOMAIN_META[d].color}`}
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Fields */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Properties</p>
              <div className="rounded-md border border-gray-100 px-3 py-1">
                {Object.entries(def.properties).map(([key, field]) => (
                  <FieldRow key={key} fieldKey={key} def={field} />
                ))}
              </div>
            </div>

            {/* Constraints */}
            {def.constraints.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Constraints</p>
                <ul className="space-y-1">
                  {def.constraints.map((c) => (
                    <li key={c.name} className="text-xs text-gray-600 flex gap-2">
                      <span className="text-amber-500 flex-shrink-0">⚠</span>
                      <span>{c.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Version */}
            <p className="text-[10px] text-gray-300 mt-3">
              v{def.version} · slug: {def.slug}
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// NOTE: Component definitions are loaded from the backend API at runtime.
// For the standalone page, we fetch from /api/ai/design-components/registry.

function useRegistry() {
  const [data, setData] = useState<{
    total: number;
    byDomain: Record<string, ComponentDefinition[]>;
    components: ComponentDefinition[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    const adminKey = import.meta.env.VITE_ADMIN_API_KEY ?? "";
    fetch(`/api/ai/design-components/registry`, {
      headers: adminKey ? { "X-Admin-Api-Key": adminKey } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  });

  return { data, loading, error };
}

export default function DesignComponentsPage() {
  const { data, loading, error } = useRegistry();
  const [search, setSearch] = useState("");
  const [activeDomain, setActiveDomain] = useState<ComponentDomain | "all">("all");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    return data.components.filter((c) => {
      const domainMatch = activeDomain === "all" || c.domain === activeDomain;
      const searchMatch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags.some((t) => t.includes(q));
      return domainMatch && searchMatch;
    });
  }, [data, search, activeDomain]);

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      total: data.total,
      graphic: data.byDomain.graphic?.length ?? 0,
      interior: data.byDomain.interior?.length ?? 0,
      fashion: data.byDomain.fashion?.length ?? 0,
      packaging: data.byDomain.packaging?.length ?? 0,
    };
  }, [data]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-lg bg-gray-900 flex items-center justify-center">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Universal Component Library
            </h1>
            <p className="text-sm text-gray-500">
              Reusable creative components across four domains
            </p>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
            {(
              [
                { label: "Total", value: stats.total, color: "text-gray-900" },
                { label: "Graphic", value: stats.graphic, color: "text-blue-700" },
                { label: "Interior", value: stats.interior, color: "text-amber-700" },
                { label: "Fashion", value: stats.fashion, color: "text-rose-700" },
                { label: "Packaging", value: stats.packaging, color: "text-emerald-700" },
              ] as const
            ).map((s) => (
              <div key={s.label} className="bg-white rounded-lg border border-gray-100 px-3 py-2 text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          className="pl-9"
          placeholder="Search components by name, type, or tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeDomain} onValueChange={(v) => setActiveDomain(v as ComponentDomain | "all")}>
        <TabsList className="mb-5">
          <TabsTrigger value="all">All ({data?.total ?? 0})</TabsTrigger>
          {(["graphic", "interior", "fashion", "packaging"] as ComponentDomain[]).map((d) => (
            <TabsTrigger key={d} value={d} className="capitalize">
              <span className="flex items-center gap-1.5">
                {DOMAIN_META[d].icon}
                {DOMAIN_META[d].label} ({stats?.[d] ?? 0})
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeDomain}>
          {loading && (
            <div className="text-center py-20 text-gray-400">Loading component registry…</div>
          )}

          {error && (
            <div className="text-center py-20">
              <p className="text-red-600 font-medium mb-2">Failed to load registry</p>
              <p className="text-sm text-gray-500">{error}</p>
              <p className="text-xs text-gray-400 mt-2">
                Ensure the API server is running and the design-components router is mounted.
              </p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="text-center py-20 text-gray-400">
              {search
                ? `No components match "${search}"`
                : "No components in this domain."}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-3">
              {filtered.map((def) => (
                <ComponentCard key={def.type} def={def} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
