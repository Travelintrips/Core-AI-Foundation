import { useState } from "react";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceInvoices, useSubmitPaymentProof } from "@/hooks/use-workspace";
import { fmtMoney, fmtDate } from "@/lib/workspace-format";
import {
  Loader2, Receipt, FileText, Download, Printer, CreditCard, RefreshCw,
  AlertCircle, CheckCircle2, Clock, X, Send, Copy, Check, Info, Banknote,
} from "lucide-react";

interface GenerateResult {
  documentNumber: string;
  documentType: string;
  status: string;
  generatedAt: string | null;
  accessToken: string;
  expiresAt: string;
  downloadPath: string;
}

function statusConfig(status: string): { label: string; icon: React.ReactNode; cls: string } {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    paid:            { label: "Lunas",          icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    settled:         { label: "Lunas",          icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    partially_paid:  { label: "Sebagian",       icon: <Clock className="w-3.5 h-3.5" />,        cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    overdue:         { label: "Jatuh Tempo",    icon: <AlertCircle className="w-3.5 h-3.5" />,  cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    issued:          { label: "Diterbitkan",    icon: <FileText className="w-3.5 h-3.5" />,     cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    draft:           { label: "Draft",          icon: <FileText className="w-3.5 h-3.5" />,     cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
    cancelled:       { label: "Dibatalkan",     icon: <AlertCircle className="w-3.5 h-3.5" />,  cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
    voided:          { label: "Void",           icon: <AlertCircle className="w-3.5 h-3.5" />,  cls: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
  };
  return map[status] ?? { label: status, icon: null, cls: "bg-muted text-muted-foreground" };
}

function scheduleStatusBadge(s: string | null): { label: string; cls: string } | null {
  if (!s) return null;
  const map: Record<string, { label: string; cls: string }> = {
    pending:                       { label: "Belum Dibayar",          cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    waiting_payment_verification:  { label: "Menunggu Verifikasi",    cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    paid:                          { label: "Lunas",                  cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    rejected:                      { label: "Bukti Ditolak",          cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  };
  return map[s] ?? null;
}

interface PaymentModalProps {
  invoiceNumber: string;
  amount: string;
  currency: string;
  scheduleId: number;
  existingReference: string | null;
  scheduleStatus: string | null;
  token: string;
  onClose: () => void;
}

const BANK_ACCOUNTS = [
  { bank: "BCA", accountNumber: "123-456-7890", accountName: "PT Creative AI Studio" },
  { bank: "Mandiri", accountNumber: "098-765-4321", accountName: "PT Creative AI Studio" },
  { bank: "BNI", accountNumber: "555-111-2222", accountName: "PT Creative AI Studio" },
];

function PaymentModal({
  invoiceNumber, amount, currency, scheduleId,
  existingReference, scheduleStatus, token, onClose,
}: PaymentModalProps) {
  const [reference, setReference] = useState(existingReference ?? "");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [success, setSuccess] = useState(false);
  const submitMutation = useSubmitPaymentProof(token);

  const alreadySubmitted = scheduleStatus === "waiting_payment_verification";
  const isRejected = scheduleStatus === "rejected";

  function copyAccountNumber(idx: number, value: string) {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim()) return;
    try {
      await submitMutation.mutateAsync({ scheduleId, reference: reference.trim() });
      setSuccess(true);
    } catch { /* error shown from mutation state */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-card-border rounded-2xl w-full max-w-lg shadow-2xl">

        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-base">Konfirmasi Pembayaran</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Invoice summary */}
          <div className="bg-muted/40 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Invoice</p>
              <p className="font-semibold text-sm">{invoiceNumber}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-0.5">Total</p>
              <p className="font-bold text-lg">{fmtMoney(Number(amount), currency)}</p>
            </div>
          </div>

          {success ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-base mb-1">Bukti Pembayaran Terkirim</h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  Tim kami akan memverifikasi pembayaran Anda dalam 1×24 jam kerja.
                  Anda akan menerima notifikasi setelah verifikasi selesai.
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl px-4 py-3 text-left">
                <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-0.5">Nomor Referensi Anda</p>
                <p className="font-mono text-sm text-blue-900 dark:text-blue-100 font-semibold">{reference}</p>
              </div>
              <button onClick={onClose} className="mt-2 px-5 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                Tutup
              </button>
            </div>
          ) : alreadySubmitted && !isRejected ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl px-4 py-3">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Menunggu Verifikasi</p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                    Bukti pembayaran Anda sedang diproses. Tim kami akan mengonfirmasi dalam 1×24 jam kerja.
                  </p>
                </div>
              </div>
              {existingReference && (
                <div className="bg-muted/40 rounded-xl px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-1">Nomor Referensi Terkirim</p>
                  <p className="font-mono text-sm font-semibold">{existingReference}</p>
                </div>
              )}
              <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-muted hover:bg-muted/70 text-sm font-medium transition-colors">
                Tutup
              </button>
            </div>
          ) : (
            <>
              {isRejected && (
                <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">Bukti Sebelumnya Ditolak</p>
                    <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                      Silakan kirim ulang bukti transfer yang valid.
                    </p>
                  </div>
                </div>
              )}

              {/* Bank accounts */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rekening Tujuan</p>
                {BANK_ACCOUNTS.map((acc, idx) => (
                  <div key={idx} className="bg-muted/40 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-sm">{acc.bank}</p>
                      <p className="font-mono text-xs text-muted-foreground">{acc.accountNumber}</p>
                      <p className="text-xs text-muted-foreground">{acc.accountName}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyAccountNumber(idx, acc.accountNumber)}
                      className="p-2 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
                      title="Salin nomor rekening"
                    >
                      {copiedIdx === idx
                        ? <Check className="w-4 h-4 text-green-500" />
                        : <Copy className="w-4 h-4 text-muted-foreground" />
                      }
                    </button>
                  </div>
                ))}
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Nomor Referensi Transfer *
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="contoh: TRF20260712001 atau nomor bukti transfer"
                    className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Masukkan nomor referensi / bukti transfer dari bank Anda.
                  </p>
                </div>

                {submitMutation.error && (
                  <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-2.5">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {submitMutation.error.message}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl border border-input bg-background text-sm font-medium hover:bg-muted transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submitMutation.isPending || !reference.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Mengirim...</>
                    ) : (
                      <><Send className="w-4 h-4" />Kirim Bukti Bayar</>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceInvoicesPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceInvoices(token);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generatedDocs, setGeneratedDocs] = useState<Record<number, GenerateResult>>({});
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  async function handleGenerate(invoiceId: number, docType?: string) {
    setGeneratingId(invoiceId);
    setGenerateError(null);
    try {
      const resp = await fetch(
        `/api/public/customer/workspace/${token}/invoices/${invoiceId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(docType ? { documentType: docType } : {}),
        },
      );
      if (!resp.ok) {
        const body = await resp.json() as { error?: string };
        throw new Error(body.error ?? "Gagal membuat dokumen");
      }
      const result = await resp.json() as GenerateResult;
      setGeneratedDocs((prev) => ({ ...prev, [invoiceId]: result }));
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Gagal membuat dokumen");
    } finally {
      setGeneratingId(null);
    }
  }

  function handleDownload(downloadPath: string) {
    window.open(downloadPath, "_blank");
  }

  const STATUS_FILTERS = [
    { key: "all",          label: "Semua" },
    { key: "issued",       label: "Belum Dibayar" },
    { key: "overdue",      label: "Jatuh Tempo" },
    { key: "paid",         label: "Lunas" },
    { key: "partially_paid", label: "Sebagian" },
  ];

  const filteredItems = (data?.items ?? []).filter((inv) =>
    statusFilter === "all" ? true : inv.status === statusFilter
  );

  const activeModal = paymentModalInvoice !== null
    ? (data?.items ?? []).find((inv) => inv.id === paymentModalInvoice)
    : null;

  const pendingCount = (data?.items ?? []).filter(
    (inv) => ["issued", "overdue"].includes(inv.status) && inv.scheduleStatus === "pending"
  ).length;

  return (
    <WorkspaceLayout token={token}>
      {activeModal && activeModal.paymentScheduleId && (
        <PaymentModal
          invoiceNumber={activeModal.invoiceNumber}
          amount={activeModal.amount}
          currency={activeModal.currency}
          scheduleId={activeModal.paymentScheduleId}
          existingReference={activeModal.scheduleReference}
          scheduleStatus={activeModal.scheduleStatus}
          token={token}
          onClose={() => setPaymentModalInvoice(null)}
        />
      )}

      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Invoice Center</h1>
        <p className="text-muted-foreground">Lihat, unduh, dan konfirmasi pembayaran Anda.</p>
      </div>

      {/* Pending payment banner */}
      {pendingCount > 0 && (
        <div className="mb-5 flex items-start gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-2xl px-5 py-4">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200 text-sm">
              {pendingCount} Invoice Menunggu Pembayaran
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
              Klik "Bayar Sekarang" pada invoice di bawah untuk mengirim bukti transfer.
            </p>
          </div>
        </div>
      )}

      {generateError && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {generateError}
        </div>
      )}

      {/* Filter chips */}
      {!isLoading && data && data.items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {STATUS_FILTERS.map((f) => {
            const count = f.key === "all"
              ? data.items.length
              : data.items.filter((i) => i.status === f.key).length;
            if (f.key !== "all" && count === 0) return null;
            return (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  statusFilter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/70 text-muted-foreground"
                }`}
              >
                {f.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  statusFilter === f.key ? "bg-white/20" : "bg-background"
                }`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Receipt className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-xl font-medium mb-2">Belum ada invoice</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Invoice akan muncul di sini setelah proyek Anda memiliki jadwal pembayaran.
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-10 text-center">
          <p className="text-muted-foreground text-sm">Tidak ada invoice dengan status ini.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((inv) => {
            const sc = statusConfig(inv.status);
            const ss = scheduleStatusBadge(inv.scheduleStatus);
            const generated = generatedDocs[inv.id];
            const isGenerating = generatingId === inv.id;
            const canPay = inv.paymentScheduleId !== null &&
              ["issued", "partially_paid", "overdue"].includes(inv.status) &&
              inv.scheduleStatus !== "paid";
            const awaitingVerification = inv.scheduleStatus === "waiting_payment_verification";

            return (
              <div
                key={inv.id}
                id={`invoice-${inv.id}`}
                className={`bg-card border rounded-2xl p-5 transition-colors ${
                  awaitingVerification
                    ? "border-blue-200 dark:border-blue-900/50"
                    : inv.status === "overdue"
                    ? "border-red-200 dark:border-red-900/50"
                    : "border-card-border"
                }`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-base">{inv.invoiceNumber}</p>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${sc.cls}`}>
                        {sc.icon}
                        {sc.label}
                      </span>
                      {ss && (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${ss.cls}`}>
                          {ss.label}
                        </span>
                      )}
                    </div>
                    {inv.projectNumber && (
                      <p className="text-sm text-muted-foreground">Proyek #{inv.projectNumber}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {inv.issuedAt && `Diterbitkan: ${fmtDate(inv.issuedAt)}`}
                      {inv.dueDate && ` · Jatuh Tempo: ${fmtDate(inv.dueDate)}`}
                    </p>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-xl font-bold">{fmtMoney(Number(inv.amount), inv.currency)}</p>
                    {inv.paidAt && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Dibayar {fmtDate(inv.paidAt)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Verification notice */}
                {awaitingVerification && inv.scheduleReference && (
                  <div className="mb-3 flex items-center gap-2 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 rounded-xl px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      Referensi <span className="font-mono font-semibold">{inv.scheduleReference}</span> sedang diverifikasi tim kami.
                    </span>
                  </div>
                )}

                {/* Action row */}
                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border/50">
                  {generated ? (
                    <>
                      <button
                        onClick={() => handleDownload(generated.downloadPath)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Unduh PDF
                      </button>
                      <button
                        onClick={() => handleGenerate(inv.id)}
                        disabled={isGenerating}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                        Buat Ulang
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleGenerate(inv.id)}
                      disabled={isGenerating}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileText className="w-3.5 h-3.5" />
                      )}
                      {isGenerating ? "Membuat PDF..." : "Buat PDF"}
                    </button>
                  )}

                  <button
                    onClick={() => handleGenerate(inv.id, "payment_receipt")}
                    disabled={isGenerating || inv.status !== "paid"}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50"
                  >
                    <Receipt className="w-3.5 h-3.5" />
                    Tanda Terima
                  </button>

                  {canPay && (
                    <button
                      onClick={() => setPaymentModalInvoice(inv.id)}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-opacity hover:opacity-90 ${
                        awaitingVerification
                          ? "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                          : "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      {awaitingVerification ? "Lihat Status" : "Bayar Sekarang"}
                    </button>
                  )}

                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors ml-auto"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print
                  </button>
                </div>

                {generated && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {generated.documentNumber} siap · Valid hingga {fmtDate(generated.expiresAt)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceLayout>
  );
}
