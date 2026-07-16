import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutTemplate, Plus, Archive, Eye, TrendingUp, BarChart3,
  Sparkles, RefreshCw, Star, Layers, Search, Filter, ChevronRight,
  Globe, Lightbulb, Package, CheckCircle2, AlertCircle, ArrowUpRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ── Admin API ─────────────────────────────────────────────────────────────────

// API calls must go to /api/... directly — do NOT use BASE_URL here.
// BASE_URL is /admin/ for this artifact, which would route requests to the
// Vite dev server instead of the API server when prepended.
const API_BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface ColorTheme { primary: string; secondary: string; accent: string; background: string; text: string }

interface TemplateItem {
  id: number;
  templateCode: string;
  name: string;
  description: string | null;
  category: string;
  style: string;
  industry: string | null;
  colorTheme: ColorTheme | null;
  previewImages: { thumbnail: string; hero: string; gallery: string[] } | null;
  editable: boolean;
  isPremium: boolean;
  version: string;
  status: string;
  featured: boolean;
  views: number;
  selections: number;
  previewsGenerated: number;
  conversions: number;
  supportedPackages: string[] | null;
  createdAt: string;
  updatedAt: string;
}

interface TemplateList { items: TemplateItem[]; total: number }

interface AnalyticsSummary {
  totalViews: number | null; totalSelections: number | null;
  totalPreviews: number | null; totalConversions: number | null; templateCount: number | null;
}

interface AnalyticsStats {
  summary: AnalyticsSummary;
  topByViews: Array<{ id: number; name: string; category: string; views: number; conversions: number }>;
  topByConversions: Array<{ id: number; name: string; category: string; views: number; conversions: number }>;
  byCategory: Array<{ category: string; count: number; totalViews: number }>;
  byStyle: Array<{ style: string; count: number; totalSelections: number }>;
}

interface EvolutionEntry {
  id: number; name: string; category: string; style: string;
  views: number; conversions: number; previewsGenerated?: number; recommendation: string;
}

interface TemplateEvolution {
  underperforming: EvolutionEntry[];
  needsRevision: EvolutionEntry[];
  topConverters: EvolutionEntry[];
}

interface IndustryShowcaseItem { industry: string; topTemplate: TemplateItem | null; totalTemplates: number }

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}18` }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold">{value ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function ColorDot({ color }: { color: string | null }) {
  if (!color) return null;
  return <span className="inline-block w-4 h-4 rounded-full border border-border" style={{ background: color }} title={color} />;
}

function PremiumBadge({ isPremium }: { isPremium: boolean }) {
  return isPremium
    ? <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300">Premium</Badge>
    : <Badge variant="outline">Free</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    archived: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status] ?? styles.draft}`}>{status}</span>;
}

