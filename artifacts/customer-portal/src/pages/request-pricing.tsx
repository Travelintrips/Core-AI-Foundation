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

const STATUS_LABEL: Record<string, string> = {
  draft: "Permintaan Diterima",
  brief_in_progress: "Mengisi Brief",
  brief_completed: "Brief Selesai",
  pricing_calculated: "Harga Dikonfirmasi",
  quoted: "Sedang Dikalkulasi",
  quotation_ready: "Penawaran Siap Dikirim",
  waiting_customer_approval: "Menunggu Persetujuan Anda",
  approved: "Disetujui",
  waiting_commercial_gate: "Menunggu Konfirmasi Pembayaran",
  revision_requested: "Revisi Dibutuhkan",
  rejected: "Ditolak",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
  converted_to_project: "Project Dibuat",
};

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

  const hasQuotation = ["quotation_ready", "waiting_customer_approval", "approved", "waiting_commercial_gate", "converted_to_project"].includes(request.status);

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
        <div className={`rounded-2xl border p-6 mb-6 ${hasQuotation ? "bg-primary/5 border-primary/20" : "bg-card border-border"}`}>
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${hasQuotation ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {hasQuotation ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div>
              <p className="font-medium">{STATUS_LABEL[request.status] ?? request.status}</p>
              {hasQuotation ? (
                <p className="text-sm text-muted-foreground mt-1">
                  Penawaran harga sudah siap untuk Anda tinjau dan setujui.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  Tim kami sedang menyiapkan penawaran harga berdasarkan brief yang Anda kirimkan.
                  Anda akan dihubungi via email saat penawaran siap.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Pricing breakdown (from service request) */}
        {parseFloat(String(request.total ?? "0")) > 0 && (
          <div className="bg-card border border-border rounded-2xl p-6 mb-6">
            <h2 className="font-serif text-lg font-medium mb-4">Estimasi Harga</h2>
            <div className="space-y-3">
              <PriceRow label="Harga Dasar" amount={request.subtotal} currency={request.currency} />
              {parseFloat(String(request.rushFee ?? "0")) > 0 && (
                <PriceRow label="Rush Fee" amount={request.rushFee} currency={request.currency} />
              )}
              {parseFloat(String(request.revisionFee ?? "0")) > 0 && (
                <PriceRow label="Biaya Revisi" amount={request.revisionFee} currency={request.currency} />
              )}
              {parseFloat(String(request.humanReviewFee ?? "0")) > 0 && (
                <PriceRow label="Human Review" amount={request.humanReviewFee} currency={request.currency} />
              )}
              {parseFloat(String(request.discount ?? "0")) > 0 && (
                <PriceRow label="Diskon" amount={`-${request.discount}`} currency={request.currency} highlight="text-green-600" />
              )}
              {parseFloat(String(request.tax ?? "0")) > 0 && (
                <PriceRow label="Pajak (PPN)" amount={request.tax} currency={request.currency} />
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
        {hasQuotation ? (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Penawaran resmi telah dikirim ke email <strong>{request.customerEmail}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              Gunakan link di email untuk meninjau dan menyetujui penawaran.
            </p>
          </div>
        ) : (
          <div className="bg-muted/30 border border-border rounded-2xl p-6 text-center">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">Menunggu Penawaran Resmi</p>
            <p className="text-sm text-muted-foreground">
              Biasanya selesai dalam 1–2 hari kerja. Cek email Anda secara berkala.
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
