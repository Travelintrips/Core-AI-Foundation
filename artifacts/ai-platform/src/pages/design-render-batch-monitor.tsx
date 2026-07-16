/**
 * Batch Monitoring Page — /design-render-batches/:id
 *
 * Polls GET /ai/design-render-batches/:id every 3s until terminal state.
 * Shows progress bar, item list (paginated, filterable), cancel/retry actions.
 * ZIP export: POST export-zip → poll status → show download link (with expiry warning).
 */

import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, RefreshCw, XCircle, Download, Loader2,
  CheckCircle2, AlertTriangle, Clock, Ban, Package,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── API helper ─────────────────────────────────────────────────────────────────

const API_BASE = "";
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BatchStatus {
  id: number;
  name: string;
  status: "draft" | "queued" | "processing" | "completed" | "failed" | "partially_failed" | "cancelled";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  cancelledItems: number;
  queuedItems?: number;
  processingItems?: number;
  requestedFormat: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface RenderItem {
  id: number;
  rowIndex: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  outputUrl?: string | null;
  errorMessage?: string | null;
  attemptCount?: number;
  completedAt?: string | null;
}

interface ItemsPage {
  items: RenderItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface ZipStatus {
  status: "pending" | "processing" | "completed" | "failed" | "not_implemented";
  signedUrl?: string;
  expiresAt?: string;
  error?: string;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "partially_failed", "cancelled"]);
const POLL_INTERVAL_MS = 3000;

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft:            "bg-gray-100 text-gray-700",
  queued:           "bg-blue-100 text-blue-700",
  processing:       "bg-amber-100 text-amber-700",
  completed:        "bg-green-100 text-green-700",
  failed:           "bg-red-100 text-red-700",
  partially_failed: "bg-orange-100 text-orange-700",
  cancelled:        "bg-gray-100 text-gray-500",
};

