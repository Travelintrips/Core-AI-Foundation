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
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useRequestDetail } from "@/hooks/use-catalog";
import { DashboardAccessButton } from "@/components/commercial/dashboard-access-button";
import { PaymentInstructionCard } from "@/components/commercial/payment-instruction-card";
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
  ArrowLeft,
} from "lucide-react";

function formatCurrency(amount: number | null | undefined, currency = "IDR") {
  if (amount == null || amount <= 0) return null;
  if (currency === "IDR") return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
  return `${currency} ${amount.toLocaleString()}`;
}

// ── RC-2/RC-3 fix: derive canonical display state from server fields ──────────
//
// Priority order (highest first):
//   complete          — filesUnlocked = true
//   production_in_progress — project still running (not completed/failed)
//   billing_pending   — production done but no invoice/schedule record yet
//   awaiting_payment  — invoice exists and balance > 0
//
// This prevents the "Menunggu Pelunasan" screen from appearing when there is
// no invoice and no balance — which was the original bug where customers saw a
// payment demand with zero information to act on.

type DisplayState = "complete" | "production_in_progress" | "billing_pending" | "awaiting_payment";

const PRODUCTION_IN_PROGRESS_STATUSES = new Set([
  "waiting_payment", "deposit_paid", "payment_verified", "ready_to_build",
  "running", "orchestrating", "building", "in_progress", "generating_document",
  "generating_presentation",
]);

function deriveDisplayState(d: ReturnType<typeof useRequestDetail>["data"]): DisplayState {
  if (!d) return "production_in_progress";
  const filesUnlocked = (d as any).filesUnlocked === true;
  if (filesUnlocked) return "complete";

  const productionStatus: string | null = (d as any).productionStatus ?? null;
  const invoiceExists: boolean = (d as any).invoiceExists === true;
  const remainingBalance: number | null = (d as any).remainingBalance ?? null;

  // If no linked project, or if the linked project is still in a pre-completion status → in progress
  if (!productionStatus || PRODUCTION_IN_PROGRESS_STATUSES.has(productionStatus)) {
    return "production_in_progress";
  }

  // Production is done (completed/failed/outputs_ready) but no billing record yet
  if (!invoiceExists) return "billing_pending";

  // Invoice exists — show the payment screen if there's an outstanding balance
  if (remainingBalance !== null && remainingBalance > 0) return "awaiting_payment";

  // Invoice exists but balance is 0 — payment received but files not yet unlocked (admin pending)
  return "billing_pending";
}

export default function RequestResultsPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { data, isLoading, isError } = useRequestDetail(requestId);

  const displayState: DisplayState = deriveDisplayState(data);

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-8 pt-6 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group">
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Kembali
        </Link>
      </div>
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
            {/* Header — title driven by canonical display state, not just filesUnlocked */}
            <div className="flex items-start gap-4 mb-10">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                displayState === "complete"
                  ? "bg-green-100 dark:bg-green-900/30"
                  : displayState === "awaiting_payment"
                  ? "bg-yellow-100 dark:bg-yellow-900/30"
                  : "bg-blue-100 dark:bg-blue-900/30"
              }`}>
                {displayState === "complete"
                  ? <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                  : displayState === "awaiting_payment"
                  ? <Lock className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                  : <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
                }
              </div>
              <div>
                <h1 className="text-3xl font-serif font-medium mb-1">
                  {displayState === "complete"
                    ? "Proyek Selesai!"
                    : displayState === "awaiting_payment"
                    ? "Menunggu Pelunasan"
                    : displayState === "billing_pending"
                    ? "Tagihan Sedang Dipersiapkan"
                    : "Sedang Diproduksi"}
                </h1>
                <p className="text-muted-foreground">
                  Kode permintaan:{" "}
                  <span className="font-mono text-sm">{requestId}</span>
                </p>
              </div>
            </div>

            {/* Production in progress notice */}
            {displayState === "production_in_progress" && (
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-3">
                  <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0 animate-spin" />
                  <div>
                    <h2 className="font-semibold text-blue-900 dark:text-blue-200 mb-1">
                      Sedang Diproduksi
                    </h2>
                    <p className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed">
                      Tim AI kami sedang mengerjakan proyek Anda. Proses ini membutuhkan
                      beberapa menit. Halaman ini akan diperbarui otomatis.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Billing pending — production done but invoice not yet generated */}
            {displayState === "billing_pending" && (
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <h2 className="font-semibold text-blue-900 dark:text-blue-200 mb-1">
                      Tagihan Sedang Dipersiapkan
                    </h2>
                    <p className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed">
                      Proyek Anda telah selesai diproduksi. Tim kami sedang menyiapkan tagihan
                      final. Anda akan menerima notifikasi begitu tagihan tersedia.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* P0-6: File Lock Screen — only shown when there IS an invoice and a balance to pay */}
            {displayState === "awaiting_payment" && (
              <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-3 mb-4">
                  <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                  <div>
                    <h2 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
                      File Final Terkunci
                    </h2>
                    <p className="text-sm text-yellow-800 dark:text-yellow-300 leading-relaxed">
                      Proyek Anda telah selesai dikerjakan. File final akan dibuka segera setelah
                      pelunasan diverifikasi oleh tim kami.
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

                {/* Bank transfer destinations */}
                <div className="mb-4">
                  <PaymentInstructionCard />
                </div>

                {/* Pay remaining CTA */}
                <div className="rounded-xl border border-yellow-300 dark:border-yellow-700 p-4 bg-white/60 dark:bg-yellow-900/10">
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200 mb-1">
                    Cara melakukan pelunasan:
                  </p>
                  <ol className="text-sm text-yellow-800 dark:text-yellow-300 space-y-1 list-decimal list-inside">
                    <li>Transfer sesuai jumlah sisa tagihan ke salah satu rekening di atas</li>
                    <li>Buka dashboard Anda dan submit bukti transfer di halaman Pembayaran</li>
                    <li>Admin akan memverifikasi dan membuka file Anda dalam 1×24 jam</li>
                  </ol>
                </div>

                {/* Dashboard shortcut — sends a magic-link email so customer can access their workspace */}
                <div className="mt-4">
                  <DashboardAccessButton email={(data as any).customerEmail} className="w-full" />
                </div>

                {/* What you'll get after unlock — no hardcoded file types */}
                <div className="mt-4 flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400">
                  <Unlock className="w-4 h-4 shrink-0" />
                  <span>Setelah lunas, semua file final proyek Anda akan terbuka secara otomatis.</span>
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

            {/* Results ready in workspace — filesUnlocked but no manual links/notes.
                AI-generated results live in the workspace dashboard, not here. */}
            {(data as any).filesUnlocked && !data.completionNotes && (!data.completionLinks || data.completionLinks.length === 0) && (
              <div className="bg-card border border-card-border rounded-2xl p-8 mb-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <PackageOpen className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold text-foreground mb-1">
                      Hasil Proyek Siap di Dashboard Anda
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                      Proyek Anda telah selesai dikerjakan oleh tim AI kami. Buka dashboard untuk
                      melihat hasil lengkap — brand strategy, creative direction, copy, visual
                      assets, dan semua deliverable proyek Anda.
                    </p>
                    <DashboardAccessButton email={data.customerEmail} />
                  </div>
                </div>
              </div>
            )}

            {/* Dashboard access — shown below manual links/notes when they exist */}
            {(data.completionNotes || (data.completionLinks && data.completionLinks.length > 0)) && (
              <div className="flex justify-center mb-6">
                <DashboardAccessButton email={data.customerEmail} />
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
