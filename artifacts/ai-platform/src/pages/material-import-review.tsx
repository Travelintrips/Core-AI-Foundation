/**
 * material-import-review.tsx — Phase 5 Controlled Material Import & Review
 *
 * Route: /admin/material-import-review
 * Authorization: internal staff with roles owner | admin | manager | internal_staff
 *
 * Provides:
 *  - Dashboard summary (pending/approved/imported/failed counts)
 *  - Filterable, searchable, sortable review queue with pagination
 *  - Per-item detail: approve, reject, reviewer notes
 *  - Bulk approve / bulk reject
 *  - Duplicate comparison and resolution
 *  - Controlled import action + result report
 *  - Audit / history trail per item
 */
import { useState, useCallback, useEffect } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Download,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  FileText,
  Layers,
  History,
  Copy,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAdminApi } from "@/hooks/useAdminApi";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportState =
  | "draft"
  | "needs_review"
  | "approved"
  | "rejected"
  | "importing"
  | "imported"
  | "failed"
  | "rolled_back";

type DuplicateResolution =
  | "keep_existing"
  | "replace_existing"
  | "merge"
  | "create_new";

interface StagedMaterial {
  id: number;
  status: ImportState;
  productCode: string;
  category: string;
  brand?: string;
  name?: string;
  description?: string;
  collection?: string;
  finish?: string;
  texture?: string;
  pattern?: string;
  dimensions?: string;
  materialType?: string;
  duplicateScore?: number | null;
  previewImageUrl?: string;
  assetUrls?: string[];
  warnings?: string[];
  source?: string;
  reviewerName?: string;
  reviewerNotes?: string;
  reviewedAt?: string;
  importedAt?: string;
  canonicalMaterialId?: number | null;
  assetStatus?: string;
  failureReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuditEntry {
  id: number;
  eventType: string;
  fromStatus?: string;
  toStatus?: string;
  reviewerName?: string;
  notes?: string;
  createdAt: string;
}

interface Dashboard {
  pendingReview: number;
  approved: number;
  rejected: number;
  imported: number;
  failed: number;
  pendingAssets: number;
  duplicates: number;
  recentImports: StagedMaterial[];
}

interface ReviewList {
  items: StagedMaterial[];
  total: number;
  page: number;
  pageSize: number;
}

interface ImportReport {
  imported: number;
  failed: number;
  skipped: number;
  updated: number;
  pendingAssets: number;
  processingTimeMs: number;
  items: Array<{
    id: number;
    status: string;
    canonicalMaterialId?: number | null;
    assetStatus?: string;
    error?: string;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusBadge(status: ImportState) {
  const map: Record<ImportState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    draft:        { label: "Draft",        variant: "secondary" },
    needs_review: { label: "Needs Review", variant: "default" },
    approved:     { label: "Approved",     variant: "outline" },
    rejected:     { label: "Rejected",     variant: "destructive" },
    importing:    { label: "Importing…",   variant: "secondary" },
    imported:     { label: "Imported",     variant: "outline" },
    failed:       { label: "Failed",       variant: "destructive" },
    rolled_back:  { label: "Rolled Back",  variant: "secondary" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "secondary" };
  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

function duplicateBadge(score: number | null | undefined) {
  if (score == null || score < 0.5) return null;
  const pct = Math.round(score * 100);
  const color = score >= 0.9 ? "bg-red-500/10 text-red-400 border-red-500/20"
    : score >= 0.7 ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  return (
    <span className={`text-[10px] border rounded px-1 py-0.5 font-mono ${color}`}>
      dup {pct}%
    </span>
  );
}

// ─── Hook: api fetch via internal auth ───────────────────────────────────────

function useAdminFetch() {
  const { apiFetch } = useAdminApi();
  const json = useCallback(
    async (path: string, opts?: RequestInit) => {
      const res = await apiFetch(`${BASE}${path}`, opts);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? res.statusText);
      }
      return res.json();
    },
    [apiFetch],
  );
  return json;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ?? "bg-primary/10"}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  material,
  onClose,
  onRefresh,
  apiFetch,
}: {
  material: StagedMaterial;
  onClose: () => void;
  onRefresh: () => void;
  apiFetch: (path: string, opts?: RequestInit) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(material.reviewerNotes ?? "");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "audit">("details");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [dupResolution, setDupResolution] = useState<DuplicateResolution>("keep_existing");
  const [showDupDialog, setShowDupDialog] = useState(false);

  useEffect(() => {
    if (activeTab === "audit") {
      setLoadingAudit(true);
      apiFetch(`/api/ai/material-import/review/${material.id}`)
        .then((data) => {
          const d = data as { audit: AuditEntry[] };
          setAudit(d.audit ?? []);
        })
        .catch(() => setAudit([]))
        .finally(() => setLoadingAudit(false));
    }
  }, [activeTab, material.id, apiFetch]);

  async function doTransition(status: ImportState) {
    setBusyAction(status);
    try {
      await apiFetch(`/api/ai/material-import/review/${material.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });
      toast({ title: `Material ${status}`, description: `Item #${material.id} moved to ${status}.` });
      onRefresh();
      onClose();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  }

  async function doResolveDuplicate() {
    setBusyAction("dup");
    try {
      await apiFetch(`/api/ai/material-import/duplicates/${material.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: dupResolution, notes }),
      });
      toast({ title: "Duplicate resolved", description: `Resolution: ${dupResolution}` });
      setShowDupDialog(false);
      onRefresh();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  }

  async function doRetryAsset() {
    setBusyAction("retry-asset");
    try {
      await apiFetch(`/api/ai/material-import/review/${material.id}/retry-asset`, {
        method: "POST",
      });
      toast({ title: "Asset retry queued" });
      onRefresh();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  }

  const isTerminal = ["imported", "rolled_back"].includes(material.status);
  const canApprove = ["needs_review", "draft"].includes(material.status);
  const canReject = ["needs_review", "draft", "approved"].includes(material.status);
  const canRetryAsset = ["imported", "failed"].includes(material.status);
  const hasDuplicate = (material.duplicateScore ?? 0) >= 0.5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">{material.productCode}</span>
            {statusBadge(material.status)}
            {duplicateBadge(material.duplicateScore)}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 px-5 pt-3 border-b border-border shrink-0">
          {(["details", "audit"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {tab === "audit" ? "Audit History" : "Details"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === "details" ? (
            <>
              {/* Core fields */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Category", material.category],
                  ["Brand", material.brand],
                  ["Name", material.name],
                  ["Type", material.materialType],
                  ["Finish", material.finish],
                  ["Texture", material.texture],
                  ["Pattern", material.pattern],
                  ["Dimensions", material.dimensions],
                  ["Source", material.source],
                  ["Canonical ID", material.canonicalMaterialId ?? "—"],
                ].filter(([, v]) => v != null && v !== "").map(([k, v]) => (
                  <div key={String(k)} className="bg-muted/30 rounded p-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k}</p>
                    <p className="font-medium text-foreground mt-0.5 truncate">{String(v)}</p>
                  </div>
                ))}
              </div>

              {/* Description */}
              {material.description && (
                <div className="bg-muted/30 rounded p-3 text-sm text-foreground">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                  {material.description}
                </div>
              )}

              {/* Warnings */}
              {(material.warnings ?? []).length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded p-3">
                  <p className="text-xs font-medium text-amber-400 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Warnings</p>
                  <ul className="text-xs text-amber-300 space-y-0.5">
                    {(material.warnings ?? []).map((w, i) => <li key={i}>• {String(w)}</li>)}
                  </ul>
                </div>
              )}

              {/* Asset status */}
              {material.assetStatus && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Asset:</span>
                  <Badge variant="outline" className="text-xs">{material.assetStatus}</Badge>
                  {canRetryAsset && (
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={doRetryAsset} disabled={busyAction === "retry-asset"}>
                      Retry Asset
                    </Button>
                  )}
                </div>
              )}

              {/* Reviewer info */}
              {material.reviewerName && (
                <div className="text-xs text-muted-foreground">
                  Reviewed by <strong>{material.reviewerName}</strong>
                  {material.reviewedAt && ` on ${new Date(material.reviewedAt).toLocaleDateString()}`}
                </div>
              )}

              {/* Reviewer notes input */}
              {!isTerminal && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Reviewer Notes</label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add notes (required when rejecting)…"
                    className="text-sm min-h-[72px] resize-none"
                  />
                </div>
              )}
            </>
          ) : (
            /* Audit history */
            <div className="space-y-2">
              {loadingAudit && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!loadingAudit && audit.length === 0 && <p className="text-sm text-muted-foreground">No audit entries.</p>}
              {audit.map((entry) => (
                <div key={entry.id} className="flex gap-3 text-sm">
                  <div className="shrink-0 mt-0.5">
                    <History className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{entry.eventType}</span>
                      {entry.fromStatus && entry.toStatus && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          {entry.fromStatus} <ArrowRight className="w-2.5 h-2.5" /> {entry.toStatus}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {entry.reviewerName && <p className="text-xs text-muted-foreground">by {entry.reviewerName}</p>}
                    {entry.notes && <p className="text-xs text-foreground/80 mt-0.5 italic">"{entry.notes}"</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isTerminal && activeTab === "details" && (
          <div className="flex items-center gap-2 px-5 py-4 border-t border-border shrink-0 flex-wrap">
            {hasDuplicate && (
              <Button variant="outline" size="sm" onClick={() => setShowDupDialog(true)} className="gap-1.5">
                <Copy className="w-3.5 h-3.5" />
                Resolve Duplicate
              </Button>
            )}
            {canReject && (
              <Button variant="destructive" size="sm" onClick={() => doTransition("rejected")} disabled={busyAction != null} className="gap-1.5">
                <XCircle className="w-3.5 h-3.5" />
                {busyAction === "rejected" ? "Rejecting…" : "Reject"}
              </Button>
            )}
            {canApprove && (
              <Button variant="default" size="sm" onClick={() => doTransition("approved")} disabled={busyAction != null} className="gap-1.5 ml-auto">
                <CheckCircle className="w-3.5 h-3.5" />
                {busyAction === "approved" ? "Approving…" : "Approve"}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Duplicate resolution dialog */}
      <Dialog open={showDupDialog} onOpenChange={setShowDupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Duplicate</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Duplicate score: <strong>{Math.round((material.duplicateScore ?? 0) * 100)}%</strong>. Choose how to handle this record when it is imported.
            </p>
            <Select value={dupResolution} onValueChange={(v) => setDupResolution(v as DuplicateResolution)}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep_existing">Keep existing — skip this record</SelectItem>
                <SelectItem value="replace_existing">Replace existing with this record</SelectItem>
                <SelectItem value="merge">Merge — prefer non-null fields from this record</SelectItem>
                <SelectItem value="create_new">Create new — import as a separate item</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for decision…"
              className="text-sm resize-none"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDupDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={doResolveDuplicate} disabled={busyAction === "dup"}>
              {busyAction === "dup" ? "Saving…" : "Save Resolution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Import result report ──────────────────────────────────────────────────────

function ImportReportModal({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Import Report</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Imported", report.imported, "text-emerald-400"],
              ["Failed", report.failed, "text-red-400"],
              ["Skipped", report.skipped, "text-yellow-400"],
            ].map(([label, val, color]) => (
              <div key={String(label)} className="bg-muted/30 rounded p-3">
                <p className={`text-2xl font-bold ${String(color)}`}>{String(val)}</p>
                <p className="text-xs text-muted-foreground">{String(label)}</p>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Updated existing: <strong>{report.updated}</strong></p>
            <p>Assets pending: <strong>{report.pendingAssets}</strong></p>
            <p>Processing time: <strong>{(report.processingTimeMs / 1000).toFixed(1)}s</strong></p>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {report.items.map((item) => (
              <div key={item.id} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${item.status === "imported" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                <span>ID #{item.id}</span>
                <span className={item.status === "imported" ? "text-emerald-400" : "text-red-400"}>{item.status}</span>
                {item.error && <span className="text-muted-foreground truncate max-w-[120px]">{item.error}</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border">
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MaterialImportReviewPage() {
  const apiFetch = useAdminFetch();
  const { toast } = useToast();

  // Dashboard
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);

  // List state
  const [items, setItems] = useState<StagedMaterial[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Filters
  const [statusFilter, setStatusFilter] = useState<ImportState | "all">("needs_review");
  const [searchTerm, setSearchTerm] = useState("");
  const [sort, setSort] = useState<"created_desc" | "created_asc" | "duplicate_desc">("created_desc");

  // UI state
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StagedMaterial | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [busyImport, setBusyImport] = useState(false);
  const [busyBulk, setBusyBulk] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await apiFetch("/api/ai/material-import/dashboard");
      setDashboard(data as Dashboard);
    } catch {
      // non-blocking
    }
  }, [apiFetch]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      const data = (await apiFetch(`/api/ai/material-import/review?${params}`)) as ReviewList;
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      toast({ title: "Failed to load review queue", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [apiFetch, page, pageSize, sort, statusFilter, searchTerm, toast]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { void loadItems(); }, [loadItems]);

  const refresh = useCallback(() => {
    void loadDashboard();
    void loadItems();
    setSelectedIds(new Set());
  }, [loadDashboard, loadItems]);

  async function doBulkAction(status: "approved" | "rejected" | "needs_review") {
    if (selectedIds.size === 0) return;
    setBusyBulk(true);
    try {
      await apiFetch("/api/ai/material-import/review/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds], status }),
      });
      toast({ title: `Bulk ${status}`, description: `${selectedIds.size} items updated.` });
      refresh();
    } catch (err) {
      toast({ title: "Bulk action failed", description: String(err), variant: "destructive" });
    } finally {
      setBusyBulk(false);
    }
  }

  async function doImport() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : "all";
    setBusyImport(true);
    try {
      const report = (await apiFetch("/api/ai/material-import/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })) as ImportReport;
      setImportReport(report);
      refresh();
    } catch (err) {
      toast({ title: "Import failed", description: String(err), variant: "destructive" });
    } finally {
      setBusyImport(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Download className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">Material Import Review</h1>
            <p className="text-xs text-muted-foreground">Phase 5 — Controlled import with human review</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Dashboard stats */}
      {dashboard && (
        <div className="grid grid-cols-4 lg:grid-cols-7 gap-3 px-6 py-3 border-b border-border shrink-0">
          <StatCard icon={<Clock className="w-4 h-4 text-primary" />} label="Pending Review" value={dashboard.pendingReview} accent="bg-primary/10" />
          <StatCard icon={<CheckCircle className="w-4 h-4 text-emerald-400" />} label="Approved" value={dashboard.approved} accent="bg-emerald-500/10" />
          <StatCard icon={<XCircle className="w-4 h-4 text-red-400" />} label="Rejected" value={dashboard.rejected} accent="bg-red-500/10" />
          <StatCard icon={<Download className="w-4 h-4 text-blue-400" />} label="Imported" value={dashboard.imported} accent="bg-blue-500/10" />
          <StatCard icon={<AlertTriangle className="w-4 h-4 text-red-400" />} label="Failed" value={dashboard.failed} accent="bg-red-500/10" />
          <StatCard icon={<Layers className="w-4 h-4 text-amber-400" />} label="Pending Assets" value={dashboard.pendingAssets} accent="bg-amber-500/10" />
          <StatCard icon={<Copy className="w-4 h-4 text-yellow-400" />} label="Duplicates" value={dashboard.duplicates} accent="bg-yellow-500/10" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            placeholder="Search product code, brand…"
            className="pl-8 h-8 text-sm"
          />
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(1); }}>
          <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="needs_review">Needs Review</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="imported">Imported</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger className="h-8 text-sm w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created_desc">Newest first</SelectItem>
            <SelectItem value="created_asc">Oldest first</SelectItem>
            <SelectItem value="duplicate_desc">Highest duplicate</SelectItem>
          </SelectContent>
        </Select>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => doBulkAction("approved")} disabled={busyBulk}>
              <CheckCircle className="w-3 h-3 mr-1" /> Approve
            </Button>
            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => doBulkAction("rejected")} disabled={busyBulk}>
              <XCircle className="w-3 h-3 mr-1" /> Reject
            </Button>
          </div>
        )}

        {/* Import action */}
        <Button size="sm" className="h-8 text-xs gap-1.5 ml-auto" onClick={doImport} disabled={busyImport}>
          <Download className="w-3.5 h-3.5" />
          {busyImport ? "Importing…" : selectedIds.size > 0 ? `Import ${selectedIds.size} selected` : "Import all approved"}
        </Button>
      </div>

      {/* Review queue table */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <Layers className="w-8 h-8 opacity-30" />
            <p className="text-sm">No items match your filters.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 pr-3 w-8 text-left">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === items.length && items.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="pb-2 pr-4 text-left">Product Code</th>
                <th className="pb-2 pr-4 text-left">Category</th>
                <th className="pb-2 pr-4 text-left">Brand</th>
                <th className="pb-2 pr-4 text-left">Status</th>
                <th className="pb-2 pr-4 text-left">Duplicate</th>
                <th className="pb-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 pr-3" onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{item.productCode}</td>
                  <td className="py-2.5 pr-4 text-foreground/80">{item.category}</td>
                  <td className="py-2.5 pr-4 text-foreground/80">{item.brand ?? "—"}</td>
                  <td className="py-2.5 pr-4">{statusBadge(item.status)}</td>
                  <td className="py-2.5 pr-4">{duplicateBadge(item.duplicateScore)}</td>
                  <td className="py-2.5 text-xs text-muted-foreground">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
            <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="px-2">{page} / {totalPages}</span>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedItem && (
        <DetailPanel
          material={selectedItem}
          onClose={() => setSelectedItem(null)}
          onRefresh={refresh}
          apiFetch={apiFetch}
        />
      )}

      {/* Import report */}
      {importReport && (
        <ImportReportModal report={importReport} onClose={() => setImportReport(null)} />
      )}
    </div>
  );
}