const ITEM_STATUS_ICON: Record<string, React.ReactNode> = {
  queued:     <Clock className="h-3.5 w-3.5 text-blue-500" />,
  processing: <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />,
  completed:  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  failed:     <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
  cancelled:  <Ban className="h-3.5 w-3.5 text-gray-400" />,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function BatchMonitorPage() {
  const [, params] = useRoute("/design-render-batches/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const batchId = parseInt(params?.id ?? "0", 10);

  const [itemPage, setItemPage] = useState(1);
  const [itemStatusFilter, setItemStatusFilter] = useState<string>("all");
  const [zipStatus, setZipStatus] = useState<ZipStatus | null>(null);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [zipPollHandle, setZipPollHandle] = useState<ReturnType<typeof setInterval> | null>(null);

  // ── Batch polling ──────────────────────────────────────────────────────────

  const { data: batch, isLoading: batchLoading } = useQuery<BatchStatus>({
    queryKey: ["batch", batchId],
    queryFn: () => apiFetch(`/api/ai/design-render-batches/${batchId}`),
    refetchInterval: (query) => {
      const status = (query.state.data as BatchStatus | undefined)?.status;
      return status && TERMINAL_STATUSES.has(status) ? false : POLL_INTERVAL_MS;
    },
    enabled: !!batchId,
  });

  // ── Item list ──────────────────────────────────────────────────────────────

  const { data: itemsData, isLoading: itemsLoading } = useQuery<ItemsPage>({
    queryKey: ["batch-items", batchId, itemPage, itemStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(itemPage), pageSize: "50" });
      if (itemStatusFilter !== "all") params.set("status", itemStatusFilter);
      return apiFetch(`/api/ai/design-render-batches/${batchId}/items?${params}`);
    },
    enabled: !!batchId,
    refetchInterval: batch && !TERMINAL_STATUSES.has(batch.status) ? POLL_INTERVAL_MS : false,
  });

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/api/ai/design-render-batches/${batchId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Batch cancelled" });
      qc.invalidateQueries({ queryKey: ["batch", batchId] });
    },
    onError: (err) => toast({ title: "Cancel failed", description: String(err), variant: "destructive" }),
  });

  // ── Retry failed ───────────────────────────────────────────────────────────

  const retryMutation = useMutation({
    mutationFn: () => apiFetch(`/api/ai/design-render-batches/${batchId}/retry-failed`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Retrying failed items…" });
      qc.invalidateQueries({ queryKey: ["batch", batchId] });
      qc.invalidateQueries({ queryKey: ["batch-items", batchId] });
    },
    onError: (err) => toast({ title: "Retry failed", description: String(err), variant: "destructive" }),
  });

  // ── ZIP export ─────────────────────────────────────────────────────────────

  const startZipExport = useCallback(async () => {
    setIsExportingZip(true);
    try {
      const result = await apiFetch<ZipStatus>(`/api/ai/design-render-batches/${batchId}/export-zip`, {
        method: "POST",
      });

      if (result.status === "not_implemented") {
        toast({
          title: "ZIP export not yet available",
          description: result.error ?? "ZIP export is not implemented yet. Download individual items instead.",
          variant: "destructive",
        });
        setIsExportingZip(false);
        return;
      }

      setZipStatus(result);

      if (result.status === "completed" && result.signedUrl) {
        setIsExportingZip(false);
        return;
      }

      // Poll for status
      const handle = setInterval(async () => {
        try {
          const poll = await apiFetch<ZipStatus>(`/api/ai/design-render-batches/${batchId}/export-zip`);
          setZipStatus(poll);
          if (poll.status === "completed" || poll.status === "failed") {
            clearInterval(handle);
            setIsExportingZip(false);
          }
        } catch {
          clearInterval(handle);
          setIsExportingZip(false);
        }
      }, 3000);
      setZipPollHandle(handle);
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
      setIsExportingZip(false);
    }
  }, [batchId, toast]);

  // Cleanup ZIP poll on unmount
  useEffect(() => {
    return () => { if (zipPollHandle) clearInterval(zipPollHandle); };
  }, [zipPollHandle]);

  // ── Progress ───────────────────────────────────────────────────────────────

  const progressPct = batch && batch.totalItems > 0
    ? Math.round((batch.completedItems / batch.totalItems) * 100)
    : 0;

  const totalPages = itemsData ? Math.ceil(itemsData.total / 50) : 1;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (batchLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!batch) {
    return <div className="p-6 text-muted-foreground">Batch not found.</div>;
  }

  const isTerminal = TERMINAL_STATUSES.has(batch.status);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/design-studio")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold truncate">{batch.name}</h1>
            <span className={cn("px-2 py-0.5 rounded text-xs font-medium", STATUS_BADGE[batch.status] ?? "")}>
              {batch.status.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Batch #{batch.id} · {batch.requestedFormat.toUpperCase()} · Created {new Date(batch.createdAt).toLocaleString()}
          </p>
        </div>
        {!isTerminal && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["batch", batchId] })}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        )}
      </div>

      {/* Progress section */}
      <div className="border rounded-xl p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Progress</span>
          <span className="text-muted-foreground">
            {batch.completedItems}/{batch.totalItems} completed
          </span>
        </div>
        <Progress value={progressPct} className="h-3" />

        <div className="grid grid-cols-4 gap-3 text-center">
          <div className="border rounded-lg p-2">
            <p className="text-xl font-bold text-blue-600">{batch.queuedItems ?? (batch.totalItems - batch.completedItems - batch.failedItems - batch.cancelledItems)}</p>
            <p className="text-xs text-muted-foreground">Queued</p>
          </div>
          <div className="border rounded-lg p-2">
            <p className="text-xl font-bold text-amber-600">{batch.processingItems ?? 0}</p>
            <p className="text-xs text-muted-foreground">Processing</p>
          </div>
          <div className="border rounded-lg p-2">
            <p className="text-xl font-bold text-green-600">{batch.completedItems}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
          <div className="border rounded-lg p-2">
            <p className="text-xl font-bold text-red-600">{batch.failedItems}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        {!isTerminal && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {cancelMutation.isPending ? "Cancelling…" : "Cancel Batch"}
          </Button>
        )}
        {(batch.status === "failed" || batch.status === "partially_failed") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {retryMutation.isPending ? "Retrying…" : "Retry Failed Items"}
          </Button>
        )}
        {isTerminal && batch.completedItems > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={startZipExport}
            disabled={isExportingZip}
          >
            {isExportingZip
              ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Preparing ZIP…</>
              : <><Package className="h-4 w-4 mr-1" /> Export ZIP</>}
          </Button>
        )}
      </div>

      {/* ZIP status */}
      {zipStatus && (
        <div className={cn(
          "border rounded-lg p-3 text-sm",
          zipStatus.status === "completed" ? "border-green-200 bg-green-50" :
          zipStatus.status === "failed" ? "border-red-200 bg-red-50" :
          "border-blue-200 bg-blue-50",
        )}>
          {zipStatus.status === "completed" && zipStatus.signedUrl ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-green-800">ZIP ready!</span>
              <a
                href={zipStatus.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-green-700 underline font-medium"
              >
                <Download className="h-3.5 w-3.5" /> Download ZIP
                <ExternalLink className="h-3 w-3" />
              </a>
              {zipStatus.expiresAt && (
                <span className="text-xs text-green-600 ml-1">
                  (link expires {new Date(zipStatus.expiresAt).toLocaleString()} — download now)
                </span>
              )}
            </div>
          ) : zipStatus.status === "failed" ? (
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4" />
              ZIP export failed: {zipStatus.error ?? "Unknown error"}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-blue-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing ZIP archive…
            </div>
          )}
        </div>
      )}

      {/* Item list */}
      <div className="border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-3 bg-muted/40 border-b">
          <h2 className="font-medium text-sm">Render Items</h2>
          <Select value={itemStatusFilter} onValueChange={(v) => { setItemStatusFilter(v); setItemPage(1); }}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {itemsLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="divide-y max-h-[480px] overflow-y-auto">
              {(itemsData?.items ?? []).map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 text-sm hover:bg-muted/30">
                  <span className="text-muted-foreground w-6 text-right text-xs">{item.rowIndex + 1}</span>
                  {ITEM_STATUS_ICON[item.status] ?? null}
                  <span className="flex-1 text-muted-foreground">Item #{item.id}</span>

                  {item.outputUrl && (
                    <a
                      href={item.outputUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 underline flex items-center gap-0.5"
                    >
                      <Download className="h-3 w-3" /> Download
                    </a>
                  )}

                  {item.status === "failed" && item.errorMessage && (
                    <span className="text-xs text-red-600 max-w-48 truncate" title={item.errorMessage}>
                      {item.errorMessage}
                    </span>
                  )}

                  {item.status === "failed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => retryMutation.mutate()}
                      disabled={retryMutation.isPending}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              ))}
              {(itemsData?.items ?? []).length === 0 && (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  No items match this filter.
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-2 border-t text-xs text-muted-foreground">
                <span>Page {itemPage} of {totalPages} · {itemsData?.total ?? 0} items</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setItemPage((p) => Math.max(1, p - 1))} disabled={itemPage === 1}>← Prev</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setItemPage((p) => Math.min(totalPages, p + 1))} disabled={itemPage === totalPages}>Next →</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
