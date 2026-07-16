/**
 * Packaging Design — Admin Platform
 * Team 19 | /packaging-design
 *
 * Admin dashboard for managing packaging design orders:
 *   - Order list with filters (status, service type)
 *   - Order detail drawer (specs, variants, prepress validation results)
 *   - Status transition controls
 *   - One-click prepress validation runner
 *   - Variant management
 *   - Analytics card
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import {
  Package, Box, Droplets, Tag, Coffee, Layers, Wheat, Sparkles,
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  ChevronRight, X, Shield, ShieldCheck, ShieldAlert, Play,
  Plus, Trash2, Edit3, BarChart2, Clock,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────────

const API_BASE = "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  if (key) headers["x-admin-api-key"] = key;
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body?.error as string) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrepressCheck {
  code: string;
  name: string;
  severity: "error" | "warning" | "info";
  passed: boolean;
  detail: string;
}

interface PrintWarning {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
}

interface PrepressValidationResult {
  outcome: "passed" | "failed" | "passed_with_warnings";
  checks: PrepressCheck[];
  warnings: PrintWarning[];
  blockerCount: number;
  warningCount: number;
  runAt: string;
  runBy: string;
}

interface PackagingVariant {
  id: number;
  orderId: number;
  variantName: string;
  variantLabel: string | null;
  sku: string | null;
  barcodeValue: string | null;
  colorAccent: string | null;
  netWeight: string | null;
  consistencyStatus: string;
  consistencyNotes: string | null;
  status: string;
  displayOrder: number;
  createdAt: string;
}

interface PackagingOrder {
  id: number;
  orderId: string;
  serviceType: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  companyName: string | null;
  brandName: string;
  productName: string;
  productCategory: string | null;
  quantity: number;
  panelsRequired: string[];
  widthMm: string | null;
  heightMm: string | null;
  depthMm: string | null;
  bleedMm: string;
  safeAreaMm: string;
  colorMode: string;
  finishType: string | null;
  materialType: string | null;
  printSides: number;
  hasBarcodeZone: boolean;
  barcodeType: string | null;
  hasIngredientsBlock: boolean;
  hasLegalBlock: boolean;
  hasLogoZone: boolean;
  hasNutritionFacts: boolean;
  hasHalalCertification: boolean;
  hasSniBadge: boolean;
  hasBpomNumber: boolean;
  variantCount: number;
  status: string;
  prepressValidationJson: PrepressValidationResult | null;
  prepressValidatedAt: string | null;
  printReadyAt: string | null;
  currency: string;
  quotedPrice: string | null;
  finalPrice: string | null;
  completionNotes: string | null;
  deliverableLinks: Array<{ label: string; url: string }> | null;
  createdAt: string;
  updatedAt: string;
  // from detail endpoint
  variants?: PackagingVariant[];
  lastValidation?: PrepressValidationResult | null;
}

interface Analytics {
  totalOrders: number;
  byStatus: Record<string, number>;
  byServiceType: Record<string, number>;
  printReadyCount: number;
  validationPassRate: number;
  recentOrders: PackagingOrder[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_ICONS: Record<string, React.ElementType> = {
  box: Box, pouch: Package, bottle_label: Droplets, jar_label: Tag,
  cup: Coffee, sleeve: Layers, food_packaging: Wheat, cosmetic_packaging: Sparkles,
};

const SERVICE_NAMES: Record<string, string> = {
  box: "Box", pouch: "Pouch", bottle_label: "Label Botol", jar_label: "Label Jar",
  cup: "Cup", sleeve: "Sleeve", food_packaging: "Kemasan Makanan", cosmetic_packaging: "Kemasan Kosmetik",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:               { label: "Draft",            color: "text-slate-500",   bg: "bg-slate-100 dark:bg-slate-900/30" },
  submitted:           { label: "Dikirim",          color: "text-blue-600",    bg: "bg-blue-50 dark:bg-blue-950/30" },
  in_review:           { label: "Ditinjau",         color: "text-indigo-600",  bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  design_in_progress:  { label: "Desain Berlangsung",color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
  prepress_validation: { label: "Validasi Prepress",color: "text-amber-600",   bg: "bg-amber-50 dark:bg-amber-950/30" },
  revision_requested:  { label: "Perlu Revisi",     color: "text-orange-600",  bg: "bg-orange-50 dark:bg-orange-950/30" },
  print_ready:         { label: "Siap Cetak ✓",    color: "text-green-600",   bg: "bg-green-50 dark:bg-green-950/30" },
  completed:           { label: "Selesai",          color: "text-teal-600",    bg: "bg-teal-50 dark:bg-teal-950/30" },
  cancelled:           { label: "Dibatalkan",       color: "text-red-500",     bg: "bg-red-50 dark:bg-red-950/30" },
};

const NEXT_ACTIONS: Record<string, { label: string; status: string; variant: "primary"|"warning"|"danger" }[]> = {
  submitted:           [{ label: "Mulai Tinjauan",          status: "in_review",            variant: "primary" }],
  in_review:           [{ label: "Mulai Desain",            status: "design_in_progress",   variant: "primary" },
                        { label: "Perlu Revisi",            status: "revision_requested",   variant: "warning" }],
  design_in_progress:  [{ label: "Ke Validasi Prepress",   status: "prepress_validation",  variant: "primary" },
                        { label: "Perlu Revisi",            status: "revision_requested",   variant: "warning" }],
  prepress_validation: [{ label: "Tandai Siap Cetak",      status: "print_ready",          variant: "primary" },
                        { label: "Minta Revisi",            status: "revision_requested",   variant: "warning" }],
  revision_requested:  [{ label: "Lanjutkan Desain",       status: "design_in_progress",   variant: "primary" }],
  print_ready:         [{ label: "Tandai Selesai",         status: "completed",            variant: "primary" }],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 text-sm border-b border-border/30 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right max-w-[60%]">{value ?? "—"}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "text-muted-foreground", bg: "bg-muted/30" };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
  );
}

function ValidationOutcomeIcon({ outcome }: { outcome: string }) {
  if (outcome === "passed") return <ShieldCheck className="w-5 h-5 text-green-500" />;
  if (outcome === "passed_with_warnings") return <Shield className="w-5 h-5 text-amber-500" />;
  return <ShieldAlert className="w-5 h-5 text-red-500" />;
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ order, onClose }: { order: PackagingOrder; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newVariantName, setNewVariantName] = useState("");

  // Fetch detail (variants + last validation)
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["pkg-order-detail", order.id],
    queryFn: () => apiFetch<PackagingOrder>(`/api/ai/packaging-design/orders/${order.id}`),
  });

  const variants = detail?.variants ?? [];
  const lastValidation = detail?.lastValidation ?? order.prepressValidationJson;

  // Run validation
  const runValidation = useMutation({
    mutationFn: () =>
      apiFetch<PrepressValidationResult>(`/api/ai/packaging-design/orders/${order.id}/validate`, {
        method: "POST",
        body: JSON.stringify({ runBy: "admin" }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["pkg-orders"] });
      qc.invalidateQueries({ queryKey: ["pkg-order-detail", order.id] });
      toast({ title: `Validasi: ${data.outcome === "passed" ? "✓ Lulus" : data.outcome === "failed" ? "✗ Gagal" : "⚠ Lulus dengan warning"}` });
    },
    onError: (err: Error) => toast({ title: "Validasi gagal", description: err.message, variant: "destructive" }),
  });

  // Change status
  const changeStatus = useMutation({
    mutationFn: ({ status, notes }: { status: string; notes?: string }) =>
      apiFetch(`/api/ai/packaging-design/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, notes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pkg-orders"] });
      qc.invalidateQueries({ queryKey: ["pkg-order-detail", order.id] });
    },
    onError: (err: Error) => toast({ title: "Gagal ubah status", description: err.message, variant: "destructive" }),
  });

  // Add variant
  const addVariant = useMutation({
    mutationFn: (variantName: string) =>
      apiFetch(`/api/ai/packaging-design/orders/${order.id}/variants`, {
        method: "POST",
        body: JSON.stringify({ variantName }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pkg-order-detail", order.id] });
      setNewVariantName("");
    },
    onError: (err: Error) => toast({ title: "Gagal tambah varian", description: err.message, variant: "destructive" }),
  });

  // Update variant consistency
  const updateVariantStatus = useMutation({
    mutationFn: ({ id, consistencyStatus }: { id: number; consistencyStatus: string }) =>
      apiFetch(`/api/ai/packaging-design/variants/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ consistencyStatus }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pkg-order-detail", order.id] }),
    onError: (err: Error) => toast({ title: "Gagal update varian", description: err.message, variant: "destructive" }),
  });

  // Archive variant
  const archiveVariant = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/ai/packaging-design/variants/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pkg-order-detail", order.id] }),
  });

  const actions = NEXT_ACTIONS[order.status] ?? [];
  const ServiceIcon = SERVICE_ICONS[order.serviceType] ?? Package;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative w-full max-w-xl h-full bg-background border-l border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <ServiceIcon className="w-4.5 h-4.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold truncate">{order.brandName} — {order.productName}</h2>
              <p className="text-xs text-muted-foreground font-mono">{order.orderId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={order.status} />
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Customer + order info */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Informasi Pesanan</h3>
            <div className="bg-muted/20 rounded-xl p-4">
              <Row label="Customer" value={order.customerName} />
              <Row label="Email" value={order.customerEmail} />
              {order.customerPhone && <Row label="Telepon" value={order.customerPhone} />}
              {order.companyName && <Row label="Perusahaan" value={order.companyName} />}
              <Row label="Layanan" value={SERVICE_NAMES[order.serviceType] ?? order.serviceType} />
              <Row label="Kuantitas" value={`${order.quantity.toLocaleString("id-ID")} pcs`} />
              <Row label="Varian" value={`${order.variantCount} varian`} />
              <Row label="Masuk" value={new Date(order.createdAt).toLocaleString("id-ID")} />
            </div>
          </section>

          {/* Technical spec */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Spesifikasi Teknis</h3>
            <div className="bg-muted/20 rounded-xl p-4">
              <Row label="Panel" value={(order.panelsRequired ?? []).join(", ") || "—"} />
              <Row label="Dimensi" value={[order.widthMm, order.heightMm, order.depthMm].filter(Boolean).join(" × ") + " mm" || "—"} />
              <Row label="Bleed" value={`${order.bleedMm} mm`} />
              <Row label="Safe Area" value={`${order.safeAreaMm} mm`} />
              <Row label="Mode Warna" value={order.colorMode.toUpperCase()} />
              <Row label="Finishing" value={order.finishType ?? "—"} />
              <Row label="Material" value={order.materialType ?? "—"} />
              <Row label="Sisi Cetak" value={String(order.printSides)} />
            </div>
          </section>

          {/* Zones */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Zona & Blok Wajib</h3>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              {[
                ["Logo", order.hasLogoZone],
                ["Barcode", order.hasBarcodeZone],
                ["Komposisi", order.hasIngredientsBlock],
                ["Legal Block", order.hasLegalBlock],
                ["Nutrition Facts", order.hasNutritionFacts],
                ["Halal", order.hasHalalCertification],
                ["SNI", order.hasSniBadge],
                ["BPOM", order.hasBpomNumber],
              ].map(([label, val]) => (
                <div key={String(label)} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${val ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" : "bg-muted/30 text-muted-foreground"}`}>
                  {val ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  <span className="text-xs">{String(label)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Prepress validation */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Validasi Prepress</h3>
              <button
                onClick={() => runValidation.mutate()}
                disabled={runValidation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {runValidation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Jalankan Validasi
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : lastValidation ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <ValidationOutcomeIcon outcome={lastValidation.outcome} />
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {lastValidation.outcome === "passed" ? "Lulus" : lastValidation.outcome === "failed" ? "Gagal" : "Lulus (dengan peringatan)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lastValidation.blockerCount} blocker · {lastValidation.warningCount} peringatan
                      {lastValidation.runAt && ` · ${new Date(lastValidation.runAt).toLocaleString("id-ID")}`}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {lastValidation.checks.map((c) => (
                    <div
                      key={c.code}
                      className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${
                        c.passed
                          ? "bg-green-50/50 dark:bg-green-950/20"
                          : c.severity === "error"
                          ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                          : "bg-amber-50/50 dark:bg-amber-950/20"
                      }`}
                    >
                      {c.passed
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                        : c.severity === "error"
                        ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />}
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-muted-foreground leading-snug mt-0.5">{c.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {lastValidation.warnings.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Print Warnings</p>
                    {lastValidation.warnings.map((w) => (
                      <div key={w.code} className="flex items-start gap-2 p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{w.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <Shield className="w-10 h-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">Belum ada validasi. Klik "Jalankan Validasi" untuk memulai.</p>
              </div>
            )}
          </section>

          {/* Variants */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Varian ({variants.filter(v => v.status === "active").length} aktif)</h3>
            <div className="space-y-2">
              {variants.filter((v) => v.status === "active").map((v) => (
                <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/10">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{v.variantName}</p>
                    {v.sku && <p className="text-xs text-muted-foreground">SKU: {v.sku}</p>}
                    {v.barcodeValue && <p className="text-xs text-muted-foreground font-mono truncate">{v.barcodeValue}</p>}
                  </div>
                  <select
                    value={v.consistencyStatus}
                    onChange={(e) => updateVariantStatus.mutate({ id: v.id, consistencyStatus: e.target.value })}
                    className={`text-xs rounded-lg border px-2 py-1 bg-background focus:outline-none ${
                      v.consistencyStatus === "consistent" ? "border-green-400 text-green-600"
                      : v.consistencyStatus === "inconsistent" ? "border-red-400 text-red-500"
                      : "border-amber-400 text-amber-600"
                    }`}
                  >
                    <option value="not_validated">Belum divalidasi</option>
                    <option value="consistent">Konsisten ✓</option>
                    <option value="inconsistent">Tidak konsisten ✗</option>
                  </select>
                  <button
                    onClick={() => archiveVariant.mutate(v.id)}
                    className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-lg transition-colors text-muted-foreground"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Add variant */}
              <div className="flex gap-2">
                <input
                  value={newVariantName}
                  onChange={(e) => setNewVariantName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newVariantName.trim() && addVariant.mutate(newVariantName.trim())}
                  placeholder="Nama varian baru..."
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={() => newVariantName.trim() && addVariant.mutate(newVariantName.trim())}
                  disabled={!newVariantName.trim() || addVariant.isPending}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {addVariant.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Tambah
                </button>
              </div>
            </div>
          </section>

        </div>

        {/* Action footer */}
        {actions.length > 0 && (
          <div className="shrink-0 border-t border-border px-6 py-4 bg-muted/10">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Tindakan Selanjutnya</p>
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action.status}
                  onClick={() => changeStatus.mutate({ status: action.status })}
                  disabled={changeStatus.isPending}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                    action.variant === "primary"
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : action.variant === "warning"
                      ? "bg-amber-600 text-white hover:bg-amber-700"
                      : "bg-muted text-foreground hover:bg-muted/80 border border-border"
                  }`}
                >
                  {changeStatus.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {action.label}
                </button>
              ))}
            </div>
            {order.status === "prepress_validation" && !order.prepressValidationJson && (
              <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Jalankan validasi prepress sebelum menandai Siap Cetak.
              </p>
            )}
            {order.status === "prepress_validation" && order.prepressValidationJson?.blockerCount !== undefined && order.prepressValidationJson.blockerCount > 0 && (
              <p className="text-[11px] text-red-500 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {order.prepressValidationJson.blockerCount} blocker aktif — selesaikan dulu sebelum Siap Cetak.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PackagingDesignAdminPage() {
  const { toast } = useToast();
  const [selectedOrder, setSelectedOrder] = useState<PackagingOrder | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");

  const { data: ordersData, isLoading, refetch } = useQuery({
    queryKey: ["pkg-orders", filterStatus, filterType],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterType) params.set("serviceType", filterType);
      return apiFetch<{ orders: PackagingOrder[]; total: number }>(`/api/ai/packaging-design/orders?${params}`);
    },
  });

  const { data: analytics } = useQuery({
    queryKey: ["pkg-analytics"],
    queryFn: () => apiFetch<Analytics>("/api/ai/packaging-design/analytics"),
  });

  const orders = ordersData?.orders ?? [];
  const total = ordersData?.total ?? 0;

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="w-6 h-6 text-primary" />
              Packaging Design
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">Team 19 — Manajemen pesanan desain kemasan</p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Analytics cards */}
        {analytics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Total Pesanan", value: analytics.totalOrders, icon: Package, color: "text-blue-600" },
              { label: "Siap Cetak",    value: analytics.printReadyCount, icon: ShieldCheck, color: "text-green-600" },
              { label: "Pass Rate",     value: `${(analytics.validationPassRate * 100).toFixed(0)}%`, icon: BarChart2, color: "text-violet-600" },
              { label: "Draft / Baru", value: (analytics.byStatus["draft"] ?? 0) + (analytics.byStatus["submitted"] ?? 0), icon: Clock, color: "text-amber-600" },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="p-4 rounded-2xl border border-border bg-card">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${card.color}`} />
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </div>
                  <p className="text-2xl font-bold">{card.value}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Semua Status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Semua Tipe</option>
            {Object.entries(SERVICE_NAMES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground ml-auto">{total} pesanan</span>
        </div>

        {/* Orders table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">Belum ada pesanan packaging design.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  {["Layanan","Brand & Produk","Customer","Varian","Validasi","Status",""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const ServiceIcon = SERVICE_ICONS[o.serviceType] ?? Package;
                  const validation = o.prepressValidationJson;
                  return (
                    <tr
                      key={o.id}
                      className="border-b border-border hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setSelectedOrder(o)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ServiceIcon className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-xs text-muted-foreground">{SERVICE_NAMES[o.serviceType] ?? o.serviceType}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{o.brandName}</p>
                        <p className="text-xs text-muted-foreground">{o.productName}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{o.customerName}</p>
                        <p className="text-xs text-muted-foreground">{o.customerEmail}</p>
                      </td>
                      <td className="px-4 py-3 text-center">{o.variantCount}</td>
                      <td className="px-4 py-3">
                        {validation ? (
                          <div className="flex items-center gap-1.5">
                            <ValidationOutcomeIcon outcome={validation.outcome} />
                            <span className="text-xs text-muted-foreground">
                              {validation.blockerCount > 0 ? `${validation.blockerCount} blocker` : "Lulus"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-3">
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedOrder && (
        <DetailDrawer
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </Layout>
  );
}
