import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Receipt, DollarSign, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

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

type PaymentSchedule = {
  id: number;
  projectId: number;
  paymentType: string;
  percentage: number | null;
  amount: string;
  currency: string;
  status: string;
  reference: string | null;
  proofImageUrl: string | null;
  verifiedBy: string | null;
  paidAt: string | null;
};

type CreativeProject = {
  id: number;
  projectId: string;
  brandName: string;
  status: string;
  paymentStatus: string;
  filesUnlocked: boolean;
};

type PendingGroup = { project: CreativeProject; schedule: PaymentSchedule[] };

type PaymentKpi = {
  paidRevenue: number;
  outstandingBalance: number;
  pendingVerificationCount: number;
  lockedProjects: number;
  unlockedProjects: number;
};

const SCHED_STATUS: Record<string, { label: string; color: string }> = {
  pending:      { label: "Pending",      color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  uploaded:     { label: "Proof Uploaded", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  verified:     { label: "Verified",     color: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected:     { label: "Rejected",     color: "bg-red-500/15 text-red-400 border-red-500/30" },
  waived:       { label: "Waived",       color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

const TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  remaining_balance: "Sisa Pembayaran",
  full_payment: "Pembayaran Penuh",
  custom_installment: "Cicilan",
  subscription_charge: "Tagihan Langganan",
};

function fmt(amount: string, currency: string) {
  const n = parseFloat(amount);
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

function fmtNum(n: number, currency = "IDR") {
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return n.toLocaleString();
}

export default function InvoicesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["invoices", "pending"],
    queryFn: () => apiFetch<PendingGroup[]>("/api/ai/payments/pending"),
    refetchInterval: 30_000,
  });

  const { data: kpi } = useQuery({
    queryKey: ["invoices", "kpi"],
    queryFn: () => apiFetch<PaymentKpi>("/api/ai/payments/kpi"),
    refetchInterval: 60_000,
  });

  const generateInvoice = useMutation({
    mutationFn: (scheduleId: number) =>
      apiFetch(`/api/ai/payments/${scheduleId}/invoice`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice generated." });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const allSchedules = (data ?? []).flatMap((g) =>
    g.schedule.map((s) => ({ ...s, project: g.project })),
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-invoices">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Receipt className="w-6 h-6" /> Invoices
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Payment schedules and invoice management — sourced from canonical billing.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Paid Revenue", value: fmtNum(kpi.paidRevenue), icon: DollarSign, accent: "text-green-400" },
            { label: "Outstanding", value: fmtNum(kpi.outstandingBalance), icon: Clock, accent: "text-yellow-400" },
            { label: "Pending Verification", value: kpi.pendingVerificationCount, icon: AlertTriangle, accent: "text-orange-400" },
            { label: "Projects Locked", value: kpi.lockedProjects, icon: Receipt, accent: "text-red-400" },
            { label: "Projects Unlocked", value: kpi.unlockedProjects, icon: CheckCircle2, accent: "text-green-400" },
          ].map(({ label, value, icon: Icon, accent }) => (
            <div key={label} className="border border-border rounded-xl p-3 bg-card/40">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
                <Icon className={`w-3.5 h-3.5 ${accent}`} />
              </div>
              <div className={`text-xl font-bold font-mono ${accent}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : allSchedules.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">No payment schedules found.</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="table-invoices">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Invoice</th>
                <th className="text-left px-4 py-2.5">Project</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Reference</th>
                <th className="text-left px-4 py-2.5">Verified By</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allSchedules.map((s) => {
                const cfg = SCHED_STATUS[s.status];
                return (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/5" data-testid={`row-invoice-${s.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">#{s.id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm">{s.project.brandName}</div>
                      <div className="text-xs font-mono text-muted-foreground">{s.project.projectId.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{TYPE_LABEL[s.paymentType] ?? s.paymentType}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] border font-mono px-1.5 py-0 h-4 ${cfg?.color ?? "bg-muted text-muted-foreground border-border"}`}>
                        {cfg?.label ?? s.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-green-400">{fmt(s.amount, s.currency)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{s.reference ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.verifiedBy ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {["verified", "pending"].includes(s.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => generateInvoice.mutate(s.id)}
                            disabled={generateInvoice.isPending}
                            className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            data-testid={`button-generate-invoice-${s.id}`}
                          >
                            <Receipt className="w-3 h-3 mr-1" /> Invoice
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
