import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, PackageCheck, Unlock, Eye, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

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

type CreativeProject = {
  id: number;
  projectId: string;
  brandName: string;
  businessType: string;
  status: string;
  paymentStatus: string | null;
  filesUnlocked: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Projects eligible for deliverable management are those with files or
 *  in a terminal/near-terminal production state. */
const DELIVERABLE_STATUSES = new Set([
  "workflow_completed", "production_completed", "deliverable_ready",
  "commercial_completed", "completed", "waiting_review", "review_approved",
]);

const STATUS_COLOR: Record<string, string> = {
  deliverable_ready:    "bg-lime-500/15 text-lime-400 border-lime-500/30",
  workflow_completed:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  production_completed: "bg-green-500/15 text-green-400 border-green-500/30",
  commercial_completed: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  completed:            "bg-green-600/15 text-green-500 border-green-600/30",
  waiting_review:       "bg-orange-500/15 text-orange-400 border-orange-500/30",
  review_approved:      "bg-teal-500/15 text-teal-400 border-teal-500/30",
};

export default function DeliverablesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["deliverables"],
    queryFn: () => apiFetch<CreativeProject[]>("/api/creative-ai/projects"),
    refetchInterval: 30_000,
  });

  const unlockMut = useMutation({
    mutationFn: ({ projectId, reason }: { projectId: number; reason: string }) =>
      apiFetch(`/api/ai/payments/project/${projectId}/unlock`, {
        method: "POST",
        body: JSON.stringify({ unlockedBy: "admin", reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliverables"] });
      toast({ title: "Files unlocked — customer can now download." });
    },
    onError: (err: Error) => toast({ title: "Failed to unlock", description: err.message, variant: "destructive" }),
  });

  const projects = (data ?? []).filter(
    (p) => DELIVERABLE_STATUSES.has(p.status) || p.filesUnlocked,
  );

  const summary = {
    total: projects.length,
    unlocked: projects.filter((p) => p.filesUnlocked).length,
    locked: projects.filter((p) => !p.filesUnlocked).length,
    ready: projects.filter((p) => p.status === "deliverable_ready").length,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-deliverables">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <PackageCheck className="w-6 h-6" /> Deliverables
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Projects with deliverables ready — unlock files to allow customer download.
            File unlock is the canonical gate guarding customer access.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Projects", value: summary.total, icon: PackageCheck, color: "text-muted-foreground" },
          { label: "Ready to Deliver", value: summary.ready, icon: CheckCircle2, color: "text-lime-400" },
          { label: "Files Unlocked", value: summary.unlocked, icon: Unlock, color: "text-green-400" },
          { label: "Still Locked", value: summary.locked, icon: Clock, color: "text-yellow-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="border border-border rounded-xl p-3 bg-card/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
              <Icon className={`w-3.5 h-3.5 ${color}`} />
            </div>
            <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          No deliverables ready yet. Projects appear here once workflow is completed.
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="table-deliverables">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Project</th>
                <th className="text-left px-4 py-2.5">Brand</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Payment</th>
                <th className="text-left px-4 py-2.5">Files</th>
                <th className="text-left px-4 py-2.5">Updated</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/5" data-testid={`row-deliverable-${p.projectId}`}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.projectId.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm">{p.brandName}</div>
                    <div className="text-xs text-muted-foreground">{p.businessType}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] border font-mono px-1.5 py-0 h-4 ${STATUS_COLOR[p.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {p.status.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono">
                    <span className={p.paymentStatus === "paid" ? "text-green-400" : "text-yellow-400"}>
                      {p.paymentStatus ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.filesUnlocked ? (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <Unlock className="w-3 h-3" /> Unlocked
                      </span>
                    ) : (
                      <span className="text-xs text-yellow-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Locked
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString("id-ID")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {!p.filesUnlocked && ["deliverable_ready", "workflow_completed", "production_completed", "commercial_completed"].includes(p.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => unlockMut.mutate({ projectId: p.id, reason: "Deliverable approved by admin" })}
                          disabled={unlockMut.isPending}
                          className="h-6 px-2 text-[10px] text-green-400 hover:text-green-300 hover:bg-green-500/10"
                          data-testid={`button-unlock-${p.projectId}`}
                        >
                          <Unlock className="w-3 h-3 mr-1" /> Unlock
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
