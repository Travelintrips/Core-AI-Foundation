/**
 * InteriorDesignEditor — Editable view of AI-generated Interior Design concept.
 *
 * Renders in View mode by default; admin switches to Edit mode to modify:
 *   - Visual Concept
 *   - Space Planning (zones: add / edit / remove / reorder)
 *   - Material Specification (per-area items with dropdowns + custom)
 *   - Furniture Placement (items per zone)
 *   - Lighting Recommendations (fixtures per zone)
 *
 * Images: each item fetched from /api/ai/interior-design/asset-images/:projectUuid
 * and displayed as thumbnails with skeleton + onError fallback to swatch/emoji.
 *
 * Review state machine:
 *   ai_generated → edited_by_admin → ready_for_review / revision_requested → approved_for_rendering
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { getMaterialSwatch } from "../material-library/materialColorSwatch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Edit2,
  Eye,
  Save,
  X,
  Plus,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Loader2,
  Home,
  Palette,
  Sofa,
  Lightbulb,
  Layers,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  BookOpen,
  Upload,
  ImageOff,
  RefreshCw,
} from "lucide-react";
import {
  MaterialSelectorDialog,
  type LibraryMaterial,
} from "@/components/material-library/MaterialSelectorDialog";
import { MoodboardPanel } from "./MoodboardPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewState =
  | "ai_generated"
  | "edited_by_admin"
  | "ready_for_review"
  | "revision_requested"
  | "approved_for_rendering";

export interface ConceptDraft {
  id: number;
  projectUuid: string;
  originalSpacePlan: unknown;
  originalMaterials: unknown;
  originalFurniture: unknown;
  originalLighting: unknown;
  originalVisualConcept: string | null;
  spacePlanDraft: unknown;
  materialsDraft: unknown;
  furnitureDraft: unknown;
  lightingDraft: unknown;
  visualConceptDraft: string | null;
  reviewState: ReviewState;
  hasUnsavedEdits: boolean;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

/** Image metadata record from id_interior_asset_images */
export interface ItemAssetImage {
  id: number;
  projectUuid: string;
  itemType: string;
  itemId: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageSource: string | null;
  imageSourceUrl: string | null;
  imageLicense: string | null;
  imageAttribution: string | null;
  isManualUpload: boolean;
  storagePath: string | null;
}

interface SpaceZone {
  id: string;
  name: string;
  function: string;
  approximateSize: string;
  priority: string;
  adjacency: string;
  notes: string;
}

interface MaterialItem {
  id: string;
  area: string;
  component: string;
  category: string;
  materialType: string;
  color: string;
  finish: string;
  texture: string;
  brand: string;
  productCode: string;
  priceTier: string;
  notes: string;
  status: "selected" | "rejected" | "pending";
  source?: "custom" | "material_library";
  libraryMaterialId?: number | null;
  name?: string;
  subcategory?: string;
  description?: string;
  thumbnailUrl?: string;
  previewImages?: string[];
  technicalData?: Record<string, unknown>;
}

interface FurnitureItem {
  id: string;
  item: string;
  zone: string;
  quantity: string;
  dimensions: string;
  notes: string;
  thumbnailUrl?: string;
}

interface LightingItem {
  id: string;
  zone: string;
  lightingType: string;
  fixtureType: string;
  colorTemperature: string;
  purpose: string;
  quantity: string;
  notes: string;
  thumbnailUrl?: string;
}

// ── Material category options ─────────────────────────────────────────────────

const MATERIAL_CATEGORIES: Record<string, string[]> = {
  Floor: ["porcelain tile","ceramic tile","granite","marble","terrazzo","SPC","vinyl","engineered wood","solid wood","carpet","polished concrete","epoxy","Custom"],
  Wall:  ["paint","wallpaper","wood panel","HPL","stone","marble","ceramic tile","acoustic panel","fabric panel","exposed concrete","Custom"],
  Ceiling: ["gypsum","wood slat","metal","acoustic ceiling","exposed ceiling","PVC","stretch ceiling","Custom"],
  Countertop: ["granite","marble","quartz","solid surface","stainless steel","concrete","Custom"],
  Other: ["Custom"],
};

const LIGHTING_TYPES = [
  "downlight","track light","pendant","chandelier","cove light","hidden LED",
  "wall washer","wall lamp","floor lamp","table lamp","Custom",
];

