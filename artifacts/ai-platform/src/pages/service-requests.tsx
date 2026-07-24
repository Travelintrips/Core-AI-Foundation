import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, RefreshCw, FileText, ClipboardList, Calculator,
  Send, ThumbsUp, ShieldCheck, Zap, Eye, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, X, TrendingUp, DollarSign, Users,
  ArrowRight, AlertTriangle, CheckCircle, Copy, Link2, ExternalLink,
  Plus, Trash2, Save,
} from "lucide-react";

// Use empty string so fetch("/api/...") goes through the Vite /api proxy,
// not "/admin/api/..." which bypasses it.
const API_BASE = "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};


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

type PricingLineItem = { code: string; label: string; amount: number };
type PricingSnapshot = {
  basePrice?: number;
  lineItems?: PricingLineItem[];
  total?: number;
  taxPercent?: number;
  grossMargin?: number;
  grossMarginPercent?: number;
  estimatedAiCost?: number;
  humanLaborEstimate?: number;
};

type ServiceRequest = {
  id: number;
  requestId: string;
  serviceId: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  companyName: string | null;
  currency: string;
  total: string;
  subtotal: string;
  rushFee: string;
  revisionFee: string;
  humanReviewFee: string;
  additionalServiceFee: string;
  discount: string;
  tax: string;
  status: string;
  briefJson: Record<string, unknown> | null;
  marginApprovalRequired: boolean;
  marginApprovedBy: string | null;
  marginApprovedAt: string | null;
  estimatedAiCost: string | null;
  humanLaborEstimate: string | null;
  grossMargin: string | null;
  grossMarginPercent: string | null;
  pricingSnapshotJson: PricingSnapshot | null;
  completionNotes: string | null;
  completionLinks: Array<{ label: string; url: string }> | null;
  createdAt: string;
  updatedAt: string;
};

// Next status actions for each current status
const NEXT_ACTIONS: Record<string, { label: string; status: string; variant: "primary" | "secondary" | "danger" }[]> = {
  draft:                      [{ label: "Mulai Brief", status: "brief_in_progress", variant: "primary" }],
  brief_in_progress:          [{ label: "Tandai Brief Selesai", status: "brief_completed", variant: "primary" }],
  brief_completed:            [{ label: "Kirim Penawaran ke Customer", status: "quotation_ready", variant: "primary" }],
  quoted:                     [{ label: "Penawaran Siap Dikirim", status: "quotation_ready", variant: "primary" }],
  quotation_ready:            [{ label: "Tandai Menunggu Persetujuan", status: "waiting_customer_approval", variant: "secondary" }],
  waiting_customer_approval:  [],   // customer action
  approved:                   [{ label: "Proses Gate Komersial", status: "waiting_commercial_gate", variant: "primary" }, { label: "Langsung ke Produksi", status: "in_progress", variant: "secondary" }],
  waiting_commercial_gate:    [{ label: "Siap Produksi", status: "ready_to_build", variant: "primary" }],
  ready_to_build:             [{ label: "Mulai Produksi", status: "in_progress", variant: "primary" }],
  in_progress:                [{ label: "Ke Review", status: "waiting_review", variant: "secondary" }],
  orchestrating:              [{ label: "Ke Review", status: "waiting_review", variant: "secondary" }],
  waiting_review:             [{ label: "Selesai", status: "completed", variant: "primary" }],
};

