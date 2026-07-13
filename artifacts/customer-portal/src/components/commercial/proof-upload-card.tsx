import { useCallback, useRef, useState } from "react";
import { CheckCircle2, Info, AlertCircle, Upload, Image, Eye, Trash2, Loader2 } from "lucide-react";

const MAX_FILE_SIZE_MB = 5;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type ProofUploadCardProps = {
  /** Called on submit. Both fields are already-supported payload fields on
   *  POST /api/public/payments/:scheduleId/submit-proof — no new API surface. */
  onSubmit: (input: { reference: string; proofImageBase64: string | null; proofImageMimeType?: string }) => Promise<void>;
  isSubmitting: boolean;
  /** waiting_payment_verification / pending / rejected / paid, etc. */
  scheduleStatus: string;
  existingReference?: string | null;
  existingProofImageUrl?: string | null;
  submitError?: string | null;
};

/**
 * Payment proof submission — reference number + optional transfer screenshot.
 * Adapted from the mature pattern already used in
 * src/pages/workspace/invoices.tsx so the public checkout flow gets the same
 * drag-and-drop upload UX the logged-in workspace already has, instead of a
 * bare text input.
 */
export function ProofUploadCard({
  onSubmit,
  isSubmitting,
  scheduleStatus,
  existingReference,
  existingProofImageUrl,
  submitError,
}: ProofUploadCardProps) {
  const [reference, setReference] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [imageViewOpen, setImageViewOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const alreadySubmitted = scheduleStatus === "partially_paid" || scheduleStatus === "waiting_payment_verification";
  const isPaid = scheduleStatus === "paid";

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim()) return;
    await onSubmit({
      reference: reference.trim(),
      proofImageBase64: previewFile?.base64 ?? null,
      proofImageMimeType: previewFile?.mimeType,
    });
    setSuccess(true);
  }

  if (isPaid) return null;

  if (success || alreadySubmitted) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Menunggu Verifikasi</p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
              Bukti pembayaran Anda sedang diproses. Tim kami akan mengonfirmasi dalam 1×24 jam kerja.
            </p>
          </div>
        </div>
        {(existingReference || reference) && (
          <div className="bg-muted/40 rounded-xl px-4 py-3 mt-3">
            <p className="text-xs text-muted-foreground mb-1">Nomor Referensi Terkirim</p>
            <p className="font-mono text-sm font-semibold">{existingReference || reference}</p>
          </div>
        )}
        {(existingProofImageUrl || previewFile) && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Bukti Transfer</p>
            <div
              className="relative rounded-xl overflow-hidden border border-border/50 group cursor-pointer"
              onClick={() => setImageViewOpen(true)}
            >
              <img
                src={existingProofImageUrl || previewFile?.base64}
                alt="Bukti transfer"
                className="w-full max-h-48 object-contain bg-muted/20"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                <Eye className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        )}
        {imageViewOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
            onClick={() => setImageViewOpen(false)}
          >
            <img src={existingProofImageUrl || previewFile?.base64} alt="Bukti transfer" className="max-h-[85vh] max-w-full rounded-lg" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <h3 className="font-semibold text-sm mb-1">Konfirmasi Pembayaran</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Sudah transfer? Kirim nomor referensi dan (opsional) bukti transfer agar kami bisa segera memverifikasi.
      </p>

      {scheduleStatus === "failed" && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-3 mb-4">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Bukti Sebelumnya Ditolak</p>
            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">Silakan kirim ulang bukti transfer yang valid.</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="proof-reference" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Nomor Referensi Transfer *
          </label>
          <input
            id="proof-reference"
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="contoh: TRF20260712001"
            className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>

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
                  aria-label="Hapus gambar"
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
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
              className={`border-2 border-dashed rounded-xl px-4 py-6 text-center cursor-pointer transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
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
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}
          {fileError && <p className="text-xs text-destructive">{fileError}</p>}
        </div>

        {submitError && <p className="text-sm text-destructive">{submitError}</p>}

        <button
          type="submit"
          disabled={isSubmitting || !reference.trim()}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? "Mengirim..." : "Kirim Konfirmasi Pembayaran"}
        </button>
      </form>
    </div>
  );
}

export { CheckCircle2 as ProofUploadSuccessIcon };
