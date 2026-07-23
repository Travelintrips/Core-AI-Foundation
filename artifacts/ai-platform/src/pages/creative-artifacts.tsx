import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Image, FileStack, CheckCircle2, Clock, XCircle, Eye } from "lucide-react";

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

type CreativeAsset = {
  id: number;
  assetId: string;
  projectId: string;
  assetType: string;
  status: string;
  imageUrl: string | null;
  prompt: string | null;
  qcScore: number | null;
  assetPurpose: string | null;
  isPublished: boolean | null;
  createdAt: string;
};

type CreativeProject = {
  id: number;
  projectId: string;
  brandName: string;
  status: string;
};

const ASSET_STATUS: Record<string, { label: string; color: string }> = {
  pending:       { label: "Pending",       color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  generating:    { label: "Generating",    color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  generated:     { label: "Generated",     color: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  qc_passed:     { label: "QC Passed",     color: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
  qc_failed:     { label: "QC Failed",     color: "bg-red-500/15 text-red-400 border-red-500/30" },
  approved:      { label: "Approved",      color: "bg-green-500/15 text-green-400 border-green-500/30" },
  needs_review:  { label: "Needs Review",  color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  failed:        { label: "Failed",        color: "bg-red-600/15 text-red-500 border-red-600/30" },
};

export default function CreativeArtifactsPage() {
  const [selectedProject, setSelectedProject] = useState<string>("all");

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ["artifacts-projects"],
    queryFn: () => apiFetch<CreativeProject[]>("/api/creative-ai/projects"),
    refetchInterval: 60_000,
  });

  const { data: assets, isLoading: assetsLoading, refetch, isFetching } = useQuery({
    queryKey: ["artifacts", selectedProject],
    queryFn: async () => {
      if (selectedProject === "all") {
        const projs = await apiFetch<CreativeProject[]>("/api/creative-ai/projects");
        const results = await Promise.all(
          projs.slice(0, 20).map((p) =>
            apiFetch<CreativeAsset[]>(`/api/creative-ai/projects/${p.projectId}/assets`).catch(() => []),
          ),
        );
        return results.flat();
      }
      return apiFetch<CreativeAsset[]>(`/api/creative-ai/projects/${selectedProject}/assets`);
    },
    refetchInterval: 30_000,
  });

  const isLoading = projectsLoading || assetsLoading;

  const summary = {
    total: assets?.length ?? 0,
    approved: assets?.filter((a) => a.status === "approved" || a.status === "qc_passed").length ?? 0,
    published: assets?.filter((a) => a.isPublished).length ?? 0,
    failed: assets?.filter((a) => a.status === "failed" || a.status === "qc_failed").length ?? 0,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-artifacts">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileStack className="w-6 h-6" /> Artifacts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Creative AI assets — generated images, designs, and deliverable files.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/20 focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="select-project-filter"
          >
            <option value="all">All Projects (recent 20)</option>
            {(projects ?? []).map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.brandName} ({p.projectId.slice(0, 8)})
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Assets", value: summary.total, icon: FileStack, color: "text-muted-foreground" },
          { label: "Approved/QC Passed", value: summary.approved, icon: CheckCircle2, color: "text-green-400" },
          { label: "Published", value: summary.published, icon: Eye, color: "text-blue-400" },
          { label: "Failed", value: summary.failed, icon: XCircle, color: "text-red-400" },
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
      ) : (assets ?? []).length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">No assets found.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" data-testid="grid-artifacts">
          {(assets ?? []).map((a) => {
            const cfg = ASSET_STATUS[a.status];
            return (
              <div key={a.id} className="border border-border rounded-xl overflow-hidden bg-card/40 hover:border-primary/50 transition-colors" data-testid={`card-asset-${a.assetId}`}>
                {a.imageUrl ? (
                  <div className="aspect-square bg-muted/20 overflow-hidden">
                    <img src={a.imageUrl} alt={a.assetType} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ) : (
                  <div className="aspect-square bg-muted/20 flex items-center justify-center">
                    <Image className="w-8 h-8 text-muted-foreground/30" />
                  </div>
                )}
                <div className="p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium truncate">{a.assetType}</span>
                    <Badge className={`text-[9px] border font-mono px-1 py-0 h-3.5 flex-shrink-0 ${cfg?.color ?? "bg-muted text-muted-foreground border-border"}`}>
                      {cfg?.label ?? a.status}
                    </Badge>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {a.projectId.slice(0, 8)}…
                  </div>
                  {a.qcScore != null && (
                    <div className={`text-[10px] font-mono ${a.qcScore >= 80 ? "text-green-400" : "text-red-400"}`}>
                      QC: {a.qcScore}/100
                    </div>
                  )}
                  {a.isPublished && (
                    <div className="text-[10px] text-blue-400 flex items-center gap-0.5">
                      <Eye className="w-2.5 h-2.5" /> Published
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