const PRICE_TIERS = ["Budget","Mid-range","Premium","Luxury"];
const PRIORITY_LEVELS = ["High","Medium","Low"];
const COLOR_TEMPS = ["2700K – Warm White","3000K – Warm Neutral","3500K – Neutral","4000K – Cool White","5000K – Daylight","6500K – Cool Daylight"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function parseZones(raw: unknown): SpaceZone[] {
  if (!raw || typeof raw !== "object") return [];
  const sp = raw as Record<string, unknown>;
  const zones = Array.isArray(sp["zones"]) ? sp["zones"] : [];
  return (zones as Record<string, unknown>[]).map((z, i) => ({
    id: String(z["id"] ?? uid() + i),
    name:            String(z["name"]            ?? z["zone"]    ?? ""),
    function:        String(z["function"]         ?? z["purpose"] ?? ""),
    approximateSize: String(z["approximateSize"]  ?? z["size"]    ?? ""),
    priority:        String(z["priority"]         ?? "Medium"),
    adjacency:       String(z["adjacency"]        ?? ""),
    notes:           String(z["notes"]            ?? ""),
  }));
}

function parseItems<T>(raw: unknown, defaults: T & { id: string }): T[] {
  if (!raw || typeof raw !== "object") return [];
  const items = Array.isArray((raw as Record<string,unknown>)["items"])
    ? (raw as Record<string,unknown>)["items"] as Record<string,unknown>[]
    : Array.isArray(raw) ? raw as Record<string,unknown>[]
    : [];
  return items.map((item, i) =>
    Object.assign({}, defaults, { id: String(item["id"] ?? uid() + i) }, item as Partial<T>),
  );
}

function zonesToRaw(zones: SpaceZone[], original: unknown): unknown {
  const orig = original as Record<string, unknown> | null;
  return { ...(orig ?? {}), zones };
}

function itemsToRaw(items: unknown[]): unknown {
  return { items };
}

// ── Review state badge ────────────────────────────────────────────────────────

const STATE_LABELS: Record<ReviewState, string> = {
  ai_generated:          "AI Generated",
  edited_by_admin:       "Edited",
  ready_for_review:      "Ready for Review",
  revision_requested:    "Revision Requested",
  approved_for_rendering: "Approved for Rendering",
};

const STATE_COLORS: Record<ReviewState, string> = {
  ai_generated:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  edited_by_admin:       "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  ready_for_review:      "bg-purple-500/10 text-purple-400 border-purple-500/20",
  revision_requested:    "bg-red-500/10 text-red-400 border-red-500/20",
  approved_for_rendering: "bg-green-500/10 text-green-400 border-green-500/20",
};

// ── Visual swatch helpers ─────────────────────────────────────────────────────

function getFurnitureSwatch(itemName: string): { emoji: string; bg: string } {
  const n = itemName.toLowerCase();
  if (/sofa|couch|sectional|loveseat/.test(n)) return { emoji: "🛋️", bg: "linear-gradient(135deg,#8b6f5e,#6b4f3e)" };
  if (/chair|kursi|armchair|stool/.test(n))    return { emoji: "🪑", bg: "linear-gradient(135deg,#a07850,#805830)" };
  if (/bed|kasur|tempat tidur/.test(n))         return { emoji: "🛏️", bg: "linear-gradient(135deg,#607090,#405070)" };
  if (/table|meja|desk|dining/.test(n))         return { emoji: "🪵", bg: "linear-gradient(135deg,#b08060,#907040)" };
  if (/cabinet|lemari|wardrobe|closet|almari/.test(n)) return { emoji: "🗄️", bg: "linear-gradient(135deg,#808080,#606060)" };
  if (/shelf|rak|bookcase|bookshelf/.test(n))   return { emoji: "📚", bg: "linear-gradient(135deg,#c09878,#a07858)" };
  if (/mirror|cermin/.test(n))                  return { emoji: "🪞", bg: "linear-gradient(135deg,#a0b8c8,#809ab0)" };
  if (/lamp|light|lampu/.test(n))               return { emoji: "💡", bg: "linear-gradient(135deg,#d4aa50,#b08830)" };
  if (/rug|carpet|karpet|mat/.test(n))          return { emoji: "🟫", bg: "linear-gradient(135deg,#a08068,#806048)" };
  if (/plant|tanaman|pot/.test(n))              return { emoji: "🪴", bg: "linear-gradient(135deg,#608060,#406040)" };
  if (/tv|television|screen|monitor/.test(n))   return { emoji: "📺", bg: "linear-gradient(135deg,#404858,#282e38)" };
  if (/bath|tub|shower|toilet/.test(n))         return { emoji: "🛁", bg: "linear-gradient(135deg,#c8d8e8,#a0b8c8)" };
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) & 0xffffff;
  const h = (hash % 360);
  return { emoji: "🪑", bg: `linear-gradient(135deg,hsl(${h},30%,40%),hsl(${h},30%,28%))` };
}

function getLightingSwatch(colorTemp: string): { emoji: string; bg: string } {
  const k = parseInt(colorTemp, 10);
  if (!k || isNaN(k))   return { emoji: "💡", bg: "linear-gradient(135deg,#c8c0a0,#a8a080)" };
  if (k <= 2700)        return { emoji: "🕯️", bg: "linear-gradient(135deg,#e8a030,#c07820)" };
  if (k <= 3200)        return { emoji: "💡", bg: "linear-gradient(135deg,#e0b850,#c09030)" };
  if (k <= 4000)        return { emoji: "💡", bg: "linear-gradient(135deg,#e8e0c0,#c8c0a0)" };
  if (k <= 5000)        return { emoji: "🔆", bg: "linear-gradient(135deg,#d8e8f0,#b0c8d8)" };
  return               { emoji: "🔆", bg: "linear-gradient(135deg,#b8d0e8,#80a8c8)" };
}

function getZoneSwatch(name: string, fn: string): { emoji: string; bg: string } {
  const t = `${name} ${fn}`.toLowerCase();
  if (/living|ruang tamu|lounge|family/.test(t))   return { emoji: "🛋️", bg: "linear-gradient(135deg,#7080a0,#506080)" };
  if (/bedroom|kamar tidur|master|tidur/.test(t))  return { emoji: "🛏️", bg: "linear-gradient(135deg,#607090,#405070)" };
  if (/kitchen|dapur|pantry/.test(t))              return { emoji: "🍳", bg: "linear-gradient(135deg,#a06840,#805030)" };
  if (/dining|makan|restaurant/.test(t))           return { emoji: "🍽️", bg: "linear-gradient(135deg,#906858,#705040)" };
  if (/bathroom|toilet|wc|shower|kamar mandi/.test(t)) return { emoji: "🚿", bg: "linear-gradient(135deg,#6090a8,#408090)" };
  if (/office|kerja|study|work|studio/.test(t))   return { emoji: "💼", bg: "linear-gradient(135deg,#506878,#384858)" };
  if (/kids|anak|child|play|nursery/.test(t))      return { emoji: "🎨", bg: "linear-gradient(135deg,#8060a0,#604080)" };
  if (/gym|sport|fitness/.test(t))                 return { emoji: "🏋️", bg: "linear-gradient(135deg,#506850,#304830)" };
  if (/garage|parkir|carport/.test(t))             return { emoji: "🚗", bg: "linear-gradient(135deg,#606060,#404040)" };
  if (/balcony|teras|terrace|garden|outdoor/.test(t)) return { emoji: "🪴", bg: "linear-gradient(135deg,#508050,#306030)" };
  if (/library|perpus|reading|baca/.test(t))       return { emoji: "📚", bg: "linear-gradient(135deg,#7860a0,#584080)" };
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) & 0xffffff;
  const h = (hash % 360);
  return { emoji: "🏠", bg: `linear-gradient(135deg,hsl(${h},25%,38%),hsl(${h},25%,26%))` };
}

function normalizePriceTier(tier: string): string {
  if (tier === "Standard") return "Mid-range";
  return tier;
}

// ── ItemThumbnail — skeleton + image + fallback ───────────────────────────────

interface ItemThumbnailProps {
  thumbnailUrl?: string | null;
  imageAlt?: string | null;
  fallback: React.ReactNode;
  className?: string;
}

