import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, History, CheckCircle2, XCircle, AlertTriangle, DollarSign, Unlock, RotateCcw, FileDown, Eye, Info } from "lucide-react";

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

type TimelineGroup = {
  date: string;
  events: AuditLog[];
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  success: CheckCircle2,
  failure: XCircle,
  pending: AlertTriangle,
};

const ACTION_ICON_MAP: Array<[string[], typeof CheckCircle2]> = [
  [["payment_verified", "verify"], DollarSign],
  [["unlock", "files_unlocked"], Unlock],
  [["revision"], RotateCcw],
  [["download", "export"], FileDown],
  [["review", "view"], Eye],
  [["failed", "failure"], XCircle],
  [["completed", "success"], CheckCircle2],
];

function getActionIcon(action: string, status: string): typeof CheckCircle2 {
  if (status === "failure") return XCircle;
  const lower = action.toLowerCase();
  for (const [patterns, icon] of ACTION_ICON_MAP) {
    if (patterns.some((p) => lower.includes(p))) return icon;
  }
  return INFO_ICON;
}

function INFO_ICON(props: React.SVGProps<SVGSVGElement>) {
  return <Info {...(props as Parameters<typeof Info>[0])} />;
}

const STATUS_DOT: Record<string, string> = {
  success: "bg-green-400",
  failure: "bg-red-400",
  pending: "bg-yellow-400",
};

const STATUS_COLOR: Record<string, string> = {
  success: "text-green-400",
  failure: "text-red-400",
  pending: "text-yellow-400",
};

function groupByDate(logs: AuditLog[]): TimelineGroup[] {
  const map = new Map<string, AuditLog[]>();
  for (const log of logs) {
    const d = new Date(log.createdAt).toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const arr = map.get(d) ?? [];
    arr.push(log);
    map.set(d, arr);
  }
  return Array.from(map.entries()).map(([date, events]) => ({ date, events }));
}

const MODULE_FILTERS = ["all", "payment", "creative-ai", "commercial-gates", "ai-jobs", "auth", "admin"] as const;
type ModuleFilter = typeof MODULE_FILTERS[number];

export default function OperationsTimelinePage() {
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failure">("all");

  const { data: logs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["timeline", "audit"],
    queryFn: () => apiFetch<AuditLog[]>("/api/ai/audit-logs?limit=200"),
    refetchInterval: 30_000,
  });

  const filtered = (logs ?? []).filter((log) => {
    if (moduleFilter !== "all" && !log.module.toLowerCase().includes(moduleFilter)) return false;
    if (statusFilter !== "all" && log.status !== statusFilter) return false;
    return true;
  });

  const groups = groupByDate(filtered);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" data-testid="page-operations-timeline">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <History className="w-6 h-6" /> Operations Timeline
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Chronological timeline of all admin operations — sourced from real audit events only.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {MODULE_FILTERS.map((m) => (
            <button
              key={m}
              onClick={() => setModuleFilter(m)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                moduleFilter === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`filter-module-${m}`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {(["all", "success", "failure"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`filter-status-${s}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">No events match the current filters.</div>
      ) : (
        <div className="space-y-8" data-testid="timeline-groups">
          {groups.map((group) => (
            <div key={group.date}>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="flex-1 border-b border-border/50" />
                <span className="px-2">{group.date}</span>
                <span className="flex-1 border-b border-border/50" />
              </div>
              <div className="relative space-y-1 ml-4" data-testid={`group-${group.date}`}>
                {/* vertical line */}
                <div className="absolute top-2 bottom-2 left-[7px] w-px bg-border/50" />

                {group.events.map((log, idx) => {
                  const Icon = getActionIcon(log.action, log.status);
                  const dot = STATUS_DOT[log.status] ?? "bg-muted-foreground";
                  const textColor = STATUS_COLOR[log.status] ?? "text-muted-foreground";
                  return (
                    <div key={log.id} className="relative flex items-start gap-3 pl-6 py-2 hover:bg-muted/5 rounded-lg transition-colors group" data-testid={`timeline-event-${log.id}`}>
                      {/* dot */}
                      <div className={`absolute left-0 top-3 w-3.5 h-3.5 rounded-full border-2 border-background flex-shrink-0 ${dot}`} />

                      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${textColor}`} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{log.action.replace(/_/g, " ")}</span>
                          <Badge className={`text-[9px] border font-mono px-1 py-0 h-3.5 ${
                            log.status === "success" ? "bg-green-500/15 text-green-400 border-green-500/30" :
                            log.status === "failure" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                            "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
                          }`}>
                            {log.status}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground font-mono">{log.module}</span>
                        </div>
                        {(log.resourceId || log.resourceType) && (
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">
                            {log.resourceType && `${log.resourceType}`}{log.resourceId && `#${log.resourceId}`}
                          </div>
                        )}
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <div className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">
                            {JSON.stringify(log.metadata).slice(0, 80)}
                          </div>
                        )}
                      </div>

                      <div className="text-[10px] font-mono text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {new Date(log.createdAt).toLocaleTimeString("id-ID")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
