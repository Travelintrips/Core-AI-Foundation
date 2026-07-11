/**
 * Project Results page — shown to the customer after a service request is
 * marked as completed by the admin.
 *
 * P0-2 / P0-6: Final files are gated behind `filesUnlocked`.
 * If remaining payment is outstanding, a lock screen is shown instead of
 * the deliverable links.
 *
 * Route: /request-service/:requestId/results
 */
import { useParams } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useRequestDetail } from "@/hooks/use-catalog";
import {
  Loader2,
  CheckCircle2,
  ExternalLink,
  FileDown,
  MessageCircle,
  PackageOpen,
  Lock,
  CreditCard,
  AlertCircle,
  Unlock,
} from "lucide-react";

function formatCurrency(amount: number | null | undefined, currency = "IDR") {
  if (amount == null || amount <= 0) return null;
  if (currency === "IDR") return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
  return `${currency} ${amount.toLocaleString()}`;
}

export default function RequestResultsPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { data, isLoading, isError } = useRequestDetail(requestId);

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep="selesai" />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <div className="text-center py-24 text-muted-foreground">
            <p>Permintaan tidak ditemukan.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start gap-4 mb-10">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                (data as any).filesUnlocked
                  ? "bg-green-100 dark:bg-green-900/30"
                  : "bg-yellow-100 dark:bg-yellow-900/30"
              }`}>
                {(data as any).filesUnlocked
                  ? <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                  : <Lock className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                }
              </div>
              <div>
                <h1 className="text-3xl font-serif font-medium mb-1">
                  {(data as any).filesUnlocked ? "Proyek Selesai!" : "Menunggu Pelunasan"}
                </h1>
                <p className="text-muted-foreground">
                  Kode permintaan:{" "}
                  <span className="font-mono text-sm">{requestId}</span>
                </p>
              </div>
            </div>

            {/* P0-6: File Lock Screen — show when files are locked */}
            {!(data as any).filesUnlocked && (
              <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-3 mb-4">
                  <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                  <div>
                    <h2 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
                      File Final Terkunci
                    </h2>
                    <p className="text-sm text-yellow-800 dark:text-yellow-300 leading-relaxed">
                      Proyek Anda telah selesai dikerjakan. File final (PNG HD, SVG, Brand Guideline,
                      dan semua deliverable) akan dibuka segera setelah pelunasan diverifikasi oleh tim kami.
                    </p>
                  </div>
                </div>

                {/* Remaining balance */}
                {(data as any).remainingBalance != null && (data as any).remainingBalance > 0 && (
                  <div className="bg-white dark:bg-yellow-900/20 rounded-xl p-4 mb-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Sisa yang harus dibayar</p>
                      <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-200">
                        {formatCurrency((data as any).remainingBalance, (data as any).currency ?? "IDR")}
                      </p>
                    </div>
                    <CreditCard className="w-8 h-8 text-yellow-600 dark:text-yellow-400 shrink-0" />
                  </div>
                )}

                {/* Pay remaining CTA */}
                <div className="rounded-xl border border-yellow-300 dark:border-yellow-700 p-4 bg-white/60 dark:bg-yellow-900/10">
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200 mb-1">
                    Cara melakukan pelunasan:
                  </p>
                  <ol className="text-sm text-yellow-800 dark:text-yellow-300 space-y-1 list-decimal list-inside">
                    <li>Transfer sesuai jumlah sisa tagihan ke rekening yang tertera di quotation Anda</li>
                    <li>Submit bukti transfer melalui halaman Pembayaran</li>
                    <li>Admin akan memverifikasi dan membuka file Anda dalam 1×24 jam</li>
                  </ol>
                </div>

                {/* What you'll get after unlock */}
                <div className="mt-4 flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400">
                  <Unlock className="w-4 h-4 shrink-0" />
                  <span>Setelah lunas: PNG HD, SVG, PSD, Brand Guideline, Editable Source, dan semua file final</span>
                </div>
              </div>
            )}

            {/* Admin notes */}
            {data.completionNotes ? (
              <div className="bg-card border border-card-border rounded-2xl p-6 mb-6 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <MessageCircle className="w-4 h-4 text-primary" />
                  <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    Pesan dari Tim Kami
                  </h2>
                </div>
                <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                  {data.completionNotes}
                </p>
              </div>
            ) : null}

            {/* Deliverable links — only shown when filesUnlocked = true */}
            {(data as any).filesUnlocked && data.completionLinks && data.completionLinks.length > 0 ? (
              <div className="bg-card border border-card-border rounded-2xl p-6 mb-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <FileDown className="w-4 h-4 text-primary" />
                  <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    Hasil & Deliverable
                  </h2>
                </div>
                <div className="space-y-3">
                  {data.completionLinks.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors group"
                    >
                      <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                        {link.label || link.url}
                      </span>
                      <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Locked deliverable preview (files exist but locked) */}
            {!(data as any).filesUnlocked && data.completionNotes && (
              <div className="bg-card border border-card-border rounded-2xl p-6 mb-6 shadow-sm opacity-60">
                <div className="flex items-center gap-2 mb-4">
                  <Lock className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    Hasil & Deliverable (Terkunci)
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  File Anda sudah siap dan menunggu pembayaran lunas untuk dibuka.
                </p>
              </div>
            )}

            {/* Empty state — no notes or links yet and files unlocked */}
            {(data as any).filesUnlocked && !data.completionNotes && (!data.completionLinks || data.completionLinks.length === 0) && (
              <div className="bg-card border border-card-border rounded-2xl p-10 mb-6 shadow-sm text-center">
                <PackageOpen className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">
                  Tim kami sedang mempersiapkan hasil proyek Anda. Anda akan
                  dihubungi melalui email atau WhatsApp secepatnya.
                </p>
              </div>
            )}

            {/* Contact footer */}
            <div className="mt-10 text-center text-sm text-muted-foreground">
              <p>
                Ada pertanyaan tentang hasil proyek? Hubungi kami melalui email
                atau WhatsApp.
              </p>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