function fmt(amount: string | number | null | undefined, currency = "IDR") {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "—";
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

type CommercialGate = {
  id: number;
  serviceRequestId: number | null;
  gateType: string;
  status: string;
  requiredAmount: string | null;
  verifiedAmount: string | null;
  referenceNumber: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  notes: string | null;
};

function DetailPanel({ req, onClose }: { req: ServiceRequest; onClose: () => void }) {
  const qc = useQueryClient();
  const snapshot = req.pricingSnapshotJson;

  const [quotationLink, setQuotationLink] = useState<{ url: string; validUntil: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: gate } = useQuery({
    queryKey: ["commercial-gate", req.id],
    queryFn: async () => {
      const rows = await apiFetch<CommercialGate[]>(`/api/commercial-gates?serviceRequestId=${req.id}`);
      return rows[0] ?? null;
    },
    enabled: req.status === "waiting_commercial_gate",
  });

  const [gateName, setGateName] = useState("");
  const [gateReason, setGateReason] = useState("");

  const verifyGate = useMutation({
    mutationFn: () =>
      apiFetch(`/api/commercial-gates/${gate!.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ verifiedBy: gateName.trim() }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commercial-gate", req.id] });
      qc.invalidateQueries({ queryKey: ["service-requests"] });
      toast({ title: "Gate komersial diverifikasi." });
    },
    onError: (err: Error) => toast({ title: "Gagal verifikasi gate", description: err.message, variant: "destructive" }),
  });

  const waiveGate = useMutation({
    mutationFn: () =>
      apiFetch(`/api/commercial-gates/${gate!.id}/waive`, {
        method: "POST",
        body: JSON.stringify({ waivedBy: gateName.trim(), reason: gateReason.trim() }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commercial-gate", req.id] });
      qc.invalidateQueries({ queryKey: ["service-requests"] });
      toast({ title: "Gate komersial dilewati (waived)." });
    },
    onError: (err: Error) => toast({ title: "Gagal waive gate", description: err.message, variant: "destructive" }),
  });

  const approveMargin = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ai/catalog/requests/${req.id}/approve-margin`, {
        method: "POST",
        body: JSON.stringify({ approvedBy: "admin" }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-requests"] }),
  });

  const generateLink = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; quotationUrl: string; validUntil: string; customerEmail: string; emailSent: boolean; emailError?: string }>(
        `/api/ai/catalog/requests/${req.id}/issue-quotation`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      setQuotationLink({ url: data.quotationUrl, validUntil: data.validUntil });
      qc.invalidateQueries({ queryKey: ["service-requests"] });
    },
  });

  function copyLink() {
    if (!quotationLink) return;
    navigator.clipboard.writeText(quotationLink.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const [completionNotes, setCompletionNotes] = useState(req.completionNotes ?? "");
  const [completionLinks, setCompletionLinks] = useState<Array<{ label: string; url: string }>>(
    req.completionLinks ?? [],
  );

  const saveCompletion = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ai/catalog/requests/${req.id}/completion`, {
        method: "PATCH",
        body: JSON.stringify({ notes: completionNotes, links: completionLinks }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-requests"] });
      toast({ title: "Hasil proyek disimpan dan akan tampil ke customer." });
    },
    onError: (err: Error) =>
      toast({ title: "Gagal menyimpan", description: err.message, variant: "destructive" }),
  });

  const { toast } = useToast();
  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/api/ai/catalog/requests/${req.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-requests"] }),
    onError: (err: Error) => toast({ title: "Tidak bisa mengubah status", description: err.message, variant: "destructive" }),
  });

  const actions = NEXT_ACTIONS[req.status] ?? [];
  const marginNeeded = req.marginApprovalRequired && !req.marginApprovedBy;
  const marginApproved = !!req.marginApprovedBy;
  const gateBlocking = req.status === "waiting_commercial_gate" && !!gate && gate.status === "pending";

  const stage = STAGES.find((s) => s.statuses.includes(req.status));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative w-full max-w-lg h-full bg-background border-l border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-lg">{req.customerName}</h2>
            <p className="text-xs text-muted-foreground font-mono">{req.requestId}</p>
          </div>
          <div className="flex items-center gap-3">
            {stage && (
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${stage.bg} ${stage.color}`}>
                {stage.label}
              </span>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Customer Info */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Info Customer</h3>
            <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
              <Row label="Nama" value={req.customerName} />
              <Row label="Email" value={req.customerEmail} />
              {req.customerPhone && <Row label="Telepon" value={req.customerPhone} />}
              {req.companyName && <Row label="Perusahaan" value={req.companyName} />}
              <Row label="Masuk" value={new Date(req.createdAt).toLocaleString("id-ID")} />
            </div>
          </section>

          {/* Margin Warning */}
          {marginNeeded && (
            <section className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-amber-800 dark:text-amber-300 text-sm">Persetujuan Margin Diperlukan</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                    Margin gross di bawah threshold yang ditetapkan. Admin harus menyetujui sebelum penawaran dikirim ke customer.
                  </p>
                  <button
                    onClick={() => approveMargin.mutate()}
                    disabled={approveMargin.isPending}
                    className="mt-3 flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                  >
                    {approveMargin.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Approve Margin
                  </button>
                </div>
              </div>
            </section>
          )}

          {marginApproved && (
            <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Margin disetujui oleh <strong className="ml-1">{req.marginApprovedBy}</strong>
              {req.marginApprovedAt && <span className="ml-1 text-muted-foreground">· {new Date(req.marginApprovedAt).toLocaleDateString("id-ID")}</span>}
            </div>
          )}

          {/* Commercial Gate */}
          {req.status === "waiting_commercial_gate" && gate && gate.status === "pending" && (
            <section className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-teal-800 dark:text-teal-300 text-sm">Gate Komersial #{gate.id} — {gate.gateType}</p>
                  <p className="text-xs text-teal-700 dark:text-teal-400 mt-1">
                    Perlu diverifikasi atau di-waive oleh admin sebelum proyek bisa lanjut ke "Siap Produksi".
                  </p>
                </div>
              </div>
              <input
                value={gateName}
                onChange={(e) => setGateName(e.target.value)}
                placeholder="Nama admin (verified by / waived by)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <textarea
                value={gateReason}
                onChange={(e) => setGateReason(e.target.value)}
                rows={2}
                placeholder="Alasan waive (wajib diisi hanya jika memilih Waive)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => verifyGate.mutate()}
                  disabled={!gateName.trim() || verifyGate.isPending || waiveGate.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {verifyGate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Verify
                </button>
                <button
                  onClick={() => waiveGate.mutate()}
                  disabled={!gateName.trim() || !gateReason.trim() || verifyGate.isPending || waiveGate.isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 border border-border rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {waiveGate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  Waive
                </button>
              </div>
            </section>
          )}

          {req.status === "waiting_commercial_gate" && gate && gate.status !== "pending" && (
            <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Gate #{gate.id} {gate.status === "verified" ? "diverifikasi" : "diwaive"} oleh <strong className="ml-1">{gate.verifiedBy}</strong>
            </div>
          )}

          {/* Pricing Breakdown */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Rincian Harga</h3>
            <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
              {snapshot?.lineItems && snapshot.lineItems.length > 0
                ? snapshot.lineItems.map((item) => (
                    <div key={item.code} className="flex justify-between">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium">{fmt(item.amount, req.currency)}</span>
                    </div>
                  ))
                : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium">{fmt(req.subtotal, req.currency)}</span>
                    </div>
                  )}
              {parseFloat(req.discount) > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Diskon</span>
                  <span>−{fmt(req.discount, req.currency)}</span>
                </div>
              )}
              {parseFloat(req.tax) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pajak</span>
                  <span className="font-medium">{fmt(req.tax, req.currency)}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between font-semibold">
                <span>Total</span>
                <span className="text-primary">{fmt(req.total, req.currency)}</span>
              </div>
            </div>
          </section>

          {/* Margin / Cost Internal */}
          {(req.grossMargin || snapshot?.grossMargin) && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Margin & Biaya Internal</h3>
              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  icon={TrendingUp}
                  label="Gross Margin"
                  value={fmt(req.grossMargin ?? snapshot?.grossMargin, req.currency)}
                  sub={`${parseFloat(req.grossMarginPercent ?? String(snapshot?.grossMarginPercent ?? 0)).toFixed(1)}%`}
                  color="text-green-600"
                />
                <MetricCard
                  icon={DollarSign}
                  label="Est. AI Cost"
                  value={fmt(req.estimatedAiCost ?? snapshot?.estimatedAiCost, req.currency)}
                  color="text-blue-600"
                />
                <MetricCard
                  icon={Users}
                  label="Labor Estimate"
                  value={fmt(req.humanLaborEstimate ?? snapshot?.humanLaborEstimate, req.currency)}
                  color="text-purple-600"
                />
              </div>
            </section>
          )}

          {/* Brief */}
          {req.briefJson && Object.keys(req.briefJson).length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Data Brief</h3>
              <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
                {Object.entries(req.briefJson)
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => (
                    <Row key={k} label={k.replace(/_/g, " ")} value={String(v)} />
                  ))}
              </div>
            </section>
          )}

          {/* Hasil Proyek — only visible when request is completed */}
          {["completed", "converted_to_project"].includes(req.status) && (
            <section className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-5 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
                Hasil Proyek — Tampil ke Customer
              </h3>

              {/* Customer results URL — for sharing */}
              {(() => {
                const resultsUrl = `${window.location.origin}/request-service/${req.requestId}/results`;
                return (
                  <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg px-3 py-2.5">
                    <p className="text-xs text-green-700 dark:text-green-300 font-medium mb-1.5 flex items-center gap-1.5">
                      <Link2 className="w-3 h-3" /> Link Hasil untuk Customer
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs text-green-800 dark:text-green-200 truncate font-mono">{resultsUrl}</code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(resultsUrl);
                          toast({ title: "Link disalin!", description: "Bagikan ke customer agar mereka bisa melihat hasil proyek." });
                        }}
                        className="shrink-0 p-1.5 rounded hover:bg-green-200 dark:hover:bg-green-800 transition-colors"
                        title="Salin link"
                      >
                        <Copy className="w-3.5 h-3.5 text-green-700 dark:text-green-300" />
                      </button>
                      <a
                        href={resultsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 p-1.5 rounded hover:bg-green-200 dark:hover:bg-green-800 transition-colors"
                        title="Buka di tab baru"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-green-700 dark:text-green-300" />
                      </a>
                    </div>
                  </div>
                );
              })()}

              {/* Notes */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Catatan untuk Customer</label>
                <textarea
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Tuliskan pesan untuk customer tentang hasil proyek ini..."
                />
              </div>

              {/* Links */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground">Link Deliverable</label>
                  <button
                    onClick={() => setCompletionLinks([...completionLinks, { label: "", url: "" }])}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Tambah Link
                  </button>
                </div>
                {completionLinks.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Belum ada link. Klik "Tambah Link" untuk menambahkan Google Drive, Dropbox, dll.</p>
                )}
                {completionLinks.map((link, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      value={link.label}
                      onChange={(e) => {
                        const updated = [...completionLinks];
                        updated[i] = { ...updated[i], label: e.target.value };
                        setCompletionLinks(updated);
                      }}
                      placeholder="Label (mis: Google Drive)"
                      className="w-28 shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      value={link.url}
                      onChange={(e) => {
                        const updated = [...completionLinks];
                        updated[i] = { ...updated[i], url: e.target.value };
                        setCompletionLinks(updated);
                      }}
                      placeholder="https://..."
                      className="flex-1 min-w-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => setCompletionLinks(completionLinks.filter((_, idx) => idx !== i))}
                      className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Save button */}
              <button
                onClick={() => saveCompletion.mutate()}
                disabled={saveCompletion.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {saveCompletion.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Save className="w-3.5 h-3.5" />}
                Simpan & Tampilkan ke Customer
              </button>
            </section>
          )}
        </div>

        {/* Send / Resend Quotation Email */}
        {snapshot && (
          <div className="shrink-0 border-t border-border px-6 py-4 bg-muted/10 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Email Penawaran</p>
            <button
              onClick={() => generateLink.mutate()}
              disabled={generateLink.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 bg-muted text-foreground hover:bg-muted/80 border border-border"
            >
              {generateLink.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {quotationLink ? "Kirim Ulang Email Penawaran" : "Kirim Email Penawaran"}
            </button>

            {generateLink.isError && (
              <p className="text-xs text-destructive">{(generateLink.error as Error).message}</p>
            )}

            {generateLink.isSuccess && (
              <div className={`text-xs rounded-lg px-3 py-2 flex items-start gap-2 ${
                generateLink.data.emailSent
                  ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                  : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
              }`}>
                {generateLink.data.emailSent ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                <span>
                  {generateLink.data.emailSent
                    ? `Email terkirim ke ${req.customerEmail}.`
                    : `Gagal mengirim email otomatis (${generateLink.data.emailError ?? "unknown error"}). Salin link di bawah untuk dikirim manual.`}
                </span>
              </div>
            )}

            {quotationLink && (
              <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono truncate flex-1">{quotationLink.url}</span>
                <button onClick={copyLink} className="p-1 hover:bg-muted rounded shrink-0" title="Salin link">
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a href={quotationLink.url} target="_blank" rel="noreferrer" className="p-1 hover:bg-muted rounded shrink-0" title="Buka link">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Action Footer */}
        {actions.length > 0 && (
          <div className="shrink-0 border-t border-border px-6 py-4 bg-muted/10 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Langkah Berikutnya</p>
            {actions.map((action) => (
              <button
                key={action.status}
                onClick={() => changeStatus.mutate(action.status)}
                disabled={
                  changeStatus.isPending ||
                  (marginNeeded && action.status === "quotation_ready") ||
                  (gateBlocking && action.status === "ready_to_build")
                }
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                  action.variant === "primary"
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : action.variant === "danger"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-muted text-foreground hover:bg-muted/80 border border-border"
                }`}
              >
                {changeStatus.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5" />
                )}
                {action.label}
                {marginNeeded && action.status === "quotation_ready" && (
                  <span className="ml-1 text-[10px] opacity-70">(approve margin dulu)</span>
                )}
                {gateBlocking && action.status === "ready_to_build" && (
                  <span className="ml-1 text-[10px] opacity-70">(verify/waive gate dulu)</span>
                )}
              </button>
            ))}
          </div>
        )}

        {req.status === "waiting_customer_approval" && (
          <div className="shrink-0 border-t border-border px-6 py-4 bg-muted/10">
            <p className="text-xs text-muted-foreground text-center">
              Menunggu customer menyetujui penawaran — tidak ada aksi admin di tahap ini.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground capitalize shrink-0">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof TrendingUp; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-background border border-border rounded-xl p-3 flex items-start gap-3">
      <div className={`w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
        {sub && <p className={`text-xs font-medium ${color}`}>{sub}</p>}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ServiceRequestsPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["new", "brief", "brief_done", "pricing", "waiting", "approved", "gate", "production"]));
  const [selected, setSelected] = useState<ServiceRequest | null>(null);

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

  // Sync selected request with fresh data after mutations
  const selectedFresh = selected ? (requests.find((r) => r.id === selected.id) ?? selected) : null;

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
                      {items.map((req) => {
                        const needsMargin = req.marginApprovalRequired && !req.marginApprovedBy;
                        return (
                          <button
                            key={req.id}
                            onClick={() => setSelected(req)}
                            className="w-full flex items-center gap-4 px-4 py-3 bg-muted/10 hover:bg-muted/30 transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{req.customerName}</p>
                              <p className="text-xs text-muted-foreground truncate">{req.customerEmail}</p>
                            </div>
                            {needsMargin && (
                              <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" /> Margin
                              </span>
                            )}
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
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          </button>
                        );
                      })}
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

      {/* Detail Panel */}
      {selectedFresh && (
        <DetailPanel req={selectedFresh} onClose={() => setSelected(null)} />
      )}
    </Layout>
  );
}
