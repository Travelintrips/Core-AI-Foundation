/**
 * Phase 6B — Batch Detail / Result Gallery
 * Route: /design-render-batches/:id
 */
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  AlertTriangle, Download, RotateCcw, StopCircle, Archive, ExternalLink,
  ImageIcon, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { batchApi, type DesignRenderBatch, type DesignRenderItem } from "@/services/design-batch-api";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:      { label: "Draft",      color: "text-gray-400" },
  queued:     { label: "Queued",     color: "text-blue-400" },
  processing: { label: "Processing", color: "text-indigo-400" },
  completed:  { label: "Completed",  color: "text-green-400" },
  failed:     { label: "Failed",     color: "text-red-400" },
  cancelled:  { label: "Cancelled",  color: "text-gray-500" },
};

const POLL_INTERVAL = 5000;

// ── Result thumbnail ───────────────────────────────────────────────────────────

function ResultThumbnail({ item }: { item: DesignRenderItem }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`rounded-xl border overflow-hidden ${
      item.status === "completed" ? "border-gray-700" :
      item.status === "failed"    ? "border-red-500/30 bg-red-500/5" :
      "border-gray-800 bg-gray-900/30"
    }`}>
      {/* Image area */}
      <div className="aspect-square bg-gray-900 flex items-center justify-center relative">
        {item.status === "completed" && item.outputUrl && !imgError ? (
          <img
            src={item.outputUrl}
            alt={`Row ${item.rowIndex + 1}`}
            className="w-full h-full object-contain"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : item.status === "processing" ? (
          <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
        ) : item.status === "queued" ? (
          <Clock className="h-6 w-6 text-gray-600" />
        ) : item.status === "failed" ? (
          <XCircle className="h-6 w-6 text-red-400" />
        ) : (
          <ImageIcon className="h-6 w-6 text-gray-700" />
        )}

        {/* Download overlay */}
        {item.status === "completed" && item.outputUrl && (
          <a
            href={item.outputUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          >
            <Download className="h-5 w-5 text-white" />
          </a>
        )}
      </div>

      {/* Footer */}
      <div className="px-2 py-1.5 bg-gray-900/60">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500">Row {item.rowIndex + 1}</span>
          <span className={`text-[11px] font-medium ${STATUS_CFG[item.status]?.color ?? "text-gray-400"}`}>
            {STATUS_CFG[item.status]?.label ?? item.status}
          </span>
        </div>
        {item.status === "failed" && item.errorMessage && (
          <p className="text-[10px] text-red-400 mt-0.5 truncate" title={item.errorMessage}>
            {item.errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DesignRenderBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const batchId = parseInt(id ?? "", 10);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [itemsPage, setItemsPage] = useState(1);
  const [itemsFilter, setItemsFilter] = useState<string>("all");
  const ITEMS_PER_PAGE = 24;

  // Batch polling
  const { data: batch, isLoading: batchLoading, refetch: refetchBatch } = useQuery<DesignRenderBatch>({
    queryKey: ["design-render-batch", batchId],
    queryFn: () => batchApi.get(batchId),
    enabled: !isNaN(batchId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "processing" || s === "queued" ? POLL_INTERVAL : false;
    },
    refetchIntervalInBackground: false,
  });

  // Items polling
  const { data: itemsData, isLoading: itemsLoading, refetch: refetchItems } = useQuery({
    queryKey: ["design-render-batch-items", batchId, itemsFilter, itemsPage],
    queryFn: () => batchApi.getItems(batchId, {
      page: itemsPage,
      pageSize: ITEMS_PER_PAGE,
      status: itemsFilter !== "all" ? itemsFilter : undefined,
    }),
    enabled: !isNaN(batchId),
    refetchInterval: (query) => {
      // Stop polling on tab hidden is browser-native; just use a reasonable interval
      return batch?.status === "processing" || batch?.status === "queued" ? POLL_INTERVAL : false;
    },
    refetchIntervalInBackground: false,
  });

  // Actions
  const cancelMutation = useMutation({
    mutationFn: () => batchApi.cancel(batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-render-batch", batchId] });
      toast({ title: "Batch cancelled" });
    },
    onError: (e: Error) => toast({ title: "Failed to cancel", description: e.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: () => batchApi.retryFailed(batchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-render-batch", batchId] });
      qc.invalidateQueries({ queryKey: ["design-render-batch-items", batchId] });
      toast({ title: "Failed items re-queued" });
    },
    onError: (e: Error) => toast({ title: "Failed to retry", description: e.message, variant: "destructive" }),
  });

  const zipMutation = useMutation({
    mutationFn: () => batchApi.requestZip(batchId),
    onSuccess: () => toast({ title: "ZIP export queued", description: "You'll be notified when ready." }),
    onError: (e: Error) => toast({ title: "Failed to request ZIP", description: e.message, variant: "destructive" }),
  });

  const [confirmCancel, setConfirmCancel] = useState(false);

  if (batchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="p-6 text-center text-gray-500">
        Batch not found.
        <button onClick={() => navigate("/design-render-batches")} className="ml-2 text-indigo-400 hover:underline">Go back</button>
      </div>
    );
  }

  const isActive = batch.status === "processing" || batch.status === "queued";
  const pct = batch.totalItems > 0
    ? Math.round(((batch.completedItems + batch.failedItems) / batch.totalItems) * 100)
    : 0;

  const items = itemsData?.items ?? [];
  const totalItems = itemsData?.total ?? 0;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate("/design-render-batches")} className="mt-1 text-gray-500 hover:text-gray-300">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{batch.name}</h1>
              <span className={`text-sm font-medium ${STATUS_CFG[batch.status]?.color ?? "text-gray-400"}`}>
                {STATUS_CFG[batch.status]?.label ?? batch.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Template #{batch.templateId} · v{batch.templateVersionId} · {batch.requestedFormat.toUpperCase()} · Created {new Date(batch.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { refetchBatch(); refetchItems(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          {batch.status === "completed" && (
            <Button size="sm" variant="outline" onClick={() => zipMutation.mutate()} disabled={zipMutation.isPending}>
              <Archive className="h-3.5 w-3.5 mr-1" />
              {zipMutation.isPending ? "Queuing…" : "Export ZIP"}
            </Button>
          )}
          {batch.failedItems > 0 && (batch.status === "completed" || batch.status === "failed") && (
            <Button size="sm" variant="outline" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {retryMutation.isPending ? "Retrying…" : `Retry Failed (${batch.failedItems})`}
            </Button>
          )}
          {isActive && (
            <>
              {!confirmCancel ? (
                <Button size="sm" variant="destructive" onClick={() => setConfirmCancel(true)}>
                  <StopCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-400">Confirm?</span>
                  <Button size="sm" variant="destructive" onClick={() => { cancelMutation.mutate(); setConfirmCancel(false); }} disabled={cancelMutation.isPending}>
                    Yes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>No</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Progress section */}
      <div className="rounded-2xl bg-gray-900/40 border border-gray-800 p-6 mb-6">
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[
            { label: "Total",     value: batch.totalItems,     color: "text-gray-300" },
            { label: "Completed", value: batch.completedItems, color: "text-green-400" },
            { label: "Failed",    value: batch.failedItems,    color: batch.failedItems > 0 ? "text-red-400" : "text-gray-500" },
            { label: "Progress",  value: `${pct}%`,             color: "text-indigo-400" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        {isActive && (
          <Progress value={pct} className="h-2 bg-gray-800" />
        )}
      </div>

      {/* Result gallery */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Result Gallery</h2>
          <div className="flex gap-1.5">
            {["all", "completed", "failed", "queued", "processing"].map((s) => (
              <button
                key={s}
                onClick={() => { setItemsFilter(s); setItemsPage(1); }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  itemsFilter === s ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {itemsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 rounded-xl border border-dashed border-gray-800">
            <p className="text-gray-500 text-sm">No items match this filter.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {items.map((item) => <ResultThumbnail key={item.id} item={item} />)}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <Button
                  variant="ghost" size="sm"
                  disabled={itemsPage <= 1}
                  onClick={() => setItemsPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-gray-500">{itemsPage} / {totalPages}</span>
                <Button
                  variant="ghost" size="sm"
                  disabled={itemsPage >= totalPages}
                  onClick={() => setItemsPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
