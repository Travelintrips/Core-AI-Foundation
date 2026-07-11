import { useParams, useLocation, Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useRequestDetail } from "@/hooks/use-catalog";
import { Loader2, Clock, CheckCircle2, ArrowRight, Info } from "lucide-react";

function formatMoney(amount: number | string, currency = "IDR") {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(num);
  } catch {
    return `${currency} ${num.toLocaleString()}`;
  }
}

// Kept in sync with the label map used on the customer dashboard
// (artifacts/api-server/src/routes/customer-portal.ts) — every status the
// backend can set on a service request must have an entry here, otherwise
// this page falls back to showing the raw backend value.
const STATUS_LABEL: Record<string, string> = {
  draft: "Permintaan Diterima",
  brief_in_progress: "Mengisi Brief",
  brief_completed: "Brief Selesai",
  quoted: "Harga Dikalkulasi",
  quotation_ready: "Penawaran Siap Dikirim",
  waiting_customer_approval: "Menunggu Persetujuan Anda",
  approved: "Disetujui",
  waiting_commercial_gate: "Verifikasi Komersial",
  ready_to_build: "Siap Produksi",
  in_progress: "Sedang Diproduksi",
  orchestrating: "Sedang Diproduksi",
  waiting_review: "Menunggu Review Internal",
  completed: "Selesai",
  converted_to_project: "Project Dibuat",
  revision_requested: "Revisi Dibutuhkan",
  rejected: "Ditolak",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
};

// Stage buckets drive which message/CTA is shown — this replaces the old
// binary "hasQuotation" check, which only recognised 5 statuses and silently
// mislabeled everything past that (e.g. "completed") as "still preparing".
type Stage = "awaiting_quotation" | "quotation_pending" | "in_production" | "done" | "stopped";

function stageFor(status: string): Stage {
  if (["quotation_ready", "waiting_customer_approval", "approved", "waiting_commercial_gate", "revision_requested"].includes(status)) {
    return "quotation_pending";
  }
  if (["ready_to_build", "in_progress", "orchestrating", "waiting_review", "converted_to_project"].includes(status)) {
    return "in_production";
  }
  if (status === "completed") return "done";
  if (["rejected", "expired", "cancelled"].includes(status)) return "stopped";
  return "awaiting_quotation"; // draft, brief_in_progress, brief_completed, quoted
}

