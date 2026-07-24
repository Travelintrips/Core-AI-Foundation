/**
 * Affiliate System — Sprint P2.5
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users2, TrendingUp, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const HEADERS = () => {

  return { "Content-Type": "application/json", };
};
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: HEADERS(), ...init });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

type Affiliate = {
  id: number; name: string; email: string; affiliateCode: string;
  commissionRate: number; status: string;
  totalClicks: number; totalConversions: number; totalRevenue: number;
  totalCommission: number; pendingCommission: number; paidCommission: number;
};

function statusBadge(s: string) {
  if (s === "active") return "bg-green-500/10 text-green-400 border-green-500/20";
  if (s === "suspended") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
}

function idr(n: number) { return `Rp ${n.toLocaleString("id-ID")}`; }

export default function AffiliatesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", affiliateCode: "", commissionRate: "10" });

  const { data, isLoading } = useQuery({
    queryKey: ["affiliates"],
    queryFn: () => apiFetch<{ items: Affiliate[]; total: number }>("/api/ai/affiliates"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) =>
      apiFetch("/api/ai/affiliates", {
        method: "POST",
        body: JSON.stringify({
          name: payload.name,
          email: payload.email,
          affiliateCode: payload.affiliateCode || undefined,
          commissionRate: parseInt(payload.commissionRate, 10),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["affiliates"] });
      toast({ title: "Affiliate created" });
      setOpen(false); setForm({ name: "", email: "", affiliateCode: "", commissionRate: "10" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/api/ai/affiliates/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["affiliates"] }),
  });

  const totalRevenue = data?.items.reduce((s, a) => s + a.totalRevenue, 0) ?? 0;
  const totalCommission = data?.items.reduce((s, a) => s + a.totalCommission, 0) ?? 0;
  const pendingCommission = data?.items.reduce((s, a) => s + a.pendingCommission, 0) ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users2 className="size-6 text-purple-400" />Affiliate System</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage affiliates, track clicks and conversions</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="size-4 mr-2" />Add Affiliate</Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Affiliate Revenue", value: idr(totalRevenue), icon: DollarSign, color: "text-green-400" },
          { label: "Total Commission", value: idr(totalCommission), icon: TrendingUp, color: "text-cyan-400" },
          { label: "Pending Payout", value: idr(pendingCommission), icon: DollarSign, color: "text-yellow-400" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-bold mt-1">{k.value}</p>
              </div>
              <k.icon className={`size-5 ${k.color}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Affiliate Table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Affiliates ({data?.total ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : data?.items.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No affiliates yet.</div>
          ) : (
            <div className="space-y-3">
              {data?.items.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{a.name}</span>
                        <Badge className={statusBadge(a.status)}>{a.status}</Badge>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{a.affiliateCode}</code>
                        <span className="text-xs text-muted-foreground">{a.commissionRate}% commission</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.email}</p>
                      <div className="flex gap-6 mt-2 text-xs">
                        <span className="text-muted-foreground">Clicks: <strong className="text-foreground">{a.totalClicks}</strong></span>
                        <span className="text-muted-foreground">Conversions: <strong className="text-foreground">{a.totalConversions}</strong></span>
                        <span className="text-muted-foreground">Revenue: <strong className="text-foreground">{idr(a.totalRevenue)}</strong></span>
                        <span className="text-muted-foreground">Commission: <strong className="text-foreground">{idr(a.totalCommission)}</strong></span>
                        <span className="text-yellow-400">Pending: {idr(a.pendingCommission)}</span>
                        <span className="text-green-400">Paid: {idr(a.paidCommission)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {a.status === "active" ? (
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => patchMutation.mutate({ id: a.id, status: "suspended" })}>Suspend</Button>
                      ) : (
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => patchMutation.mutate({ id: a.id, status: "active" })}>Activate</Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Affiliate</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Full name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input type="email" placeholder="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input placeholder="Affiliate code (optional, auto-generated if blank)" value={form.affiliateCode} onChange={(e) => setForm({ ...form, affiliateCode: e.target.value.toUpperCase() })} />
            <Input type="number" placeholder="Commission rate % (default: 10)" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Adding…" : "Add Affiliate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
