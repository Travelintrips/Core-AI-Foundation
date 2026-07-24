/**
 * Coupon Engine — Sprint P2.5
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Ticket, Copy, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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

type Coupon = {
  id: number; code: string; type: string; value: number;
  minimumOrder?: number | null; maximumDiscount?: number | null;
  startDate?: string | null; endDate?: string | null;
  usageLimit?: number | null; usagePerCustomer: number;
  usageCount: number; status: string;
};

const EMPTY = {
  code: "", type: "percentage", value: "",
  minimumOrder: "", maximumDiscount: "",
  startDate: "", endDate: "",
  usageLimit: "", usagePerCustomer: "1",
};

function statusBadge(s: string) {
  if (s === "active") return "bg-green-500/10 text-green-400 border-green-500/20";
  if (s === "paused") return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  return "bg-muted text-muted-foreground";
}

export default function CouponsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["coupons"],
    queryFn: () => apiFetch<{ items: Coupon[]; total: number }>("/api/ai/coupons"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) =>
      apiFetch("/api/ai/coupons", {
        method: "POST",
        body: JSON.stringify({
          code: payload.code.toUpperCase().trim(),
          type: payload.type,
          value: parseInt(payload.value, 10),
          minimumOrder: payload.minimumOrder ? parseInt(payload.minimumOrder, 10) : undefined,
          maximumDiscount: payload.maximumDiscount ? parseInt(payload.maximumDiscount, 10) : undefined,
          startDate: payload.startDate || undefined,
          endDate: payload.endDate || undefined,
          usageLimit: payload.usageLimit ? parseInt(payload.usageLimit, 10) : undefined,
          usagePerCustomer: parseInt(payload.usagePerCustomer, 10),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      toast({ title: "Coupon created" });
      setOpen(false); setForm(EMPTY);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/api/ai/coupons/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Ticket className="size-6 text-cyan-400" />Coupon Engine</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Create and manage discount coupon codes</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="size-4 mr-2" />New Coupon</Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : (
        <div className="grid gap-3">
          {data?.items.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No coupons yet.</CardContent></Card>
          )}
          {data?.items.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="font-mono text-base font-bold tracking-widest bg-muted px-2 py-0.5 rounded">{c.code}</code>
                      <Button size="icon" variant="ghost" className="size-6" onClick={() => copyCode(c.code)}>
                        {copied === c.code ? <CheckCircle className="size-3 text-green-400" /> : <Copy className="size-3" />}
                      </Button>
                      <Badge className={statusBadge(c.status)}>{c.status}</Badge>
                      <Badge variant="outline" className="text-xs">
                        {c.type === "percentage" ? `${c.value}% OFF` : `Rp ${c.value.toLocaleString("id-ID")} OFF`}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                      {c.minimumOrder && <span>Min order: Rp {c.minimumOrder.toLocaleString("id-ID")}</span>}
                      {c.maximumDiscount && <span>Max discount: Rp {c.maximumDiscount.toLocaleString("id-ID")}</span>}
                      {c.usageLimit && <span>Used: {c.usageCount}/{c.usageLimit}</span>}
                      <span>Per customer: {c.usagePerCustomer}x</span>
                      {c.endDate && <span>Expires: {new Date(c.endDate).toLocaleDateString("id-ID")}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {c.status === "active" ? (
                      <Button size="sm" variant="outline" onClick={() => patchMutation.mutate({ id: c.id, status: "paused" })}>Pause</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => patchMutation.mutate({ id: c.id, status: "active" })}>Activate</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Coupon</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Coupon code * (e.g. SAVE20)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage (%)</SelectItem>
                <SelectItem value="fixed">Fixed amount (IDR)</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" placeholder={form.type === "percentage" ? "Discount % (e.g. 20)" : "Discount amount IDR"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" placeholder="Minimum order (IDR)" value={form.minimumOrder} onChange={(e) => setForm({ ...form, minimumOrder: e.target.value })} />
              <Input type="number" placeholder="Maximum discount (IDR)" value={form.maximumDiscount} onChange={(e) => setForm({ ...form, maximumDiscount: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-muted-foreground">Start Date</label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><label className="text-xs text-muted-foreground">End Date</label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" placeholder="Usage limit (total)" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} />
              <Input type="number" placeholder="Per customer limit" value={form.usagePerCustomer} onChange={(e) => setForm({ ...form, usagePerCustomer: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
