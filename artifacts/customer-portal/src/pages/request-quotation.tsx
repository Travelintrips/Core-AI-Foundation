/**
 * Service-catalog quotation page — accessible via token.
 * Route: /request-service/:requestId/quotation?token=<reviewToken>
 *
 * Uses the new /api/public/quotations/:token endpoint (ai_quotations flow).
 */
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useToast } from "@/hooks/use-toast";
import {
  useServiceQuotation,
  useApproveServiceQuotation,
  useRequestChangeServiceQuotation,
  useRejectServiceQuotation,
  useRequestDetail,
} from "@/hooks/use-catalog";

/** Map service-request status → flow-stepper key */
export function requestStatusToStep(status: string): string {
  if (["completed", "converted_to_project"].includes(status)) return "selesai";
  if (["waiting_review", "revision_requested"].includes(status)) return "review";
  if (["ready_to_build", "pending", "orchestrating", "in_progress"].includes(status)) return "produksi";
  if (["approved", "waiting_commercial_gate"].includes(status)) return "verifikasi";
  return "persetujuan";
}
import { Loader2, CheckCircle2, XCircle, MessageSquare, FileText, Clock, ShieldCheck } from "lucide-react";
import { CommercialStatusBadge } from "@/components/commercial/commercial-status-badge";
import { ActionRequiredPanel } from "@/components/commercial/action-required-panel";
import { PriceBreakdown } from "@/components/commercial/price-breakdown";
import { CommercialErrorState } from "@/components/commercial/commercial-error-state";

/** Message shown under the "Penawaran telah disetujui!" banner, based on real backend progress. */
function postApproveMessage(requestStatus: string | null): string {
  if (!requestStatus) return "Langkah berikutnya: verifikasi komersial oleh tim kami sebelum produksi dimulai.";
  if (["completed", "converted_to_project"].includes(requestStatus)) return "Project Anda telah selesai!";
  if (["waiting_review", "revision_requested"].includes(requestStatus)) return "Project Anda sedang ditinjau oleh tim kami sebelum diserahkan.";
  if (["pending", "orchestrating", "in_progress", "ready_to_build"].includes(requestStatus)) return "Verifikasi komersial selesai — tim AI kami sedang mengerjakan project Anda.";
  return "Langkah berikutnya: verifikasi komersial oleh tim kami sebelum produksi dimulai.";
}

