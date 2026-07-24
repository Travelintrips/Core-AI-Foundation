/**
 * Promotions Management — Sprint P2.5
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const HEADERS = () => {

  return { "Content-Type": "application/json", };
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: HEADERS(), ...init });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

type Promotion = {
  id: number; name: string; description?: string | null;
  discountType: string; discountValue?: number | null;
  benefitLabel?: string | null; industry?: string | null;
  startDate?: string | null; endDate?: string | null;
  usageLimit?: number | null; usageCount: number; status: string;
};

const DISCOUNT_TYPES = ["percentage","fixed","free_revision","free_source_file","free_consultation","bundle"];

const DISCOUNT_TYPE_LABELS: Record<string, string> = {
  percentage: "Percentage (%)", fixed: "Fixed (IDR)",
  free_revision: "Free Revision", free_source_file: "Free Source File",
  free_consultation: "Free Consultation", bundle: "Bundle",
};

function statusColor(s: string) {
  if (s === "active") return "bg-green-500/10 text-green-400 border-green-500/20";
  if (s === "paused") return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  return "bg-muted text-muted-foreground";
}

const EMPTY_FORM = {
  name: "", description: "", discountType: "percentage", discountValue: "",
  benefitLabel: "", industry: "", startDate: "", endDate: "", usageLimit: "",
};

export default function PromotionsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["promotions"],
    queryFn: () => apiFetch<{ items: Promotion[]; total: number }>("/api/ai/promotions?includeExpired=true"),
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: typeof form & { id?: number }) => {
      const body = {
        name: payload.name,
        description: payload.description || undefined,
        discountType: payload.discountType,
        discountValue: payload.discountValue ? parseInt(payload.discountValue, 10) : undefined,
        benefitLabel: payload.benefitLabel || undefined,
        industry: payload.industry || undefined,
        startDate: payload.startDate || undefined,
        endDate: payload.endDate || undefined,
        usageLimit: payload.usageLimit ? parseInt(payload.usageLimit, 10) : undefined,
        status: "active",
      };
      if (payload.id) {
        return apiFetch(`/api/ai/promotions/${payload.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      return apiFetch("/api/ai/promotions", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      toast({ title: editing ? "Promotion updated" : "Promotion created" });
      setOpen(false); setEditing(null); setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/promotions/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["promotions"] }); toast({ title: "Promotion deleted" }); },
  });

  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setOpen(true);
  }

  function openEdit(p: Promotion) {
    setEditing(p);
    setForm({
      name: p.name, description: p.description ?? "",
      discountType: p.discountType, discountValue: p.discountValue ? String(p.discountValue) : "",
      benefitLabel: p.benefitLabel ?? "", industry: p.industry ?? "",
      startDate: p.startDate ? p.startDate.slice(0,10) : "",
      endDate: p.endDate ? p.endDate.slice(0,10) : "",
      usageLimit: p.usageLimit ? String(p.usageLimit) : "",
    });
    setOpen(true);
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Tag className="size-6 text-pink-400" />Promotion Engine</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage discounts, bundles, and special offers</p>
        </div>
        <Button onClick={openCreate}><Plus className="size-4 mr-2" />New Promotion</Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : (
        <div className="grid gap-3">
          {data?.items.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No promotions yet. Create your first one.</CardContent></Card>
          )}
          {data?.items.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge className={statusColor(p.status)}>{p.status}</Badge>
                    <Badge variant="outline" className="text-xs">{DISCOUNT_TYPE_LABELS[p.discountType] ?? p.discountType}</Badge>
                  </div>
                  {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                    {p.discountValue != null && <span>Value: {p.discountType === "percentage" ? `${p.discountValue}%` : `Rp ${p.discountValue.toLocaleString("id-ID")}`}</span>}
                    {p.industry && <span>Industry: {p.industry}</span>}
                    {p.usageLimit && <span>Used: {p.usageCount}/{p.usageLimit}</span>}
                    {p.endDate && <span>Ends: {new Date(p.endDate).toLocaleDateString("id-ID")}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(p.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Promotion" : "New Promotion"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Promotion name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Select value={form.discountType} onValueChange={(v) => setForm({ ...form, discountType: v })}>
              <SelectTrigger><SelectValue placeholder="Discount type *" /></SelectTrigger>
              <SelectContent>{DISCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{DISCOUNT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
            </Select>
            {["percentage","fixed"].includes(form.discountType) && (
              <Input type="number" placeholder={form.discountType === "percentage" ? "Discount % (e.g. 20)" : "Discount amount IDR"} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
            )}
            {!["percentage","fixed"].includes(form.discountType) && (
              <Input placeholder="Benefit label (e.g. 1 free revision)" value={form.benefitLabel} onChange={(e) => setForm({ ...form, benefitLabel: e.target.value })} />
            )}
            <Input placeholder="Industry filter (optional)" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-muted-foreground">Start Date</label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><label className="text-xs text-muted-foreground">End Date</label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            </div>
            <Input type="number" placeholder="Usage limit (optional)" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate({ ...form, id: editing?.id })} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