function ItemThumbnail({ thumbnailUrl, imageAlt, fallback, className }: ItemThumbnailProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">(
    thumbnailUrl ? "loading" : "error",
  );

  // Reset when URL changes
  useEffect(() => {
    setState(thumbnailUrl ? "loading" : "error");
  }, [thumbnailUrl]);

  if (!thumbnailUrl || state === "error") {
    return <>{fallback}</>;
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg shrink-0", className)}>
      {state === "loading" && (
        <div className="absolute inset-0 bg-muted/40 animate-pulse rounded-lg" />
      )}
      <img
        src={thumbnailUrl}
        alt={imageAlt ?? ""}
        className={cn(
          "w-full h-full object-cover rounded-lg border border-border/30 transition-opacity duration-300",
          state === "loaded" ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
      />
    </div>
  );
}

// ── AdminImageControls — upload / enrich / delete ─────────────────────────────

interface AdminImageControlsProps {
  projectUuid: string;
  itemType: string;
  itemId: string;
  adminKey?: string;
  existingImage?: ItemAssetImage | null;
  onRefresh: () => void;
  enrichPayload?: Record<string, string>;
}

function AdminImageControls({
  projectUuid, itemType, itemId, adminKey, existingImage, onRefresh, enrichPayload,
}: AdminImageControlsProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(adminKey ? { "x-admin-api-key": adminKey } : {}),
  });

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast({ title: "Only image files are accepted", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "File must be under 5 MB", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(`/api/ai/interior-design/asset-images/${projectUuid}/upload`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          itemType, itemId,
          imageData: base64,
          mimeType: file.type,
          altText: file.name.replace(/\.[^.]+$/, ""),
          forceReplace: Boolean(existingImage),
        }),
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        toast({ title: e.error ?? "Upload failed", variant: "destructive" });
      } else {
        toast({ title: "Image uploaded" });
        onRefresh();
      }
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
    setBusy(false);
  };

  const handleEnrich = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/interior-design/asset-images/${projectUuid}/enrich`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ itemType, itemId, force: Boolean(existingImage), ...enrichPayload }),
      });
      const data = await res.json() as { result?: { status: string; thumbnailUrl?: string; error?: string } };
      const result = data.result;
      if (result?.status === "enriched") {
        toast({ title: "Image found and saved" });
        onRefresh();
      } else if (result?.status === "no_key") {
        toast({ title: "PEXELS_API_KEY not configured on server", variant: "destructive" });
      } else if (result?.status === "no_results") {
        toast({ title: "No matching image found" });
      } else if (result?.status === "skipped") {
        toast({ title: "Skipped (manual upload protected)" });
      } else {
        toast({ title: result?.error ?? "Enrichment failed", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/ai/interior-design/asset-images/${projectUuid}/${itemType}/${itemId}`,
        { method: "DELETE", headers: headers() },
      );
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        toast({ title: e.error ?? "Delete failed", variant: "destructive" });
      } else {
        toast({ title: "Reverted to fallback visual" });
        onRefresh();
      }
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f); e.target.value = ""; }}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-5 text-[10px] px-1.5 gap-1 border-border/40"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="size-2.5" />
        {existingImage ? "Replace" : "Upload"}
      </Button>
      {!existingImage?.isManualUpload && (
        <Button
          variant="outline"
          size="sm"
          className="h-5 text-[10px] px-1.5 gap-1 border-border/40"
          disabled={busy}
          onClick={() => void handleEnrich()}
        >
          {busy ? <Loader2 className="size-2.5 animate-spin" /> : <RefreshCw className="size-2.5" />}
          Find
        </Button>
      )}
      {existingImage && (
        <>
          {existingImage.imageAttribution && (
            <span className="text-[9px] text-muted-foreground truncate max-w-[100px]">
              © {existingImage.imageAttribution}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] px-1.5 gap-1 text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => void handleDelete()}
          >
            <ImageOff className="size-2.5" /> Revert
          </Button>
        </>
      )}
    </div>
  );
}

// ── Sub-editors ───────────────────────────────────────────────────────────────

