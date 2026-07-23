import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Bell, AlertTriangle, CheckCircle2, XCircle, DollarSign, Eye, RotateCcw, FileDown, Info } from "lucide-react";

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

type NotificationLevel = "critical" | "warning" | "info" | "success";

type Notification = {
  id: number;
  level: NotificationLevel;
  title: string;
  body: string;
  source: string;
  createdAt: string;
  read: boolean;
};

const CRITICAL_ACTIONS = ["worker_failed", "renderer_failed", "workflow_failed", "payment_rejected", "job_failed", "failed"];
const WARNING_ACTIONS = ["payment_uploaded", "revision_requested", "review_needed", "waiting_payment_verification"];
const SUCCESS_ACTIONS = ["payment_verified", "files_unlocked", "unlock_files", "review_approved", "completed", "verified"];
const INFO_ACTIONS = ["download", "customer_download", "approval", "publish", "created", "updated"];

function classifyAuditLog(log: AuditLog): { level: NotificationLevel; title: string; body: string } | null {
  const action = log.action.toLowerCase();
  const mod = log.module.toLowerCase();

  if (log.status === "failure" || CRITICAL_ACTIONS.some((a) => action.includes(a))) {
    return { level: "critical", title: `${log.module}: ${log.action}`, body: `Resource: ${log.resourceType ?? ""}#${log.resourceId ?? "?"} — ${JSON.stringify(log.metadata ?? {}).slice(0, 80)}` };
  }
  if (WARNING_ACTIONS.some((a) => action.includes(a))) {
    return { level: "warning", title: `Action Required: ${log.action}`, body: `${log.module} — ${log.resourceType ?? ""}#${log.resourceId ?? "?"}` };
  }
  if (SUCCESS_ACTIONS.some((a) => action.includes(a))) {
    return { level: "success", title: `${log.action.replace(/_/g, " ")}`, body: `${log.module} — ${log.resourceType ?? ""}#${log.resourceId ?? "?"}` };
  }
  if (INFO_ACTIONS.some((a) => action.includes(a))) {
    return { level: "info", title: `${log.action.replace(/_/g, " ")}`, body: `${log.module} — ${log.resourceId ?? "?"}` };
  }
  return null;
}

const LEVEL_CONFIG: Record<NotificationLevel, { color: string; dot: string; icon: typeof Bell; badge: string }> = {
  critical: { color: "border-red-500/30 bg-red-500/5",    dot: "bg-red-500",    icon: XCircle,        badge: "bg-red-500/15 text-red-400 border-red-500/30" },
  warning:  { color: "border-yellow-500/30 bg-yellow-500/5", dot: "bg-yellow-500", icon: AlertTriangle, badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  success:  { color: "border-green-500/30 bg-green-500/5", dot: "bg-green-500",  icon: CheckCircle2,   badge: "bg-green-500/15 text-green-400 border-green-500/30" },
  info:     { color: "border-border/50 bg-muted/5",        dot: "bg-blue-500",   icon: Info,           badge: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
};

const FILTERS: Array<{ key: NotificationLevel | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "success", label: "Success" },
  { key: "info", label: "Info" },
];

export default function AdminNotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<NotificationLevel | "all">("all");
  const [readIds, setReadIds] = useState<Set<number>>(new Set());

  const { data: logs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["notifications", "audit"],
    queryFn: () => apiFetch<AuditLog[]>("/api/ai/audit-logs?limit=200"),
    refetchInterval: 30_000,
  });

  const notifications: Notification[] = (logs ?? [])
    .map((log) => {
      const classified = classifyAuditLog(log);
      if (!classified) return null;
      return { id: log.id, ...classified, source: log.module, createdAt: log.createdAt, read: readIds.has(log.id) };
    })
    .filter(Boolean) as Notification[];

  const filtered = notifications.filter((n) => filter === "all" || n.level === filter);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const criticalCount = notifications.filter((n) => n.level === "critical").length;

  function markRead(id: number) {
    setReadIds((prev) => new Set(prev).add(id));
  }
  function markAllRead() {
    setReadIds(new Set(notifications.map((n) => n.id)));
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" data-testid="page-notifications">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Notifications
            {unreadCount > 0 && (
              <span className="text-sm bg-red-500 text-white rounded-full px-2 py-0.5 font-mono font-bold">
                {unreadCount}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Admin notifications derived from canonical audit log events. No synthetic data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead} data-testid="button-mark-all-read">
              Mark all read
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {criticalCount > 0 && (
        <div className="flex items-center gap-2 p-3 border border-red-500/30 bg-red-500/5 rounded-xl text-sm">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-red-400 font-medium">{criticalCount} critical event{criticalCount > 1 ? "s" : ""} require attention.</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(({ key, label }) => {
          const count = key === "all" ? notifications.length : notifications.filter((n) => n.level === key).length;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`filter-notif-${key}`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 space-y-2">
          <Bell className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground text-sm">No notifications in this category.</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="list-notifications">
          {filtered.map((n) => {
            const cfg = LEVEL_CONFIG[n.level];
            const Icon = cfg.icon;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-4 border rounded-xl transition-all cursor-pointer ${cfg.color} ${n.read ? "opacity-60" : ""}`}
                onClick={() => markRead(n.id)}
                data-testid={`notif-${n.id}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  <Icon className={`w-4 h-4 ${n.level === "critical" ? "text-red-400" : n.level === "warning" ? "text-yellow-400" : n.level === "success" ? "text-green-400" : "text-blue-400"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium truncate">{n.title}</span>
                    <Badge className={`text-[9px] border font-mono px-1 py-0 h-3.5 flex-shrink-0 ${cfg.badge}`}>
                      {n.level}
                    </Badge>
                    {!n.read && (
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{n.body}</p>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground whitespace-nowrap flex-shrink-0">
                  {new Date(n.createdAt).toLocaleString("id-ID")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
