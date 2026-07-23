import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, FileText, Send, Eye, Clock, CheckCircle2, XCircle } from "lucide-react";

const API_BASE = "";
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  if (key) headers["x-admin-api-key"] = key;
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body?.error as string) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type Quotation = {
  id: number;
  serviceRequestId: number;
  status: string;
  totalAmount: string | null;
  currency: string;
  validUntil: string | null;
  issuedAt: string | null;
  viewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof FileText }> = {
  draft:     { label: "Draft",     color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",    icon: FileText },
  issued:    { label: "Issued",    color: "bg-blue-500/15 text-blue-400 border-blue-500/30",    icon: Send },
  viewed:    { label: "Viewed",    color: "bg-violet-500/15 text-violet-400 border-violet-500/30", icon: Eye },
  approved:  { label: "Approved",  color: "bg-green-500/15 text-green-400 border-green-500/30", icon: CheckCircle2 },
  rejected:  { label: "Rejected",  color: "bg-red-500/15 text-red-400 border-red-500/30",       icon: XCircle },
  expired:   { label: "Expired",   color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: Clock },
};

function fmt(amount: string | null, currency: string) {
  if (!amount) return "—";
  const n = parseFloat(amount);
  if (isNaN(n)) return "—";
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

const FILTERS = ["all", "draft", "issued", "viewed", "approved", "rejected"] as const;
type Filter = typeof FILTERS[number];

export default function QuotationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["quotations"],
    queryFn: () => apiFetch<Quotation[]>("/api/ai/quotations"),
    refetchInterval: 30_000,
  });

  const issueMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/ai/quotations/${id}/issue`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      toast({ title: "Quotation issued to customer." });
    },
    onError: (err: Error) => toast({ title: "Failed to issue", description: err.message, variant: "destructive" }),
  });

  const quotations = (data ?? []).filter((q) => filter === "all" || q.status === filter);

  const counts: Record<string, number> = {
    all: data?.length ?? 0,
    draft: data?.filter((q) => q.status === "draft").length ?? 0,
    issued: data?.filter((q) => q.status === "issued").length ?? 0,
    viewed: data?.filter((q) => q.status === "viewed").length ?? 0,
    approved: data?.filter((q) => q.status === "approved").length ?? 0,
    rejected: data?.filter((q) => q.status === "rejected").length ?? 0,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-quotations">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileText className="w-6 h-6" /> Quotations
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Service-catalog quotations — canonical source: <code className="text-xs font-mono">ai_quotations</code>. No hardcoded statuses.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {FILTERS.map((f) => {
          const cfg = STATUS_CONFIG[f];
          const Icon = cfg?.icon ?? FileText;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`border rounded-xl p-3 text-left transition-all ${
                filter === f ? "border-primary bg-primary/10" : "border-border bg-card/40 hover:bg-muted/10"
              }`}
              data-testid={`filter-quotation-${f}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{f}</span>
              </div>
              <div className="text-xl font-bold font-mono">{counts[f] ?? 0}</div>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : quotations.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">No quotations found.</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="table-quotations">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">ID</th>
                <th className="text-left px-4 py-2.5">Request ID</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Valid Until</th>
                <th className="text-left px-4 py-2.5">Issued</th>
                <th className="text-left px-4 py-2.5">Approved</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => {
                const cfg = STATUS_CONFIG[q.status];
                const Icon = cfg?.icon ?? FileText;
                return (
                  <tr key={q.id} className="border-b border-border/50 hover:bg-muted/5 transition-colors" data-testid={`row-quotation-${q.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{q.id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{q.serviceRequestId}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] border font-mono px-1.5 py-0 h-4 gap-0.5 ${cfg?.color ?? "bg-muted text-muted-foreground border-border"}`}>
                        <Icon className="w-2.5 h-2.5" /> {cfg?.label ?? q.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-green-400">
                      {fmt(q.totalAmount, q.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                      {q.validUntil ? new Date(q.validUntil).toLocaleDateString("id-ID") : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                      {q.issuedAt ? new Date(q.issuedAt).toLocaleDateString("id-ID") : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                      {q.approvedAt ? new Date(q.approvedAt).toLocaleDateString("id-ID") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {q.status === "draft" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => issueMut.mutate(q.id)}
                            disabled={issueMut.isPending}
                            className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            data-testid={`button-issue-${q.id}`}
                          >
                            <Send className="w-3 h-3 mr-1" /> Issue
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
