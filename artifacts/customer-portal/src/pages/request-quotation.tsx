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
} from "@/hooks/use-catalog";
import { Loader2, CheckCircle2, XCircle, MessageSquare, FileText, Clock, ShieldCheck } from "lucide-react";

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

  if (!token) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <p className="text-muted-foreground">Link penawaran tidak valid.</p>
        </div>
      </Layout>
    );
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center max-w-sm">
            <h2 className="text-xl font-serif mb-2">Penawaran Tidak Ditemukan</h2>
            <p className="text-sm text-muted-foreground">Link mungkin sudah kedaluwarsa atau tidak valid.</p>
          </div>
        </div>
      </Layout>
    );
  }

  const { quotation, items } = data;
  const terminal = TERMINAL[quotation.status];
  const isActive = !terminal;
  const stepperStep = quotation.status === "approved" ? "verifikasi" : "persetujuan";

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
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Penawaran Resmi</p>
            <h1 className="text-3xl font-serif font-medium">{quotation.quotationCode}</h1>
            <p className="text-muted-foreground text-sm mt-1">untuk {quotation.customerName}</p>
          </div>
          {terminal && (
            <div className={`flex items-center gap-2 text-sm font-medium ${terminal.color}`}>
              <terminal.icon className="w-4 h-4" />
              {terminal.label}
            </div>
          )}
        </div>

        {/* Line items */}
        {items && items.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden mb-6">
            <div className="p-4 border-b border-border bg-muted/30">
              <h2 className="font-medium flex items-center gap-2"><FileText className="w-4 h-4" /> Rincian Layanan</h2>
            </div>
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.id} className="flex items-start justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.quantity} × {formatMoney(item.unitPrice, quotation.currency)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap ml-4">
                    {formatMoney(item.amount, quotation.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="bg-card border border-border rounded-2xl p-6 mb-6">
          <div className="space-y-2">
            <TotalRow label="Subtotal" amount={quotation.subtotal} currency={quotation.currency} />
            {quotation.discount > 0 && (
              <TotalRow label="Diskon" amount={-quotation.discount} currency={quotation.currency} className="text-green-600" />
            )}
            {quotation.tax > 0 && (
              <TotalRow label="Pajak" amount={quotation.tax} currency={quotation.currency} />
            )}
          </div>
          <div className="border-t border-border mt-3 pt-3 flex justify-between items-center">
            <span className="font-bold text-lg">Total</span>
            <span className="text-2xl font-bold text-primary">
              {formatMoney(quotation.total, quotation.currency)}
            </span>
          </div>
          {quotation.validUntil && (
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Berlaku hingga {new Date(quotation.validUntil).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
        </div>

        {/* Actions (only if quotation is active) */}
        {isActive && (
          <div className="space-y-4">
            {/* Approve */}
            {!showChange && !showReject && (
              <button
                onClick={handleApprove}
                disabled={approve.isPending}
                className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Setujui Penawaran
              </button>
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
              Langkah berikutnya: verifikasi komersial oleh tim kami sebelum produksi dimulai.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}

function TotalRow({ label, amount, currency, className = "" }: { label: string; amount: number; currency: string; className?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${className}`}>{formatMoney(Math.abs(amount), currency)}</span>
    </div>
  );
}
