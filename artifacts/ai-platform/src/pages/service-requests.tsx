import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import {
  Loader2, RefreshCw, FileText, ClipboardList, Calculator,
  Send, ThumbsUp, ShieldCheck, Zap, Eye, CheckCircle2, XCircle,
  ChevronDown, ChevronRight,
} from "lucide-react";

// Use empty string so fetch("/api/...") goes through the Vite /api proxy,
// not "/admin/api/..." which bypasses it.
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

// ── Stage config ──────────────────────────────────────────────────────────────

type Stage = {
  key: string;
  label: string;
  statuses: string[];
  icon: typeof FileText;
  color: string;
  bg: string;
};

const STAGES: Stage[] = [
  { key: "new",          label: "Permintaan Baru",         statuses: ["draft"],                         icon: FileText,    color: "text-slate-600",   bg: "bg-slate-100 dark:bg-slate-900/30" },
  { key: "brief",        label: "Brief In Progress",        statuses: ["brief_in_progress"],              icon: ClipboardList, color: "text-blue-600",    bg: "bg-blue-50 dark:bg-blue-950/30" },
  { key: "brief_done",   label: "Brief Selesai",            statuses: ["brief_completed"],                icon: ClipboardList, color: "text-indigo-600",  bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  { key: "pricing",      label: "Harga Dikalkulasi",        statuses: ["quoted"],                         icon: Calculator,  color: "text-violet-600",  bg: "bg-violet-50 dark:bg-violet-950/30" },
  { key: "quotation",    label: "Penawaran Siap",           statuses: ["quotation_ready"],                icon: Send,        color: "text-amber-600",   bg: "bg-amber-50 dark:bg-amber-950/30" },
  { key: "waiting",      label: "Menunggu Persetujuan",     statuses: ["waiting_customer_approval"],      icon: ThumbsUp,    color: "text-orange-600",  bg: "bg-orange-50 dark:bg-orange-950/30" },
  { key: "approved",     label: "Disetujui Customer",       statuses: ["approved"],                       icon: ThumbsUp,    color: "text-lime-600",    bg: "bg-lime-50 dark:bg-lime-950/30" },
  { key: "gate",         label: "Menunggu Gate Komersial",  statuses: ["waiting_commercial_gate"],        icon: ShieldCheck, color: "text-teal-600",    bg: "bg-teal-50 dark:bg-teal-950/30" },
  { key: "build",        label: "Siap Produksi",            statuses: ["ready_to_build"],                 icon: Zap,         color: "text-cyan-600",    bg: "bg-cyan-50 dark:bg-cyan-950/30" },
  { key: "production",   label: "Sedang Diproduksi",        statuses: ["in_progress", "orchestrating"],   icon: Zap,         color: "text-sky-600",     bg: "bg-sky-50 dark:bg-sky-950/30" },
  { key: "review",       label: "Menunggu Review",          statuses: ["waiting_review"],                 icon: Eye,         color: "text-purple-600",  bg: "bg-purple-50 dark:bg-purple-950/30" },
  { key: "completed",    label: "Selesai",                  statuses: ["completed", "converted_to_project"], icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/30" },
  { key: "cancelled",    label: "Dibatalkan",               statuses: ["cancelled", "revision_requested"],   icon: XCircle,    color: "text-red-500",    bg: "bg-red-50 dark:bg-red-950/30" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceRequest = {
  id: number;
  requestId: string;
  serviceId: number;
  customerName: string;
  customerEmail: string;
  companyName: string | null;
  currency: string;
  total: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceRequestsPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["new", "brief", "brief_done", "pricing", "waiting", "approved", "gate", "production"]));

  const { data: requests = [], isLoading, refetch, isFetching } = useQuery<ServiceRequest[]>({
    queryKey: ["service-requests"],
    queryFn: () => apiFetch<ServiceRequest[]>("/api/ai/catalog/requests"),
    refetchInterval: 30_000,
  });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Group requests by stage
  const byStage = new Map<string, ServiceRequest[]>();
  for (const stage of STAGES) byStage.set(stage.key, []);

  for (const req of requests) {
    const stage = STAGES.find((s) => s.statuses.includes(req.status));
    const key = stage?.key ?? "new";
    byStage.get(key)!.push(req);
  }

  const total = requests.length;
  const completedCount = byStage.get("completed")?.length ?? 0;
  const inProgressCount = (byStage.get("production")?.length ?? 0) + (byStage.get("build")?.length ?? 0);

  return (
    <Layout>
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Service Request Funnel</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {total} total · {completedCount} selesai · {inProgressCount} sedang berjalan
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {STAGES.map((stage) => {
              const items = byStage.get(stage.key) ?? [];
              const isOpen = expanded.has(stage.key);
              const StageIcon = stage.icon;

              return (
                <div key={stage.key} className="border border-border rounded-xl overflow-hidden">
                  {/* Stage header */}
                  <button
                    onClick={() => toggle(stage.key)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${stage.bg}`}>
                      <StageIcon className={`w-3.5 h-3.5 ${stage.color}`} />
                    </div>
                    <span className="font-medium text-sm flex-1">{stage.label}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${items.length > 0 ? `${stage.bg} ${stage.color}` : "bg-muted text-muted-foreground"}`}>
                      {items.length}
                    </span>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {/* Request rows */}
                  {isOpen && items.length > 0 && (
                    <div className="border-t border-border divide-y divide-border">
                      {items.map((req) => (
                        <div key={req.id} className="flex items-center gap-4 px-4 py-3 bg-muted/10 hover:bg-muted/20 transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{req.customerName}</p>
                            <p className="text-xs text-muted-foreground truncate">{req.customerEmail}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold">
                              {req.currency === "IDR"
                                ? `Rp${Math.round(parseFloat(req.total)).toLocaleString("id-ID")}`
                                : `${req.currency} ${parseFloat(req.total).toLocaleString()}`}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">{req.requestId.slice(0, 8)}</p>
                          </div>
                          <div className="shrink-0">
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${stage.bg} ${stage.color}`}>
                              {req.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                            {new Date(req.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {isOpen && items.length === 0 && (
                    <div className="border-t border-border px-4 py-4 bg-muted/5">
                      <p className="text-xs text-muted-foreground text-center">Tidak ada permintaan di tahap ini</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
