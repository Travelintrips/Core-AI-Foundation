/**
 * WP-02 — Furniture Library Admin Detail/Create Page
 *
 * Handles both create (id="new") and edit modes.
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Save, Package, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAdminApi } from "@/hooks/useAdminApi";

interface FurnitureItem {
  id: string;
  code: string;
  name: string;
  nameId: string;
  slug: string;
  description?: string | null;
  categoryId: string;
  brandId?: string | null;
  collectionId?: string | null;
  style?: string | null;
  furnitureType?: string | null;
  primaryMaterials: string[];
  finishes: string[];
  colors: string[];
  dimensions: { widthCm: number; depthCm: number; heightCm: number; weightKg?: number | null };
  priceTier: string;
  sku?: string | null;
  thumbnailUrl?: string | null;
  status: string;
  version: number;
  searchKeywords: string[];
  createdAt: string;
  updatedAt: string;
  assets?: unknown[];
  tags?: unknown[];
}

interface RefItem { id: string; name: string; code: string; slug: string; }

export default function FurnitureLibraryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { apiFetch } = useAdminApi();
  const { toast } = useToast();

  const apiJson = useCallback(async <T,>(url: string, opts?: RequestInit): Promise<T> => {
    const res = await apiFetch(url, opts);
    return res.json() as T;
  }, [apiFetch]);

  const isNew = id === "new";
  const [item, setItem]       = useState<Partial<FurnitureItem>>({
    name: "", nameId: "", description: "", categoryId: "", priceTier: "mid",
    primaryMaterials: [], finishes: [], colors: [], dimensions: { widthCm: 0, depthCm: 0, heightCm: 0 },
  });
  const [categories, setCategories] = useState<RefItem[]>([]);
  const [brands, setBrands]         = useState<RefItem[]>([]);
  const [collections, setCollections] = useState<RefItem[]>([]);
  const [history, setHistory]       = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);

  const loadRefs = useCallback(async () => {
    try {
      const [cats, brnds, cols] = await Promise.all([
        apiJson<{ data: RefItem[] }>("/ai/furniture-library/categories"),
        apiJson<{ data: RefItem[] }>("/ai/furniture-library/brands"),
        apiJson<{ data: RefItem[] }>("/ai/furniture-library/collections"),
      ]);
      setCategories(cats.data);
      setBrands(brnds.data);
      setCollections(cols.data);
    } catch {}
  }, [apiFetch]);

  const loadItem = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const [data, hist] = await Promise.all([
        apiJson<FurnitureItem>(`/ai/furniture-library/items/${id}`),
        apiJson<{ data: Record<string, unknown>[] }>(`/ai/furniture-library/items/${id}/history`),
      ]);
      setItem(data);
      setHistory(hist.data);
    } catch {
      toast({ title: "Error", description: "Failed to load item.", variant: "destructive" });
      navigate("/furniture-library");
    } finally { setLoading(false); }
  }, [id, isNew, apiFetch, toast, navigate]);

  useEffect(() => { loadRefs(); loadItem(); }, [loadRefs, loadItem]);

  const handleSave = async () => {
    if (!item.name?.trim()) {
      toast({ title: "Validation", description: "Name is required.", variant: "destructive" });
      return;
    }
    if (!item.categoryId) {
      toast({ title: "Validation", description: "Category is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await apiJson<FurnitureItem>("/ai/furniture-library/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        toast({ title: "Created", description: `"${created.name}" created as draft.` });
        navigate(`/furniture-library/${created.id}`);
      } else {
        const updated = await apiJson<FurnitureItem>(`/ai/furniture-library/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        setItem(updated);
        toast({ title: "Saved", description: "Changes saved." });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleArrayField = (field: keyof FurnitureItem, value: string) => {
    setItem(prev => ({ ...prev, [field]: value.split(",").map(s => s.trim()).filter(Boolean) }));
  };

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/furniture-library")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Package className="w-5 h-5" />
            {isNew ? "New Furniture Item" : item.name}
          </h1>
          {!isNew && (
            <div className="flex items-center gap-2 mt-1">
              <Badge>{item.status}</Badge>
              <span className="text-xs text-muted-foreground">v{item.version}</span>
              <span className="text-xs text-muted-foreground font-mono">{item.code}</span>
            </div>
          )}
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* Core fields */}
      <Card>
        <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={item.name ?? ""} onChange={e => setItem(p => ({ ...p, name: e.target.value }))} placeholder="Oslo 3-Seat Sofa" />
            </div>
            <div className="space-y-1">
              <Label>Name (Indonesian)</Label>
              <Input value={item.nameId ?? ""} onChange={e => setItem(p => ({ ...p, nameId: e.target.value }))} placeholder="Sofa Oslo 3-Dudukan" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={item.description ?? ""} onChange={e => setItem(p => ({ ...p, description: e.target.value }))} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Category *</Label>
              <Select value={item.categoryId ?? ""} onValueChange={v => setItem(p => ({ ...p, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Price Tier</Label>
              <Select value={item.priceTier ?? "mid"} onValueChange={v => setItem(p => ({ ...p, priceTier: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="budget">Budget</SelectItem>
                  <SelectItem value="mid">Mid</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="luxury">Luxury</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Brand</Label>
              <Select value={item.brandId ?? ""} onValueChange={v => setItem(p => ({ ...p, brandId: v || null }))}>
                <SelectTrigger><SelectValue placeholder="No brand" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No brand</SelectItem>
                  {brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Collection</Label>
              <Select value={item.collectionId ?? ""} onValueChange={v => setItem(p => ({ ...p, collectionId: v || null }))}>
                <SelectTrigger><SelectValue placeholder="No collection" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No collection</SelectItem>
                  {collections.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Classification */}
      <Card>
        <CardHeader><CardTitle>Classification</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Furniture Type</Label>
              <Input value={item.furnitureType ?? ""} onChange={e => setItem(p => ({ ...p, furnitureType: e.target.value }))} placeholder="sofa, chair, table…" />
            </div>
            <div className="space-y-1">
              <Label>Style</Label>
              <Input value={item.style ?? ""} onChange={e => setItem(p => ({ ...p, style: e.target.value }))} placeholder="Scandinavian, Industrial…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Primary Materials <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
              <Input value={(item.primaryMaterials ?? []).join(", ")} onChange={e => handleArrayField("primaryMaterials", e.target.value)} placeholder="oak, fabric, steel" />
            </div>
            <div className="space-y-1">
              <Label>Colors <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
              <Input value={(item.colors ?? []).join(", ")} onChange={e => handleArrayField("colors", e.target.value)} placeholder="grey, charcoal, white" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Finishes <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
            <Input value={(item.finishes ?? []).join(", ")} onChange={e => handleArrayField("finishes", e.target.value)} placeholder="matte, gloss, brushed" />
          </div>
        </CardContent>
      </Card>

      {/* Dimensions */}
      <Card>
        <CardHeader><CardTitle>Dimensions</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(["widthCm", "depthCm", "heightCm", "weightKg"] as const).map(field => (
              <div key={field} className="space-y-1">
                <Label className="capitalize">{field.replace("Cm", " (cm)").replace("Kg", " (kg)")}</Label>
                <Input
                  type="number" min={0}
                  value={item.dimensions?.[field] ?? ""}
                  onChange={e => setItem(p => ({
                    ...p,
                    dimensions: { ...(p.dimensions ?? { widthCm: 0, depthCm: 0, heightCm: 0 }), [field]: Number(e.target.value) }
                  }))}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Media & Search */}
      <Card>
        <CardHeader><CardTitle>Media & Search</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Thumbnail URL</Label>
            <Input value={item.thumbnailUrl ?? ""} onChange={e => setItem(p => ({ ...p, thumbnailUrl: e.target.value || null }))} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label>SKU</Label>
            <Input value={item.sku ?? ""} onChange={e => setItem(p => ({ ...p, sku: e.target.value || null }))} placeholder="optional product SKU" />
          </div>
          <div className="space-y-1">
            <Label>Search Keywords <span className="text-xs text-muted-foreground">(comma-separated)</span></Label>
            <Input value={(item.searchKeywords ?? []).join(", ")} onChange={e => handleArrayField("searchKeywords", e.target.value)} placeholder="sofa, seating, living room" />
          </div>
        </CardContent>
      </Card>

      {/* Version History */}
      {!isNew && history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4" /> Version History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className="text-sm flex items-start gap-3 pb-2 border-b last:border-0">
                  <Badge variant="outline" className="shrink-0 text-xs">{String(h["action"]).replace(/_/g, " ")}</Badge>
                  <span className="text-muted-foreground text-xs">{new Date(h["created_at"] as string).toLocaleString()}</span>
                  {h["details"] != null && <span className="text-xs text-muted-foreground">{JSON.stringify(h["details"])}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
