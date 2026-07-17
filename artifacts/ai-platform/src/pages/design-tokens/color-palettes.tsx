// Team 10 — Color Palettes Management Page
// Route: /admin/design-tokens/color-palettes  (Team 24 registers this)

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Palette, Plus, Search, ChevronLeft, Trash2, Pencil,
  CheckCircle2, XCircle, AlertTriangle, Printer, Droplets,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

interface ColorPalette {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  style: string;
  mood: string[];
  industries: string[];
  colors: string[];
  printSafe: boolean;
  accessible: boolean;
  wcagLevel: string;
  tags: string[];
  active: boolean;
  semanticRoles?: SemanticRole[];
}

interface SemanticRole {
  id: number;
  role: string;
  hexColor: string;
  contrastOnWhite: number;
  contrastOnBlack: number;
  wcagAAOnWhite: boolean;
  wcagAAAOnWhite: boolean;
}

interface PrintCheckResult {
  originalHex: string;
  cmyk: { c: number; m: number; y: number; k: number };
  cmykFormatted: string;
  isPrintSafe: boolean;
  printSafeHex: string;
  deltaE: number;
  note: string | null;
}

const STYLE_OPTIONS = ["monochromatic", "complementary", "triadic", "analogous", "split-complementary", "tetradic", "custom"];
const MOOD_OPTIONS = ["professional", "playful", "elegant", "modern", "traditional", "bold", "minimal", "friendly"];

const WCAG_BADGE: Record<string, { label: string; className: string }> = {
  AAA: { label: "AAA", className: "bg-green-100 text-green-800" },
  AA: { label: "AA", className: "bg-yellow-100 text-yellow-800" },
  fail: { label: "Fail", className: "bg-red-100 text-red-800" },
};

// ── Colour Swatch Strip ───────────────────────────────────────────────────────

