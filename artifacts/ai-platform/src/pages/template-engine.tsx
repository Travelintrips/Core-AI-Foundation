/**
 * template-engine.tsx — V4.6 Template Engine Admin
 * Manages: Registry, Themes, Layouts, Versioning, Mappings
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Layers, Palette, LayoutTemplate, Plus, Settings2, ChevronRight,
  Tag, Globe, Package, History, CheckCircle2, Archive, RefreshCw,
  BarChart3, Sparkles, Edit3, Trash2, BookOpen, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// ── Admin API helper ──────────────────────────────────────────────────────────
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),

      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Theme {
  id: number; themeKey: string; name: string; description?: string;
  category?: string; tokensJson: Record<string, unknown>; createdAt: string;
}
interface Layout {
  id: number; layoutKey: string; name: string; description?: string;
  category: string; layoutType: string; minSlots: number; maxSlots?: number;
  structureJson: { sections: Array<{ id: string; label: string; order: number }>; columns?: number };
}
interface RegistryTemplate {
  id: number; templateKey: string; name: string; description?: string;
  category: string; status: string; currentVersionId?: number;
  thumbnailUrl?: string; createdBy?: string; updatedAt: string;
  version_number?: number; theme_name?: string; layout_name?: string;
}
interface CategoryStat {
  category: string; published: number; drafts: number; archived: number; total: number;
}

const CATEGORIES = [
  "Company Profile","Proposal","Pitch Deck","Brochure","Catalog",
  "Flyer","Banner","Presentation","Website","Landing Page",
  "Whitepaper","Case Study","Annual Report",
];

const STATUS_COLORS: Record<string, string> = {
  published: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  draft:     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  archived:  "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function useMeta() {
  return useQuery({ queryKey: ["engine-meta"], queryFn: () => apiFetch("/api/ai/engine/meta") });
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function OverviewPanel() {
  const { data: stats } = useQuery<{ categories: CategoryStat[] }>({
    queryKey: ["engine-registry-stats"],
    queryFn: () => apiFetch("/api/ai/engine/registry/stats"),
  });
  const { data: themes } = useQuery<{ items: Theme[]; total: number }>({
    queryKey: ["engine-themes"],
    queryFn: () => apiFetch("/api/ai/engine/themes?limit=100"),
  });
  const { data: layouts } = useQuery<{ items: Layout[]; total: number }>({
    queryKey: ["engine-layouts"],
    queryFn: () => apiFetch("/api/ai/engine/layouts?limit=100"),
  });
  const { toast } = useToast();
  const qc = useQueryClient();

  const seedMut = useMutation({
    mutationFn: () => apiFetch("/api/ai/engine/seed", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Seed berhasil", description: "Themes, layouts & registry templates di-seed." });
      qc.invalidateQueries({ queryKey: ["engine-registry-stats"] });
      qc.invalidateQueries({ queryKey: ["engine-themes"] });
      qc.invalidateQueries({ queryKey: ["engine-layouts"] });
    },
  });

  const totalPublished = stats?.categories.reduce((s, c) => s + Number(c.published), 0) ?? 0;
  const totalDrafts = stats?.categories.reduce((s, c) => s + Number(c.drafts), 0) ?? 0;
  const totalTemplates = stats?.categories.reduce((s, c) => s + Number(c.total), 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Templates", value: totalTemplates, icon: Layers, color: "text-blue-400" },
          { label: "Published", value: totalPublished, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Drafts", value: totalDrafts, icon: Edit3, color: "text-yellow-400" },
          { label: "Themes", value: themes?.total ?? 0, icon: Palette, color: "text-purple-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color} shrink-0`} />
              <div>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-xs text-zinc-400">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Category breakdown */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Coverage per Kategori
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}
            className="h-7 text-xs border-zinc-700">
            <RefreshCw className={`w-3 h-3 mr-1 ${seedMut.isPending ? "animate-spin" : ""}`} />
            Seed Default
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {CATEGORIES.map((cat) => {
              const stat = stats?.categories.find((c) => c.category === cat);
              const total = Number(stat?.total ?? 0);
              const pub = Number(stat?.published ?? 0);
              const pct = total > 0 ? Math.round((pub / total) * 100) : 0;
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400 w-36 shrink-0">{cat}</span>
                  <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-zinc-500 w-20 text-right">
                    {pub}/{total} published
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Engine summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
              <Palette className="w-4 h-4 text-purple-400" /> Theme Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {(themes?.items ?? []).slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: (t.tokensJson as { colors?: { primary?: string } })?.colors?.primary ?? "#888" }} />
                <span className="text-zinc-300">{t.name}</span>
                {t.category && <Badge variant="outline" className="text-[10px] px-1 py-0 border-zinc-700">{t.category}</Badge>}
              </div>
            ))}
            {(themes?.total ?? 0) > 6 && (
              <p className="text-[10px] text-zinc-500">+{(themes?.total ?? 0) - 6} more</p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
              <LayoutTemplate className="w-4 h-4 text-cyan-400" /> Layout Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {(layouts?.items ?? []).slice(0, 6).map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-xs">
                <span className="text-zinc-300">{l.name}</span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-zinc-700">{l.layoutType}</Badge>
                <span className="text-zinc-500">{l.category}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// THEME ENGINE PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function ThemeEnginePanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newTheme, setNewTheme] = useState({ themeKey: "", name: "", description: "", category: "" });
  const [newColors, setNewColors] = useState({ primary: "#1a2f5a", secondary: "#2d4a8a", accent: "#c9a84c", background: "#ffffff", text: "#1a1a2e" });
  const [newTypo, setNewTypo] = useState({ heading: "Inter", body: "Inter" });
  const [createOpen, setCreateOpen] = useState(false);

  const { data } = useQuery<{ items: Theme[]; total: number }>({
    queryKey: ["engine-themes"],
    queryFn: () => apiFetch("/api/ai/engine/themes?limit=100"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/engine/themes/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["engine-themes"] }); toast({ title: "Theme dihapus" }); },
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/api/ai/engine/themes", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine-themes"] });
      toast({ title: "Theme dibuat" });
      setCreateOpen(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">{data?.total ?? 0} themes terdaftar</p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs"><Plus className="w-3 h-3 mr-1" /> Buat Theme</Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg">
            <DialogHeader><DialogTitle className="text-white">Buat Theme Baru</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-zinc-400 text-xs">Theme Key *</Label>
                  <Input value={newTheme.themeKey} onChange={(e) => setNewTheme({ ...newTheme, themeKey: e.target.value })}
                    placeholder="THEME-BRAND-001" className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
                <div><Label className="text-zinc-400 text-xs">Name *</Label>
                  <Input value={newTheme.name} onChange={(e) => setNewTheme({ ...newTheme, name: e.target.value })}
                    placeholder="Corporate Navy" className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
              </div>
              <div><Label className="text-zinc-400 text-xs">Category (opsional)</Label>
                <Input value={newTheme.category} onChange={(e) => setNewTheme({ ...newTheme, category: e.target.value })}
                  placeholder="Company Profile" className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
              <div><Label className="text-zinc-400 text-xs">Description</Label>
                <Textarea value={newTheme.description} onChange={(e) => setNewTheme({ ...newTheme, description: e.target.value })}
                  rows={2} className="bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
              <div><Label className="text-zinc-400 text-xs mb-2 block">Colors</Label>
                <div className="grid grid-cols-5 gap-1">
                  {(["primary","secondary","accent","background","text"] as const).map((k) => (
                    <div key={k} className="text-center">
                      <input type="color" value={newColors[k]} onChange={(e) => setNewColors({ ...newColors, [k]: e.target.value })}
                        className="w-full h-8 rounded cursor-pointer bg-transparent border-0" />
                      <p className="text-[9px] text-zinc-500 mt-1">{k}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-zinc-400 text-xs">Heading Font</Label>
                  <Input value={newTypo.heading} onChange={(e) => setNewTypo({ ...newTypo, heading: e.target.value })}
                    placeholder="Inter" className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
                <div><Label className="text-zinc-400 text-xs">Body Font</Label>
                  <Input value={newTypo.body} onChange={(e) => setNewTypo({ ...newTypo, body: e.target.value })}
                    placeholder="Inter" className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
              </div>
              <Button size="sm" className="w-full" onClick={() => createMut.mutate({
                ...newTheme,
                tokensJson: { colors: newColors, typography: newTypo, spacing: "normal", borderRadius: "medium", shadows: "soft" },
              })} disabled={createMut.isPending}>
                {createMut.isPending ? "Menyimpan..." : "Simpan Theme"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {(data?.items ?? []).map((theme) => {
          const colors = (theme.tokensJson as { colors?: Record<string, string> })?.colors ?? {};
          return (
            <Card key={theme.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardContent className="p-4">
                <div className="flex gap-2 mb-3">
                  {["primary","secondary","accent","background","text"].map((k) => (
                    <div key={k} className="w-6 h-6 rounded-full border border-zinc-700 shrink-0"
                      style={{ background: colors[k] ?? "#888" }} title={k} />
                  ))}
                </div>
                <p className="font-medium text-white text-sm">{theme.name}</p>
                <p className="text-[10px] text-zinc-500 font-mono">{theme.themeKey}</p>
                {theme.description && <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{theme.description}</p>}
                <div className="flex items-center justify-between mt-3">
                  {theme.category
                    ? <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">{theme.category}</Badge>
                    : <span className="text-[10px] text-zinc-600">Universal</span>}
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-zinc-500 hover:text-red-400"
                    onClick={() => deleteMut.mutate(theme.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT ENGINE PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function LayoutEnginePanel() {
  const { data } = useQuery<{ items: Layout[]; total: number }>({
    queryKey: ["engine-layouts"],
    queryFn: () => apiFetch("/api/ai/engine/layouts?limit=100"),
  });

  const LAYOUT_TYPE_COLORS: Record<string, string> = {
    "single-column": "bg-blue-500/20 text-blue-300",
    "two-column": "bg-purple-500/20 text-purple-300",
    "grid": "bg-emerald-500/20 text-emerald-300",
    "magazine": "bg-orange-500/20 text-orange-300",
    "cover-focus": "bg-pink-500/20 text-pink-300",
    "tri-fold": "bg-yellow-500/20 text-yellow-300",
    "banner-landscape": "bg-cyan-500/20 text-cyan-300",
    "banner-portrait": "bg-indigo-500/20 text-indigo-300",
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">{data?.total ?? 0} layouts terdaftar</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(data?.items ?? []).map((layout) => (
          <Card key={layout.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-medium text-white text-sm">{layout.name}</p>
                  <p className="text-[10px] text-zinc-500 font-mono">{layout.layoutKey}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${LAYOUT_TYPE_COLORS[layout.layoutType] ?? "bg-zinc-700 text-zinc-300"}`}>
                  {layout.layoutType}
                </span>
              </div>
              {layout.description && <p className="text-xs text-zinc-400 mb-3">{layout.description}</p>}
              <div className="space-y-1">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Sections</p>
                <div className="flex flex-wrap gap-1">
                  {(layout.structureJson?.sections ?? []).map((s) => (
                    <span key={s.id} className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">{s.label}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">{layout.category}</Badge>
                <span className="text-[10px] text-zinc-500">
                  {layout.minSlots}–{layout.maxSlots ?? "∞"} slots · {layout.structureJson?.columns ?? 1} col
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function RegistryPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTpl, setNewTpl] = useState({ templateKey: "", name: "", description: "", category: CATEGORIES[0] });

  const { data } = useQuery<{ items: RegistryTemplate[]; total: number }>({
    queryKey: ["engine-registry", catFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "200" });
      if (catFilter !== "all") params.set("category", catFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      return apiFetch(`/api/ai/engine/registry?${params}`);
    },
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/api/ai/engine/registry", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine-registry"] });
      qc.invalidateQueries({ queryKey: ["engine-registry-stats"] });
      toast({ title: "Template dibuat" });
      setCreateOpen(false);
      setNewTpl({ templateKey: "", name: "", description: "", category: CATEGORIES[0] });
    },
  });

  const publishMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/engine/registry/${id}/publish`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine-registry"] });
      qc.invalidateQueries({ queryKey: ["engine-registry-stats"] });
      toast({ title: "Template dipublish" });
    },
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/engine/registry/${id}/archive`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine-registry"] });
      qc.invalidateQueries({ queryKey: ["engine-registry-stats"] });
      toast({ title: "Template diarsip" });
    },
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-8 w-48 bg-zinc-800 border-zinc-700 text-xs">
            <SelectValue placeholder="Semua Kategori" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="all" className="text-xs">Semua Kategori</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 bg-zinc-800 border-zinc-700 text-xs">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-800">
            <SelectItem value="all" className="text-xs">Semua Status</SelectItem>
            <SelectItem value="draft" className="text-xs">Draft</SelectItem>
            <SelectItem value="published" className="text-xs">Published</SelectItem>
            <SelectItem value="archived" className="text-xs">Archived</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs"><Plus className="w-3 h-3 mr-1" /> Template Baru</Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md">
              <DialogHeader><DialogTitle className="text-white">Buat Template</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <div><Label className="text-zinc-400 text-xs">Template Key *</Label>
                  <Input value={newTpl.templateKey} onChange={(e) => setNewTpl({ ...newTpl, templateKey: e.target.value })}
                    placeholder="TPL-COMP-PROF-001" className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
                <div><Label className="text-zinc-400 text-xs">Name *</Label>
                  <Input value={newTpl.name} onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })}
                    placeholder="Company Profile Standard" className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
                <div><Label className="text-zinc-400 text-xs">Kategori *</Label>
                  <Select value={newTpl.category} onValueChange={(v) => setNewTpl({ ...newTpl, category: v })}>
                    <SelectTrigger className="h-8 bg-zinc-800 border-zinc-700 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-800">
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-zinc-400 text-xs">Description</Label>
                  <Textarea value={newTpl.description} onChange={(e) => setNewTpl({ ...newTpl, description: e.target.value })}
                    rows={2} className="bg-zinc-800 border-zinc-700 text-xs mt-1" /></div>
                <Button size="sm" className="w-full" onClick={() => createMut.mutate(newTpl as Record<string, unknown>)}
                  disabled={createMut.isPending}>
                  {createMut.isPending ? "Menyimpan..." : "Buat Template"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <p className="text-xs text-zinc-500">{data?.total ?? 0} templates</p>

      {/* Table */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Template</th>
              <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Kategori</th>
              <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Theme / Layout</th>
              <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Versi</th>
              <th className="text-left px-4 py-2.5 text-xs text-zinc-400 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {(data?.items ?? []).map((tpl) => (
              <tr key={tpl.id} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-white text-xs font-medium">{tpl.name}</p>
                  <p className="text-[10px] text-zinc-500 font-mono">{tpl.templateKey}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">{tpl.category}</Badge>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-400">
                  {tpl.theme_name ? <span className="text-purple-400">{tpl.theme_name}</span> : <span className="text-zinc-600">—</span>}
                  {" / "}
                  {tpl.layout_name ? <span className="text-cyan-400">{tpl.layout_name}</span> : <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-400">
                  {tpl.version_number != null ? `v${tpl.version_number}` : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[tpl.status] ?? ""}`}>
                    {tpl.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-zinc-500 hover:text-white"
                      onClick={() => setSelectedId(selectedId === tpl.id ? null : tpl.id)}>
                      <Settings2 className="w-3 h-3" />
                    </Button>
                    {tpl.status === "draft" && (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-zinc-500 hover:text-emerald-400"
                        onClick={() => publishMut.mutate(tpl.id)}>
                        <CheckCircle2 className="w-3 h-3" />
                      </Button>
                    )}
                    {tpl.status !== "archived" && (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-zinc-500 hover:text-yellow-400"
                        onClick={() => archiveMut.mutate(tpl.id)}>
                        <Archive className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.total ?? 0) === 0 && (
          <div className="text-center py-8 text-zinc-500 text-xs">
            Belum ada template. Klik "Seed Default" untuk mengisi data awal.
          </div>
        )}
      </div>

      {/* Version detail drawer */}
      {selectedId && <VersionPanel templateId={selectedId} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function VersionPanel({ templateId }: { templateId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newVer, setNewVer] = useState({ changelog: "", themeId: "", layoutId: "" });

  const { data: versions } = useQuery<{ items: unknown[]; total: number }>({
    queryKey: ["engine-versions", templateId],
    queryFn: () => apiFetch(`/api/ai/engine/registry/${templateId}/versions`),
  });

  const { data: themes } = useQuery<{ items: Theme[] }>({
    queryKey: ["engine-themes"],
    queryFn: () => apiFetch("/api/ai/engine/themes?limit=100"),
  });

  const { data: layouts } = useQuery<{ items: Layout[] }>({
    queryKey: ["engine-layouts"],
    queryFn: () => apiFetch("/api/ai/engine/layouts?limit=100"),
  });

  const createVerMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/api/ai/engine/registry/${templateId}/versions`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine-versions", templateId] });
      toast({ title: "Versi dibuat" });
    },
  });

  const publishVerMut = useMutation({
    mutationFn: (versionId: number) =>
      apiFetch(`/api/ai/engine/registry/${templateId}/versions/${versionId}/publish`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine-versions", templateId] });
      qc.invalidateQueries({ queryKey: ["engine-registry"] });
      toast({ title: "Versi dipublish & jadi current version" });
    },
  });

  const rollbackMut = useMutation({
    mutationFn: (versionId: number) =>
      apiFetch(`/api/ai/engine/registry/${templateId}/versions/${versionId}/rollback`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engine-registry"] });
      toast({ title: "Rollback berhasil" });
    },
  });

  return (
    <Card className="bg-zinc-900 border-zinc-700 mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
          <History className="w-4 h-4 text-blue-400" /> Version History — Template #{templateId}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new version */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 bg-zinc-800/50 rounded-lg p-3">
          <div>
            <Label className="text-zinc-400 text-xs">Theme</Label>
            <Select value={newVer.themeId} onValueChange={(v) => setNewVer({ ...newVer, themeId: v })}>
              <SelectTrigger className="h-7 bg-zinc-800 border-zinc-700 text-xs mt-1">
                <SelectValue placeholder="Pilih theme" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="" className="text-xs">— Tidak ada —</SelectItem>
                {(themes?.items ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} className="text-xs">{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Layout</Label>
            <Select value={newVer.layoutId} onValueChange={(v) => setNewVer({ ...newVer, layoutId: v })}>
              <SelectTrigger className="h-7 bg-zinc-800 border-zinc-700 text-xs mt-1">
                <SelectValue placeholder="Pilih layout" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                <SelectItem value="" className="text-xs">— Tidak ada —</SelectItem>
                {(layouts?.items ?? []).map((l) => (
                  <SelectItem key={l.id} value={String(l.id)} className="text-xs">{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Changelog</Label>
            <Input value={newVer.changelog} onChange={(e) => setNewVer({ ...newVer, changelog: e.target.value })}
              placeholder="Deskripsi perubahan" className="h-7 bg-zinc-800 border-zinc-700 text-xs mt-1" />
          </div>
          <div className="flex items-end">
            <Button size="sm" className="h-7 text-xs w-full" onClick={() => createVerMut.mutate({
              themeId: newVer.themeId ? parseInt(newVer.themeId, 10) : undefined,
              layoutId: newVer.layoutId ? parseInt(newVer.layoutId, 10) : undefined,
              changelog: newVer.changelog || undefined,
            })} disabled={createVerMut.isPending}>
              <Plus className="w-3 h-3 mr-1" /> Buat Versi
            </Button>
          </div>
        </div>

        {/* Version list */}
        <div className="space-y-2">
          {((versions?.items ?? []) as Array<Record<string, unknown>>).map((v) => (
            <div key={v.id as number} className="flex items-center gap-3 bg-zinc-800/30 rounded-lg px-3 py-2">
              <span className="text-xs font-mono text-blue-400 w-8">v{v.versionNumber as number}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[v.status as string] ?? ""}`}>
                {v.status as string}
              </span>
              <span className="text-xs text-zinc-400 flex-1 truncate">{(v.changelog as string) || "—"}</span>
              <span className="text-[10px] text-zinc-500">
                {new Date(v.createdAt as string).toLocaleDateString("id-ID")}
              </span>
              <div className="flex gap-1">
                {v.status === "draft" && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-emerald-400 px-2"
                    onClick={() => publishVerMut.mutate(v.id as number)}>
                    Publish
                  </Button>
                )}
                {v.status === "published" && (
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-yellow-400 px-2"
                    onClick={() => rollbackMut.mutate(v.id as number)}>
                    Set Active
                  </Button>
                )}
              </div>
            </div>
          ))}
          {(versions?.total ?? 0) === 0 && (
            <p className="text-center text-xs text-zinc-500 py-3">Belum ada versi. Buat versi pertama di atas.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function TemplateEnginePage() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <Sparkles className="w-3 h-3" /> Creative AI
            <ChevronRight className="w-3 h-3" />
            <span className="text-zinc-300">Template Engine</span>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Layers className="w-6 h-6 text-blue-400" /> Template Engine
            <Badge className="bg-blue-600/20 text-blue-400 border-blue-500/30 border text-xs font-normal">V4.6</Badge>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Master template engine — Theme, Layout, Registry &amp; Mapping untuk seluruh Creative AI
          </p>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => (
          <span key={cat} className="text-[10px] px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
            {cat}
          </span>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-zinc-800 border border-zinc-700 h-9">
          {[
            { value: "overview",  label: "Overview",        icon: BarChart3 },
            { value: "themes",    label: "Theme Engine",    icon: Palette },
            { value: "layouts",   label: "Layout Engine",   icon: LayoutTemplate },
            { value: "registry",  label: "Registry",        icon: BookOpen },
          ].map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}
              className="text-xs data-[state=active]:bg-zinc-700 data-[state=active]:text-white flex items-center gap-1.5">
              <Icon className="w-3 h-3" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4"><OverviewPanel /></TabsContent>
        <TabsContent value="themes" className="mt-4"><ThemeEnginePanel /></TabsContent>
        <TabsContent value="layouts" className="mt-4"><LayoutEnginePanel /></TabsContent>
        <TabsContent value="registry" className="mt-4"><RegistryPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
