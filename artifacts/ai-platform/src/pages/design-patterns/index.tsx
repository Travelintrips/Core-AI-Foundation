/**
 * Team 09 — Design Pattern Library page
 * Route: /design-patterns  (Team 24 registers this in App.tsx + sidebar)
 *
 * Features:
 *  - Full-text + faceted search
 *  - Filter by domain, category, repeat behavior, scale, colorizable
 *  - Pattern detail panel (variants, compat records)
 *  - Admin: create / edit / archive patterns
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, X, ChevronDown, Grid3X3, Layers,
  Palette, Repeat, ZoomIn, Shield, Tag, Edit2, Archive,
  CheckCircle, XCircle, Loader2,
} from "lucide-react";

// ── shadcn/ui components (paths from ai-platform conventions) ─────────────────
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label }    from "@/components/ui/label";
import { Switch }   from "@/components/ui/switch";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DesignPattern {
  id:                 number;
  slug:               string;
  name:               string;
  category:           string;
  domain:             string;
  style:              string;
  description:        string | null;
  repeat_behavior:    string;
  scale:              string;
  colorizable:        boolean;
  color_palette:      string[];
  preview_url:        string | null;
  preview_thumb_url:  string | null;
  source_type:        string;
  license:            string | null;
  cultural_origin:    string | null;
  cultural_notes:     string | null;
  compatibility:      string[];
  tags:               string[];
  version:            string;
  status:             string;
  created_at:         string;
  updated_at:         string;
}

interface SearchResult {
  patterns: DesignPattern[];
  total:    number;
  facets: {
    domains:      Record<string, number>;
    categories:   Record<string, number>;
    styles:       Record<string, number>;
    source_types: Record<string, number>;
  };
}

interface PatternMeta {
  domains:          string[];
  categories:       string[];
  repeat_behaviors: string[];
  scales:           string[];
  source_types:     string[];
  statuses:         string[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

function apiFetch(path: string, init?: RequestInit) {

  return fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",

      ...(init?.headers ?? {}),
    },
  });
}

const BASE = "/design-patterns";

async function fetchMeta(): Promise<PatternMeta> {
  const r = await apiFetch(`${BASE}/meta`);
  if (!r.ok) throw new Error("Failed to load meta");
  return r.json() as Promise<PatternMeta>;
}

async function searchPatterns(params: Record<string, string>): Promise<SearchResult> {
  const qs = new URLSearchParams(params).toString();
  const r = await apiFetch(`${BASE}/search?${qs}`);
  if (!r.ok) throw new Error("Search failed");
  return r.json() as Promise<SearchResult>;
}

async function getPattern(id: number): Promise<DesignPattern> {
  const r = await apiFetch(`${BASE}/${id}`);
  if (!r.ok) throw new Error("Not found");
  return r.json() as Promise<DesignPattern>;
}

async function createPattern(body: Record<string, unknown>): Promise<DesignPattern> {
  const r = await apiFetch(BASE, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) {
    const err = (await r.json()) as { error: string };
    throw new Error(err.error ?? "Failed to create pattern");
  }
  return r.json() as Promise<DesignPattern>;
}

async function updatePattern(id: number, body: Record<string, unknown>): Promise<DesignPattern> {
  const r = await apiFetch(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!r.ok) {
    const err = (await r.json()) as { error: string };
    throw new Error(err.error ?? "Failed to update");
  }
  return r.json() as Promise<DesignPattern>;
}

async function archivePattern(id: number): Promise<void> {
  const r = await apiFetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to archive");
}

// ── Color swatch ──────────────────────────────────────────────────────────────
function ColorSwatch({ colors }: { colors: string[] }) {
  if (!colors.length) return <span className="text-muted-foreground text-xs">No palette</span>;
  return (
    <div className="flex gap-1 flex-wrap">
      {colors.slice(0, 8).map((c) => (
        <TooltipProvider key={c}>
          <Tooltip>
            <TooltipTrigger>
              <span
                className="inline-block w-5 h-5 rounded-full border border-border"
                style={{ backgroundColor: c }}
              />
            </TooltipTrigger>
            <TooltipContent><p>{c}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
      {colors.length > 8 && <span className="text-xs text-muted-foreground">+{colors.length - 8}</span>}
    </div>
  );
}

// ── Domain badge colors ───────────────────────────────────────────────────────
const DOMAIN_COLORS: Record<string, string> = {
  geometric:       "bg-blue-100 text-blue-800",
  corporate:       "bg-slate-100 text-slate-800",
  luxury:          "bg-yellow-100 text-yellow-800",
  marble:          "bg-stone-100 text-stone-800",
  abstract:        "bg-purple-100 text-purple-800",
  wave:            "bg-cyan-100 text-cyan-800",
  floral:          "bg-pink-100 text-pink-800",
  leaf:            "bg-green-100 text-green-800",
  "batik-inspired":"bg-orange-100 text-orange-800",
  textile:         "bg-amber-100 text-amber-800",
  interior:        "bg-neutral-100 text-neutral-800",
  wood:            "bg-lime-100 text-lime-800",
  stone:           "bg-gray-100 text-gray-800",
  metal:           "bg-zinc-100 text-zinc-800",
  fabric:          "bg-rose-100 text-rose-800",
  packaging:       "bg-indigo-100 text-indigo-800",
};

// ── Pattern card ──────────────────────────────────────────────────────────────
function PatternCard({ pattern, onSelect }: { pattern: DesignPattern; onSelect: (p: DesignPattern) => void }) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/60 transition-colors"
      onClick={() => onSelect(pattern)}
    >
      {/* Preview */}
      <div className="aspect-square bg-muted rounded-t-md overflow-hidden flex items-center justify-center">
        {pattern.preview_thumb_url ? (
          <img src={pattern.preview_thumb_url} alt={pattern.name} className="w-full h-full object-cover" />
        ) : (
          <Grid3X3 className="w-10 h-10 text-muted-foreground/40" />
        )}
      </div>

      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-1">
          <p className="font-medium text-sm leading-tight">{pattern.name}</p>
          {pattern.status !== "active" && (
            <Badge variant="outline" className="text-xs shrink-0">{pattern.status}</Badge>
          )}
        </div>

        <div className="flex gap-1 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DOMAIN_COLORS[pattern.domain] ?? "bg-muted text-muted-foreground"}`}>
            {pattern.domain}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {pattern.category}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Repeat className="w-3 h-3" />{pattern.repeat_behavior}</span>
          <span className="flex items-center gap-1"><ZoomIn className="w-3 h-3" />{pattern.scale}</span>
          {pattern.colorizable && <Palette className="w-3 h-3 text-primary" />}
        </div>

        <ColorSwatch colors={pattern.color_palette} />
      </CardContent>
    </Card>
  );
}

