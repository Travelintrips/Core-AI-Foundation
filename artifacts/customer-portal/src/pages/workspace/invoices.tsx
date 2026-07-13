import { useState, useRef, useCallback, useEffect } from "react";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceInvoices, useSubmitPaymentProof } from "@/hooks/use-workspace";
import { useQueryClient } from "@tanstack/react-query";
import { fmtMoney, fmtDate } from "@/lib/workspace-format";
import {
  Loader2, Receipt, FileText, Download, Printer, RefreshCw,
  AlertCircle, CheckCircle2, Clock, X, Send, Info, Banknote,
  Upload, Image, Eye, Trash2,
} from "lucide-react";
import { PaymentInstructionCard } from "@/components/commercial/payment-instruction-card";

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

const MAX_FILE_SIZE_MB = 5;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface PaymentModalProps {
  invoiceNumber: string;
  amount: string;
  currency: string;
  scheduleId: number;
  existingReference: string | null;
  existingProofImageUrl: string | null;
  scheduleStatus: string | null;
  token: string;
  onClose: () => void;
}

function PaymentModal({
  invoiceNumber, amount, currency, scheduleId,
  existingReference, existingProofImageUrl, scheduleStatus, token, onClose,
}: PaymentModalProps) {
  const [reference, setReference] = useState(existingReference ?? "");
  const [success, setSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [imageViewOpen, setImageViewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitMutation = useSubmitPaymentProof(token);

  const alreadySubmitted = scheduleStatus === "waiting_payment_verification";
  const isRejected = scheduleStatus === "rejected";

  const handleFile = useCallback((file: File) => {
    setFileError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFileError("Format file tidak didukung. Gunakan JPG, PNG, atau WebP.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setFileError(`Ukuran file maksimal ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreviewFile({ base64: result, mimeType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  }, []);

  function onDropZoneDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDropZoneDragLeave() {
    setIsDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim()) return;
    try {
      await submitMutation.mutateAsync({
        scheduleId,
        reference: reference.trim(),
        proofImageBase64: previewFile?.base64 ?? null,
        proofImageMimeType: previewFile?.mimeType,
      });
      setSuccess(true);
    } catch { /* error shown from mutation state */ }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-card border border-card-border rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 sticky top-0 bg-card z-10">
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
                {previewFile && (
                  <div className="rounded-xl overflow-hidden border border-border/50">
                    <img src={previewFile.base64} alt="Bukti transfer" className="w-full max-h-48 object-contain bg-muted/20" />
                  </div>
                )}
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
                {existingProofImageUrl && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Bukti Transfer Terkirim</p>
                    <div className="relative rounded-xl overflow-hidden border border-border/50 group cursor-pointer" onClick={() => setImageViewOpen(true)}>
                      <img src={existingProofImageUrl} alt="Bukti transfer" className="w-full max-h-48 object-contain bg-muted/20" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <Eye className="w-6 h-6 text-white" />
                      </div>
                    </div>
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
                <PaymentInstructionCard />

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Reference number */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Nomor Referensi Transfer *
                    </label>
                    <input
                      type="text"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="contoh: TRF20260712001"
                      className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                      required
                    />
                  </div>

                  {/* Proof image upload */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Foto Bukti Transfer <span className="normal-case text-muted-foreground/60">(opsional, maks. {MAX_FILE_SIZE_MB}MB)</span>
                    </label>

                    {previewFile ? (
                      <div className="space-y-2">
                        <div className="relative rounded-xl overflow-hidden border border-border/50 group">
                          <img src={previewFile.base64} alt="Preview bukti" className="w-full max-h-48 object-contain bg-muted/20" />
                          <button
                            type="button"
                            onClick={() => setPreviewFile(null)}
                            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                            title="Hapus gambar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Image className="w-3.5 h-3.5" />
                          {previewFile.name}
                        </p>
                      </div>
                    ) : (
                      <div
                        onDragOver={onDropZoneDragOver}
                        onDragLeave={onDropZoneDragLeave}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer transition-colors ${
                          isDragging
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-muted/30"
                        }`}
                      >
                        <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Drag & drop atau <span className="text-primary font-medium">klik untuk pilih</span>
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">JPG, PNG, WebP</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={ACCEPTED_TYPES.join(",")}
                          onChange={onFileInput}
                          className="hidden"
                        />
                      </div>
                    )}

                    {fileError && (
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        {fileError}
                      </p>
                    )}
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

      {/* Full-screen image viewer */}
      {imageViewOpen && existingProofImageUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
          onClick={() => setImageViewOpen(false)}
        >
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
          <img
            src={existingProofImageUrl}
            alt="Bukti transfer"
            className="max-w-full max-h-full object-contain p-4"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/** Auto-refresh hook: re-fetches invoices every `intervalMs` while any invoice has
 *  `scheduleStatus === "waiting_payment_verification"`. Stops once all are resolved. */
function usePaymentStatusPolling(token: string, hasAwaitingVerification: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!hasAwaitingVerification) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["workspace-invoices", token] });
    }, 15_000);
    return () => clearInterval(id);
  }, [token, hasAwaitingVerification, qc]);
}

export default function WorkspaceInvoicesPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceInvoices(token);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generatedDocs, setGeneratedDocs] = useState<Record<number, GenerateResult>>({});
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const hasAwaitingVerification = (data?.items ?? []).some(
    (inv) => inv.scheduleStatus === "waiting_payment_verification",
  );
  usePaymentStatusPolling(token, hasAwaitingVerification);

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
          existingProofImageUrl={activeModal.proofImageUrl}
          scheduleStatus={activeModal.scheduleStatus}
          token={token}
          onClose={() => setPaymentModalInvoice(null)}
        />
      )}

      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-medium mb-1">Invoice Center</h1>
            <p className="text-muted-foreground">Lihat, unduh, dan konfirmasi pembayaran Anda.</p>
          </div>
          {hasAwaitingVerification && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-full px-3 py-1.5 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Auto-refresh aktif
            </div>
          )}
        </div>
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
              Klik "Bayar Sekarang" untuk mengirim bukti transfer (nomor referensi + foto screenshot).
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
                          {awaitingVerification && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-0.5" />}
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

                {/* Verification notice with proof thumbnail */}
                {awaitingVerification && (
                  <div className="mb-3 flex items-start gap-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 rounded-xl px-3 py-2.5">
                    <Clock className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        {inv.scheduleReference && (
                          <>Ref: <span className="font-mono font-semibold">{inv.scheduleReference}</span> · </>
                        )}
                        Sedang diverifikasi tim kami
                      </p>
                    </div>
                    {inv.proofImageUrl && (
                      <img
                        src={inv.proofImageUrl}
                        alt="Bukti"
                        className="w-10 h-10 rounded-lg object-cover border border-blue-200 dark:border-blue-800 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setPaymentModalInvoice(inv.id)}
                        title="Lihat bukti transfer"
                      />
                    )}
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
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" />Membuat PDF...</>
                      ) : (
                        <><FileText className="w-3.5 h-3.5" />Buat PDF</>
                      )}
                    </button>
                  )}

                  {canPay && (
                    <button
                      onClick={() => setPaymentModalInvoice(inv.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors ml-auto"
                    >
                      <Banknote className="w-3.5 h-3.5" />
                      {awaitingVerification ? "Lihat Bukti" : "Bayar Sekarang"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceLayout>
  );
}
