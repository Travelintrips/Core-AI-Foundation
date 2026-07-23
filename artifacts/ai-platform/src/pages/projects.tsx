import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, RefreshCw, FolderOpen, Eye, CheckCircle2, Clock, Zap,
  XCircle, AlertTriangle, DollarSign, ArrowUpRight,
} from "lucide-react";
import { Link } from "wouter";

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
  targetMarket: string;
  productOrService: string;
  stylePreference: string | null;
  goal: string;
  status: string;
  paymentStatus: string | null;
  filesUnlocked: boolean;
  createdAt: string;
  updatedAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  waiting_payment:             { label: "Waiting Payment",     color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  in_progress:                 { label: "In Progress",         color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  generating:                  { label: "Generating",          color: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  waiting_review:              { label: "Waiting Review",      color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  review_approved:             { label: "Review Approved",     color: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
  revision_requested:          { label: "Revision Requested",  color: "bg-red-500/15 text-red-400 border-red-500/30" },
  deliverable_ready:           { label: "Deliverable Ready",   color: "bg-lime-500/15 text-lime-400 border-lime-500/30" },
  completed:                   { label: "Completed",           color: "bg-green-500/15 text-green-400 border-green-500/30" },
  cancelled:                   { label: "Cancelled",           color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  failed:                      { label: "Failed",              color: "bg-red-600/15 text-red-500 border-red-600/30" },
  workflow_completed:          { label: "Workflow Completed",  color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  production_completed:        { label: "Production Done",     color: "bg-green-600/15 text-green-500 border-green-600/30" },
  commercial_completed:        { label: "Commercial Done",     color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-muted text-muted-foreground border-border" };
  return (
    <Badge className={`text-[10px] border font-mono px-1.5 py-0 h-4 ${cfg.color}`} data-testid={`status-badge-${status}`}>
      {cfg.label}
    </Badge>
  );
}

const FILTERS = ["all", "in_progress", "waiting_review", "deliverable_ready", "completed", "failed"] as const;
type Filter = typeof FILTERS[number];

export default function Projects() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiFetch<CreativeProject[]>("/api/creative-ai/projects"),
    refetchInterval: 30_000,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/creative-ai/projects/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project cancelled." });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const projects = (data ?? [])
    .filter((p) => filter === "all" || p.status === filter)
    .filter((p) =>
      !search ||
      p.brandName.toLowerCase().includes(search.toLowerCase()) ||
      p.projectId.toLowerCase().includes(search.toLowerCase()),
    );

  const counts = {
    all: data?.length ?? 0,
    in_progress: data?.filter((p) => p.status === "in_progress").length ?? 0,
    waiting_review: data?.filter((p) => p.status === "waiting_review").length ?? 0,
    deliverable_ready: data?.filter((p) => p.status === "deliverable_ready").length ?? 0,
    completed: data?.filter((p) => p.status === "completed").length ?? 0,
    failed: data?.filter((p) => p.status === "failed").length ?? 0,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-projects">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FolderOpen className="w-6 h-6" /> Creative Projects
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            All creative AI projects — lifecycle from brief to final delivery.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-projects">
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`filter-${f}`}
          >
            {f === "all" ? "All" : STATUS_CONFIG[f]?.label ?? f} ({counts[f]})
          </button>
        ))}
        <input
          type="text"
          placeholder="Search brand or project ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/20 focus:outline-none focus:ring-1 focus:ring-primary w-56"
          data-testid="input-search-projects"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          No projects found.
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="table-projects">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Project</th>
                <th className="text-left px-4 py-2.5">Brand</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Payment</th>
                <th className="text-left px-4 py-2.5">Files</th>
                <th className="text-left px-4 py-2.5">Created</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/5 transition-colors" data-testid={`row-project-${p.projectId}`}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {p.projectId.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm">{p.brandName}</div>
                    <div className="text-xs text-muted-foreground">{p.businessType}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-mono ${
                      p.paymentStatus === "paid" ? "text-green-400" :
                      p.paymentStatus === "partial" ? "text-yellow-400" : "text-muted-foreground"
                    }`}>
                      {p.paymentStatus ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.filesUnlocked ? (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Unlocked
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Locked
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                    {new Date(p.createdAt).toLocaleDateString("id-ID")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Link href={`/production-pipeline`}>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" data-testid={`button-view-pipeline-${p.projectId}`}>
                          <Zap className="w-3 h-3 mr-1" /> Pipeline
                        </Button>
                      </Link>
                      {!["completed", "cancelled", "failed"].includes(p.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cancelMut.mutate(p.projectId)}
                          disabled={cancelMut.isPending}
                          className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          data-testid={`button-cancel-${p.projectId}`}
                        >
                          <XCircle className="w-3 h-3" />
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
