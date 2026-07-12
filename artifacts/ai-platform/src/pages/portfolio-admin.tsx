import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Play, Ban, CheckCircle, XCircle, Loader2, RefreshCcw, Images, Star, TrendingUp, BarChart3, Settings, ListChecks, Layers, Archive, RotateCcw, AlertTriangle, Eye, ExternalLink, X, FileImage } from "lucide-react";
import { Plus, Play, Ban, CheckCircle, XCircle, Loader2, RefreshCcw, Images, Star, TrendingUp, BarChart3, Settings, ListChecks, Layers, Archive, RotateCcw, AlertTriangle, ChevronDown, ChevronUp, Eye } from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────────

const API = "/api";
const KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-admin-api-key": KEY, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GenerationBatch {
  id: number;
  batchCode: string;
  industry: string;
  style: string;
  packageLevel: string;
  requestedCount: number;
  generatedCount: number;
  approvedCount: number;
  rejectedCount: number;
  failedCount: number;
  status: string;
  maxCost: string | null;
  actualCost: string;
  autoPublish: boolean;
  createdBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Portfolio {
  id: number;
  title: string;
  industry: string;
  style: string;
  status: string;
  publishStatus?: string;
  featured: boolean;
  views: number;
  rating: string | null;
  isDemo?: boolean;
  qcScore?: string | null;
  trademarkRisk?: string;
  createdAt: string;
  description?: string | null;
  imageUrl?: string | null;
  previewUrl?: string | null;
  displayOrder?: number;
}

interface Permission {
  id: number;
  projectId: number;
  customerId: number | null;
  permissionStatus: string;
  requestedAt: string | null;
  approvedAt: string | null;
  notes: string | null;
}

interface PortfolioAsset {
  id: number;
  portfolioId: number;
  assetRole: string;
  status: string;
  archiveStatus: string;
  archiveAttempts: number;
  archiveError: string | null;
  optimizationStatus: string;
  thumbnailStatus: string;
  storagePath: string | null;
  storageProvider: string | null;
  sourceUrl: string | null;
  previewUrl: string | null;
}

interface ArchiveQueueStats {
  jobsByTypeAndStatus: Record<string, Record<string, number>>;
  assetsByLifecycleStatus: Record<string, number>;
  avgArchiveDurationSeconds: number | null;
}

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  queued: "bg-blue-100 text-blue-700",
  running: "bg-yellow-100 text-yellow-700",
  review: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  partially_failed: "bg-orange-100 text-orange-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
  blocked_by_budget: "bg-red-100 text-red-700",
  published: "bg-green-100 text-green-700",
  hidden: "bg-gray-100 text-gray-500",
  archived: "bg-gray-100 text-gray-400",
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  revoked: "bg-gray-100 text-gray-500",
  // Asset lifecycle statuses (Sprint P2.1.1)
  generating: "bg-blue-100 text-blue-700",
  generated: "bg-indigo-100 text-indigo-700",
  archiving: "bg-yellow-100 text-yellow-700",
  optimized: "bg-cyan-100 text-cyan-700",
  archive_failed: "bg-red-100 text-red-700",
  optimize_failed: "bg-red-100 text-red-700",
  thumbnail_failed: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Portfolio Detail Drawer ───────────────────────────────────────────────────

