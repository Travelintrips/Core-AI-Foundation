/**
 * Phase 6B — Batch List / Monitoring
 * Route: /design-render-batches
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Plus, RefreshCw, Layers, CheckCircle2, XCircle,
  Clock, Loader2, AlertTriangle, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { batchApi, type DesignRenderBatch } from "@/services/design-batch-api";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:      { label: "Draft",      color: "text-gray-400",   icon: Layers },
  queued:     { label: "Queued",     color: "text-blue-400",   icon: Clock },
  processing: { label: "Processing", color: "text-indigo-400", icon: Loader2 },
  completed:  { label: "Completed",  color: "text-green-400",  icon: CheckCircle2 },
  failed:     { label: "Failed",     color: "text-red-400",    icon: XCircle },
  cancelled:  { label: "Cancelled",  color: "text-gray-500",   icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "text-gray-400", icon: AlertTriangle };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "processing" ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  );
}

function progressPercent(batch: DesignRenderBatch): number {
  if (batch.totalItems === 0) return 0;
  return Math.round(((batch.completedItems + batch.failedItems) / batch.totalItems) * 100);
}

// ── Batch row ──────────────────────────────────────────────────────────────────

function BatchRow({ batch }: { batch: DesignRenderBatch }) {
  const pct = progressPercent(batch);
  const isActive = batch.status === "processing" || batch.status === "queued";

  return (
    <Link href={`/design-render-batches/${batch.id}`}>
      <div className="flex items-center gap-4 px-5 py-4 rounded-xl border border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900/60 cursor-pointer transition-colors group">
        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-gray-200 truncate">{batch.name}</span>
            <StatusBadge status={batch.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Template #{batch.templateId}</span>
            <span>·</span>
            <span>{batch.totalItems.toLocaleString()} items</span>
            <span>·</span>
            <span>{batch.requestedFormat.toUpperCase()}</span>
            <span>·</span>
            <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
          </div>

          {/* Progress bar (for active batches) */}
          {isActive && (
            <div className="mt-2">
              <Progress value={pct} className="h-1.5 bg-gray-800" />
              <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                <span>{batch.completedItems} done, {batch.failedItems} failed</span>
                <span>{pct}%</span>
              </div>
            </div>
          )}

          {/* Completed summary */}
          {batch.status === "completed" && (
            <div className="flex gap-3 mt-1.5">
              <span className="text-xs text-green-400">{batch.completedItems} ✓</span>
              {batch.failedItems > 0 && <span className="text-xs text-red-400">{batch.failedItems} ✗</span>}
            </div>
          )}
        </div>

        {/* Right: arrow */}
        <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-400 shrink-0" />
      </div>
    </Link>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 8000; // 8 s for active batches

export default function DesignRenderBatchesPage() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["design-render-batches", statusFilter, page],
    queryFn: () => batchApi.list({ status: statusFilter !== "all" ? statusFilter : undefined, page, pageSize: 20 }),
    refetchInterval: (query) => {
      // Poll while any active batch exists
      const batches = query.state.data?.items ?? [];
      const hasActive = batches.some((b) => b.status === "processing" || b.status === "queued");
      return hasActive ? POLL_INTERVAL : false;
    },
    refetchIntervalInBackground: false,
  });

  const batches = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Bulk Render Batches</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create and monitor batch rendering jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => navigate("/design-render-batches/new")}>
            <Plus className="h-4 w-4 mr-1" /> New Batch
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total", value: data.total },
            { label: "Active", value: batches.filter((b) => b.status === "processing" || b.status === "queued").length },
            { label: "Completed", value: batches.filter((b) => b.status === "completed").length },
            { label: "Failed", value: batches.filter((b) => b.status === "failed").length },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-3 bg-gray-900/40 border border-gray-800 text-center">
              <div className="text-xl font-bold text-gray-200">{s.value}</div>
              <div className="text-[11px] text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {["all", "queued", "processing", "completed", "failed", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Batch list */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-gray-800">
          <Layers className="h-10 w-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No batches yet</p>
          <p className="text-sm text-gray-600 mb-4">Upload a dataset to start bulk rendering.</p>
          <Button size="sm" onClick={() => navigate("/design-render-batches/new")}>
            <Plus className="h-4 w-4 mr-1" /> New Batch
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map((batch) => <BatchRow key={batch.id} batch={batch} />)}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
