// Team 10 — Font Pairs Management Page
// Route: /admin/design-tokens/font-pairs  (Team 24 registers this)

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Type, Plus, Search, ChevronLeft, Trash2, Pencil, Check, X,
  AlertTriangle, ExternalLink, ListOrdered,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";
import { useNavigate } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FontPair {
  id: number;
  name: string;
  slug: string;
  displayFont: string;
  bodyFont: string;
  accentFont: string | null;
  category: string;
  mood: string[];
  industries: string[];
  license: string;
  pairingRationale: string | null;
  googleFontsUrl: string | null;
  active: boolean;
  typographyRoles?: TypographyRole[];
}

interface TypographyRole {
  id: number;
  role: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: number;
}

const MOOD_OPTIONS = ["professional", "playful", "elegant", "modern", "traditional", "bold", "minimal", "friendly"];
const CATEGORY_OPTIONS = ["serif", "sans-serif", "display", "monospace", "handwriting"];
const LICENSE_OPTIONS = ["open", "commercial", "custom"];

const MOOD_COLORS: Record<string, string> = {
  professional: "bg-blue-100 text-blue-800",
  modern: "bg-purple-100 text-purple-800",
  elegant: "bg-amber-100 text-amber-800",
  bold: "bg-red-100 text-red-800",
  playful: "bg-pink-100 text-pink-800",
  minimal: "bg-gray-100 text-gray-700",
  friendly: "bg-green-100 text-green-800",
  traditional: "bg-orange-100 text-orange-800",
};

// ── Font Pair Card ────────────────────────────────────────────────────────────