function formatMoney(amount: number, currency = "IDR") {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

const TERMINAL: Record<string, { icon: typeof CheckCircle2; label: string; color: string }> = {
  approved:           { icon: CheckCircle2, label: "Penawaran Disetujui",        color: "text-green-600" },
  rejected:           { icon: XCircle,      label: "Penawaran Ditolak",           color: "text-destructive" },
  revision_requested: { icon: MessageSquare,label: "Revisi Diminta",              color: "text-amber-600" },
  expired:            { icon: Clock,        label: "Penawaran Kedaluwarsa",       color: "text-muted-foreground" },
  cancelled:          { icon: XCircle,      label: "Penawaran Dibatalkan",        color: "text-muted-foreground" },
};

export default function RequestQuotationPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Read token from query string
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const { data, isLoading, error } = useServiceQuotation(token);
  const approve = useApproveServiceQuotation();
  const requestChange = useRequestChangeServiceQuotation();
  const reject = useRejectServiceQuotation();

  const [changeNotes, setChangeNotes] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [showChange, setShowChange] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  if (!token) {
    return (
      <Layout>
        <CommercialErrorState
          title="Link Penawaran Tidak Valid"
          description="Tautan yang Anda buka tidak menyertakan kode akses yang sah. Silakan gunakan tautan dari email terakhir kami."
          backHref="/"
          backLabel="Kembali ke beranda"
        />
      </Layout>
    );
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-32" role="status" aria-live="polite">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <CommercialErrorState
          title="Penawaran Tidak Ditemukan"
          description="Link mungkin sudah kedaluwarsa atau tidak valid. Silakan hubungi kami untuk penawaran baru."
          backHref="/"
          backLabel="Kembali ke beranda"
        />
      </Layout>
    );
  }

  const { quotation, items, requestStatus } = data;
  const terminal = TERMINAL[quotation.status];
  const isActive = !terminal;
  const stepperStep =
    quotation.status === "approved"
      ? requestStatusToStep(requestStatus ?? "approved")
      : "persetujuan";

  const handleApprove = () => {
    approve.mutate({ token }, {
      onSuccess: () => {
        toast({ title: "Penawaran disetujui!", description: "Kami akan memproses verifikasi komersial." });
        setLocation(`/request-service/${requestId}/approval?token=${token}`);
      },
      onError: (err) => toast({ title: "Gagal", description: String((err as Error)?.message ?? err), variant: "destructive" }),
    });
  };

  const handleRequestChange = () => {
    if (!changeNotes.trim()) {
      toast({ title: "Catatan wajib diisi", description: "Jelaskan perubahan yang diinginkan.", variant: "destructive" });
      return;
    }
    requestChange.mutate({ token, notes: changeNotes }, {
      onSuccess: () => toast({ title: "Permintaan perubahan terkirim", description: "Tim kami akan meninjau dan menghubungi Anda." }),
      onError: (err) => toast({ title: "Gagal", description: String((err as Error)?.message ?? err), variant: "destructive" }),
    });
  };

  const handleReject = () => {
    reject.mutate({ token, notes: rejectNotes }, {
      onSuccess: () => toast({ title: "Penawaran ditolak" }),
      onError: (err) => toast({ title: "Gagal", description: String((err as Error)?.message ?? err), variant: "destructive" }),
    });
  };

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep={stepperStep} />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Penawaran Resmi</p>
            <h1 className="text-3xl font-serif font-medium">{quotation.quotationCode}</h1>
            <p className="text-muted-foreground text-sm mt-1">untuk {quotation.customerName}</p>
          </div>
          <CommercialStatusBadge status={quotation.status} />
        </div>

        {isActive && (
          <ActionRequiredPanel
            title="Tinjau dan tanggapi penawaran ini"
            description="Setujui untuk memulai verifikasi komersial, atau minta perubahan / tolak jika belum sesuai."
            {...(quotation.validUntil
              ? {
                  deadline: new Date(quotation.validUntil).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                }
              : {})}
            consequence="Produksi belum dimulai sebelum Anda menyetujui penawaran ini."
            className="mb-6"
          />
        )}

        {/* Line items */}
        {items && items.length > 0 ? (
          <div className="mb-6">
            <PriceBreakdown
              currency={quotation.currency}
              lineItems={items.map((item) => ({
                key: item.id,
                label: item.description,
                meta: `${item.quantity} × ${formatMoney(item.unitPrice, quotation.currency)}`,
                amount: item.amount,
              }))}
              subtotal={quotation.subtotal}
              discount={quotation.discount}
              taxLabel="Pajak"
              taxAmount={quotation.tax}
              total={quotation.total}
              formatMoney={formatMoney}
            />
            {quotation.validUntil && (
              <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" />
                Berlaku hingga {new Date(quotation.validUntil).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-6 mb-6">
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-bold text-lg">Total</span>
              <span className="text-2xl font-bold text-primary">
                {formatMoney(quotation.total, quotation.currency)}
              </span>
            </div>
          </div>
        )}

        {/* Actions (only if quotation is active) */}
        {isActive && (
          <div className="space-y-4">
            {/* Approve */}
            {!showChange && !showReject && (
              <>
                <label className="flex items-start gap-2.5 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-border"
                  />
                  Saya sudah meninjau rincian harga di atas dan setuju untuk melanjutkan.
                </label>
                <button
                  onClick={handleApprove}
                  disabled={approve.isPending || !confirmChecked}
                  aria-disabled={!confirmChecked}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
                  Setujui Penawaran
                </button>
              </>
            )}

            {/* Request change */}
            {!showReject && (
              <div>
                {!showChange ? (
                  <button
                    onClick={() => setShowChange(true)}
                    className="w-full py-3 border border-border text-sm font-medium rounded-xl hover:bg-muted/50 transition-colors"
                  >
                    Minta Perubahan
                  </button>
                ) : (
                  <div className="border border-amber-200 rounded-xl p-4 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Deskripsikan perubahan yang diinginkan:</p>
                    <textarea
                      className="w-full border border-border rounded-lg p-3 text-sm min-h-[100px] bg-background"
                      value={changeNotes}
                      onChange={(e) => setChangeNotes(e.target.value)}
                      placeholder="Jelaskan secara detail perubahan yang Anda butuhkan..."
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleRequestChange}
                        disabled={requestChange.isPending}
                        className="flex-1 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-60 transition-colors"
                      >
                        {requestChange.isPending ? "Mengirim..." : "Kirim Permintaan Perubahan"}
                      </button>
                      <button onClick={() => setShowChange(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Reject */}
            {!showChange && (
              <div>
                {!showReject ? (
                  <button
                    onClick={() => setShowReject(true)}
                    className="w-full py-3 text-sm text-destructive hover:text-destructive/80 transition-colors"
                  >
                    Tolak Penawaran
                  </button>
                ) : (
                  <div className="border border-destructive/30 rounded-xl p-4 bg-destructive/5 space-y-3">
                    <p className="text-sm font-medium text-destructive">Tolak penawaran ini?</p>
                    <textarea
                      className="w-full border border-border rounded-lg p-3 text-sm min-h-[80px] bg-background"
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      placeholder="Alasan penolakan (opsional)..."
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleReject}
                        disabled={reject.isPending}
                        className="flex-1 py-2 bg-destructive text-destructive-foreground text-sm font-medium rounded-lg hover:bg-destructive/90 disabled:opacity-60 transition-colors"
                      >
                        {reject.isPending ? "Memproses..." : "Ya, Tolak"}
                      </button>
                      <button onClick={() => setShowReject(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Post-approve info */}
        {quotation.status === "approved" && (
          <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl p-5 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="font-medium text-green-700 dark:text-green-400">Penawaran telah disetujui!</p>
            <p className="text-sm text-green-600/80 dark:text-green-500/80 mt-1">
              {postApproveMessage(requestStatus)}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