function ColourSwatches({ colors }: { colors: string[] }) {
  return (
    <div className="flex rounded-md overflow-hidden h-8 w-full">
      {colors.map((c, i) => (
        <div
          key={i}
          className="flex-1 group relative"
          style={{ backgroundColor: c }}
          title={c}
        >
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 transition-opacity">
            <span className="text-white text-xs font-mono drop-shadow">{c}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Palette Card ──────────────────────────────────────────────────────────────

function PaletteCard({ palette, onEdit, onDelete, onViewDetails }: {
  palette: ColorPalette;
  onEdit: (p: ColorPalette) => void;
  onDelete: (p: ColorPalette) => void;
  onViewDetails: (p: ColorPalette) => void;
}) {
  const wcag = WCAG_BADGE[palette.wcagLevel] ?? WCAG_BADGE.fail;

  return (
    <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => onViewDetails(palette)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-1">
          <div>
            <CardTitle className="text-sm font-semibold">{palette.name}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono">{palette.slug}</p>
          </div>
          <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(palette)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(palette)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ColourSwatches colors={palette.colors} />

        <div className="flex flex-wrap gap-1.5 items-center">
          <Badge className={`text-xs ${wcag.className}`}>WCAG {wcag.label}</Badge>
          <Badge variant="secondary" className="text-xs">{palette.style}</Badge>
          {palette.printSafe && (
            <Badge className="text-xs bg-teal-100 text-teal-800 gap-1">
              <Printer className="h-2.5 w-2.5" /> Print-safe
            </Badge>
          )}
          {palette.accessible ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-red-400" />
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {palette.mood.slice(0, 2).map((m) => (
            <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
          ))}
          <span className="text-xs text-muted-foreground self-center">
            {palette.colors.length} colours
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Create/Edit Dialog ────────────────────────────────────────────────────────

function PaletteDialog({ open, palette, onClose }: {
  open: boolean;
  palette: ColorPalette | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!palette;

  const [form, setForm] = useState({
    name: palette?.name ?? "",
    description: palette?.description ?? "",
    style: palette?.style ?? "custom",
    mood: palette?.mood ?? ["professional"],
    industries: palette?.industries?.join(", ") ?? "",
    colors: palette?.colors?.join(", ") ?? "",
    tags: palette?.tags?.join(", ") ?? "",
  });

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? apiFetch(`/api/ai/design-tokens/color-palettes/${palette!.id}`, { method: "PATCH", body: JSON.stringify(data) })
        : apiFetch("/api/ai/design-tokens/color-palettes", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-tokens-palettes"] });
      qc.invalidateQueries({ queryKey: ["design-tokens-palettes-summary"] });
      toast({ title: isEdit ? "Palette updated" : "Palette created" });
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
      description: form.description || undefined,
      style: form.style,
      mood: form.mood,
      industries: form.industries.split(",").map((s) => s.trim()).filter(Boolean),
      colors: form.colors.split(",").map((s) => s.trim()).filter(Boolean),
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Palette" : "New Color Palette"}</DialogTitle>
          <DialogDescription>
            Enter hex colour codes. Contrast and print-safety are computed automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Tech Blue Slate" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Style</Label>
              <Select value={form.style} onValueChange={(v) => setForm((f) => ({ ...f, style: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STYLE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Industries <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
              <Input value={form.industries} onChange={(e) => setForm((f) => ({ ...f, industries: e.target.value }))} placeholder="technology, retail" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Hex Colours <span className="text-xs text-muted-foreground">(comma-separated, 2–12)</span></Label>
            <Input value={form.colors} onChange={(e) => setForm((f) => ({ ...f, colors: e.target.value }))} placeholder="#0066cc, #ffffff, #333333" />
            {/* Live preview */}
            {form.colors && (
              <div className="flex rounded overflow-hidden h-6 mt-1">
                {form.colors.split(",").map((c, i) => {
                  const hex = c.trim();
                  return hex ? <div key={i} className="flex-1" style={{ backgroundColor: hex }} title={hex} /> : null;
                })}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>Mood / Personality</Label>
            <div className="flex flex-wrap gap-2">
              {MOOD_OPTIONS.map((m) => (
                <button key={m} type="button" onClick={() => toggleMood(m)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.mood.includes(m) ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:border-primary"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Tags <span className="text-xs text-muted-foreground">(optional, comma-separated)</span></Label>
            <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="dark, corporate, high-contrast" />
          </div>
          <div className="space-y-1">
            <Label>Description <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
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

// ── Palette Detail Dialog ─────────────────────────────────────────────────────

function PaletteDetailDialog({ palette, onClose }: { palette: ColorPalette; onClose: () => void }) {
  const { data } = useQuery<{ data: SemanticRole[] }>({
    queryKey: ["semantic-roles", palette.id],
    queryFn: () => apiFetch(`/api/ai/design-tokens/color-palettes/${palette.id}/semantic-roles`),
  });

  const [printCheck, setPrintCheck] = useState<PrintCheckResult[] | null>(null);
  const printMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/ai/design-tokens/color-palettes/print-safe-check", {
        method: "POST",
        body: JSON.stringify({ colors: palette.colors }),
      }).then((r) => r.data),
    onSuccess: (d) => setPrintCheck(d),
  });

  const roles = data?.data ?? [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{palette.name}</DialogTitle>
          <DialogDescription>{palette.slug} · {palette.style}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto">
          <ColourSwatches colors={palette.colors} />

          {/* Colour hex list */}
          <div className="flex flex-wrap gap-2">
            {palette.colors.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-md border px-2 py-1">
                <div className="h-4 w-4 rounded-sm border" style={{ backgroundColor: c }} />
                <span className="text-xs font-mono">{c}</span>
              </div>
            ))}
          </div>

          {/* WCAG badge */}
          <div className="flex gap-2 items-center">
            <Badge className={WCAG_BADGE[palette.wcagLevel]?.className}>{palette.wcagLevel} Compliance</Badge>
            {palette.printSafe && <Badge className="bg-teal-100 text-teal-800 gap-1"><Printer className="h-3 w-3" />Print-safe</Badge>}
          </div>

          {/* Semantic roles */}
          {roles.length > 0 && (
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Semantic Roles</h4>
              <div className="grid grid-cols-2 gap-2">
                {roles.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <div className="h-5 w-5 rounded-sm border shrink-0" style={{ backgroundColor: r.hexColor }} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{r.role}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.hexColor}</p>
                    </div>
                    <div className="ml-auto shrink-0">
                      {r.wcagAAOnWhite
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        : <XCircle className="h-3.5 w-3.5 text-red-400" />
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Print-safe check */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Print-Safe (CMYK)</h4>
              {!printCheck && (
                <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => printMutation.mutate()} disabled={printMutation.isPending}>
                  <Printer className="h-3 w-3" /> Check
                </Button>
              )}
            </div>
            {printCheck && (
              <div className="space-y-1.5">
                {printCheck.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md border px-2 py-1.5 text-xs">
                    <div className="h-4 w-4 rounded-sm border shrink-0" style={{ backgroundColor: r.originalHex }} />
                    <span className="font-mono w-16">{r.originalHex}</span>
                    <span className="text-muted-foreground flex-1 truncate">{r.cmykFormatted}</span>
                    {r.isPrintSafe
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          <div className="h-4 w-4 rounded-sm border" style={{ backgroundColor: r.printSafeHex }} title={`Safe: ${r.printSafeHex}`} />
                        </div>
                      )
                    }
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ColorPalettesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [style, setStyle] = useState("all");
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [printSafeOnly, setPrintSafeOnly] = useState(false);
  const [editPalette, setEditPalette] = useState<ColorPalette | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletePalette, setDeletePalette] = useState<ColorPalette | null>(null);
  const [detailPalette, setDetailPalette] = useState<ColorPalette | null>(null);

  const { data, isLoading } = useQuery<{ data: ColorPalette[] }>({
    queryKey: ["design-tokens-palettes", search, style, accessibleOnly, printSafeOnly],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (search) params.set("search", search);
      if (style !== "all") params.set("style", style);
      if (accessibleOnly) params.set("accessible", "true");
      if (printSafeOnly) params.set("printSafe", "true");
      return apiFetch(`/api/ai/design-tokens/color-palettes?${params}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/design-tokens/color-palettes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-tokens-palettes"] });
      toast({ title: "Palette deactivated" });
      setDeletePalette(null);
    },
  });

  const palettes = data?.data ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/design-tokens")}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Color Palettes</h1>
          <p className="text-sm text-muted-foreground">WCAG-validated, print-safe palette registry</p>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New Palette
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search palettes…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={style} onValueChange={setStyle}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Style" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All styles</SelectItem>
            {STYLE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          variant={accessibleOnly ? "default" : "outline"} size="sm"
          className="gap-1.5" onClick={() => setAccessibleOnly((v) => !v)}>
          <CheckCircle2 className="h-3.5 w-3.5" /> WCAG AA+
        </Button>
        <Button
          variant={printSafeOnly ? "default" : "outline"} size="sm"
          className="gap-1.5" onClick={() => setPrintSafeOnly((v) => !v)}>
          <Printer className="h-3.5 w-3.5" /> Print-safe
        </Button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : palettes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Palette className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No palettes found.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
            Add first palette
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {palettes.map((p) => (
            <PaletteCard key={p.id} palette={p} onEdit={setEditPalette} onDelete={setDeletePalette} onViewDetails={setDetailPalette} />
          ))}
        </div>
      )}

      {/* Create/Edit */}
      <PaletteDialog open={showCreate || !!editPalette} palette={editPalette} onClose={() => { setShowCreate(false); setEditPalette(null); }} />

      {/* Delete confirm */}
      <Dialog open={!!deletePalette} onOpenChange={(v) => !v && setDeletePalette(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Deactivate Palette
            </DialogTitle>
            <DialogDescription>"{deletePalette?.name}" will be deactivated and hidden from all recommendations.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePalette(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate(deletePalette!.id)} disabled={deleteMutation.isPending}>Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail panel */}
      {detailPalette && (
        <PaletteDetailDialog palette={detailPalette} onClose={() => setDetailPalette(null)} />
      )}
    </div>
  );
}

export default ColorPalettesPage;