function SpacePlanEditor({ zones, onChange }: { zones: SpaceZone[]; onChange: (z: SpaceZone[]) => void }) {
  const update = (id: string, field: keyof SpaceZone, value: string) =>
    onChange(zones.map((z) => z.id === id ? { ...z, [field]: value } : z));
  const remove = (id: string) => onChange(zones.filter((z) => z.id !== id));
  const add = () => onChange([...zones, { id: uid(), name: "", function: "", approximateSize: "", priority: "Medium", adjacency: "", notes: "" }]);
  const moveUp   = (i: number) => { if (i === 0) return; const n = [...zones]; [n[i-1], n[i]] = [n[i], n[i-1]]; onChange(n); };
  const moveDown = (i: number) => { if (i === zones.length - 1) return; const n = [...zones]; [n[i], n[i+1]] = [n[i+1], n[i]]; onChange(n); };

  return (
    <div className="space-y-3">
      {zones.map((z, i) => (
        <div key={z.id} className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/5">
          <div className="flex items-center gap-2 justify-between">
            {(() => { const s = getZoneSwatch(z.name, z.function); return (
              <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-base" style={{ background: s.bg }}>{s.emoji}</div>
            ); })()}
            <span className="text-[10px] font-mono font-semibold text-muted-foreground flex-1">Zone {i + 1}{z.name ? ` — ${z.name}` : ""}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-6" onClick={() => moveUp(i)} disabled={i === 0}><ArrowUp className="size-3" /></Button>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => moveDown(i)} disabled={i === zones.length - 1}><ArrowDown className="size-3" /></Button>
              <Button variant="ghost" size="icon" className="size-6 text-destructive hover:text-destructive" onClick={() => remove(z.id)}><Trash2 className="size-3" /></Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[10px]">Zone / Room Name</Label><Input className="h-7 text-xs mt-0.5" value={z.name} onChange={(e) => update(z.id, "name", e.target.value)} placeholder="e.g. Living Area" /></div>
            <div><Label className="text-[10px]">Function / Purpose</Label><Input className="h-7 text-xs mt-0.5" value={z.function} onChange={(e) => update(z.id, "function", e.target.value)} placeholder="e.g. Relaxation & Entertainment" /></div>
            <div><Label className="text-[10px]">Approximate Size</Label><Input className="h-7 text-xs mt-0.5" value={z.approximateSize} onChange={(e) => update(z.id, "approximateSize", e.target.value)} placeholder="e.g. 4m × 5m" /></div>
            <div>
              <Label className="text-[10px]">Priority</Label>
              <Select value={z.priority} onValueChange={(v) => update(z.id, "priority", v)}>
                <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITY_LEVELS.map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label className="text-[10px]">Adjacency / Relationship</Label><Input className="h-7 text-xs mt-0.5" value={z.adjacency} onChange={(e) => update(z.id, "adjacency", e.target.value)} placeholder="e.g. Adjacent to dining area, separate from bedroom" /></div>
          <div><Label className="text-[10px]">Notes</Label><Input className="h-7 text-xs mt-0.5" value={z.notes} onChange={(e) => update(z.id, "notes", e.target.value)} placeholder="Additional notes…" /></div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5 border-dashed" onClick={add}><Plus className="size-3" /> Add Zone</Button>
    </div>
  );
}

function MaterialEditor({ items, onChange }: { items: MaterialItem[]; onChange: (v: MaterialItem[]) => void }) {
  const [newCategory, setNewCategory] = useState("Floor");
  const [dialogOpenForId, setDialogOpenForId] = useState<string | null>(null);

  const dialogItem = dialogOpenForId ? (items.find((m) => m.id === dialogOpenForId) ?? null) : null;

  const update = (id: string, field: keyof MaterialItem, value: string) =>
    onChange(items.map((m) => m.id === id ? { ...m, [field]: value } : m));
  const remove = (id: string) => onChange(items.filter((m) => m.id !== id));
  const add = () => onChange([...items, {
    id: uid(), area: newCategory, component: "", category: newCategory, materialType: "",
    color: "", finish: "", texture: "", brand: "", productCode: "", priceTier: "Mid-range",
    notes: "", status: "pending",
    source: "custom" as const, libraryMaterialId: null,
    name: "", subcategory: "", description: "", thumbnailUrl: "", previewImages: [], technicalData: {},
  }]);

  const applyLibraryMaterial = (itemId: string, lib: LibraryMaterial) => {
    onChange(items.map((item) =>
      item.id !== itemId ? item : {
        ...item,
        source:            "material_library" as const,
        libraryMaterialId: lib.id,
        name:              lib.name,
        materialType:      lib.materialType ?? item.materialType,
        brand:             lib.brand        ?? item.brand,
        category:          lib.category,
        subcategory:       lib.subcategory  ?? "",
        color:             lib.color        ?? item.color,
        finish:            lib.finish       ?? item.finish,
        texture:           lib.texture      ?? item.texture,
        description:       lib.description  ?? "",
        priceTier:         normalizePriceTier(lib.priceTier),
        thumbnailUrl:      lib.thumbnailUrl ?? "",
        productCode:       lib.materialCode,
        previewImages:     [],
        technicalData:     {},
      },
    ));
  };

  const clearLibrary = (itemId: string) =>
    onChange(items.map((item) =>
      item.id !== itemId ? item : {
        ...item, source: "custom" as const, libraryMaterialId: null,
        name: "", thumbnailUrl: "", subcategory: "", description: "",
      },
    ));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={newCategory} onValueChange={setNewCategory}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.keys(MATERIAL_CATEGORIES).map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 shrink-0" onClick={add}><Plus className="size-3" /> Add</Button>
      </div>

      {items.map((m) => (
        <div key={m.id} className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/5">
          <div className="flex items-center gap-2 justify-between flex-wrap">
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("text-[10px] px-1.5 h-4 font-mono",
                  m.status === "selected" ? "text-green-400 border-green-500/30"
                  : m.status === "rejected" ? "text-red-400 border-red-500/30"
                  : "text-muted-foreground",
                )}
              >{m.area}</Badge>
              {m.source === "material_library" && (
                <Badge variant="outline" className="text-[10px] px-1.5 h-4 font-mono text-teal-400 border-teal-500/30">
                  Library
                </Badge>
              )}
            </div>
            <div className="flex gap-1 items-center">
              <Button
                variant="outline"
                size="sm"
                className="h-5 text-[10px] px-2 gap-1 border-border/50 text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => setDialogOpenForId(m.id)}
              >
                <BookOpen className="size-2.5" /> Browse Library
              </Button>
              <Select value={m.status} onValueChange={(v) => update(m.id, "status", v)}>
                <SelectTrigger className="h-5 text-[10px] px-1.5 w-24 border-border/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending"  className="text-xs">Pending</SelectItem>
                  <SelectItem value="selected" className="text-xs">Selected</SelectItem>
                  <SelectItem value="rejected" className="text-xs">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="size-6 text-destructive hover:text-destructive" onClick={() => remove(m.id)}>
                <Trash2 className="size-3" />
              </Button>
            </div>
          </div>

          {m.source === "material_library" && m.name && (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-teal-500/5 border border-teal-500/15">
              {m.thumbnailUrl ? (
                <img src={m.thumbnailUrl} alt={m.name} className="w-8 h-8 rounded object-cover shrink-0 border border-border/30" />
              ) : (() => {
                const sw = getMaterialSwatch(m.color, m.materialType, m.finish);
                return <div className="w-8 h-8 rounded shrink-0 border border-border/20 flex items-center justify-center text-sm" style={{ background: sw.background }}>{sw.patternHint}</div>;
              })()}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{m.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {[m.category, m.subcategory].filter(Boolean).join(" › ")}
                  {m.productCode ? ` · ${m.productCode}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 text-muted-foreground shrink-0"
                onClick={() => clearLibrary(m.id)}
              >
                Clear
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[10px]">Component / Area</Label><Input className="h-7 text-xs mt-0.5" value={m.component} onChange={(e) => update(m.id, "component", e.target.value)} placeholder="e.g. Main floor" /></div>
            <div>
              <Label className="text-[10px]">Material Type</Label>
              <Select value={m.materialType || ""} onValueChange={(v) => update(m.id, "materialType", v)}>
                <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {(MATERIAL_CATEGORIES[m.category] ?? MATERIAL_CATEGORIES["Other"]).map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-[10px]">Color</Label><Input className="h-7 text-xs mt-0.5" value={m.color} onChange={(e) => update(m.id, "color", e.target.value)} placeholder="e.g. Warm Ivory" /></div>
            <div><Label className="text-[10px]">Finish</Label><Input className="h-7 text-xs mt-0.5" value={m.finish} onChange={(e) => update(m.id, "finish", e.target.value)} placeholder="e.g. Matte, Polished" /></div>
            <div>
              <Label className="text-[10px]">Price Tier</Label>
              <Select value={m.priceTier} onValueChange={(v) => update(m.id, "priceTier", v)}>
                <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>{PRICE_TIERS.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-[10px]">Brand (optional)</Label><Input className="h-7 text-xs mt-0.5" value={m.brand} onChange={(e) => update(m.id, "brand", e.target.value)} placeholder="e.g. Roman Ceramics" /></div>
          </div>
          <div><Label className="text-[10px]">Notes</Label><Input className="h-7 text-xs mt-0.5" value={m.notes} onChange={(e) => update(m.id, "notes", e.target.value)} placeholder="Additional notes…" /></div>
        </div>
      ))}

      <MaterialSelectorDialog
        open={dialogOpenForId !== null}
        onOpenChange={(open) => { if (!open) setDialogOpenForId(null); }}
        initialCategory={dialogItem?.category}
        onSelect={(lib) => {
          if (dialogOpenForId) applyLibraryMaterial(dialogOpenForId, lib);
          setDialogOpenForId(null);
        }}
      />
    </div>
  );
}

function FurnitureEditor({ items, onChange }: { items: FurnitureItem[]; onChange: (v: FurnitureItem[]) => void }) {
  const update = (id: string, field: keyof FurnitureItem, value: string) =>
    onChange(items.map((f) => f.id === id ? { ...f, [field]: value } : f));
  const remove = (id: string) => onChange(items.filter((f) => f.id !== id));
  const add = () => onChange([...items, { id: uid(), item: "", zone: "", quantity: "1", dimensions: "", notes: "" }]);

  return (
    <div className="space-y-2">
      {items.map((f) => (
        <div key={f.id} className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/5">
          <div className="flex items-center gap-2">
            {(() => { const s = getFurnitureSwatch(f.item); return (
              <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-base" style={{ background: s.bg }}>{s.emoji}</div>
            ); })()}
            <Input className="h-7 text-xs flex-1 font-medium" value={f.item} onChange={(e) => update(f.id, "item", e.target.value)} placeholder="Furniture item name…" />
            <Button variant="ghost" size="icon" className="size-6 text-destructive hover:text-destructive shrink-0" onClick={() => remove(f.id)}><Trash2 className="size-3" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[10px]">Room / Zone</Label><Input className="h-7 text-xs mt-0.5" value={f.zone} onChange={(e) => update(f.id, "zone", e.target.value)} placeholder="e.g. Living Area" /></div>
            <div><Label className="text-[10px]">Quantity</Label><Input className="h-7 text-xs mt-0.5" type="number" min="1" value={f.quantity} onChange={(e) => update(f.id, "quantity", e.target.value)} /></div>
            <div className="col-span-2"><Label className="text-[10px]">Approx. Dimensions</Label><Input className="h-7 text-xs mt-0.5" value={f.dimensions} onChange={(e) => update(f.id, "dimensions", e.target.value)} placeholder="e.g. W200 × D90 × H75 cm" /></div>
          </div>
          <div><Label className="text-[10px]">Placement Notes</Label><Input className="h-7 text-xs mt-0.5" value={f.notes} onChange={(e) => update(f.id, "notes", e.target.value)} placeholder="e.g. Centred on feature wall, facing TV unit" /></div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5 border-dashed" onClick={add}><Plus className="size-3" /> Add Furniture Item</Button>
    </div>
  );
}

function LightingEditor({ items, onChange }: { items: LightingItem[]; onChange: (v: LightingItem[]) => void }) {
  const update = (id: string, field: keyof LightingItem, value: string) =>
    onChange(items.map((l) => l.id === id ? { ...l, [field]: value } : l));
  const remove = (id: string) => onChange(items.filter((l) => l.id !== id));
  const add = () => onChange([...items, { id: uid(), zone: "", lightingType: "", fixtureType: "", colorTemperature: "3000K – Warm Neutral", purpose: "Ambient", quantity: "1", notes: "" }]);

  return (
    <div className="space-y-2">
      {items.map((l) => (
        <div key={l.id} className="border border-border/50 rounded-lg p-3 space-y-2 bg-muted/5">
          <div className="flex items-center gap-2 justify-between">
            {(() => { const s = getLightingSwatch(l.colorTemperature); return (
              <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-base" style={{ background: s.bg }}>{s.emoji}</div>
            ); })()}
            <span className="text-[10px] font-mono text-muted-foreground flex-1">{l.lightingType || "Lighting"}{l.zone ? ` — ${l.zone}` : ""}</span>
            <Button variant="ghost" size="icon" className="size-6 text-destructive hover:text-destructive" onClick={() => remove(l.id)}><Trash2 className="size-3" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[10px]">Room / Zone</Label><Input className="h-7 text-xs mt-0.5" value={l.zone} onChange={(e) => update(l.id, "zone", e.target.value)} placeholder="e.g. Living Area" /></div>
            <div>
              <Label className="text-[10px]">Lighting Type</Label>
              <Select value={l.lightingType || ""} onValueChange={(v) => update(l.id, "lightingType", v)}>
                <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{LIGHTING_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-[10px]">Fixture Type</Label><Input className="h-7 text-xs mt-0.5" value={l.fixtureType} onChange={(e) => update(l.id, "fixtureType", e.target.value)} placeholder="e.g. Recessed MR16" /></div>
            <div>
              <Label className="text-[10px]">Color Temperature</Label>
              <Select value={l.colorTemperature} onValueChange={(v) => update(l.id, "colorTemperature", v)}>
                <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>{COLOR_TEMPS.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-[10px]">Purpose</Label><Input className="h-7 text-xs mt-0.5" value={l.purpose} onChange={(e) => update(l.id, "purpose", e.target.value)} placeholder="e.g. Ambient, Task, Accent" /></div>
            <div><Label className="text-[10px]">Quantity</Label><Input className="h-7 text-xs mt-0.5" type="number" min="1" value={l.quantity} onChange={(e) => update(l.id, "quantity", e.target.value)} /></div>
          </div>
          <div><Label className="text-[10px]">Placement Notes</Label><Input className="h-7 text-xs mt-0.5" value={l.notes} onChange={(e) => update(l.id, "notes", e.target.value)} placeholder="e.g. Grid of 4, centred on ceiling, 600mm from wall" /></div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1.5 border-dashed" onClick={add}><Plus className="size-3" /> Add Lighting Item</Button>
    </div>
  );
}

// ── Main Editor ───────────────────────────────────────────────────────────────

interface InteriorDesignEditorProps {
  projectUuid: string;
  onReadyStateChange?: (approved: boolean, hasUnsavedEdits: boolean) => void;
}

export function InteriorDesignEditor({ projectUuid, onReadyStateChange }: InteriorDesignEditorProps) {
  const { toast } = useToast();
  const adminKey = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

  const [draft, setDraft] = useState<ConceptDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [activeSection, setActiveSection] = useState<"concept" | "space" | "materials" | "furniture" | "lighting">("concept");

  // Asset images map: "{itemType}:{itemId}" → ItemAssetImage
  const [assetImages, setAssetImages] = useState<Record<string, ItemAssetImage>>({});
  const [imagesLoading, setImagesLoading] = useState(false);

  const [localConcept, setLocalConcept]    = useState("");
  const [localZones, setLocalZones]         = useState<SpaceZone[]>([]);
  const [localMaterials, setLocalMaterials] = useState<MaterialItem[]>([]);
  const [localFurniture, setLocalFurniture] = useState<FurnitureItem[]>([]);
  const [localLighting, setLocalLighting]   = useState<LightingItem[]>([]);

  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(adminKey ? { "x-admin-api-key": adminKey } : {}),
  });

  // ── Load draft ──────────────────────────────────────────────────────────────

  const loadDraft = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/interior-design/drafts/${projectUuid}`, { headers: headers() });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json() as { draft: ConceptDraft };
      setDraft(data.draft);
      onReadyStateChange?.(
        data.draft.reviewState === "approved_for_rendering",
        data.draft.hasUnsavedEdits,
      );
    } catch { /* network error */ }
    setLoading(false);
  }, [projectUuid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load asset images ───────────────────────────────────────────────────────

  const loadImages = useCallback(async () => {
    setImagesLoading(true);
    try {
      const res = await fetch(`/api/ai/interior-design/asset-images/${projectUuid}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json() as { images: Record<string, ItemAssetImage> };
        setAssetImages(data.images ?? {});
      }
    } catch { /* non-fatal */ }
    setImagesLoading(false);
  }, [projectUuid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadDraft(); void loadImages(); }, [loadDraft, loadImages]);

  // ── Edit mode entry ─────────────────────────────────────────────────────────

  const enterEdit = () => {
    if (!draft) return;
    setLocalConcept(draft.visualConceptDraft ?? "");
    setLocalZones(parseZones(draft.spacePlanDraft));
    setLocalMaterials(parseItems<MaterialItem>(draft.materialsDraft, {
      id: "", area: "Floor", component: "", category: "Floor", materialType: "",
      color: "", finish: "", texture: "", brand: "", productCode: "", priceTier: "Mid-range",
      notes: "", status: "pending",
      source: "custom", libraryMaterialId: null, name: "", subcategory: "",
      description: "", thumbnailUrl: "", previewImages: [], technicalData: {},
    }));
    setLocalFurniture(parseItems<FurnitureItem>(draft.furnitureDraft, { id: "", item: "", zone: "", quantity: "1", dimensions: "", notes: "" }));
    setLocalLighting(parseItems<LightingItem>(draft.lightingDraft, { id: "", zone: "", lightingType: "", fixtureType: "", colorTemperature: "3000K – Warm Neutral", purpose: "Ambient", quantity: "1", notes: "" }));
    setEditMode(true);
  };

  const cancelEdit = () => setEditMode(false);

  // ── Save draft ──────────────────────────────────────────────────────────────

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        spacePlan:     zonesToRaw(localZones, draft.originalSpacePlan),
        materials:     itemsToRaw(localMaterials),
        furniture:     itemsToRaw(localFurniture),
        lighting:      itemsToRaw(localLighting),
        visualConcept: localConcept,
        updatedAt:     draft.updatedAt,
        editorId:      "admin",
      };
      const res = await fetch(`/api/ai/interior-design/drafts/${projectUuid}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Save failed", variant: "destructive" });
        setSaving(false);
        return;
      }
      const data = await res.json() as { draft: ConceptDraft };
      setDraft(data.draft);
      setEditMode(false);
      toast({ title: "Draft saved" });
      onReadyStateChange?.(data.draft.reviewState === "approved_for_rendering", false);
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
    setSaving(false);
  };

  // ── Review state change ─────────────────────────────────────────────────────

  const setReviewState = async (newState: ReviewState) => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/interior-design/drafts/${projectUuid}/review-state`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ state: newState, editorId: "admin" }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to update state", variant: "destructive" });
        setSaving(false);
        return;
      }
      const data = await res.json() as { draft: ConceptDraft };
      setDraft(data.draft);
      toast({ title: `State updated: ${STATE_LABELS[newState]}` });
      onReadyStateChange?.(newState === "approved_for_rendering", false);
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
    setSaving(false);
  };

  const requestRevision = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/interior-design/drafts/${projectUuid}/request-revision`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ editorId: "admin" }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to request revision", variant: "destructive" });
        setSaving(false);
        return;
      }
      const data = await res.json() as { draft: ConceptDraft };
      setDraft(data.draft);
      toast({ title: "Concept unlocked — you can now edit and re-approve" });
      onReadyStateChange?.(false, false);
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
    setSaving(false);
  };

  const resetSection = async (section: string) => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/interior-design/drafts/${projectUuid}/reset`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ sections: [section], editorId: "admin" }),
      });
      if (!res.ok) { toast({ title: "Reset failed", variant: "destructive" }); setSaving(false); return; }
      const data = await res.json() as { draft: ConceptDraft };
      setDraft(data.draft);
      toast({ title: `${section} reset to original AI output` });
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
    setSaving(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono py-4">
        <Loader2 className="size-3.5 animate-spin" /> Loading concept draft…
      </div>
    );
  }

  if (!draft) return null;

  const isApproved = draft.reviewState === "approved_for_rendering";

  const SECTIONS = [
    { key: "concept",   label: "Concept",   icon: Layers },
    { key: "space",     label: "Space Plan", icon: Home },
    { key: "materials", label: "Materials",  icon: Palette },
    { key: "furniture", label: "Furniture",  icon: Sofa },
    { key: "lighting",  label: "Lighting",   icon: Lightbulb },
  ] as const;

  // Helper: get image for an item from the loaded map
  const getItemImage = (itemType: string, itemId: string): ItemAssetImage | null =>
    assetImages[`${itemType}:${itemId}`] ?? null;

  return (
    <div className="mt-2 space-y-3 border border-teal-500/20 rounded-lg p-4 bg-teal-500/5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-teal-400" />
          <span className="font-mono text-sm font-semibold">Interior Design Concept</span>
          <Badge className={cn("text-[10px] border font-mono px-1.5 h-4", STATE_COLORS[draft.reviewState])}>
            {STATE_LABELS[draft.reviewState]}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {!editMode ? (
            <>
              <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px] font-mono" onClick={enterEdit}>
                <Edit2 className="size-3" /> Edit
              </Button>
              {!isApproved && draft.reviewState !== "ai_generated" && (
                <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px] font-mono border-purple-500/30 text-purple-400 hover:bg-purple-500/10" onClick={() => void setReviewState("ready_for_review")} disabled={saving}>
                  <Eye className="size-3" /> Mark Ready for Review
                </Button>
              )}
              {draft.reviewState === "ready_for_review" && (
                <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px] font-mono border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={() => void setReviewState("approved_for_rendering")} disabled={saving}>
                  <CheckCircle2 className="size-3" /> Approve for Rendering
                </Button>
              )}
              {isApproved && (
                <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px] font-mono border-orange-500/30 text-orange-400 hover:bg-orange-500/10" onClick={() => void requestRevision()} disabled={saving}>
                  <RotateCcw className="size-3" /> Request Revision
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-[10px] font-mono" onClick={cancelEdit} disabled={saving}>
                <X className="size-3" /> Cancel
              </Button>
              <Button size="sm" className="h-6 gap-1 text-[10px] font-mono" onClick={() => void saveDraft()} disabled={saving}>
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                Save Draft
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Unsaved edits warning */}
      {!editMode && draft.hasUnsavedEdits && (
        <div className="flex items-center gap-2 text-xs text-yellow-400 font-mono bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-1.5">
          <AlertTriangle className="size-3.5 shrink-0" />
          There are unsaved edits. Save before generating images.
        </div>
      )}

      {!editMode && !isApproved && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono bg-muted/10 border border-border/30 rounded px-3 py-1.5">
          <AlertTriangle className="size-3.5 shrink-0 text-yellow-500" />
          Approve concept before generating images to ensure the render uses the latest draft.
        </div>
      )}

      {!editMode && <MoodboardPanel projectUuid={projectUuid} />}

      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key as typeof activeSection)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors",
              activeSection === key
                ? "bg-teal-500/15 text-teal-400 border border-teal-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/20",
            )}
          >
            <Icon className="size-3" /> {label}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className="pt-1">

        {/* ── Concept ── */}
        {activeSection === "concept" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Visual Concept</span>
              {editMode && <Button variant="ghost" size="sm" className="h-5 gap-1 text-[10px] text-muted-foreground" onClick={() => void resetSection("visualConcept")}><RotateCcw className="size-3" /> Reset</Button>}
            </div>
            {editMode ? (
              <Textarea className="text-xs font-mono min-h-[140px] resize-y" value={localConcept} onChange={(e) => setLocalConcept(e.target.value)} placeholder="Describe the visual concept, atmosphere, and design intent…" />
            ) : (
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
                {draft.visualConceptDraft ?? <span className="text-muted-foreground italic">No concept generated yet.</span>}
              </p>
            )}
          </div>
        )}

        {/* ── Space Plan ── */}
        {activeSection === "space" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Space Planning — Zones</span>
              {editMode && <Button variant="ghost" size="sm" className="h-5 gap-1 text-[10px] text-muted-foreground" onClick={() => void resetSection("spacePlan")}><RotateCcw className="size-3" /> Reset</Button>}
            </div>
            {editMode ? (
              <SpacePlanEditor zones={localZones} onChange={setLocalZones} />
            ) : (
              <div className="space-y-2">
                {parseZones(draft.spacePlanDraft).map((z, i) => {
                  const img = getItemImage("space_plan", z.id);
                  const swatch = getZoneSwatch(z.name, z.function);
                  return (
                    <div key={i} className="border border-border/30 rounded p-2.5 text-xs flex items-start gap-2.5">
                      <ItemThumbnail
                        thumbnailUrl={img?.thumbnailUrl}
                        imageAlt={img?.imageAlt ?? `${z.name} floor plan`}
                        className="w-10 h-10 mt-0.5"
                        fallback={
                          <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-lg mt-0.5" style={{ background: swatch.bg }}>{swatch.emoji}</div>
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold font-mono">{z.name || `Zone ${i+1}`}</span>
                          {z.priority && <Badge variant="outline" className="text-[9px] h-3.5 px-1">{z.priority}</Badge>}
                          {img?.isManualUpload && <Badge variant="outline" className="text-[9px] h-3.5 px-1 text-amber-400 border-amber-500/30">Manual</Badge>}
                        </div>
                        {z.function && <p className="text-muted-foreground">{z.function}</p>}
                        {z.approximateSize && <p className="text-muted-foreground">Size: {z.approximateSize}</p>}
                        {z.adjacency && <p className="text-muted-foreground">Adjacency: {z.adjacency}</p>}
                        {z.notes && <p className="text-muted-foreground italic">{z.notes}</p>}
                        <AdminImageControls
                          projectUuid={projectUuid}
                          itemType="space_plan"
                          itemId={z.id}
                          adminKey={adminKey}
                          existingImage={img}
                          onRefresh={() => void loadImages()}
                          enrichPayload={{ name: z.name, zone: z.function }}
                        />
                      </div>
                    </div>
                  );
                })}
                {parseZones(draft.spacePlanDraft).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No zones specified.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Materials ── */}
        {activeSection === "materials" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Material Specification</span>
              {editMode && <Button variant="ghost" size="sm" className="h-5 gap-1 text-[10px] text-muted-foreground" onClick={() => void resetSection("materials")}><RotateCcw className="size-3" /> Reset</Button>}
            </div>
            {editMode ? (
              <MaterialEditor items={localMaterials} onChange={setLocalMaterials} />
            ) : (
              <div className="space-y-1.5">
                {parseItems<MaterialItem>(draft.materialsDraft, {
                  id: "", area: "", component: "", category: "", materialType: "",
                  color: "", finish: "", texture: "", brand: "", productCode: "",
                  priceTier: "", notes: "", status: "pending",
                  source: "custom", libraryMaterialId: null, name: "", subcategory: "",
                  description: "", thumbnailUrl: "", previewImages: [], technicalData: {},
                }).map((m, i) => {
                  const img = getItemImage("material", m.id);
                  // Priority: asset images table → library thumbnailUrl → material swatch
                  const resolvedThumb = img?.thumbnailUrl ?? m.thumbnailUrl ?? null;
                  const resolvedAlt   = img?.imageAlt ?? `${m.name ?? m.materialType} ${m.category} texture`;
                  const sw = getMaterialSwatch(m.color, m.materialType, m.finish);
                  return (
                    <div key={i} className="border border-border/30 rounded p-2.5 text-xs flex items-start gap-3">
                      <ItemThumbnail
                        thumbnailUrl={resolvedThumb}
                        imageAlt={resolvedAlt}
                        className="w-10 h-10 mt-0.5"
                        fallback={
                          <div className="w-10 h-10 rounded shrink-0 border border-border/20 flex items-center justify-center text-sm mt-0.5" style={{ background: sw.background }}>{sw.patternHint}</div>
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="font-semibold">{m.name || m.area || m.category}</span>
                          {m.component && <span className="text-muted-foreground">/ {m.component}</span>}
                          {m.source === "material_library" && (
                            <Badge className="text-[9px] h-3.5 px-1 bg-teal-500/10 text-teal-400 border border-teal-500/20">Library</Badge>
                          )}
                          {m.status === "selected" && <Badge className="text-[9px] h-3.5 px-1 bg-green-500/10 text-green-400 border-green-500/20">Selected</Badge>}
                          {m.status === "rejected" && <Badge className="text-[9px] h-3.5 px-1 bg-red-500/10 text-red-400 border-red-500/20">Rejected</Badge>}
                          {img?.isManualUpload && <Badge variant="outline" className="text-[9px] h-3.5 px-1 text-amber-400 border-amber-500/30">Manual</Badge>}
                        </div>
                        <p className="text-muted-foreground">{[m.materialType, m.color, m.finish].filter(Boolean).join(" · ")}</p>
                        {m.priceTier && <p className="text-muted-foreground text-[10px]">{m.priceTier}{m.brand ? ` · ${m.brand}` : ""}</p>}
                        <AdminImageControls
                          projectUuid={projectUuid}
                          itemType="material"
                          itemId={m.id}
                          adminKey={adminKey}
                          existingImage={img}
                          onRefresh={() => void loadImages()}
                          enrichPayload={{ name: m.name ?? "", category: m.category, materialType: m.materialType, color: m.color }}
                        />
                      </div>
                    </div>
                  );
                })}
                {parseItems<MaterialItem>(draft.materialsDraft, {
                  id:"",area:"",component:"",category:"",materialType:"",color:"",finish:"",
                  texture:"",brand:"",productCode:"",priceTier:"",notes:"",status:"pending",
                  source:"custom",libraryMaterialId:null,name:"",subcategory:"",
                  description:"",thumbnailUrl:"",previewImages:[],technicalData:{},
                }).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No materials specified.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Furniture ── */}
        {activeSection === "furniture" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Furniture Placement</span>
              {editMode && <Button variant="ghost" size="sm" className="h-5 gap-1 text-[10px] text-muted-foreground" onClick={() => void resetSection("furniture")}><RotateCcw className="size-3" /> Reset</Button>}
            </div>
            {editMode ? (
              <FurnitureEditor items={localFurniture} onChange={setLocalFurniture} />
            ) : (
              <div className="space-y-1.5">
                {parseItems<FurnitureItem>(draft.furnitureDraft, {id:"",item:"",zone:"",quantity:"1",dimensions:"",notes:""}).map((f, i) => {
                  const img = getItemImage("furniture", f.id);
                  const swatch = getFurnitureSwatch(f.item);
                  return (
                    <div key={i} className="border border-border/30 rounded p-2.5 text-xs flex items-start gap-2.5">
                      <ItemThumbnail
                        thumbnailUrl={img?.thumbnailUrl}
                        imageAlt={img?.imageAlt ?? `${f.item} furniture product`}
                        className="w-10 h-10 mt-0.5"
                        fallback={
                          <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-lg mt-0.5" style={{ background: swatch.bg }}>{swatch.emoji}</div>
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{f.item || "Item"}</span>
                          {f.zone && <span className="text-muted-foreground">— {f.zone}</span>}
                          {f.quantity && f.quantity !== "1" && <Badge variant="outline" className="text-[9px] h-3.5 px-1">×{f.quantity}</Badge>}
                          {img?.isManualUpload && <Badge variant="outline" className="text-[9px] h-3.5 px-1 text-amber-400 border-amber-500/30">Manual</Badge>}
                        </div>
                        {f.dimensions && <p className="text-muted-foreground mt-0.5">{f.dimensions}</p>}
                        {f.notes && <p className="text-muted-foreground italic">{f.notes}</p>}
                        <AdminImageControls
                          projectUuid={projectUuid}
                          itemType="furniture"
                          itemId={f.id}
                          adminKey={adminKey}
                          existingImage={img}
                          onRefresh={() => void loadImages()}
                          enrichPayload={{ name: f.item, zone: f.zone }}
                        />
                      </div>
                    </div>
                  );
                })}
                {parseItems<FurnitureItem>(draft.furnitureDraft,{id:"",item:"",zone:"",quantity:"1",dimensions:"",notes:""}).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No furniture items specified.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Lighting ── */}
        {activeSection === "lighting" && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">Lighting Recommendations</span>
              {editMode && <Button variant="ghost" size="sm" className="h-5 gap-1 text-[10px] text-muted-foreground" onClick={() => void resetSection("lighting")}><RotateCcw className="size-3" /> Reset</Button>}
            </div>
            {editMode ? (
              <LightingEditor items={localLighting} onChange={setLocalLighting} />
            ) : (
              <div className="space-y-1.5">
                {parseItems<LightingItem>(draft.lightingDraft,{id:"",zone:"",lightingType:"",fixtureType:"",colorTemperature:"",purpose:"",quantity:"1",notes:""}).map((l, i) => {
                  const img = getItemImage("lighting", l.id);
                  const swatch = getLightingSwatch(l.colorTemperature);
                  return (
                    <div key={i} className="border border-border/30 rounded p-2.5 text-xs flex items-start gap-2.5">
                      <ItemThumbnail
                        thumbnailUrl={img?.thumbnailUrl}
                        imageAlt={img?.imageAlt ?? `${l.lightingType || l.fixtureType || "light"} fixture`}
                        className="w-10 h-10 mt-0.5"
                        fallback={
                          <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-lg mt-0.5" style={{ background: swatch.bg }}>{swatch.emoji}</div>
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{l.lightingType || "Light"}</span>
                          {l.zone && <span className="text-muted-foreground">— {l.zone}</span>}
                          {l.quantity && l.quantity !== "1" && <Badge variant="outline" className="text-[9px] h-3.5 px-1">×{l.quantity}</Badge>}
                          {img?.isManualUpload && <Badge variant="outline" className="text-[9px] h-3.5 px-1 text-amber-400 border-amber-500/30">Manual</Badge>}
                        </div>
                        {l.fixtureType && <p className="text-muted-foreground mt-0.5">{l.fixtureType}</p>}
                        {l.colorTemperature && <p className="text-muted-foreground text-[10px]">{l.colorTemperature}{l.purpose ? ` · ${l.purpose}` : ""}</p>}
                        {l.notes && <p className="text-muted-foreground italic">{l.notes}</p>}
                        <AdminImageControls
                          projectUuid={projectUuid}
                          itemType="lighting"
                          itemId={l.id}
                          adminKey={adminKey}
                          existingImage={img}
                          onRefresh={() => void loadImages()}
                          enrichPayload={{ lightingType: l.lightingType, fixtureType: l.fixtureType, zone: l.zone }}
                        />
                      </div>
                    </div>
                  );
                })}
                {parseItems<LightingItem>(draft.lightingDraft,{id:"",zone:"",lightingType:"",fixtureType:"",colorTemperature:"",purpose:"",quantity:"1",notes:""}).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No lighting items specified.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Images loading indicator */}
      {imagesLoading && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
          <Loader2 className="size-2.5 animate-spin" /> Loading images…
        </div>
      )}

      {/* Last edited info */}
      {draft.lastEditedBy && (
        <p className="text-[10px] text-muted-foreground font-mono">
          Last edited by {draft.lastEditedBy}
          {draft.lastEditedAt && ` at ${new Date(draft.lastEditedAt).toLocaleString()}`}
        </p>
      )}
    </div>
  );
}