export default function RequestPricingPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const { data: request, isLoading, error } = useRequestDetail(requestId);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (error || !request) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center max-w-sm">
            <h2 className="text-xl font-serif mb-2">Permintaan Tidak Ditemukan</h2>
            <p className="text-muted-foreground text-sm">Link ini mungkin tidak valid.</p>
          </div>
        </div>
      </Layout>
    );
  }

  const stage = stageFor(request.status);
  const isPositiveStage = stage === "quotation_pending" || stage === "in_production" || stage === "done";

  const STAGE_COPY: Record<Stage, string> = {
    awaiting_quotation: "Tim kami sedang menyiapkan penawaran harga berdasarkan brief yang Anda kirimkan. Anda akan dihubungi via email saat penawaran siap.",
    quotation_pending: "Penawaran harga sudah siap untuk Anda tinjau dan setujui.",
    in_production: "Penawaran sudah disetujui dan pekerjaan sedang dikerjakan oleh tim kami.",
    done: "Pekerjaan untuk permintaan ini sudah selesai dikerjakan. Cek email Anda atau dashboard untuk melihat hasilnya.",
    stopped: "Permintaan ini tidak lagi berjalan.",
  };

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep="harga" />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        <h1 className="text-3xl font-serif font-medium mb-2">Kalkulasi Harga</h1>
        <p className="text-muted-foreground mb-8">
          Kode permintaan: <span className="font-mono text-sm">{request.requestId}</span>
        </p>

        {/* Status card */}
        <div className={`rounded-2xl border p-6 mb-6 ${isPositiveStage ? "bg-primary/5 border-primary/20" : "bg-card border-border"}`}>
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isPositiveStage ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {isPositiveStage ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div>
              <p className="font-medium">{STATUS_LABEL[request.status] ?? request.status}</p>
              <p className="text-sm text-muted-foreground mt-1">{STAGE_COPY[stage]}</p>
            </div>
          </div>
        </div>

        {/* Pricing breakdown (from service request) */}
        {parseFloat(String(request.total ?? "0")) > 0 && (
          <div className="bg-card border border-border rounded-2xl p-6 mb-6">
            <h2 className="font-serif text-lg font-medium mb-4">Estimasi Harga</h2>
            <div className="space-y-3">
              {request.pricingBreakdown?.lineItems && request.pricingBreakdown.lineItems.length > 0 ? (
                // Use itemised line items from pricing snapshot for accurate display
                request.pricingBreakdown.lineItems.map((item) => (
                  <PriceRow key={item.code} label={item.label} amount={item.amount} currency={request.currency} />
                ))
              ) : (
                // Fallback: show base price from snapshot or subtotal
                <PriceRow
                  label="Harga Dasar"
                  amount={request.pricingBreakdown?.basePrice ?? request.subtotal}
                  currency={request.currency}
                />
              )}
              {parseFloat(String(request.discount ?? "0")) > 0 && (
                <PriceRow label="Diskon" amount={-parseFloat(String(request.discount))} currency={request.currency} highlight="text-green-600" />
              )}
              {(request.pricingBreakdown?.taxPercent ?? 0) > 0 && parseFloat(String(request.tax ?? "0")) > 0 && (
                <PriceRow label={`Pajak (PPN ${request.pricingBreakdown!.taxPercent}%)`} amount={request.tax} currency={request.currency} />
              )}
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="font-semibold">Total</span>
                <span className="text-xl font-bold text-primary">
                  {formatMoney(request.total ?? "0", request.currency)}
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Harga di atas adalah estimasi. Penawaran resmi akan dikirimkan melalui email dengan detail dan syarat-syarat yang berlaku.</span>
            </div>
          </div>
        )}

        {/* CTA */}
        {stage === "quotation_pending" && (
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-medium mb-1">Penawaran Siap Ditinjau</p>
            <p className="text-sm text-muted-foreground">
              Tim kami telah mengirimkan link penawaran ke <strong>{request.customerEmail}</strong>. Jika belum menerima link, hubungi tim kami.
            </p>
          </div>
        )}
        {stage === "in_production" && (
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-medium mb-1">Sedang Dikerjakan</p>
            <p className="text-sm text-muted-foreground">
              Tim kami sedang memproduksi hasil untuk permintaan ini. Anda akan dihubungi via email begitu hasilnya siap ditinjau.
            </p>
          </div>
        )}
        {stage === "done" && (
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-medium mb-1">Pekerjaan Selesai</p>
            <p className="text-sm text-muted-foreground">
              Hasil untuk permintaan ini telah selesai dikerjakan. Cek email di <strong>{request.customerEmail}</strong> atau dashboard Anda untuk melihat hasilnya. Belum menerima apa pun? Hubungi tim kami.
            </p>
          </div>
        )}
        {stage === "stopped" && (
          <div className="bg-muted/30 border border-border rounded-2xl p-6 text-center">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">Permintaan Tidak Berlanjut</p>
            <p className="text-sm text-muted-foreground">
              Permintaan ini berstatus "{STATUS_LABEL[request.status] ?? request.status}". Hubungi tim kami jika ini tidak sesuai harapan Anda.
            </p>
          </div>
        )}
        {stage === "awaiting_quotation" && (
          <div className="bg-muted/30 border border-border rounded-2xl p-6 text-center">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">Menunggu Penawaran Resmi</p>
            <p className="text-sm text-muted-foreground">
              Tim kami sedang menyiapkan penawaran. Anda akan dihubungi segera setelah siap.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}

function PriceRow({
  label,
  amount,
  currency,
  highlight,
}: {
  label: string;
  amount: string | number;
  currency: string;
  highlight?: string;
}) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${highlight ?? ""}`}>
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}
