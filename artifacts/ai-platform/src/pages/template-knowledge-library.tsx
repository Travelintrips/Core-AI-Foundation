import { useState, useEffect, useCallback } from "react";
import { useAdminApi } from "../hooks/useAdminApi";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LibraryStats {
  totalTemplates: number;
  publishedTemplates: number;
  pendingReview: number;
  totalStyles: number;
  totalIndustries: number;
  totalSections: number;
  categoryCounts: Record<string, number>;
  styleDistribution: Record<string, number>;
}

interface StyleKnowledge {
  id: number;
  styleKey: string;
  displayName: string;
  description: string;
  emotions: string[];
  personalities: string[];
  archetypes: string[];
  colorPalette: { name: string; hex: string; role: string }[];
  sortOrder: number;
}

interface IndustryKnowledge {
  id: number;
  industryKey: string;
  industryName: string;
  level: number;
  parentIndustry: string | null;
  businessTypes: string[];
  targetAudiences: string[];
  preferredStyles: string[];
  keywords: string[];
  children?: IndustryKnowledge[];
}

interface Section {
  id: number;
  sectionKey: string;
  displayName: string;
  sectionType: string;
  description: string;
  suitableCategories: string[];
  suitableStyles: string[];
  contentSlots: { slotId: string; label: string; type: string; required: boolean }[];
}

interface Template {
  id: number;
  templateCode: string;
  name: string;
  category: string;
  style: string;
  industry: string | null;
  description: string | null;
  status: string;
  featured: boolean;
  isPremium: boolean;
  views: number;
  selections: number;
  colorTheme?: Record<string, string>;
  typography?: Record<string, string>;
}

interface QueueItem {
  id: number;
  generatedTemplateCode: string;
  triggerMatchScore: number;
  gapExplanation: string;
  status: string;
  createdAt: string;
  triggerInput: Record<string, unknown>;
  generatedKnowledge: Record<string, unknown>;
}

interface MatchResult {
  matches: Array<{
    template: Template;
    totalScore: number;
    confidence: string;
    dimensions: Array<{ dimension: string; weight: number; rawScore: number; weightedScore: number; reason: string }>;
    gapExplanation?: string;
    isNearestMatch?: boolean;
  }>;
  bestScore: number;
  meetsThreshold: boolean;
  offerGeneration: boolean;
  hybridSuggestion?: string;
  inputSummary: Record<string, unknown>;
  nearestMatch?: Template;
}

type Tab = "dashboard" | "styles" | "industries" | "sections" | "templates" | "match" | "queue" | "analytics";

// ─────────────────────────────────────────────────────────────────────────────
// Utility components
// ─────────────────────────────────────────────────────────────────────────────

function Badge({ label, color = "gray" }: { label: string; color?: string }) {
  const colors: Record<string, string> = {
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-700",
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    red: "bg-red-100 text-red-700",
    purple: "bg-purple-100 text-purple-700",
    indigo: "bg-indigo-100 text-indigo-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color] ?? colors.gray}`}>
      {label}
    </span>
  );
}