function PortfolioDetailDrawer({ portfolio, onClose }: { portfolio: Portfolio; onClose: () => void }) {
  const { data: assets = [], isLoading: assetsLoading } = useQuery<PortfolioAsset[]>({
    queryKey: ["portfolio-assets", portfolio.id],
    queryFn: () => apiFetch(`/ai/portfolio/portfolios/${portfolio.id}/assets`),
  });

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const previewAsset = assets.find((a) => a.previewUrl || a.sourceUrl);
  const previewSrc = previewAsset?.previewUrl || previewAsset?.sourceUrl;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-150"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l border-border z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0 pr-4">
            <h2 className="font-semibold text-base leading-snug truncate">{portfolio.title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{portfolio.industry} · {portfolio.style}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Preview image */}
          {previewSrc ? (
            <div className="rounded-xl overflow-hidden border border-border bg-muted aspect-video flex items-center justify-center">
              <img
                src={previewSrc}
                alt={portfolio.title}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/40 aspect-video flex flex-col items-center justify-center gap-2">
              <FileImage className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No preview image</p>
            </div>
          )}

          {/* Badges row */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={portfolio.status} />
            {portfolio.publishStatus && portfolio.publishStatus !== portfolio.status && (
              <StatusBadge status={portfolio.publishStatus} />
            )}
            {portfolio.featured && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">featured</span>
            )}
            {portfolio.isDemo && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-600">demo</span>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border border-border bg-card text-center">
              <p className="text-xl font-bold">{portfolio.views.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Views</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-card text-center">
              <p className="text-xl font-bold">{portfolio.rating ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Rating</p>
            </div>
            <div className="p-3 rounded-xl border border-border bg-card text-center">
              <p className="text-xl font-bold">{portfolio.qcScore ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">QC Score</p>
            </div>
          </div>

          {/* Trademark risk */}
          {portfolio.trademarkRisk && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Trademark risk:</span>
              <span className={
                portfolio.trademarkRisk === "high" ? "text-red-600 font-medium" :
                portfolio.trademarkRisk === "medium" ? "text-amber-600 font-medium" :
                "text-green-600 font-medium"
              }>
                {portfolio.trademarkRisk}
              </span>
            </div>
          )}

          {/* Description */}
          {portfolio.description && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{portfolio.description}</p>
            </div>
          )}

          {/* Assets */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Assets</p>
            {assetsLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : assets.length === 0 ? (
              <p className="text-xs text-muted-foreground">No assets attached.</p>
            ) : (
              <div className="space-y-2">
                {assets.map((a) => (
                  <div key={a.id} className="p-3 rounded-lg border border-border bg-card">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-medium">{a.assetRole.replace(/_/g, " ")}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.previewUrl && (
                        <a
                          href={a.previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3" /> Preview URL
                        </a>
                      )}
                      {a.sourceUrl && a.sourceUrl !== a.previewUrl && (
                        <a
                          href={a.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3" /> Source URL
                        </a>
                      )}
                      {a.storagePath && (
                        <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[160px]" title={a.storagePath}>
                          {a.storagePath}
                        </span>
                      )}
                    </div>
                    {a.archiveError && (
                      <p className="mt-1 text-[11px] text-red-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" /> {a.archiveError}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border">
            <div className="flex justify-between"><span>Portfolio ID</span><span className="font-mono">#{portfolio.id}</span></div>
            {portfolio.displayOrder !== undefined && (
              <div className="flex justify-between"><span>Display order</span><span>{portfolio.displayOrder}</span></div>
            )}
            <div className="flex justify-between"><span>Created</span><span>{new Date(portfolio.createdAt).toLocaleString()}</span></div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = "portfolios" | "batches" | "review" | "archive" | "permissions" | "analytics";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "portfolios", label: "Portfolio", icon: <Images className="w-4 h-4" /> },
  { id: "batches", label: "Generation Batches", icon: <Layers className="w-4 h-4" /> },
  { id: "review", label: "Review Queue", icon: <ListChecks className="w-4 h-4" /> },
  { id: "archive", label: "Archive Queue", icon: <Archive className="w-4 h-4" /> },
  { id: "permissions", label: "Permissions", icon: <Settings className="w-4 h-4" /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
];

// ── Create Batch Form ─────────────────────────────────────────────────────────

const INDUSTRIES = [
  "coffee", "restaurant", "hotel", "logistics", "mining", "trading",
  "palm-oil", "fashion", "medical", "property", "technology", "construction",
  "retail", "education", "manufacturing", "beauty", "automotive", "furniture",
];
const STYLES = [
  "Minimalist", "Modern", "Luxury", "Corporate", "Elegant", "Premium",
  "Industrial", "Bold", "Classic", "Natural", "Clean", "Futuristic", "Professional",
];
const PKG_LEVELS = ["starter", "standard", "professional", "enterprise"];

function CreateBatchPanel({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    industry: "coffee", style: "Minimalist", packageLevel: "standard",
    requestedCount: 3, maxCost: "", autoPublish: false, qcThreshold: 70,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      await apiFetch("/ai/portfolio/batch", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          maxCost: form.maxCost ? parseFloat(form.maxCost) : undefined,
          requestedCount: Number(form.requestedCount),
          qcThreshold: Number(form.qcThreshold),
        }),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create batch");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
      <h3 className="font-medium text-sm">Create Generation Batch</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Industry</label>
          <select className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Style</label>
          <select className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })}>
            {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Package</label>
          <select className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" value={form.packageLevel} onChange={(e) => setForm({ ...form, packageLevel: e.target.value })}>
            {PKG_LEVELS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Count (1–10)</label>
          <input type="number" min={1} max={10} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" value={form.requestedCount} onChange={(e) => setForm({ ...form, requestedCount: parseInt(e.target.value) })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Max Cost (USD, optional)</label>
          <input type="number" step="0.01" placeholder="No limit" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" value={form.maxCost} onChange={(e) => setForm({ ...form, maxCost: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">QC Threshold (0–100)</label>
          <input type="number" min={0} max={100} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm" value={form.qcThreshold} onChange={(e) => setForm({ ...form, qcThreshold: parseInt(e.target.value) })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="autoPublish" checked={form.autoPublish} onChange={(e) => setForm({ ...form, autoPublish: e.target.checked })} className="rounded" />
        <label htmlFor="autoPublish" className="text-sm">Auto-publish if QC passes & trademark risk is low</label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button onClick={handleCreate} disabled={creating}
        className="w-full px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Create Batch
      </button>
    </div>
  );
}

// ── Batches Tab ───────────────────────────────────────────────────────────────

function BatchesTab() {
  const qc = useQueryClient();
  const { data: batches = [], isLoading, refetch } = useQuery<GenerationBatch[]>({
    queryKey: ["portfolio-batches"],
    queryFn: () => apiFetch("/ai/portfolio/batch"),
  });

  const startMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/ai/portfolio/batch/${id}/start`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio-batches"] }),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/ai/portfolio/batch/${id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio-batches"] }),
  });

  return (
    <div className="space-y-5">
      <CreateBatchPanel onCreated={() => qc.invalidateQueries({ queryKey: ["portfolio-batches"] })} />

      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{batches.length} Batches</h3>
        <button onClick={() => refetch()} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCcw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : batches.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No batches yet. Create your first batch above.</p>
      ) : (
        <div className="space-y-3">
          {batches.map((b) => (
            <div key={b.id} className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">{b.batchCode}</span>
                    <StatusBadge status={b.status} />
                    {b.autoPublish && <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600">auto-publish</span>}
                  </div>
                  <p className="font-medium text-sm">{b.industry} · {b.style} · {b.packageLevel}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                    <span>Requested: {b.requestedCount}</span>
                    <span className="text-green-600">✓ {b.generatedCount} generated</span>
                    {b.failedCount > 0 && <span className="text-red-500">✗ {b.failedCount} failed</span>}
                    {b.approvedCount > 0 && <span className="text-blue-600">✓ {b.approvedCount} approved</span>}
                    <span>Cost: ${parseFloat(b.actualCost || "0").toFixed(4)}{b.maxCost ? ` / $${parseFloat(b.maxCost).toFixed(2)} max` : ""}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {["draft", "failed", "partially_failed"].includes(b.status) && (
                    <button
                      onClick={() => startMutation.mutate(b.id)}
                      disabled={startMutation.isPending}
                      className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      title="Start batch"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {b.status === "running" && (
                    <button onClick={() => cancelMutation.mutate(b.id)} className="p-1.5 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/5 transition-colors" title="Cancel">
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Portfolio List Tab ────────────────────────────────────────────────────────

function PortfoliosTab({ onView }: { onView: (p: Portfolio) => void }) {
  const { data: portfolios = [], isLoading } = useQuery<Portfolio[]>({
    queryKey: ["admin-portfolios"],
    queryFn: (): Promise<Portfolio[]> => apiFetch<Portfolio[]>("/ai/portfolio/services/1/portfolios").catch(() => [] as Portfolio[]),
  });

  return (
    <div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : portfolios.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Images className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No portfolios. Seed them via the API or create a generation batch.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {portfolios.map((p) => (
            <button
              key={p.id}
              onClick={() => onView(p)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/40 transition-colors text-left group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-sm truncate">{p.title}</span>
                  {p.isDemo && <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-600 shrink-0">demo</span>}
                  {p.featured && <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary shrink-0">featured</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span>{p.industry}</span>
                  <span>·</span>
                  <span>{p.style}</span>
                  {p.rating && <span className="inline-flex items-center gap-0.5"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{p.rating}</span>}
                  <span className="inline-flex items-center gap-0.5"><TrendingUp className="w-3 h-3" />{p.views}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={p.status} />
                <Eye className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Review Queue Tab ──────────────────────────────────────────────────────────

function ReviewQueueTab({ onView }: { onView: (p: Portfolio) => void }) {
function getAssetImageUrl(asset: PortfolioAsset): string | null {
  if (asset.storagePath?.startsWith("/storage/")) return `/api${asset.storagePath}`;
  return asset.sourceUrl ?? asset.previewUrl ?? null;
}

function ReviewQueueTab() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: queue = [], isLoading, refetch } = useQuery<Portfolio[]>({
    queryKey: ["portfolio-review-queue"],
    queryFn: () => apiFetch("/ai/portfolio/review-queue"),
    refetchInterval: 15000,
  });

  const { data: assets = [], isLoading: assetsLoading } = useQuery<PortfolioAsset[]>({
    queryKey: ["portfolio-assets", selectedId],
    queryFn: () => apiFetch(`/ai/portfolio/portfolios/${selectedId}/assets`),
    enabled: selectedId !== null,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/ai/portfolio/portfolios/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-review-queue"] });
      setSelectedId(null);
    },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/ai/portfolio/portfolios/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-review-queue"] });
      setSelectedId(null);
    },
  });

  function toggleRow(id: number) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{queue.length} items awaiting review</p>
        <button onClick={() => refetch()} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCcw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : queue.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <ListChecks className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Review queue is empty.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((p) => {
            const isExpanded = selectedId === p.id;
            return (
              <div key={p.id} className={`rounded-xl border bg-card transition-colors ${isExpanded ? "border-primary/40" : "border-border"}`}>
                {/* ── Row header — click to expand ── */}
                <div
                  className="p-4 flex items-start justify-between gap-3 cursor-pointer select-none"
                  onClick={() => toggleRow(p.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{p.title}</span>
                      {p.isDemo && <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-600">demo</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{p.industry} · {p.style}</span>
                      {p.qcScore && <span className="text-blue-600">QC: {p.qcScore}</span>}
                      {p.trademarkRisk && (
                        <span className={p.trademarkRisk === "high" ? "text-red-600" : p.trademarkRisk === "medium" ? "text-amber-600" : "text-green-600"}>
                          TM risk: {p.trademarkRisk}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Eye className="w-3 h-3" /> Review
                    </span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* ── Expanded detail panel ── */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-4">
                    {assetsLoading ? (
                      <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : assets.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-4 text-center">No assets found for this portfolio.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
                        {assets.map((a) => {
                          const imgUrl = getAssetImageUrl(a);
                          return (
                            <div key={a.id} className="rounded-lg overflow-hidden border border-border bg-muted/30">
                              {imgUrl ? (
                                <a href={imgUrl} target="_blank" rel="noreferrer">
                                  <img
                                    src={imgUrl}
                                    alt={a.assetRole}
                                    className="w-full aspect-video object-cover hover:opacity-90 transition-opacity"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                </a>
                              ) : (
                                <div className="w-full aspect-video flex items-center justify-center bg-muted">
                                  <Images className="w-6 h-6 text-muted-foreground/40" />
                                </div>
                              )}
                              <div className="px-2 py-1.5">
                                <p className="text-[10px] font-medium text-foreground capitalize">{a.assetRole.replace(/_/g, " ")}</p>
                                <p className={`text-[10px] ${STATUS_COLORS[a.status] ? "" : "text-muted-foreground"}`}>
                                  <span className={`inline-block px-1 rounded ${STATUS_COLORS[a.status] ?? "bg-gray-100 text-gray-500"}`}>{a.status}</span>
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Approve / Reject actions */}
                    <div className="flex items-center gap-3 pt-2 border-t border-border">
                      <button
                        onClick={(e) => { e.stopPropagation(); approveMutation.mutate(p.id); }}
                        disabled={approveMutation.isPending}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
                      >
                        <CheckCircle className="w-4 h-4" />
                        {approveMutation.isPending ? "Approving…" : "Approve & Publish"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); rejectMutation.mutate(p.id); }}
                        disabled={rejectMutation.isPending}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors disabled:opacity-60"
                      >
                        <XCircle className="w-4 h-4" />
                        {rejectMutation.isPending ? "Rejecting…" : "Reject"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedId(null); }}
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onView(p)}
                    className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                    title="View details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => approveMutation.mutate(p.id)}
                    disabled={approveMutation.isPending}
                    className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                    title="Approve & Publish"
                  >
                    <CheckCircle className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(p.id)}
                    disabled={rejectMutation.isPending}
                    className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                    title="Reject"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Archive Queue Tab (Sprint P2.1.1 — background asset lifecycle) ───────────

const LIFECYCLE_STAGE_ORDER = ["generated", "archiving", "archived", "optimized", "published"];
const FAILURE_STAGES = ["archive_failed", "optimize_failed", "thumbnail_failed"];

function AssetLifecycleRow({ asset, onRetried }: { asset: PortfolioAsset; onRetried: () => void }) {
  const retryMutation = useMutation({
    mutationFn: () => apiFetch(`/ai/portfolio/assets/${asset.id}/retry-archive`, { method: "POST" }),
    onSuccess: onRetried,
  });
  const isFailed = FAILURE_STAGES.includes(asset.status) || [asset.archiveStatus, asset.optimizationStatus, asset.thumbnailStatus].includes("failed");

  return (
    <div className="flex items-start gap-3 px-4 py-2.5 bg-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">#{asset.id}</span>
          <span className="text-sm font-medium">{asset.assetRole.replace(/_/g, " ")}</span>
          <StatusBadge status={asset.status} />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          <span>archive: <StatusBadge status={asset.archiveStatus} /></span>
          <span>optimize: <StatusBadge status={asset.optimizationStatus} /></span>
          <span>thumbnail: <StatusBadge status={asset.thumbnailStatus} /></span>
          {asset.archiveAttempts > 0 && <span>· {asset.archiveAttempts} attempt(s)</span>}
        </div>
        {/* Clickable asset URLs */}
        {(asset.previewUrl || asset.sourceUrl) && (
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {asset.previewUrl && (
              <a
                href={asset.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" /> View preview
              </a>
            )}
            {asset.sourceUrl && asset.sourceUrl !== asset.previewUrl && (
              <a
                href={asset.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                <ExternalLink className="w-3 h-3" /> View source
              </a>
            )}
          </div>
        )}
        {asset.archiveError && (
          <p className="mt-1 text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" /> {asset.archiveError}</p>
        )}
        {asset.sourceUrl && asset.status !== "generated" && asset.previewUrl && asset.previewUrl.includes("replicate.delivery") && (
          <p className="mt-1 text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" /> still serving a temporary Replicate URL</p>
        )}
      </div>
      {isFailed && (
        <button
          onClick={() => retryMutation.mutate()}
          disabled={retryMutation.isPending}
          className="p-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors shrink-0 mt-0.5"
          title="Retry"
        >
          {retryMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

function PortfolioAssetsPanel({ portfolioId }: { portfolioId: number }) {
  const qc = useQueryClient();
  const { data: assets = [], isLoading } = useQuery<PortfolioAsset[]>({
    queryKey: ["portfolio-assets", portfolioId],
    queryFn: () => apiFetch(`/ai/portfolio/portfolios/${portfolioId}/assets`),
    refetchInterval: 8000,
  });

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="divide-y divide-border rounded-lg border border-border overflow-hidden mt-2">
      {assets.map((a) => (
        <AssetLifecycleRow key={a.id} asset={a} onRetried={() => qc.invalidateQueries({ queryKey: ["portfolio-assets", portfolioId] })} />
      ))}
    </div>
  );
}

function ArchiveQueueTab({ onView }: { onView: (p: Portfolio) => void }) {
  const [expandedPortfolioId, setExpandedPortfolioId] = useState<number | null>(null);
  const { data: stats, isLoading, refetch } = useQuery<ArchiveQueueStats>({
    queryKey: ["archive-queue-stats"],
    queryFn: () => apiFetch("/ai/portfolio/archive-queue/stats"),
    refetchInterval: 10000,
  });
  const { data: recentPortfolios = [] } = useQuery<Portfolio[]>({
    queryKey: ["admin-portfolios-for-archive"],
    queryFn: (): Promise<Portfolio[]> => apiFetch<Portfolio[]>("/ai/portfolio/services/1/portfolios").catch(() => [] as Portfolio[]),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const jobTypes = Object.keys(stats?.jobsByTypeAndStatus ?? {});
  const assetStatuses = stats?.assetsByLifecycleStatus ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Background storage pipeline health</h3>
        <button onClick={() => refetch()} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCcw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Asset lifecycle funnel */}
      <div className="p-4 rounded-xl border border-border bg-card">
        <h4 className="text-sm font-medium mb-3">Assets by lifecycle stage</h4>
        <div className="flex items-center gap-2 flex-wrap">
          {[...LIFECYCLE_STAGE_ORDER, ...FAILURE_STAGES].map((stage) => (
            <div key={stage} className="px-3 py-2 rounded-lg bg-muted min-w-[92px] text-center">
              <p className="font-bold text-lg tabular-nums">{assetStatuses[stage] ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">{stage.replace(/_/g, " ")}</p>
            </div>
          ))}
        </div>
        {stats?.avgArchiveDurationSeconds != null && (
          <p className="text-xs text-muted-foreground mt-3">Average archive duration: {stats.avgArchiveDurationSeconds.toFixed(1)}s</p>
        )}
      </div>

      {/* Job queue by type/status */}
      <div className="p-4 rounded-xl border border-border bg-card">
        <h4 className="text-sm font-medium mb-3">Jobs by type × status</h4>
        {jobTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lifecycle jobs yet.</p>
        ) : (
          <div className="space-y-2">
            {jobTypes.map((jt) => (
              <div key={jt} className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-mono text-muted-foreground w-32 shrink-0">{jt}</span>
                {Object.entries(stats!.jobsByTypeAndStatus[jt]!).map(([status, count]) => (
                  <span key={status} className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
                    {status}: {count}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-portfolio asset drill-down */}
      <div>
        <h4 className="text-sm font-medium mb-2">Per-portfolio asset detail</h4>
        <p className="text-xs text-muted-foreground mb-3">Expand a portfolio to see each asset's archive / optimize / thumbnail status and retry failed stages.</p>
        <div className="space-y-2">
          {recentPortfolios.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setExpandedPortfolioId(expandedPortfolioId === p.id ? null : p.id)}
                  className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                >
                  <span className="text-sm font-medium">{p.title}</span>
                  <StatusBadge status={p.status} />
                </button>
                <button
                  onClick={() => onView(p)}
                  className="p-2 mr-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                  title="View portfolio details"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              {expandedPortfolioId === p.id && (
                <div className="px-4 pb-4">
                  <PortfolioAssetsPanel portfolioId={p.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Permissions Tab ───────────────────────────────────────────────────────────

function PermissionsTab() {
  const qc = useQueryClient();
  const { data: permissions = [], isLoading } = useQuery<Permission[]>({
    queryKey: ["portfolio-permissions"],
    queryFn: () => apiFetch("/ai/portfolio/permissions"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/ai/portfolio/permissions/${id}`, { method: "PATCH", body: JSON.stringify({ permissionStatus: status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio-permissions"] }),
  });

  return (
    <div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : permissions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Settings className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No permission requests yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Permissions are requested when converting a completed project to a portfolio item.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
          {permissions.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 bg-card">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Project #{p.projectId}</p>
                  <a
                    href={`/admin/creative-projects?id=${p.projectId}`}
                    className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                    title="View project"
                  >
                    <ExternalLink className="w-3 h-3" /> View
                  </a>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {p.requestedAt && <span>Requested {new Date(p.requestedAt).toLocaleDateString()}</span>}
                  {p.notes && <span>· {p.notes}</span>}
                </div>
              </div>
              <StatusBadge status={p.permissionStatus} />
              {p.permissionStatus === "pending" && (
                <div className="flex items-center gap-1">
                  <button onClick={() => updateMutation.mutate({ id: p.id, status: "approved" })}
                    className="p-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200" title="Approve">
                    <CheckCircle className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => updateMutation.mutate({ id: p.id, status: "rejected" })}
                    className="p-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200" title="Reject">
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ onView }: { onView: (p: Portfolio) => void }) {
  const { data: analytics, isLoading } = useQuery({
    queryKey: ["portfolio-analytics"],
    queryFn: () => apiFetch<{
      funnel: { portfolioViews: number; previewsGenerated: number; previewToCheckout: number };
      previews: { total: number; converted: number; failed: number };
      topPortfolios: Portfolio[];
    }>("/ai/portfolio/analytics"),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const funnel = analytics?.funnel;
  const previews = analytics?.previews;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Portfolio Views", value: funnel?.portfolioViews ?? 0 },
          { label: "Previews Generated", value: previews?.total ?? 0 },
          { label: "Preview → Checkout", value: funnel?.previewToCheckout ?? 0 },
        ].map((kpi) => (
          <div key={kpi.label} className="p-4 rounded-xl border border-border bg-card text-center">
            <p className="text-2xl font-bold">{kpi.value.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Preview funnel */}
      <div className="p-4 rounded-xl border border-border bg-card">
        <h4 className="text-sm font-medium mb-3">Preview Funnel</h4>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="p-2 rounded-lg bg-muted">
            <p className="font-bold text-lg">{previews?.total ?? 0}</p>
            <p className="text-muted-foreground">Total Previews</p>
          </div>
          <div className="p-2 rounded-lg bg-green-50">
            <p className="font-bold text-lg text-green-600">{previews?.converted ?? 0}</p>
            <p className="text-muted-foreground">Converted</p>
          </div>
          <div className="p-2 rounded-lg bg-red-50">
            <p className="font-bold text-lg text-red-500">{previews?.failed ?? 0}</p>
            <p className="text-muted-foreground">Failed</p>
          </div>
        </div>
      </div>

      {/* Top portfolios */}
      {analytics?.topPortfolios && analytics.topPortfolios.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-3">Top Portfolios by Views</h4>
          <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {analytics.topPortfolios.map((p) => (
              <button
                key={p.id}
                onClick={() => onView(p)}
                className="w-full flex items-center gap-3 px-4 py-2.5 bg-card hover:bg-muted/40 transition-colors text-left group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.industry} · {p.style}</p>
                </div>
                <span className="text-sm font-medium tabular-nums">{p.views.toLocaleString()}</span>
                <Eye className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PortfolioAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("portfolios");
  const [viewingPortfolio, setViewingPortfolio] = useState<Portfolio | null>(null);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Images className="w-6 h-6" /> Portfolio Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage portfolio items, generation batches, review queue, and permissions.</p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "portfolios" && <PortfoliosTab onView={setViewingPortfolio} />}
      {activeTab === "batches" && <BatchesTab />}
      {activeTab === "review" && <ReviewQueueTab onView={setViewingPortfolio} />}
      {activeTab === "archive" && <ArchiveQueueTab onView={setViewingPortfolio} />}
      {activeTab === "permissions" && <PermissionsTab />}
      {activeTab === "analytics" && <AnalyticsTab onView={setViewingPortfolio} />}

      {/* Portfolio detail drawer */}
      {viewingPortfolio && (
        <PortfolioDetailDrawer
          portfolio={viewingPortfolio}
          onClose={() => setViewingPortfolio(null)}
        />
      )}
    </div>
  );
}