function FontPairCard({ pair, onEdit, onDelete, onViewRoles }: {
  pair: FontPair;
  onEdit: (p: FontPair) => void;
  onDelete: (p: FontPair) => void;
  onViewRoles: (p: FontPair) => void;
}) {
  return (
    <Card className="hover:border-primary/40 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{pair.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{pair.slug}</p>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onViewRoles(pair)}>
              <ListOrdered className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(pair)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(pair)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Font preview */}
        <div className="rounded-md bg-muted/40 p-3 space-y-1">
          <p className="text-base font-semibold leading-tight" style={{ fontFamily: `'${pair.displayFont}', serif` }}>
            {pair.displayFont}
          </p>
          <p className="text-xs text-muted-foreground" style={{ fontFamily: `'${pair.bodyFont}', sans-serif` }}>
            {pair.bodyFont} body text — clear and readable
          </p>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-xs">{pair.category}</Badge>
          <Badge variant="outline" className="text-xs">{pair.license}</Badge>
          {pair.mood.slice(0, 2).map((m) => (
            <Badge key={m} className={`text-xs ${MOOD_COLORS[m] ?? "bg-gray-100"}`}>{m}</Badge>
          ))}
          {pair.mood.length > 2 && (
            <Badge variant="outline" className="text-xs">+{pair.mood.length - 2}</Badge>
          )}
        </div>

        {pair.googleFontsUrl && (
          <a href={pair.googleFontsUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline">
            <ExternalLink className="h-3 w-3" /> Google Fonts
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// ── Create/Edit Dialog ────────────────────────────────────────────────────────

function FontPairDialog({ open, pair, onClose }: {
  open: boolean;
  pair: FontPair | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!pair;

  const [form, setForm] = useState({
    name: pair?.name ?? "",
    displayFont: pair?.displayFont ?? "",
    bodyFont: pair?.bodyFont ?? "",
    accentFont: pair?.accentFont ?? "",
    category: pair?.category ?? "sans-serif",
    mood: pair?.mood ?? ["professional"],
    industries: pair?.industries?.join(", ") ?? "",
    license: pair?.license ?? "open",
    pairingRationale: pair?.pairingRationale ?? "",
    googleFontsUrl: pair?.googleFontsUrl ?? "",
  });

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? apiFetch(`/api/ai/design-tokens/font-pairs/${pair!.id}`, { method: "PATCH", body: JSON.stringify(data) })
        : apiFetch("/api/ai/design-tokens/font-pairs", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-tokens-font-pairs"] });
      qc.invalidateQueries({ queryKey: ["design-tokens-font-pairs-summary"] });
      toast({ title: isEdit ? "Font pair updated" : "Font pair created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to save", variant: "destructive" });
    },
  });

  const toggleMood = (m: string) => {
    setForm((f) => ({
      ...f,
      mood: f.mood.includes(m) ? f.mood.filter((x) => x !== m) : [...f.mood, m],
    }));
  };

  const handleSubmit = () => {
    mutation.mutate({
      name: form.name,
      displayFont: form.displayFont,
      bodyFont: form.bodyFont,
      accentFont: form.accentFont || undefined,
      category: form.category,
      mood: form.mood,
      industries: form.industries.split(",").map((s) => s.trim()).filter(Boolean),
      license: form.license,
      pairingRationale: form.pairingRationale || undefined,
      googleFontsUrl: form.googleFontsUrl || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Font Pair" : "New Font Pair"}</DialogTitle>
          <DialogDescription>
            Enter font identifiers only — no font files are stored.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Modern Professional" />
            </div>
            <div className="space-y-1">
              <Label>Display Font</Label>
              <Input value={form.displayFont} onChange={(e) => setForm((f) => ({ ...f, displayFont: e.target.value }))} placeholder="e.g. Playfair Display" />
            </div>
            <div className="space-y-1">
              <Label>Body Font</Label>
              <Input value={form.bodyFont} onChange={(e) => setForm((f) => ({ ...f, bodyFont: e.target.value }))} placeholder="e.g. Lato" />
            </div>
            <div className="space-y-1">
              <Label>Accent Font <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={form.accentFont} onChange={(e) => setForm((f) => ({ ...f, accentFont: e.target.value }))} placeholder="e.g. Dancing Script" />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>License</Label>
              <Select value={form.license} onValueChange={(v) => setForm((f) => ({ ...f, license: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LICENSE_OPTIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Industries <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
              <Input value={form.industries} onChange={(e) => setForm((f) => ({ ...f, industries: e.target.value }))} placeholder="technology, finance" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Mood / Personality</Label>
            <div className="flex flex-wrap gap-2">
              {MOOD_OPTIONS.map((m) => (
                <button key={m} type="button"
                  onClick={() => toggleMood(m)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.mood.includes(m) ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:border-primary"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Google Fonts URL <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Input value={form.googleFontsUrl} onChange={(e) => setForm((f) => ({ ...f, googleFontsUrl: e.target.value }))} placeholder="https://fonts.google.com/share?..." />
          </div>
          <div className="space-y-1">
            <Label>Pairing Rationale <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Textarea rows={2} value={form.pairingRationale} onChange={(e) => setForm((f) => ({ ...f, pairingRationale: e.target.value }))} placeholder="Why this combination works…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function FontPairsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editPair, setEditPair] = useState<FontPair | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletePair, setDeletePair] = useState<FontPair | null>(null);
  const [rolesPair, setRolesPair] = useState<FontPair | null>(null);

  const { data, isLoading } = useQuery<{ data: FontPair[] }>({
    queryKey: ["design-tokens-font-pairs", search, category],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (search) params.set("search", search);
      if (category !== "all") params.set("category", category);
      return apiFetch(`/api/ai/design-tokens/font-pairs?${params}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/design-tokens/font-pairs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-tokens-font-pairs"] });
      toast({ title: "Font pair deactivated" });
      setDeletePair(null);
    },
  });

  const pairs = data?.data ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/design-tokens")}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Font Pairs</h1>
          <p className="text-sm text-muted-foreground">Typography pairing registry</p>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New Font Pair
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search font pairs…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : pairs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Type className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No font pairs found.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
            Add first font pair
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pairs.map((pair) => (
            <FontPairCard
              key={pair.id}
              pair={pair}
              onEdit={setEditPair}
              onDelete={setDeletePair}
              onViewRoles={setRolesPair}
            />
          ))}
        </div>
      )}

      {/* Create/Edit dialog */}
      <FontPairDialog
        open={showCreate || !!editPair}
        pair={editPair}
        onClose={() => { setShowCreate(false); setEditPair(null); }}
      />

      {/* Delete confirm */}
      <Dialog open={!!deletePair} onOpenChange={(v) => !v && setDeletePair(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Deactivate Font Pair
            </DialogTitle>
            <DialogDescription>
              "{deletePair?.name}" will be deactivated and hidden from all recommendations. This does not delete the record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePair(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate(deletePair!.id)} disabled={deleteMutation.isPending}>
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Typography roles viewer */}
      {rolesPair && (
        <TypographyRolesDialog pair={rolesPair} onClose={() => setRolesPair(null)} />
      )}
    </div>
  );
}

// ── Typography Roles Viewer ───────────────────────────────────────────────────

function TypographyRolesDialog({ pair, onClose }: { pair: FontPair; onClose: () => void }) {
  const { data } = useQuery<{ data: TypographyRole[] }>({
    queryKey: ["typography-roles", pair.id],
    queryFn: () => apiFetch(`/api/ai/design-tokens/font-pairs/${pair.id}/roles`),
  });

  const roles = data?.data ?? [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Typography Roles — {pair.name}</DialogTitle>
          <DialogDescription>Font size hierarchy for each content role.</DialogDescription>
        </DialogHeader>
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No typography roles defined yet.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {roles.sort((a, b) => b.fontSize - a.fontSize).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{r.role}</span>
                  <p className="text-sm" style={{ fontFamily: r.fontFamily, fontWeight: r.fontWeight }}>
                    {r.fontFamily}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{r.fontSize}px · {r.fontWeight}</div>
                  <div>lh {r.lineHeight} · ls {r.letterSpacing}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FontPairsPage;