// ── Create / Edit form ────────────────────────────────────────────────────────
interface PatternFormState {
  slug: string; name: string; category: string; domain: string; style: string;
  description: string; repeat_behavior: string; scale: string;
  colorizable: boolean; source_type: string; license: string;
  cultural_origin: string; cultural_notes: string; tags: string;
  version: string; status: string;
}

const EMPTY_FORM: PatternFormState = {
  slug: "", name: "", category: "pattern", domain: "geometric", style: "modern",
  description: "", repeat_behavior: "tile", scale: "md", colorizable: true,
  source_type: "original", license: "", cultural_origin: "", cultural_notes: "",
  tags: "", version: "1.0.0", status: "active",
};

function PatternForm({
  meta, initial, onSubmit, loading, error,
}: {
  meta: PatternMeta;
  initial?: Partial<PatternFormState>;
  onSubmit: (data: PatternFormState) => void;
  loading: boolean;
  error?: string;
}) {
  const [form, setForm] = useState<PatternFormState>({ ...EMPTY_FORM, ...initial });
  const set = (k: keyof PatternFormState, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded p-2">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Slug *</Label>
          <Input placeholder="kebab-case-slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Name *</Label>
          <Input placeholder="Display Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(v) => set("category", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Domain</Label>
          <Select value={form.domain} onValueChange={(v) => set("domain", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.domains.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Style</Label>
          <Input placeholder="modern" value={form.style} onChange={(e) => set("style", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Repeat Behavior</Label>
          <Select value={form.repeat_behavior} onValueChange={(v) => set("repeat_behavior", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.repeat_behaviors.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Scale</Label>
          <Select value={form.scale} onValueChange={(v) => set("scale", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.scales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={form.colorizable} onCheckedChange={(v) => set("colorizable", v)} id="colorizable" />
        <Label htmlFor="colorizable">Colorizable (can override palette)</Label>
      </div>

      {/* Licensing */}
      <div className="border rounded-md p-3 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Shield className="w-3 h-3" /> Licensing
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Source Type</Label>
            <Select value={form.source_type} onValueChange={(v) => set("source_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{meta.source_types.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>License {form.source_type !== "original" && <span className="text-destructive">*</span>}</Label>
            <Input placeholder="CC-BY-4.0" value={form.license} onChange={(e) => set("license", e.target.value)} />
          </div>
        </div>
      </div>

      {/* Cultural metadata */}
      {form.domain === "batik-inspired" && (
        <div className="border border-orange-200 bg-orange-50/50 rounded-md p-3 space-y-3">
          <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Cultural Metadata (required for batik)</p>
          <div className="space-y-1">
            <Label>Cultural Origin <span className="text-destructive">*</span></Label>
            <Input placeholder="Central Java, Indonesia" value={form.cultural_origin} onChange={(e) => set("cultural_origin", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Cultural Notes</Label>
            <Textarea
              rows={2}
              placeholder="This design is inspired by traditional kawung motif. It is not a claim to any specific traditional work."
              value={form.cultural_notes}
              onChange={(e) => set("cultural_notes", e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Tags (comma-separated)</Label>
          <Input placeholder="batik, java, traditional" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Version</Label>
          <Input placeholder="1.0.0" value={form.version} onChange={(e) => set("version", e.target.value)} />
        </div>
      </div>

      <DialogFooter>
        <Button onClick={() => onSubmit(form)} disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Pattern
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function PatternDetail({
  pattern, meta, onClose, onEdit, onArchive,
}: {
  pattern: DesignPattern;
  meta: PatternMeta;
  onClose: () => void;
  onEdit: (p: DesignPattern) => void;
  onArchive: (id: number) => void;
}) {
  const { data: variants } = useQuery({
    queryKey: ["design-patterns", pattern.id, "variants"],
    queryFn: async () => {
      const r = await apiFetch(`${BASE}/${pattern.id}/variants`);
      return (r.json() as Promise<{ variants: { id: number; slug: string; name: string; color_palette: string[]; scale: string }[] }>);
    },
  });

  const { data: compat } = useQuery({
    queryKey: ["design-patterns", pattern.id, "compat"],
    queryFn: async () => {
      const r = await apiFetch(`${BASE}/${pattern.id}/compat`);
      return (r.json() as Promise<{ compat: { id: number; context: string; min_dpi: number | null; max_scale: string | null; notes: string | null }[] }>);
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {pattern.name}
            <Badge variant="outline" className="font-mono text-xs">{pattern.slug}</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info">
          <TabsList>
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="variants">Variants ({variants?.variants.length ?? 0})</TabsTrigger>
            <TabsTrigger value="compat">Compatibility ({compat?.compat.length ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Domain</span>
                <p><span className={`text-xs px-1.5 py-0.5 rounded font-medium ${DOMAIN_COLORS[pattern.domain] ?? "bg-muted"}`}>{pattern.domain}</span></p>
              </div>
              <div><span className="text-muted-foreground">Category</span><p className="font-medium">{pattern.category}</p></div>
              <div><span className="text-muted-foreground">Style</span><p className="font-medium">{pattern.style}</p></div>
              <div><span className="text-muted-foreground">Version</span><p className="font-mono">{pattern.version}</p></div>
              <div><span className="text-muted-foreground">Repeat</span><p className="font-medium">{pattern.repeat_behavior}</p></div>
              <div><span className="text-muted-foreground">Scale</span><p className="font-medium">{pattern.scale}</p></div>
              <div>
                <span className="text-muted-foreground">Colorizable</span>
                <p>{pattern.colorizable
                  ? <span className="flex items-center gap-1 text-green-600"><CheckCircle className="w-4 h-4" /> Yes</span>
                  : <span className="flex items-center gap-1 text-muted-foreground"><XCircle className="w-4 h-4" /> No</span>
                }</p>
              </div>
              <div><span className="text-muted-foreground">Source</span><p className="font-medium">{pattern.source_type}{pattern.license && ` · ${pattern.license}`}</p></div>
            </div>

            {pattern.description && <p className="text-sm text-muted-foreground">{pattern.description}</p>}

            {pattern.color_palette.length > 0 && (
              <div><p className="text-xs text-muted-foreground mb-1">Default palette</p><ColorSwatch colors={pattern.color_palette} /></div>
            )}

            {(pattern.cultural_origin ?? pattern.cultural_notes) && (
              <div className="bg-orange-50 border border-orange-200 rounded p-3 text-sm space-y-1">
                <p className="font-medium text-orange-800">Cultural Context</p>
                {pattern.cultural_origin && <p><span className="text-muted-foreground">Origin:</span> {pattern.cultural_origin}</p>}
                {pattern.cultural_notes && <p className="text-muted-foreground">{pattern.cultural_notes}</p>}
              </div>
            )}

            {pattern.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {pattern.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs"><Tag className="w-3 h-3 mr-1" />{t}</Badge>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="variants" className="py-2">
            {!variants?.variants.length
              ? <p className="text-sm text-muted-foreground">No variants registered.</p>
              : <div className="space-y-2">
                {variants.variants.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 p-2 rounded border text-sm">
                    <span className="font-medium">{v.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{v.slug}</span>
                    <span className="text-xs">{v.scale}</span>
                    <ColorSwatch colors={v.color_palette} />
                  </div>
                ))}
              </div>
            }
          </TabsContent>

          <TabsContent value="compat" className="py-2">
            {!compat?.compat.length
              ? <p className="text-sm text-muted-foreground">No compatibility records registered.</p>
              : <div className="space-y-2">
                {compat.compat.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 p-2 rounded border text-sm">
                    <Badge className="shrink-0">{c.context}</Badge>
                    <div className="text-muted-foreground text-xs space-y-0.5">
                      {c.min_dpi && <p>Min DPI: {c.min_dpi}</p>}
                      {c.max_scale && <p>Max scale: {c.max_scale}</p>}
                      {c.notes && <p>{c.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            }
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(pattern)}>
            <Edit2 className="w-3 h-3 mr-1" />Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={() => { onArchive(pattern.id); onClose(); }}>
            <Archive className="w-3 h-3 mr-1" />Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DesignPatternsPage() {
  const qc = useQueryClient();

  // Filter state
  const [q,           setQ]           = useState("");
  const [domain,      setDomain]      = useState<string>("all");
  const [category,    setCategory]    = useState<string>("all");
  const [repeatBeh,   setRepeatBeh]   = useState<string>("all");
  const [scale,       setScale]       = useState<string>("all");
  const [colorizable, setColorizable] = useState<string>("all");
  const [limit]                       = useState(24);
  const [offset,      setOffset]      = useState(0);

  // UI state
  const [selected,    setSelected]  = useState<DesignPattern | null>(null);
  const [showCreate,  setShowCreate] = useState(false);
  const [editTarget,  setEditTarget] = useState<DesignPattern | null>(null);
  const [formError,   setFormError]  = useState<string | undefined>();

  // Queries
  const { data: meta } = useQuery({
    queryKey: ["design-patterns-meta"],
    queryFn: fetchMeta,
    staleTime: Infinity,
  });

  const searchParams = useMemo(() => {
    const p: Record<string, string> = {
      limit: String(limit),
      offset: String(offset),
      status: "active",
    };
    if (q)                         p["q"]               = q;
    if (domain    !== "all")       p["domain"]          = domain;
    if (category  !== "all")       p["category"]        = category;
    if (repeatBeh !== "all")       p["repeat_behavior"] = repeatBeh;
    if (scale     !== "all")       p["scale"]           = scale;
    if (colorizable !== "all")     p["colorizable"]     = colorizable;
    return p;
  }, [q, domain, category, repeatBeh, scale, colorizable, limit, offset]);

  const { data: results, isLoading, isError } = useQuery({
    queryKey: ["design-patterns-search", searchParams],
    queryFn: () => searchPatterns(searchParams),
    placeholderData: (prev) => prev,
  });

  // Mutations
  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => createPattern(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["design-patterns-search"] }); setShowCreate(false); setFormError(undefined); },
    onError: (e: Error) => setFormError(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => updatePattern(id, body),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["design-patterns-search"] }); setEditTarget(null); setSelected(p); setFormError(undefined); },
    onError: (e: Error) => setFormError(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) => archivePattern(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["design-patterns-search"] }); setSelected(null); },
  });

  const handleFormSubmit = useCallback((data: PatternFormState) => {
    const body: Record<string, unknown> = {
      ...data,
      tags: data.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (!body["license"]) delete body["license"];
    if (!body["cultural_origin"]) delete body["cultural_origin"];
    if (!body["cultural_notes"]) delete body["cultural_notes"];
    if (!body["description"]) delete body["description"];

    if (editTarget) {
      updateMut.mutate({ id: editTarget.id, body });
    } else {
      createMut.mutate(body);
    }
  }, [editTarget, createMut, updateMut]);

  const totalPages = Math.ceil((results?.total ?? 0) / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Design Pattern Library</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Pattern, motif, texture &amp; decorative asset registry
            {results && <span className="ml-2 text-xs">({results.total} assets)</span>}
          </p>
        </div>
        <Button onClick={() => { setShowCreate(true); setFormError(undefined); }}>
          <Plus className="w-4 h-4 mr-2" />Add Pattern
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, description, tags…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setOffset(0); }}
          />
        </div>

        <Select value={domain} onValueChange={(v) => { setDomain(v); setOffset(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Domain" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Domains</SelectItem>
            {meta?.domains.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => { setCategory(v); setOffset(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {meta?.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={repeatBeh} onValueChange={(v) => { setRepeatBeh(v); setOffset(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Repeat" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Repeat</SelectItem>
            {meta?.repeat_behaviors.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={scale} onValueChange={(v) => { setScale(v); setOffset(0); }}>
          <SelectTrigger className="w-28"><SelectValue placeholder="Scale" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scales</SelectItem>
            {meta?.scales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={colorizable} onValueChange={(v) => { setColorizable(v); setOffset(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Colorizable" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="true">Colorizable</SelectItem>
            <SelectItem value="false">Fixed palette</SelectItem>
          </SelectContent>
        </Select>

        {(q || domain !== "all" || category !== "all" || repeatBeh !== "all" || scale !== "all" || colorizable !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setDomain("all"); setCategory("all"); setRepeatBeh("all"); setScale("all"); setColorizable("all"); setOffset(0); }}>
            <X className="w-4 h-4 mr-1" />Clear
          </Button>
        )}
      </div>

      {/* Facets */}
      {results?.facets && Object.keys(results.facets.domains).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(results.facets.domains)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([d, cnt]) => (
              <button
                key={d}
                onClick={() => { setDomain(domain === d ? "all" : d); setOffset(0); }}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${domain === d ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}
              >
                {d} <span className="opacity-60">{cnt}</span>
              </button>
            ))}
        </div>
      )}

      {/* Grid */}
      {isLoading && (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="text-destructive text-sm flex items-center gap-2">
          <XCircle className="w-4 h-4" />Failed to load patterns. Check API connection.
        </div>
      )}

      {!isLoading && !isError && results && (
        <>
          {results.patterns.length === 0
            ? <div className="text-center text-muted-foreground py-16"><Layers className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No patterns found.</p></div>
            : <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {results.patterns.map((p) => (
                  <PatternCard key={p.id} pattern={p} onSelect={setSelected} />
                ))}
              </div>
          }

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</Button>
              <span className="text-sm text-muted-foreground">{currentPage} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={offset + limit >= (results.total)} onClick={() => setOffset(offset + limit)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Detail panel */}
      {selected && meta && (
        <PatternDetail
          pattern={selected}
          meta={meta}
          onClose={() => setSelected(null)}
          onEdit={(p) => { setEditTarget(p); setSelected(null); setFormError(undefined); }}
          onArchive={(id) => archiveMut.mutate(id)}
        />
      )}

      {/* Create dialog */}
      {showCreate && meta && (
        <Dialog open onOpenChange={() => setShowCreate(false)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Add Design Pattern</DialogTitle></DialogHeader>
            <PatternForm
              meta={meta}
              onSubmit={handleFormSubmit}
              loading={createMut.isPending}
              error={formError}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Edit dialog */}
      {editTarget && meta && (
        <Dialog open onOpenChange={() => setEditTarget(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Edit — {editTarget.name}</DialogTitle></DialogHeader>
            <PatternForm
              meta={meta}
              initial={{
                ...editTarget,
                tags: editTarget.tags.join(", "),
              }}
              onSubmit={handleFormSubmit}
              loading={updateMut.isPending}
              error={formError}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
