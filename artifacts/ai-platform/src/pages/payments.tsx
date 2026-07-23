import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, Receipt, Clock, Wallet,
  XCircle, Unlock, TrendingUp, AlertTriangle, DollarSign, Lock,
  Image, Eye, X, ZoomIn,
} from "lucide-react";

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

type PaymentSchedule = {
  id: number;
  projectId: number;
  paymentType: string;
  percentage: number | null;
  amount: string;
  currency: string;
  status: string;
  reference: string | null;
  proofImageUrl: string | null;
  verifiedBy: string | null;
  paidAt: string | null;
};

type CreativeProject = {
  id: number;
  projectId: string;
  brandName: string;
  status: string;
  paymentPolicy: string;
  paymentStatus: string;
  filesUnlocked: boolean;
};

type PendingGroup = { project: CreativeProject; schedule: PaymentSchedule[] };

type PaymentKpi = {
  paidRevenue: number;
  outstandingBalance: number;
  pendingVerificationCount: number;
  lockedProjects: number;
  unlockedProjects: number;
};

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  remaining_balance: "Sisa Pembayaran",
  full_payment: "Pembayaran Penuh",
  custom_installment: "Cicilan",
  subscription_charge: "Tagihan Langganan",
};

function fmt(amount: string, currency: string) {
  const n = parseFloat(amount);
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

function fmtNum(n: number, currency = "IDR") {
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return n.toLocaleString();
}

/** Full-screen proof image lightbox */
function ProofLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={onClose}
      >
        <X className="w-5 h-5" />
      </button>
      <div
        className="relative max-w-3xl max-h-[90vh] p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={url}
          alt="Bukti transfer"
          className="max-w-full max-h-[86vh] object-contain rounded-xl shadow-2xl"
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-4 right-4 flex items-center gap-1.5 text-xs bg-black/60 hover:bg-black/80 text-white px-3 py-1.5 rounded-full transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" /> Buka Asli
        </a>
      </div>
    </div>
  );
}