function TemplateCard({
  template,
  onPublish,
  onArchive,
  onView,
}: {
  template: TemplateItem;
  onPublish: () => void;
  onArchive: () => void;
  onView: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow">
      {/* Preview thumbnail */}
      <div className="relative h-36 overflow-hidden"
        style={{ background: template.colorTheme?.primary ?? "#6366F1" }}>
        {template.previewImages?.thumbnail
          ? <img src={template.previewImages.thumbnail} alt={template.name} className="w-full h-full object-cover opacity-80" />
          : <div className="absolute inset-0 flex items-center justify-center">
              <LayoutTemplate className="w-10 h-10 text-white/40" />
            </div>
        }
        <div className="absolute top-2 left-2 flex gap-1.5">
          <StatusBadge status={template.status} />
          {template.featured && <Badge className="bg-amber-500/90 text-white border-0"><Star className="w-3 h-3 mr-0.5" />Featured</Badge>}
        </div>
        <div className="absolute top-2 right-2">
          <PremiumBadge isPremium={template.isPremium} />
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-tight">{template.name}</h3>
            <ColorDot color={template.colorTheme?.primary ?? null} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {template.category} · {template.style}
            {template.industry ? ` · ${template.industry}` : ""}
          </p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            { label: "Views", value: template.views },
            { label: "Selected", value: template.selections },
            { label: "Previews", value: template.previewsGenerated },
            { label: "Sales", value: template.conversions },
          ].map((m) => (
            <div key={m.label} className="bg-muted/40 rounded-lg p-1.5">
              <p className="text-sm font-semibold">{m.value}</p>
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="ghost" className="flex-1 text-xs" onClick={onView}>
            <Eye className="w-3 h-3 mr-1" />View
          </Button>
          {template.status !== "published" && (
            <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={onPublish}>
              <CheckCircle2 className="w-3 h-3 mr-1" />Publish
            </Button>
          )}
          {template.status !== "archived" && (
            <Button size="sm" variant="ghost" className="flex-1 text-xs text-rose-500 hover:text-rose-600" onClick={onArchive}>
              <Archive className="w-3 h-3 mr-1" />Archive
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "All", "Company Profile", "Corporate Profile", "Pitch Deck", "Proposal",
  "Product Catalog", "Brochure", "Flyer", "Presentation", "Social Media",
  "Banner", "Business Card", "Letterhead", "Email Signature", "Website Hero",
  "Landing Page", "Packaging", "Infographic", "Whitepaper", "Case Study", "Annual Report",
];

const TABS = [
  { id: "gallery", label: "Template Gallery", icon: <LayoutTemplate className="w-4 h-4" /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
  { id: "evolution", label: "Smart Evolution", icon: <Sparkles className="w-4 h-4" /> },
  { id: "showcase", label: "Industry Showcase", icon: <Globe className="w-4 h-4" /> },
];

export default function TemplateMarketplacePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"gallery" | "analytics" | "evolution" | "showcase">("gallery");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [styleFilter, setStyleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("published");
  const [searchQ, setSearchQ] = useState("");
  const [sortBy, setSortBy] = useState<"popular" | "newest" | "conversions" | "selections">("popular");

  // ── Create Template Dialog ────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [viewTemplate, setViewTemplate] = useState<TemplateItem | null>(null);
  const [createName, setCreateName] = useState("");
  const [createCategory, setCreateCategory] = useState("Company Profile");
  const [createStyle, setCreateStyle] = useState("Modern");
  const [createDesc, setCreateDesc] = useState("");

  // ── Queries ───────────────────────────────────────────────────────────────────

  const galleryQuery = useQuery<TemplateList>({
    queryKey: ["admin-templates", categoryFilter, styleFilter, statusFilter, searchQ, sortBy],
    queryFn: () => {
      const params = new URLSearchParams({
        ...(categoryFilter !== "All" ? { category: categoryFilter } : {}),
        ...(styleFilter ? { style: styleFilter } : {}),
        status: statusFilter,
        ...(searchQ ? { search: searchQ } : {}),
        sortBy,
        limit: "48",
      });
      return apiFetch(`/api/ai/templates?${params.toString()}`);
    },
    enabled: activeTab === "gallery",
    staleTime: 30_000,
  });

  const analyticsQuery = useQuery<AnalyticsStats>({
    queryKey: ["admin-template-analytics"],
    queryFn: () => apiFetch("/api/ai/templates/stats"),
    enabled: activeTab === "analytics",
    staleTime: 60_000,
  });

  const evolutionQuery = useQuery<TemplateEvolution>({
    queryKey: ["admin-template-evolution"],
    queryFn: () => apiFetch("/api/ai/templates/evolution"),
    enabled: activeTab === "evolution",
    staleTime: 120_000,
  });

  const showcaseQuery = useQuery<{ items: IndustryShowcaseItem[] }>({
    queryKey: ["admin-template-showcase"],
    queryFn: () => apiFetch("/api/ai/templates/industry-showcase"),
    enabled: activeTab === "showcase",
    staleTime: 120_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const publishMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/templates/${id}/publish`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template published" }); qc.invalidateQueries({ queryKey: ["admin-templates"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/templates/${id}/archive`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template archived" }); qc.invalidateQueries({ queryKey: ["admin-templates"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      apiFetch(`/api/ai/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: (updated: TemplateItem) => {
      toast({ title: "Template diperbarui" });
      qc.invalidateQueries({ queryKey: ["admin-templates"] });
      setViewTemplate(updated); // refresh modal dengan data terbaru
    },
    onError: (e: Error) => toast({ title: "Gagal update", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      // Auto-generate templateCode from name: "Company Profile CSR" → "COMPANY-PROFILE-CSR"
      const templateCode = createName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
      return apiFetch("/api/ai/templates", {
        method: "POST",
        body: JSON.stringify({
          templateCode,
          name: createName.trim(),
          category: createCategory,
          style: createStyle,
          description: createDesc.trim() || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Template created", description: `"${createName.trim()}" berhasil dibuat sebagai draft.` });
      qc.invalidateQueries({ queryKey: ["admin-templates"] });
      setShowCreate(false);
      setCreateName(""); setCreateCategory("Company Profile"); setCreateStyle("Modern"); setCreateDesc("");
    },
    onError: (e: Error) => toast({ title: "Gagal membuat template", description: e.message, variant: "destructive" }),
  });

  const templates = galleryQuery.data?.items ?? [];
  const total = galleryQuery.data?.total ?? 0;
  const stats = analyticsQuery.data;
  const evolution = evolutionQuery.data;
  const showcase = showcaseQuery.data?.items ?? [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6 text-violet-400" />
            Template Marketplace
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Master Template Library · AI Matching · Analytics · Smart Evolution
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1.5" />Add Template
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Gallery ─────────────────────────────────────────────────────── */}
      {activeTab === "gallery" && (
        <div className="space-y-5">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search templates…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="pl-9" />
            </div>
            <select className="border border-border rounded-md px-3 py-2 text-sm bg-background" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {["published", "draft", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="border border-border rounded-md px-3 py-2 text-sm bg-background" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
              <option value="popular">Most Popular</option>
              <option value="newest">Newest</option>
              <option value="conversions">Top Conversions</option>
              <option value="selections">Most Selected</option>
            </select>
          </div>

          {/* Category pills */}
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                  categoryFilter === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:border-foreground/30"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Count */}
          <p className="text-sm text-muted-foreground">{total} template{total !== 1 ? "s" : ""} found</p>

          {/* Grid */}
          {galleryQuery.isLoading && (
            <div className="text-center py-12 text-muted-foreground">Loading templates…</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onPublish={() => publishMutation.mutate(t.id)}
                onArchive={() => archiveMutation.mutate(t.id)}
                onView={() => setViewTemplate(t)}
              />
            ))}
          </div>
          {templates.length === 0 && !galleryQuery.isLoading && (
            <div className="text-center py-16 text-muted-foreground">
              <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No templates found. Run <code>pnpm seed:templates</code> to seed the library.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Analytics ───────────────────────────────────────────────────── */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          {analyticsQuery.isLoading && <p className="text-muted-foreground text-sm">Loading analytics…</p>}
          {stats && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard label="Templates" value={stats.summary.templateCount ?? 0} icon={<LayoutTemplate className="w-5 h-5" />} color="#6366F1" />
                <StatCard label="Total Views" value={stats.summary.totalViews ?? 0} icon={<Eye className="w-5 h-5" />} color="#3B82F6" />
                <StatCard label="Selections" value={stats.summary.totalSelections ?? 0} icon={<Layers className="w-5 h-5" />} color="#10B981" />
                <StatCard label="Previews" value={stats.summary.totalPreviews ?? 0} icon={<Package className="w-5 h-5" />} color="#F59E0B" />
                <StatCard label="Conversions" value={stats.summary.totalConversions ?? 0} icon={<TrendingUp className="w-5 h-5" />} color="#EC4899" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Top by views */}
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold mb-3 flex items-center gap-2"><Eye className="w-4 h-4 text-blue-400" />Top by Views</h2>
                  <div className="space-y-2">
                    {stats.topByViews.map((t, i) => (
                      <div key={t.id} className="flex items-center gap-3">
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.category}</p>
                        </div>
                        <span className="text-sm font-semibold text-blue-400">{t.views}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top by conversions */}
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />Top by Conversions</h2>
                  <div className="space-y-2">
                    {stats.topByConversions.map((t, i) => (
                      <div key={t.id} className="flex items-center gap-3">
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.category}</p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-400">{t.conversions}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By category */}
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-violet-400" />Views by Category</h2>
                  <div className="space-y-2">
                    {stats.byCategory.slice(0, 8).map((c) => {
                      const max = stats.byCategory[0]?.totalViews ?? 1;
                      return (
                        <div key={c.category}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">{c.category}</span>
                            <span className="font-medium">{c.totalViews}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.round((c.totalViews / max) * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* By style */}
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-amber-400" />Selections by Style</h2>
                  <div className="space-y-2">
                    {stats.byStyle.slice(0, 8).map((s) => {
                      const max = stats.byStyle[0]?.totalSelections ?? 1;
                      return (
                        <div key={s.style}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">{s.style}</span>
                            <span className="font-medium">{s.totalSelections}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round((s.totalSelections / max) * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Smart Evolution ─────────────────────────────────────────────── */}
      {activeTab === "evolution" && (
        <div className="space-y-6">
          {evolutionQuery.isLoading && <p className="text-muted-foreground text-sm">Analyzing…</p>}
          {evolution && (
            <>
              {/* Underperforming */}
              <div className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400" />Underperforming Templates
                  <span className="text-xs text-muted-foreground ml-1">(high views, zero conversions)</span>
                </h2>
                {evolution.underperforming.length === 0
                  ? <p className="text-sm text-muted-foreground">None found.</p>
                  : evolution.underperforming.map((t) => (
                    <div key={t.id} className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-800/30 mb-2">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{t.name}</p>
                        <span className="text-xs text-muted-foreground">{t.views} views · {t.conversions} conversions</span>
                      </div>
                      <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{t.recommendation}</p>
                    </div>
                  ))}
              </div>

              {/* Needs revision */}
              <div className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold mb-3 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-amber-400" />Needs Revision
                  <span className="text-xs text-muted-foreground ml-1">(many previews, low conversion)</span>
                </h2>
                {evolution.needsRevision.length === 0
                  ? <p className="text-sm text-muted-foreground">None found.</p>
                  : evolution.needsRevision.map((t) => (
                    <div key={t.id} className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 mb-2">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{t.name}</p>
                        <span className="text-xs text-muted-foreground">{t.previewsGenerated} previews · {t.conversions} conversions</span>
                      </div>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{t.recommendation}</p>
                    </div>
                  ))}
              </div>

              {/* Top converters */}
              <div className="rounded-xl border bg-card p-5">
                <h2 className="font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />Top Converters
                  <span className="text-xs text-muted-foreground ml-1">(replicate these traits)</span>
                </h2>
                {evolution.topConverters.length === 0
                  ? <p className="text-sm text-muted-foreground">Not enough data yet.</p>
                  : evolution.topConverters.map((t) => (
                    <div key={t.id} className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 mb-2">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{t.name}</p>
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t.conversions} sales</span>
                      </div>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{t.recommendation}</p>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Industry Showcase ───────────────────────────────────────────── */}
      {activeTab === "showcase" && (
        <div className="space-y-4">
          {showcaseQuery.isLoading && <p className="text-muted-foreground text-sm">Loading showcase…</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {showcase.map((item) => (
              <div key={item.industry} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-violet-400" />
                    <h3 className="font-semibold">{item.industry}</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">{item.totalTemplates} templates</span>
                </div>
                {item.topTemplate ? (
                  <div className="rounded-lg overflow-hidden border" style={{ background: item.topTemplate.colorTheme?.primary ?? "#6366F1" }}>
                    <div className="p-3 text-white">
                      <p className="text-xs font-medium opacity-80">{item.topTemplate.category}</p>
                      <p className="text-sm font-semibold mt-0.5">{item.topTemplate.name}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs opacity-80">
                        <span>{item.topTemplate.views} views</span>
                        <span>{item.topTemplate.conversions} sales</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-muted/40 p-3 text-center text-xs text-muted-foreground">No featured template</div>
                )}
                <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => { setCategoryFilter("All"); setActiveTab("gallery"); }}>
                  Browse {item.industry} Templates <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── View Template Modal ───────────────────────────────────────────── */}
      <Dialog open={!!viewTemplate} onOpenChange={(open) => { if (!open) setViewTemplate(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewTemplate && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-3">
                  {/* Color swatch */}
                  <div
                    className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center"
                    style={{ background: viewTemplate.colorTheme?.primary ?? "#6366F1" }}
                  >
                    <LayoutTemplate className="w-6 h-6 text-white/80" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-lg leading-tight">{viewTemplate.name}</DialogTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {viewTemplate.category} · {viewTemplate.style}
                      {viewTemplate.industry ? ` · ${viewTemplate.industry}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <StatusBadge status={viewTemplate.status} />
                      {viewTemplate.featured && (
                        <Badge className="bg-amber-500/90 text-white border-0 text-xs">
                          <Star className="w-3 h-3 mr-0.5" />Featured
                        </Badge>
                      )}
                      <PremiumBadge isPremium={viewTemplate.isPremium} />
                    </div>
                  </div>
                </div>
              </DialogHeader>

              {/* Thumbnail */}
              {viewTemplate.previewImages?.thumbnail && (
                <div className="rounded-xl overflow-hidden border border-border">
                  <img
                    src={viewTemplate.previewImages.thumbnail}
                    alt={viewTemplate.name}
                    className="w-full h-48 object-cover"
                  />
                </div>
              )}

              {/* Description */}
              {viewTemplate.description && (
                <p className="text-sm text-muted-foreground leading-relaxed">{viewTemplate.description}</p>
              )}

              {/* Metrics */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Views", value: viewTemplate.views, color: "#3B82F6" },
                  { label: "Selected", value: viewTemplate.selections, color: "#8B5CF6" },
                  { label: "Previews", value: viewTemplate.previewsGenerated, color: "#F59E0B" },
                  { label: "Conversions", value: viewTemplate.conversions, color: "#10B981" },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border bg-card p-3 text-center">
                    <p className="text-xl font-bold" style={{ color: m.color }}>{m.value}</p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                  </div>
                ))}
              </div>

              {/* ── Toggle controls ──────────────────────────────────────────── */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pengaturan Template</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Harga: {viewTemplate.isPremium ? "Premium" : "Free"}</p>
                    <p className="text-xs text-muted-foreground">
                      {viewTemplate.isPremium
                        ? "Hanya tersedia untuk paket professional & enterprise"
                        : "Tersedia gratis untuk semua paket"}
                    </p>
                  </div>
                  <button
                    onClick={() => patchMutation.mutate({ id: viewTemplate.id, data: { isPremium: !viewTemplate.isPremium } })}
                    disabled={patchMutation.isPending}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      viewTemplate.isPremium ? "bg-amber-500" : "bg-muted"
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      viewTemplate.isPremium ? "translate-x-6" : "translate-x-1"
                    }`} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Featured {viewTemplate.featured ? "✓" : ""}</p>
                    <p className="text-xs text-muted-foreground">
                      {viewTemplate.featured
                        ? "Diprioritaskan dalam rekomendasi AI"
                        : "Tidak diprioritaskan dalam rekomendasi AI"}
                    </p>
                  </div>
                  <button
                    onClick={() => patchMutation.mutate({ id: viewTemplate.id, data: { featured: !viewTemplate.featured } })}
                    disabled={patchMutation.isPending}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      viewTemplate.featured ? "bg-violet-500" : "bg-muted"
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      viewTemplate.featured ? "translate-x-6" : "translate-x-1"
                    }`} />
                  </button>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                {/* Color theme */}
                {viewTemplate.colorTheme && (
                  <div className="space-y-1.5">
                    <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Color Theme</p>
                    <div className="flex gap-2 flex-wrap">
                      {Object.entries(viewTemplate.colorTheme).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full border border-border inline-block" style={{ background: v }} />
                          <span className="text-xs text-muted-foreground capitalize">{k}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Packages */}
                {viewTemplate.supportedPackages && viewTemplate.supportedPackages.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Supported Packages</p>
                    <div className="flex flex-wrap gap-1">
                      {viewTemplate.supportedPackages.map((p) => (
                        <Badge key={p} variant="outline" className="capitalize text-xs">{p}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Template code & version */}
                <div className="space-y-1">
                  <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Template Code</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{viewTemplate.templateCode}</code>
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Version</p>
                  <p className="text-xs">{viewTemplate.version}</p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setViewTemplate(null)}>Tutup</Button>
                {viewTemplate.status !== "published" && (
                  <Button onClick={() => { publishMutation.mutate(viewTemplate.id); setViewTemplate(null); }}>
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />Publish
                  </Button>
                )}
                {viewTemplate.status !== "archived" && (
                  <Button variant="destructive" onClick={() => { archiveMutation.mutate(viewTemplate.id); setViewTemplate(null); }}>
                    <Archive className="w-4 h-4 mr-1.5" />Archive
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create Template Dialog ─────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-violet-400" />
              Buat Template Baru
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Nama Template <span className="text-rose-500">*</span></Label>
              <Input
                id="tpl-name"
                placeholder="misal: Company Profile Modern 2025"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-category">Kategori</Label>
              <select
                id="tpl-category"
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                value={createCategory}
                onChange={(e) => setCreateCategory(e.target.value)}
              >
                {CATEGORIES.filter((c) => c !== "All").map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-style">Style</Label>
              <select
                id="tpl-style"
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background"
                value={createStyle}
                onChange={(e) => setCreateStyle(e.target.value)}
              >
                {["Modern", "Minimalist", "Bold", "Elegant", "Classic", "Playful", "Corporate"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Deskripsi <span className="text-muted-foreground text-xs">(opsional)</span></Label>
              <Textarea
                id="tpl-desc"
                placeholder="Deskripsikan kegunaan template ini…"
                rows={3}
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Template akan disimpan sebagai <strong>draft</strong>. Publish setelah selesai diedit.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={createMutation.isPending}>
              Batal
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!createName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Menyimpan…" : "Buat Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