function StatCard({ label, value, sub, color = "blue" }: { label: string; value: number | string; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200",
    green: "bg-green-50 border-green-200",
    yellow: "bg-yellow-50 border-yellow-200",
    purple: "bg-purple-50 border-purple-200",
    red: "bg-red-50 border-red-200",
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color] ?? colors.blue}`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold mt-1 text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function ScoreBar({ score, label }: { score: number; label?: string }) {
  const pct = Math.min(100, Math.round(score));
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-gray-500 w-24 truncate">{label}</span>}
      <div className="flex-1 h-2 rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-600 w-8 text-right">{pct}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Tab
// ─────────────────────────────────────────────────────────────────────────────

function DashboardTab({ stats, onSeed }: { stats: LibraryStats | null; onSeed: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const { apiFetch } = useAdminApi();

  const handleSeed = async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await apiFetch("/api/seed/knowledge", { method: "POST" });
      const data = await res.json() as { success: boolean; message: string; report: Record<string, { status: string; count?: number }> };
      const lines = Object.entries(data.report).map(([k, v]) => `${k}: ${v.status === "ok" ? `✅ ${v.count ?? 0}` : `❌ ${v.status}`}`);
      setSeedResult(lines.join(" | "));
      onSeed();
    } catch (err) {
      setSeedResult(`Error: ${String(err)}`);
    } finally {
      setSeeding(false);
    }
  };

  if (!stats) return <div className="p-8 text-gray-400">Loading stats…</div>;

  const topCategories = Object.entries(stats.categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Templates" value={stats.totalTemplates} color="blue" />
        <StatCard label="Published" value={stats.publishedTemplates} color="green" />
        <StatCard label="Pending Review" value={stats.pendingReview} color="yellow" />
        <StatCard label="Style Profiles" value={stats.totalStyles} color="purple" />
        <StatCard label="Industries" value={stats.totalIndustries} color="blue" />
        <StatCard label="Sections" value={stats.totalSections} color="green" />
      </div>

      {/* Category distribution */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Templates by Category</h3>
        <div className="space-y-2">
          {topCategories.map(([cat, count]) => (
            <div key={cat} className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-40 truncate">{cat}</span>
              <div className="flex-1 h-3 rounded-full bg-gray-100">
                <div
                  className="h-3 rounded-full bg-indigo-500"
                  style={{ width: `${Math.round((count / (stats.totalTemplates || 1)) * 100)}%` }}
                />
              </div>
              <span className="text-sm font-mono text-gray-500 w-10 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Seed action */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h3 className="font-semibold text-amber-800 mb-2">Knowledge Library Seeding</h3>
        <p className="text-sm text-amber-700 mb-4">
          Populate the library with 35 design styles, 32 industries, 24 sections, and 1,200+ template knowledge entries.
          Idempotent — safe to run multiple times.
        </p>
        <button
          onClick={handleSeed}
          disabled={seeding}
          className="bg-amber-600 hover:bg-amber-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {seeding ? "Seeding…" : "Run Knowledge Seed"}
        </button>
        {seedResult && (
          <p className="mt-3 text-xs text-amber-800 font-mono">{seedResult}</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles Tab
// ─────────────────────────────────────────────────────────────────────────────

function StylesTab({ styles }: { styles: StyleKnowledge[] }) {
  const [selected, setSelected] = useState<StyleKnowledge | null>(null);

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      {/* List */}
      <div className="w-64 border border-gray-200 rounded-xl overflow-y-auto">
        {styles.map((s) => (
          <button
            key={s.styleKey}
            onClick={() => setSelected(s)}
            className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${selected?.styleKey === s.styleKey ? "bg-indigo-50 border-l-4 border-l-indigo-500" : ""}`}
          >
            <p className="font-medium text-sm text-gray-800">{s.displayName}</p>
            <p className="text-xs text-gray-400 truncate">{s.styleKey}</p>
          </button>
        ))}
      </div>

      {/* Detail */}
      {selected ? (
        <div className="flex-1 border border-gray-200 rounded-xl p-6 overflow-y-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-1">{selected.displayName}</h2>
          <p className="text-sm text-gray-500 mb-4">{selected.description}</p>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Emotions</h4>
              <div className="flex flex-wrap gap-1">
                {selected.emotions.map((e) => <Badge key={e} label={e} color="blue" />)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Personalities</h4>
              <div className="flex flex-wrap gap-1">
                {selected.personalities.map((p) => <Badge key={p} label={p} color="purple" />)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Archetypes</h4>
              <div className="flex flex-wrap gap-1">
                {selected.archetypes.map((a) => <Badge key={a} label={a} color="indigo" />)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Color Palette</h4>
              <div className="flex gap-2">
                {(selected.colorPalette ?? []).slice(0, 6).map((c) => (
                  <div key={c.hex} className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-md border border-gray-200" style={{ background: c.hex }} />
                    <span className="text-xs text-gray-400 mt-1">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Select a style to view details
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Industries Tab
// ─────────────────────────────────────────────────────────────────────────────

function IndustriesTab({ industries }: { industries: IndustryKnowledge[] }) {
  const [selected, setSelected] = useState<IndustryKnowledge | null>(null);
  const topLevel = industries.filter((i) => i.level === 1);

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      <div className="w-64 border border-gray-200 rounded-xl overflow-y-auto">
        {topLevel.map((ind) => (
          <div key={ind.industryKey}>
            <button
              onClick={() => setSelected(ind)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 font-medium text-sm ${selected?.industryKey === ind.industryKey ? "bg-indigo-50 border-l-4 border-l-indigo-500" : ""}`}
            >
              {ind.industryName}
            </button>
            {ind.children?.map((child) => (
              <button
                key={child.industryKey}
                onClick={() => setSelected(child)}
                className={`w-full text-left pl-7 pr-4 py-2 border-b border-gray-50 hover:bg-gray-50 text-xs text-gray-600 ${selected?.industryKey === child.industryKey ? "bg-indigo-50 text-indigo-700" : ""}`}
              >
                {child.industryName}
              </button>
            ))}
          </div>
        ))}
      </div>

      {selected ? (
        <div className="flex-1 border border-gray-200 rounded-xl p-6 overflow-y-auto">
          <div className="flex items-start gap-3 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{selected.industryName}</h2>
              <p className="text-sm text-gray-400">{selected.industryKey}</p>
            </div>
            {selected.level === 2 && <Badge label="Sub-industry" color="gray" />}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Business Types</h4>
              <div className="flex flex-wrap gap-1">{selected.businessTypes.map((b) => <Badge key={b} label={b} color="blue" />)}</div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Preferred Styles</h4>
              <div className="flex flex-wrap gap-1">{selected.preferredStyles.map((s) => <Badge key={s} label={s} color="indigo" />)}</div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Target Audiences</h4>
              <div className="space-y-1">{selected.targetAudiences.map((a) => <p key={a} className="text-xs text-gray-600">• {a}</p>)}</div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Keywords</h4>
              <div className="flex flex-wrap gap-1">{selected.keywords.slice(0, 12).map((k) => <Badge key={k} label={k} color="green" />)}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">Select an industry to view details</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections Tab
// ─────────────────────────────────────────────────────────────────────────────

function SectionsTab({ sections }: { sections: Section[] }) {
  const [selected, setSelected] = useState<Section | null>(null);
  const types = [...new Set(sections.map((s) => s.sectionType))];

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      <div className="w-64 border border-gray-200 rounded-xl overflow-y-auto">
        {types.map((type) => (
          <div key={type}>
            <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase">{type}</div>
            {sections.filter((s) => s.sectionType === type).map((sec) => (
              <button
                key={sec.sectionKey}
                onClick={() => setSelected(sec)}
                className={`w-full text-left px-4 py-2.5 border-b border-gray-100 hover:bg-gray-50 text-sm ${selected?.sectionKey === sec.sectionKey ? "bg-indigo-50 border-l-4 border-l-indigo-500 text-indigo-800" : "text-gray-700"}`}
              >
                {sec.displayName}
              </button>
            ))}
          </div>
        ))}
      </div>

      {selected ? (
        <div className="flex-1 border border-gray-200 rounded-xl p-6 overflow-y-auto space-y-5">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{selected.displayName}</h2>
            <p className="text-sm text-gray-500 mt-1">{selected.description}</p>
          </div>

          <div className="flex gap-3">
            <Badge label={selected.sectionType} color="indigo" />
            <Badge label={`${selected.contentSlots.length} slots`} color="blue" />
            <Badge label={`${selected.suitableCategories.length} categories`} color="green" />
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Content Slots</h4>
            <div className="space-y-1">
              {selected.contentSlots.map((slot) => (
                <div key={slot.slotId} className="flex items-center gap-3 text-xs py-1 border-b border-gray-50">
                  <span className="font-mono text-gray-400 w-32">{slot.slotId}</span>
                  <span className="text-gray-700 flex-1">{slot.label}</span>
                  <Badge label={slot.type} color="gray" />
                  {slot.required && <Badge label="required" color="red" />}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Suitable Categories</h4>
            <div className="flex flex-wrap gap-1">{selected.suitableCategories.map((c) => <Badge key={c} label={c} color="blue" />)}</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">Select a section to view details</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Explorer Tab
// ─────────────────────────────────────────────────────────────────────────────

function TemplateExplorerTab({ apiFetch }: { apiFetch: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [filters, setFilters] = useState({ keyword: "", industry: "", style: "", category: "" });
  const [results, setResults] = useState<{ results: Template[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.keyword) params.set("keyword", filters.keyword);
      if (filters.industry) params.set("industry", filters.industry);
      if (filters.style) params.set("style", filters.style);
      if (filters.category) params.set("category", filters.category);
      params.set("limit", "30");
      const res = await apiFetch(`/api/template-knowledge/search?${params}`);
      const data = await res.json() as { data: { results: Template[]; total: number } };
      setResults(data.data);
    } finally {
      setLoading(false);
    }
  }, [filters, apiFetch]);

  useEffect(() => { void search(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-40" placeholder="Keyword…" value={filters.keyword} onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))} />
        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-36" placeholder="Industry…" value={filters.industry} onChange={(e) => setFilters((f) => ({ ...f, industry: e.target.value }))} />
        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32" placeholder="Style…" value={filters.style} onChange={(e) => setFilters((f) => ({ ...f, style: e.target.value }))} />
        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-40" placeholder="Category…" value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} />
        <button onClick={search} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {results && (
        <p className="text-xs text-gray-500">{results.total} templates found</p>
      )}

      <div className="overflow-auto max-h-[calc(100vh-380px)]">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="text-left px-3 py-2 border-b">Code</th>
              <th className="text-left px-3 py-2 border-b">Name</th>
              <th className="text-left px-3 py-2 border-b">Category</th>
              <th className="text-left px-3 py-2 border-b">Industry</th>
              <th className="text-left px-3 py-2 border-b">Style</th>
              <th className="text-left px-3 py-2 border-b">Views</th>
              <th className="text-left px-3 py-2 border-b">Status</th>
            </tr>
          </thead>
          <tbody>
            {(results?.results ?? []).map((t) => (
              <tr key={t.templateCode} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-400">{t.templateCode}</td>
                <td className="px-3 py-2 font-medium text-gray-800 max-w-xs truncate">{t.name}</td>
                <td className="px-3 py-2"><Badge label={t.category} color="blue" /></td>
                <td className="px-3 py-2 text-xs text-gray-500">{t.industry ?? "—"}</td>
                <td className="px-3 py-2"><Badge label={t.style} color="indigo" /></td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{t.views}</td>
                <td className="px-3 py-2"><Badge label={t.status} color={t.status === "published" ? "green" : "gray"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="text-center py-8 text-gray-400 text-sm">Searching…</p>}
        {results?.results.length === 0 && !loading && (
          <p className="text-center py-8 text-gray-400 text-sm">No templates found. Run the knowledge seed first.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Match Tab
// ─────────────────────────────────────────────────────────────────────────────

function AIMatchTab({ apiFetch }: { apiFetch: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [form, setForm] = useState({
    industry: "",
    targetAudience: "",
    preferredStyle: "",
    businessType: "B2B",
    pricePositioning: "mid-market",
    brandPersonalities: "",
    keywords: "",
    category: "",
    limit: "5",
  });
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);

  const handleMatch = async () => {
    setLoading(true);
    setResult(null);
    setGenResult(null);
    try {
      const payload = {
        ...form,
        brandPersonalities: form.brandPersonalities ? form.brandPersonalities.split(",").map((s) => s.trim()) : [],
        keywords: form.keywords ? form.keywords.split(",").map((s) => s.trim()) : [],
        limit: parseInt(form.limit, 10),
      };
      const res = await apiFetch("/api/template-knowledge/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { data: MatchResult };
      setResult(data.data);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!result) return;
    setGenerating(true);
    try {
      const payload = {
        input: {
          industry: form.industry,
          preferredStyle: form.preferredStyle,
          brandPersonalities: form.brandPersonalities.split(",").map((s) => s.trim()),
          category: form.category,
          targetAudience: form.targetAudience,
          businessType: form.businessType,
          pricePositioning: form.pricePositioning,
        },
        triggerScore: result.bestScore,
        nearest: result.nearestMatch,
      };
      const res = await apiFetch("/api/template-knowledge/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { data: { generatedTemplateCode: string; message: string } };
      setGenResult(`Generated: ${data.data.generatedTemplateCode} — ${data.data.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const fieldCls = "border border-gray-300 rounded-lg px-3 py-2 text-sm w-full";
  const labelCls = "text-xs text-gray-500 font-medium";

  return (
    <div className="flex gap-6">
      {/* Form */}
      <div className="w-80 space-y-4 flex-shrink-0">
        <h3 className="font-semibold text-gray-800">10-Dimension Match Input</h3>
        <div className="space-y-3">
          {[
            ["industry", "Industry (20%)"],
            ["targetAudience", "Target Audience (15%)"],
            ["preferredStyle", "Preferred Style (10%)"],
            ["brandPersonalities", "Brand Personalities (15%, comma-sep)"],
            ["keywords", "Keywords (5%, comma-sep)"],
            ["category", "Category"],
          ].map(([key, label]) => (
            <div key={key}>
              <label className={labelCls}>{label}</label>
              <input className={fieldCls} value={form[key as keyof typeof form]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div>
            <label className={labelCls}>Business Type (10%)</label>
            <select className={fieldCls} value={form.businessType} onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value }))}>
              {["B2B", "B2C", "D2C", "Enterprise", "SME", "Startup"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Price Positioning (10%)</label>
            <select className={fieldCls} value={form.pricePositioning} onChange={(e) => setForm((f) => ({ ...f, pricePositioning: e.target.value }))}>
              {["budget", "mid-market", "premium", "luxury"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <button onClick={handleMatch} disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {loading ? "Matching…" : "Find Best Templates"}
        </button>
      </div>

      {/* Result */}
      <div className="flex-1">
        {result ? (
          <div className="space-y-4">
            {/* Score summary */}
            <div className={`rounded-xl border p-4 ${result.meetsThreshold ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-800">Best Match Score: {Math.round(result.bestScore)}/100</p>
                  <p className="text-sm text-gray-500">
                    {result.meetsThreshold ? "✅ Meets threshold (≥70)" : "⚠️ Below threshold — hybrid generation available"}
                  </p>
                </div>
                {result.offerGeneration && (
                  <button onClick={handleGenerate} disabled={generating} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                    {generating ? "Generating…" : "Generate Template"}
                  </button>
                )}
              </div>
              {result.hybridSuggestion && (
                <p className="text-xs text-amber-700 mt-2 border-t border-amber-200 pt-2">{result.hybridSuggestion}</p>
              )}
              {genResult && <p className="text-xs text-green-700 mt-2 font-medium">{genResult}</p>}
            </div>

            {/* Top matches */}
            {result.matches.map((match, i) => (
              <div key={match.template.templateCode} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-xs text-gray-400 mr-2">#{i + 1}</span>
                    <span className="font-semibold text-gray-800">{match.template.name}</span>
                    <p className="text-xs text-gray-400 mt-0.5">{match.template.templateCode}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-gray-800">{Math.round(match.totalScore)}</span>
                    <p className="text-xs text-gray-400">{match.confidence} confidence</p>
                  </div>
                </div>

                {match.gapExplanation && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded p-2 mb-3">{match.gapExplanation}</p>
                )}

                <div className="space-y-1">
                  {match.dimensions.slice(0, 6).map((dim) => (
                    <ScoreBar key={dim.dimension} score={dim.rawScore * 100} label={dim.dimension.replace(/_/g, " ")} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400">
            Fill in the form and click "Find Best Templates"
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval Queue Tab
// ─────────────────────────────────────────────────────────────────────────────

function ApprovalQueueTab({ apiFetch }: { apiFetch: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/template-knowledge/queue");
      const data = await res.json() as { data: QueueItem[] };
      setItems(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { void load(); }, [load]);

  const review = async (decision: "approve" | "reject") => {
    if (!selected) return;
    await apiFetch(`/api/template-knowledge/queue/${selected.id}/${decision}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewedBy: "admin", notes }),
    });
    setSelected(null);
    setNotes("");
    await load();
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      <div className="w-80 border border-gray-200 rounded-xl overflow-y-auto">
        {loading ? <p className="p-4 text-gray-400 text-sm">Loading…</p> :
          items.length === 0 ? <p className="p-4 text-gray-400 text-sm">No items pending review.</p> :
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => { setSelected(item); setNotes(""); }}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${selected?.id === item.id ? "bg-indigo-50 border-l-4 border-l-indigo-500" : ""}`}
            >
              <p className="font-mono text-xs text-gray-500">{item.generatedTemplateCode}</p>
              <p className="text-sm text-gray-700 mt-0.5">Score: {Math.round(item.triggerMatchScore)}</p>
              <p className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</p>
            </button>
          ))
        }
      </div>

      {selected ? (
        <div className="flex-1 border border-gray-200 rounded-xl p-6 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">{selected.generatedTemplateCode}</h2>
            <Badge label={`Score: ${Math.round(selected.triggerMatchScore)}`} color="yellow" />
          </div>

          <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">{selected.gapExplanation}</p>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Match Input</h4>
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-32">
              {JSON.stringify(selected.triggerInput, null, 2)}
            </pre>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Generated Knowledge</h4>
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-48">
              {JSON.stringify(selected.generatedKnowledge, null, 2)}
            </pre>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Review Notes</label>
            <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
          </div>

          <div className="flex gap-3">
            <button onClick={() => void review("approve")} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium">
              ✅ Approve
            </button>
            <button onClick={() => void review("reject")} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium">
              ❌ Reject
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">Select an item to review</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function TemplateKnowledgeLibraryPage() {
  const { apiFetch } = useAdminApi();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [styles, setStyles] = useState<StyleKnowledge[]>([]);
  const [industries, setIndustries] = useState<IndustryKnowledge[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  const loadStats = useCallback(async () => {
    try {
      const res = await apiFetch("/api/template-knowledge/stats");
      const data = await res.json() as { data: LibraryStats };
      setStats(data.data);
    } catch { /* ignore */ }
  }, [apiFetch]);

  useEffect(() => {
    void loadStats();

    void apiFetch("/api/template-knowledge/styles")
      .then((r) => r.json() as Promise<{ data: StyleKnowledge[] }>)
      .then((d) => setStyles(d.data ?? []))
      .catch(() => {});

    void apiFetch("/api/template-knowledge/industries/hierarchy")
      .then((r) => r.json() as Promise<{ data: IndustryKnowledge[] }>)
      .then((d) => setIndustries(d.data ?? []))
      .catch(() => {});

    void apiFetch("/api/template-knowledge/sections")
      .then((r) => r.json() as Promise<{ data: Section[] }>)
      .then((d) => setSections(d.data ?? []))
      .catch(() => {});
  }, [apiFetch, loadStats]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "styles", label: "Styles", icon: "🎨" },
    { id: "industries", label: "Industries", icon: "🏭" },
    { id: "sections", label: "Sections", icon: "🧩" },
    { id: "templates", label: "Templates", icon: "📐" },
    { id: "match", label: "AI Match", icon: "🤖" },
    { id: "queue", label: "Approval Queue", icon: "✅" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Template Knowledge Library</h1>
            <p className="text-sm text-gray-500 mt-1">
              V5.0 Enterprise — {stats ? `${stats.totalTemplates.toLocaleString()} templates · ${stats.totalStyles} styles · ${stats.totalIndustries} industries` : "Loading…"}
            </p>
          </div>
          {stats?.pendingReview ? (
            <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-sm font-medium">
              {stats.pendingReview} pending review
            </span>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5 -mb-5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-700 bg-indigo-50"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-6">
        {activeTab === "dashboard" && <DashboardTab stats={stats} onSeed={loadStats} />}
        {activeTab === "styles" && <StylesTab styles={styles} />}
        {activeTab === "industries" && <IndustriesTab industries={industries} />}
        {activeTab === "sections" && <SectionsTab sections={sections} />}
        {activeTab === "templates" && <TemplateExplorerTab apiFetch={apiFetch} />}
        {activeTab === "match" && <AIMatchTab apiFetch={apiFetch} />}
        {activeTab === "queue" && <ApprovalQueueTab apiFetch={apiFetch} />}
      </div>
    </div>
  );
}
