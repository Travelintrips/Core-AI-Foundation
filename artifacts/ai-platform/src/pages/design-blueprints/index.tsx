/**
 * Universal Design Blueprint Library — Admin Page (Team 7)
 *
 * Route: /design-blueprints (mounted by Team 24 in App.tsx + sidebar)
 *
 * Features:
 *  - List all blueprints with domain/status/tag filters
 *  - Blueprint detail drawer (dimensions, zones, slots, outputs)
 *  - Validate a raw blueprint JSON payload
 *  - Compatibility checker
 *  - Stats cards
 */

import { useState, useCallback } from "react";

// ── Types (local — no generated client until Team 24 runs codegen) ─────────────

type BlueprintDomain = "graphic_design" | "presentation" | "interior" | "fashion" | "packaging" | "product_design";
type BlueprintStatus = "draft" | "active" | "deprecated";

interface Blueprint {
  id: string;
  slug: string;
  schemaVersion: string;
  domain: BlueprintDomain;
  name: string;
  description: string;
  version: string;
  status: BlueprintStatus;
  dimensions: { width: number; height: number; unit: string; dpi?: number; aspectRatio?: string };
  zones: { id: string; name: string; required: boolean; slotRefs: string[]; zIndex?: number }[];
  slots: { id: string; name: string; type: string; required: boolean; maxItems?: number }[];
  outputCapabilities: { format: string; maxDpi?: number; colorSpace?: string }[];
  industryTags: string[];
  styleTags: string[];
  supportedComponents: { type: string; versionRange: string; required: boolean }[];
  requiredData: { key: string; label: string; type: string; required: boolean }[];
}

interface Stats {
  total: number;
  builtin: number;
  custom: number;
  byDomain: Record<string, number>;
  byStatus: { active: number; draft: number; deprecated: number };
}

interface ValidationResult {
  valid: boolean;
  issues: { severity: string; code: string; path: string; message: string }[];
}