/** Inline proof image thumbnail — click to open lightbox */
function ProofImageCell({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="group relative w-14 h-14 rounded-lg overflow-hidden border border-border cursor-pointer flex-shrink-0 hover:ring-2 hover:ring-primary transition-all"
        onClick={() => setOpen(true)}
        title="Lihat bukti transfer"
      >
        <img src={url} alt="Bukti" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Eye className="w-4 h-4 text-white" />
        </div>
      </div>
      {open && <ProofLightbox url={url} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function Payments() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [verifiedBy, setVerifiedBy] = useState("admin");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [unlockingId, setUnlockingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["payments", "pending"],
    queryFn: () => apiFetch<PendingGroup[]>("/api/ai/payments/pending"),
    refetchInterval: 30_000,
  });

  const { data: kpi, isLoading: kpiLoading } = useQuery({
    queryKey: ["payments", "kpi"],
    queryFn: () => apiFetch<PaymentKpi>("/api/ai/payments/kpi"),
    refetchInterval: 60_000,
  });

  const verify = useMutation({
    mutationFn: ({ scheduleId, reference }: { scheduleId: number; reference?: string }) =>
      apiFetch(`/api/ai/payments/${scheduleId}/verify`, {
        method: "POST",
        body: JSON.stringify({ verifiedBy, reference }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast({ title: "Pembayaran diverifikasi." });
    },
    onError: (err: Error) =>
      toast({ title: "Gagal memverifikasi", description: err.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: ({ scheduleId, reason }: { scheduleId: number; reason: string }) =>
      apiFetch(`/api/ai/payments/${scheduleId}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejectedBy: verifiedBy, reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      setRejectingId(null);
      setRejectReason("");
      toast({ title: "Pembayaran ditolak." });
    },
    onError: (err: Error) =>
      toast({ title: "Gagal menolak", description: err.message, variant: "destructive" }),
  });

  const invoice = useMutation({
    mutationFn: (scheduleId: number) =>
      apiFetch(`/api/ai/payments/${scheduleId}/invoice`, { method: "POST" }),
    onSuccess: () => toast({ title: "Invoice dibuat." }),
    onError: (err: Error) =>
      toast({ title: "Gagal membuat invoice", description: err.message, variant: "destructive" }),
  });

  const unlock = useMutation({
    mutationFn: ({ projectId, reason }: { projectId: number; reason: string }) =>
      apiFetch(`/api/ai/payments/project/${projectId}/unlock`, {
        method: "POST",
        body: JSON.stringify({ unlockedBy: verifiedBy, reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      setUnlockingId(null);
      toast({ title: "File proyek berhasil dibuka." });
    },
    onError: (err: Error) =>
      toast({ title: "Gagal membuka file", description: err.message, variant: "destructive" }),
  });

  const hasProofPending = (data ?? []).some((g) =>
    g.project.status === "waiting_payment_verification" ||
    g.schedule.some((s) => s.proofImageUrl),
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Wallet className="w-6 h-6" /> Verifikasi Pembayaran
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Daftar proyek dengan cicilan/pembayaran yang belum lunas. Produksi AI hanya
              berjalan setelah pembayaran (deposit atau penuh) diverifikasi di sini.
            </p>
          </div>
          {hasProofPending && (
            <div className="flex items-center gap-1.5 text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full px-3 py-1.5 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Ada bukti menunggu
            </div>
          )}
        </div>

        {/* P0-5 KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {kpiLoading ? (
            <div className="col-span-5 flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : kpi ? (
            <>
              <div className="border rounded-xl p-4 bg-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <DollarSign className="w-3.5 h-3.5" /> Paid Revenue
                </div>
                <p className="font-semibold text-lg">{fmtNum(kpi.paidRevenue)}</p>
              </div>
              <div className="border rounded-xl p-4 bg-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <TrendingUp className="w-3.5 h-3.5" /> Outstanding
                </div>
                <p className="font-semibold text-lg">{fmtNum(kpi.outstandingBalance)}</p>
              </div>
              <div className="border rounded-xl p-4 bg-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Pending Verif.
                </div>
                <p className="font-semibold text-lg">{kpi.pendingVerificationCount}</p>
              </div>
              <div className="border rounded-xl p-4 bg-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Lock className="w-3.5 h-3.5" /> Locked
                </div>
                <p className="font-semibold text-lg">{kpi.lockedProjects}</p>
              </div>
              <div className="border rounded-xl p-4 bg-card">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Unlocked
                </div>
                <p className="font-semibold text-lg text-green-600">{kpi.unlockedProjects}</p>
              </div>
            </>
          ) : null}
        </div>

        {/* Verifier identity */}
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Diverifikasi oleh:</label>
          <input
            className="border rounded px-2 py-1 bg-background text-sm w-48"
            value={verifiedBy}
            onChange={(e) => setVerifiedBy(e.target.value)}
          />
        </div>

        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (data?.length ?? 0) === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
            Tidak ada pembayaran yang menunggu verifikasi.
          </div>
        )}

        <div className="space-y-4">
          {data?.map(({ project, schedule }) => {
            const hasProof = schedule.some((s) => s.proofImageUrl);
            const isAwaitingVerif = project.status === "waiting_payment_verification";

            return (
              <div
                key={project.id}
                className={`border rounded-xl p-4 bg-card ${
                  isAwaitingVerif ? "border-amber-300 dark:border-amber-700/60" : ""
                }`}
              >
                {/* Project header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      {project.brandName}
                      {isAwaitingVerif && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          Bukti Masuk
                        </span>
                      )}
                      {hasProof && !isAwaitingVerif && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                          <Image className="w-3 h-3" /> Ada Bukti
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{project.projectId}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-muted">{project.status}</span>
                    {project.filesUnlocked ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex items-center gap-1">
                        <Unlock className="w-3 h-3" /> Unlocked
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Locked
                      </span>
                    )}
                  </div>
                </div>

                {/* Schedule rows */}
                <div className="space-y-3">
                  {schedule.map((s) => (
                    <div key={s.id} className="border-t pt-3">
                      <div className="flex items-start gap-3">
                        {/* Proof thumbnail — shown when present */}
                        {s.proofImageUrl ? (
                          <ProofImageCell url={s.proofImageUrl} />
                        ) : (
                          <div className="w-14 h-14 rounded-lg border border-dashed border-border bg-muted/30 flex items-center justify-center flex-shrink-0">
                            <Image className="w-4 h-4 text-muted-foreground/40" />
                          </div>
                        )}

                        {/* Text info + actions */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="text-sm">
                              <p className="font-medium">
                                {PAYMENT_TYPE_LABEL[s.paymentType] ?? s.paymentType} — {fmt(s.amount, s.currency)}
                              </p>
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                                <Clock className="w-3 h-3 flex-shrink-0" />
                                Status: <strong>{s.status}</strong>
                                {s.reference && (
                                  <> · Ref: <span className="font-mono">{s.reference}</span></>
                                )}
                                {s.proofImageUrl && (
                                  <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400">
                                    · <Image className="w-3 h-3" /> Bukti tersedia
                                  </span>
                                )}
                              </p>
                            </div>

                            <div className="flex gap-1.5 flex-wrap justify-end">
                              {/* Verify */}
                              <button
                                className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-1"
                                disabled={s.status === "paid" || verify.isPending}
                                onClick={() => verify.mutate({ scheduleId: s.id, reference: s.reference ?? undefined })}
                              >
                                {verify.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                                Verifikasi
                              </button>

                              {/* Reject */}
                              {rejectingId === s.id ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    className="border rounded px-2 py-1 text-xs bg-background w-36"
                                    placeholder="Alasan penolakan..."
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    autoFocus
                                  />
                                  <button
                                    className="text-xs px-2 py-1.5 rounded-lg bg-destructive text-destructive-foreground disabled:opacity-50"
                                    disabled={!rejectReason.trim() || reject.isPending}
                                    onClick={() => reject.mutate({ scheduleId: s.id, reason: rejectReason })}
                                  >
                                    Konfirmasi
                                  </button>
                                  <button
                                    className="text-xs px-2 py-1.5 rounded-lg border"
                                    onClick={() => setRejectingId(null)}
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="text-xs px-3 py-1.5 rounded-lg border border-destructive text-destructive flex items-center gap-1 disabled:opacity-50"
                                  disabled={s.status === "paid" || s.status === "cancelled" || reject.isPending}
                                  onClick={() => setRejectingId(s.id)}
                                >
                                  <XCircle className="w-3 h-3" /> Tolak
                                </button>
                              )}

                              {/* Invoice */}
                              <button
                                className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1 disabled:opacity-50"
                                disabled={invoice.isPending}
                                onClick={() => invoice.mutate(s.id)}
                              >
                                <Receipt className="w-3 h-3" /> Invoice
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Manual unlock (P0-5) */}
                {!project.filesUnlocked && (
                  <div className="mt-3 pt-3 border-t">
                    {unlockingId === project.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Override unlock:</span>
                        <button
                          className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-50 flex items-center gap-1"
                          disabled={unlock.isPending}
                          onClick={() => unlock.mutate({ projectId: project.id, reason: "Manual admin override" })}
                        >
                          <Unlock className="w-3 h-3" /> Konfirmasi Buka File
                        </button>
                        <button className="text-xs px-2 py-1.5 rounded-lg border" onClick={() => setUnlockingId(null)}>
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        className="text-xs px-3 py-1.5 rounded-lg border border-green-600 text-green-600 flex items-center gap-1"
                        onClick={() => setUnlockingId(project.id)}
                      >
                        <Unlock className="w-3 h-3" /> Buka File Manual
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
}
