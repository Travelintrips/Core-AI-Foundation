import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Download, FileDown, Package, Clock, CheckCircle2 } from "lucide-react";

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

type AuditLog = {
  id: number;
  module: string;
  action: string;
  resourceId: string | null;
  resourceType: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

function isDownloadEvent(log: AuditLog): boolean {
  const downloadActions = ["download", "file_download", "asset_download", "zip_download", "unlock_files", "files_unlocked", "download_override"];
  return downloadActions.some((a) => log.action.toLowerCase().includes(a)) ||
    (log.module.toLowerCase().includes("download")) ||
    (log.action.toLowerCase() === "view" && (log.resourceType ?? "").toLowerCase().includes("file"));
}

const ACTION_COLOR: Record<string, string> = {
  success: "bg-green-500/15 text-green-400 border-green-500/30",
  failure: "bg-red-500/15 text-red-400 border-red-500/30",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

export default function DownloadsPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["downloads", "audit"],
    queryFn: () => apiFetch<AuditLog[]>("/api/ai/audit-logs?limit=200"),
    refetchInterval: 60_000,
  });

  const downloads = (data ?? []).filter(isDownloadEvent);

  const summary = {
    total: downloads.length,
    success: downloads.filter((d) => d.status === "success").length,
    failed: downloads.filter((d) => d.status === "failure").length,
    recent: downloads.filter((d) => {
      const hourAgo = Date.now() - 3_600_000;
      return new Date(d.createdAt).getTime() > hourAgo;
    }).length,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-downloads">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Download className="w-6 h-6" /> Downloads
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Customer file download events — sourced from canonical audit logs. No synthetic data.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Events", value: summary.total, icon: Download, color: "text-muted-foreground" },
          { label: "Successful", value: summary.success, icon: CheckCircle2, color: "text-green-400" },
          { label: "Failed", value: summary.failed, icon: FileDown, color: "text-red-400" },
          { label: "Last Hour", value: summary.recent, icon: Clock, color: "text-blue-400" },
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
      ) : downloads.length === 0 ? (
        <div className="text-center py-20 space-y-2">
          <Package className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground text-sm">No download events recorded yet.</p>
          <p className="text-xs text-muted-foreground/60">Download events appear here as customers access their files.</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="table-downloads">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Timestamp</th>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-left px-4 py-2.5">Module</th>
                <th className="text-left px-4 py-2.5">Resource</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((d) => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-muted/5" data-testid={`row-download-${d.id}`}>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(d.createdAt).toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{d.action}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{d.module}</td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {d.resourceId ? `${d.resourceType ?? ""}#${d.resourceId}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] border font-mono px-1.5 py-0 h-4 ${ACTION_COLOR[d.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {d.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[200px]" title={JSON.stringify(d.metadata)}>
                    {d.metadata ? JSON.stringify(d.metadata).slice(0, 60) : "—"}
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