interface CompatResult {
  compatible: boolean;
  issues: { code: string; message: string; component?: string }[];
  warnings: { code: string; message: string }[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOMAINS: BlueprintDomain[] = ["graphic_design", "presentation", "interior", "fashion", "packaging", "product_design"];
const STATUSES: BlueprintStatus[] = ["active", "draft", "deprecated"];

const DOMAIN_LABELS: Record<BlueprintDomain, string> = {
  graphic_design: "Graphic Design",
  presentation: "Presentation",
  interior: "Interior",
  fashion: "Fashion",
  packaging: "Packaging",
  product_design: "Product Design",
};

const STATUS_COLORS: Record<BlueprintStatus, string> = {
  active: "bg-green-100 text-green-800",
  draft: "bg-yellow-100 text-yellow-800",
  deprecated: "bg-red-100 text-red-800",
};

const DOMAIN_COLORS: Record<BlueprintDomain, string> = {
  graphic_design: "bg-purple-100 text-purple-800",
  presentation: "bg-blue-100 text-blue-800",
  interior: "bg-teal-100 text-teal-800",
  fashion: "bg-pink-100 text-pink-800",
  packaging: "bg-orange-100 text-orange-800",
  product_design: "bg-indigo-100 text-indigo-800",
};

const BASE = "/api/ai/design-blueprints";

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (fetchUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(fetchUrl, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setData(json);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, refetch: () => url && fetch_(url) };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function StatsCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function BlueprintCard({
  bp,
  onClick,
}: {
  bp: Blueprint;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left w-full bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-400 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-gray-900 text-sm">{bp.name}</p>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{bp.description}</p>
        </div>
        <Badge className={STATUS_COLORS[bp.status]}>{bp.status}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge className={DOMAIN_COLORS[bp.domain]}>{DOMAIN_LABELS[bp.domain]}</Badge>
        <Badge className="bg-gray-100 text-gray-600">v{bp.version}</Badge>
        <Badge className="bg-gray-100 text-gray-600">
          {bp.dimensions.width}×{bp.dimensions.height} {bp.dimensions.unit}
        </Badge>
      </div>
      <div className="mt-2 flex gap-3 text-xs text-gray-400">
        <span>{bp.zones.length} zones</span>
        <span>{bp.slots.length} slots</span>
        <span>{bp.outputCapabilities.length} outputs</span>
      </div>
    </button>
  );
}

function BlueprintDrawer({ bp, onClose }: { bp: Blueprint; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "zones" | "slots" | "data" | "outputs">("overview");

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-gray-100">
        <div>
          <p className="font-semibold text-gray-900">{bp.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={DOMAIN_COLORS[bp.domain]}>{DOMAIN_LABELS[bp.domain]}</Badge>
            <Badge className={STATUS_COLORS[bp.status]}>{bp.status}</Badge>
            <span className="text-xs text-gray-400">v{bp.version}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-4">
        {(["overview", "zones", "slots", "data", "outputs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-2 px-3 text-xs font-medium border-b-2 -mb-px capitalize transition-colors ${
              tab === t ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {tab === "overview" && (
          <>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Description</p>
              <p className="text-gray-700">{bp.description}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Canvas</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded p-2">
                  <p className="text-xs text-gray-400">Size</p>
                  <p className="font-mono text-xs text-gray-800">{bp.dimensions.width}×{bp.dimensions.height} {bp.dimensions.unit}</p>
                </div>
                {bp.dimensions.dpi && (
                  <div className="bg-gray-50 rounded p-2">
                    <p className="text-xs text-gray-400">DPI</p>
                    <p className="font-mono text-xs text-gray-800">{bp.dimensions.dpi}</p>
                  </div>
                )}
                {bp.dimensions.aspectRatio && (
                  <div className="bg-gray-50 rounded p-2">
                    <p className="text-xs text-gray-400">Aspect Ratio</p>
                    <p className="font-mono text-xs text-gray-800">{bp.dimensions.aspectRatio}</p>
                  </div>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Components</p>
              <div className="space-y-1">
                {bp.supportedComponents.map((c) => (
                  <div key={c.type} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1">
                    <span className="text-xs text-gray-700 font-mono">{c.type}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">{c.versionRange}</span>
                      {c.required && <Badge className="bg-red-100 text-red-700">required</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Industry Tags</p>
              <div className="flex flex-wrap gap-1">{bp.industryTags.map((t) => <Badge key={t} className="bg-blue-50 text-blue-700">{t}</Badge>)}</div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Style Tags</p>
              <div className="flex flex-wrap gap-1">{bp.styleTags.map((t) => <Badge key={t} className="bg-purple-50 text-purple-700">{t}</Badge>)}</div>
            </div>
          </>
        )}

        {tab === "zones" && (
          <div className="space-y-3">
            {bp.zones.map((z) => (
              <div key={z.id} className="border border-gray-100 rounded p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{z.name}</span>
                  <div className="flex gap-1">
                    {z.required && <Badge className="bg-red-100 text-red-700">required</Badge>}
                    {z.zIndex !== undefined && <Badge className="bg-gray-100 text-gray-600">z:{z.zIndex}</Badge>}
                  </div>
                </div>
                <p className="text-xs text-gray-400 font-mono mt-1">id: {z.id}</p>
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">Slot references:</p>
                  <div className="flex flex-wrap gap-1">
                    {z.slotRefs.map((r) => <Badge key={r} className="bg-gray-100 text-gray-600 font-mono">{r}</Badge>)}
                    {z.slotRefs.length === 0 && <span className="text-xs text-gray-400 italic">none</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "slots" && (
          <div className="space-y-2">
            {bp.slots.map((s) => (
              <div key={s.id} className="border border-gray-100 rounded p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <div className="flex gap-1">
                    <Badge className="bg-gray-100 text-gray-600">{s.type}</Badge>
                    {s.required && <Badge className="bg-red-100 text-red-700">required</Badge>}
                    {s.maxItems && <Badge className="bg-gray-100 text-gray-500">×{s.maxItems}</Badge>}
                  </div>
                </div>
                <p className="text-xs text-gray-400 font-mono mt-0.5">id: {s.id}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "data" && (
          <div className="space-y-2">
            {bp.requiredData.map((f) => (
              <div key={f.key} className="border border-gray-100 rounded p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{f.label}</span>
                  <div className="flex gap-1">
                    <Badge className="bg-blue-50 text-blue-700">{f.type}</Badge>
                    {f.required && <Badge className="bg-red-100 text-red-700">required</Badge>}
                  </div>
                </div>
                <p className="text-xs text-gray-400 font-mono mt-0.5">key: {f.key}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "outputs" && (
          <div className="space-y-2">
            {bp.outputCapabilities.map((o) => (
              <div key={o.format} className="border border-gray-100 rounded p-3 flex items-center justify-between">
                <span className="font-mono text-sm text-gray-900 uppercase">{o.format}</span>
                <div className="flex gap-1">
                  {o.colorSpace && <Badge className="bg-gray-100 text-gray-600">{o.colorSpace}</Badge>}
                  {o.maxDpi && <Badge className="bg-gray-100 text-gray-600">{o.maxDpi} dpi</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Validate Panel ────────────────────────────────────────────────────────────

function ValidatePanel() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleValidate() {
    setResult(null);
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      setError("Invalid JSON — check your input");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",

        },
        body: JSON.stringify(parsed),
      });
      const json: ValidationResult = await res.json();
      setResult(json);
    } catch (e: any) {
      setError(e.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700">Blueprint JSON</label>
        <textarea
          className="mt-1 w-full font-mono text-xs border border-gray-300 rounded p-2 h-48 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          placeholder='{"id":"bp-test","domain":"graphic_design","name":"My Blueprint",...}'
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      <button
        onClick={handleValidate}
        disabled={loading || !input.trim()}
        className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Validating…" : "Validate Blueprint"}
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {result && (
        <div className={`border rounded p-3 ${result.valid ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
          <p className={`font-medium text-sm ${result.valid ? "text-green-700" : "text-red-700"}`}>
            {result.valid ? "✓ Valid blueprint" : "✗ Validation failed"}
          </p>
          {result.issues.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.issues.map((issue, i) => (
                <div key={i} className={`text-xs p-2 rounded ${issue.severity === "error" ? "bg-red-100 text-red-800" : issue.severity === "warning" ? "bg-yellow-100 text-yellow-800" : "bg-blue-50 text-blue-700"}`}>
                  <span className="font-mono font-medium">[{issue.severity.toUpperCase()}] {issue.code}</span>
                  {issue.path && <span className="text-gray-500"> at {issue.path}</span>}
                  <p className="mt-0.5">{issue.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compat Panel ──────────────────────────────────────────────────────────────

function CompatPanel() {
  const [blueprintId, setBlueprintId] = useState("bp-graphic-design-v1");
  const [schemaVersion, setSchemaVersion] = useState("1.0");
  const [components, setComponents] = useState("rich-text-editor, image-picker");
  const [result, setResult] = useState<CompatResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck() {
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/check-compatibility`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",

        },
        body: JSON.stringify({
          blueprintId,
          schemaVersion,
          componentTypes: components.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const json: CompatResult = await res.json();
      setResult(json);
    } catch (e: any) {
      setError(e.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-gray-700">Blueprint ID or Slug</label>
          <input
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            value={blueprintId}
            onChange={(e) => setBlueprintId(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Schema Version</label>
          <input
            className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            value={schemaVersion}
            onChange={(e) => setSchemaVersion(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700">Component Types (comma-separated)</label>
        <input
          className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          value={components}
          onChange={(e) => setComponents(e.target.value)}
          placeholder="rich-text-editor, image-picker"
        />
      </div>
      <button
        onClick={handleCheck}
        disabled={loading || !blueprintId.trim()}
        className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Checking…" : "Check Compatibility"}
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {result && (
        <div className={`border rounded p-3 ${result.compatible ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
          <p className={`font-medium text-sm ${result.compatible ? "text-green-700" : "text-red-700"}`}>
            {result.compatible ? "✓ Compatible" : "✗ Not compatible"}
          </p>
          {result.issues.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.issues.map((issue, i) => (
                <div key={i} className="text-xs p-2 bg-red-100 text-red-800 rounded">
                  <span className="font-mono font-medium">{issue.code}</span>
                  {issue.component && <span className="text-red-600"> [{issue.component}]</span>}
                  <p className="mt-0.5">{issue.message}</p>
                </div>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="text-xs p-2 bg-yellow-100 text-yellow-800 rounded">
                  <span className="font-mono font-medium">{w.code}</span>
                  <p className="mt-0.5">{w.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DesignBlueprintsPage() {
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedBp, setSelectedBp] = useState<Blueprint | null>(null);
  const [activeTab, setActiveTab] = useState<"browse" | "validate" | "compat">("browse");
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingBps, setLoadingBps] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);


  async function loadBlueprints() {
    setLoadingBps(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (domainFilter) params.set("domain", domainFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "100");
      const res = await fetch(`${BASE}?${params}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setBlueprints(json.blueprints ?? []);
    } catch (e: any) {
      setFetchError(e.message);
    } finally {
      setLoadingBps(false);
    }
  }

  async function loadStats() {
    setLoadingStats(true);
    try {
      const res = await fetch(`${BASE}/stats`, { credentials: "include" });
      const json = await res.json();
      setStats(json);
    } catch {
      // non-critical
    } finally {
      setLoadingStats(false);
    }
  }

  // Load on first render
  useState(() => {
    loadBlueprints();
    loadStats();
  });

  const filtered = blueprints.filter((bp) =>
    !search ||
    bp.name.toLowerCase().includes(search.toLowerCase()) ||
    bp.slug.includes(search.toLowerCase()) ||
    bp.industryTags.some((t) => t.includes(search.toLowerCase())) ||
    bp.styleTags.some((t) => t.includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Design Blueprint Library</h1>
            <p className="text-sm text-gray-500 mt-0.5">Universal structural contracts for 6 design domains — Team 7</p>
          </div>
          <div className="flex gap-2">
            {(["browse", "validate", "compat"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                  activeTab === t ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {t === "compat" ? "Compatibility" : t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 py-6 max-w-6xl mx-auto">
        {/* Stats */}
        {stats && activeTab === "browse" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatsCard label="Total Blueprints" value={stats.total} />
            <StatsCard label="Built-in" value={stats.builtin} sub="6 domains" />
            <StatsCard label="Custom" value={stats.custom} />
            <StatsCard label="Active" value={stats.byStatus.active} sub={`${stats.byStatus.deprecated} deprecated`} />
          </div>
        )}

        {/* Browse */}
        {activeTab === "browse" && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4">
              <input
                className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 min-w-[200px] focus:ring-2 focus:ring-blue-500"
                placeholder="Search name, slug, or tags…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
              >
                <option value="">All Domains</option>
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>
                ))}
              </select>
              <select
                className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={() => { loadBlueprints(); loadStats(); }}
                className="border border-gray-300 text-gray-600 text-sm rounded px-3 py-1.5 hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>

            {fetchError && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm mb-4">
                {fetchError} — make sure the API server is running and you are logged in.
              </div>
            )}

            {loadingBps ? (
              <div className="text-center py-12 text-gray-400 text-sm">Loading blueprints…</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No blueprints found</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((bp) => (
                  <BlueprintCard key={bp.id} bp={bp} onClick={() => setSelectedBp(bp)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Validate */}
        {activeTab === "validate" && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl">
            <h2 className="text-base font-medium text-gray-900 mb-4">Validate Blueprint JSON</h2>
            <ValidatePanel />
          </div>
        )}

        {/* Compat */}
        {activeTab === "compat" && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl">
            <h2 className="text-base font-medium text-gray-900 mb-4">Compatibility Checker</h2>
            <CompatPanel />
          </div>
        )}
      </div>

      {/* Drawer */}
      {selectedBp && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedBp(null)} />
          <BlueprintDrawer bp={selectedBp} onClose={() => setSelectedBp(null)} />
        </>
      )}
    </div>
  );
}
