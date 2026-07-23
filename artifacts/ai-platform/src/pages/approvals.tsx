import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, SkipForward } from "lucide-react";

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

type CommercialGate = {
  id: number;
  quotationId: number | null;
  serviceQuotationId: number | null;
  serviceRequestId: number | null;
  gateType: string;
  status: string;
  requiredAmount: string | null;
  verifiedAmount: string | null;
  referenceNumber: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  notes: string | null;
  createdAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof ShieldCheck }> = {
  pending:  { label: "Pending",  color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: AlertTriangle },
  cleared:  { label: "Cleared",  color: "bg-green-500/15 text-green-400 border-green-500/30",   icon: CheckCircle2 },
  failed:   { label: "Failed",   color: "bg-red-500/15 text-red-400 border-red-500/30",          icon: XCircle },
  waived:   { label: "Waived",   color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",       icon: SkipForward },
};

function fmt(amount: string | null) {
  if (!amount) return "—";
  const n = parseFloat(amount);
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

export default function ApprovalsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [actorName, setActorName] = useState("admin");
  const [failReason, setFailReason] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [actingOn, setActingOn] = useState<{ id: number; action: "fail" | "waive" } | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => apiFetch<CommercialGate[]>("/api/commercial-gates"),
    refetchInterval: 30_000,
  });

  const verifyMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/commercial-gates/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ verifiedBy: actorName.trim() || "admin" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      toast({ title: "Gate verified — production can proceed." });
    },
    onError: (err: Error) => toast({ title: "Failed to verify", description: err.message, variant: "destructive" }),
  });

  const failMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch(`/api/commercial-gates/${id}/fail`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setActingOn(null);
      setFailReason("");
      toast({ title: "Gate failed." });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const waiveMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch(`/api/commercial-gates/${id}/waive`, {
        method: "POST",
        body: JSON.stringify({ waivedBy: actorName.trim() || "admin", reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      setActingOn(null);
      setWaiveReason("");
      toast({ title: "Gate waived." });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const gates = data ?? [];
  const pending = gates.filter((g) => g.status === "pending");
  const cleared = gates.filter((g) => g.status === "cleared");
  const failed = gates.filter((g) => g.status === "failed");

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-approvals">
      {/* Confirm Dialog */}
      {actingOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-xl p-6 max-w-sm w-full space-y-4 mx-4">
            <h3 className="font-semibold text-sm">
              {actingOn.action === "fail" ? "Fail Gate" : "Waive Gate"} #{actingOn.id}
            </h3>
            <textarea
              value={actingOn.action === "fail" ? failReason : waiveReason}
              onChange={(e) =>
                actingOn.action === "fail"
                  ? setFailReason(e.target.value)
                  : setWaiveReason(e.target.value)
              }
              placeholder="Reason (required)"
              className="w-full text-xs rounded-lg border border-border bg-muted/20 p-2 min-h-[80px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setActingOn(null)}>Cancel</Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  actingOn.action === "fail"
                    ? !failReason.trim() || failMut.isPending
                    : !waiveReason.trim() || waiveMut.isPending
                }
                onClick={() => {
                  if (actingOn.action === "fail") failMut.mutate({ id: actingOn.id, reason: failReason });
                  else waiveMut.mutate({ id: actingOn.id, reason: waiveReason });
                }}
                data-testid="button-confirm-action"
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6" /> Approvals
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Commercial gates — every approve/fail/waive action creates an audit log.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={actorName}
            onChange={(e) => setActorName(e.target.value)}
            placeholder="Actor name"
            className="text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/20 focus:outline-none focus:ring-1 focus:ring-primary w-36"
            data-testid="input-actor-name"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pending Approval", value: pending.length, icon: AlertTriangle, color: "text-yellow-400" },
          { label: "Cleared", value: cleared.length, icon: CheckCircle2, color: "text-green-400" },
          { label: "Failed / Waived", value: failed.length + gates.filter((g) => g.status === "waived").length, icon: XCircle, color: "text-red-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="border border-border rounded-xl p-4 bg-card/40 flex items-center gap-3">
            <Icon className={`w-5 h-5 flex-shrink-0 ${color}`} />
            <div>
              <div className="text-xl font-bold font-mono">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : gates.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">No commercial gates found.</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="table-approvals">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Gate</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Required</th>
                <th className="text-right px-4 py-2.5">Verified</th>
                <th className="text-left px-4 py-2.5">Reference</th>
                <th className="text-left px-4 py-2.5">Verified By</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {gates.map((g) => {
                const cfg = STATUS_CONFIG[g.status];
                const Icon = cfg?.icon ?? ShieldCheck;
                return (
                  <tr key={g.id} className="border-b border-border/50 hover:bg-muted/5" data-testid={`row-gate-${g.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      <div>#{g.id}</div>
                      {g.serviceRequestId && <div className="text-[10px]">Req #{g.serviceRequestId}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">{g.gateType}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-[10px] border font-mono px-1.5 py-0 h-4 gap-0.5 ${cfg?.color ?? "bg-muted text-muted-foreground border-border"}`}>
                        <Icon className="w-2.5 h-2.5" /> {cfg?.label ?? g.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{fmt(g.requiredAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-green-400">{fmt(g.verifiedAmount)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{g.referenceNumber ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{g.verifiedBy ?? "—"}</td>
                    <td className="px-4 py-3">
                      {g.status === "pending" && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => verifyMut.mutate(g.id)}
                            disabled={verifyMut.isPending}
                            className="h-6 px-2 text-[10px] text-green-400 hover:text-green-300 hover:bg-green-500/10"
                            data-testid={`button-verify-gate-${g.id}`}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setActingOn({ id: g.id, action: "waive" })}
                            className="h-6 px-2 text-[10px] text-zinc-400 hover:bg-zinc-500/10"
                            data-testid={`button-waive-gate-${g.id}`}
                          >
                            <SkipForward className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setActingOn({ id: g.id, action: "fail" })}
                            className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            data-testid={`button-fail-gate-${g.id}`}
                          >
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
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
