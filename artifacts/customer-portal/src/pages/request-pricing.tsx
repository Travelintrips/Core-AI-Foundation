import { useState } from "react";
import { useParams } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper, type FlowStep } from "@/components/flow-stepper";
import { useRequestDetail, useCheckout, useSubmitPaymentProof } from "@/hooks/use-catalog";
import { Loader2, Clock, CheckCircle2, Info, CreditCard, Send } from "lucide-react";
import { CommercialStatusBadge } from "@/components/commercial/commercial-status-badge";
import { ActionRequiredPanel, NoActionRequiredPanel } from "@/components/commercial/action-required-panel";
import { PriceBreakdown } from "@/components/commercial/price-breakdown";
import { PaymentInstructionCard } from "@/components/commercial/payment-instruction-card";
import { CommercialErrorState } from "@/components/commercial/commercial-error-state";
import { useTranslation } from "@/lib/i18n";

function formatMoney(amount: number | string, currency = "IDR") {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(num);
  } catch {
    return `${currency} ${num.toLocaleString()}`;
  }
}

const STATUS_STEP: Record<string, FlowStep["key"]> = {
  draft: "brief",
  brief_in_progress: "brief",
  brief_completed: "harga",
  quoted: "harga",
  quotation_ready: "harga",
  waiting_customer_approval: "persetujuan",
  approved: "verifikasi",
  waiting_commercial_gate: "verifikasi",
  ready_to_build: "produksi",
  in_progress: "produksi",
  orchestrating: "produksi",
  waiting_review: "review",
  converted_to_project: "produksi",
  completed: "selesai",
  revision_requested: "persetujuan",
  rejected: "persetujuan",
  expired: "persetujuan",
  cancelled: "paket",
};

type Stage = "awaiting_quotation" | "quotation_pending" | "quotation_approved" | "in_production" | "done" | "stopped";

function stageFor(status: string): Stage {
  if (["quotation_ready", "waiting_customer_approval", "revision_requested"].includes(status)) return "quotation_pending";
  if (["approved", "waiting_commercial_gate"].includes(status)) return "quotation_approved";
  if (["waiting_payment", "waiting_payment_verification"].includes(status)) return "quotation_pending";
  if (["deposit_paid", "payment_verified", "waiting_remaining_payment", "remaining_paid", "ready_to_build", "building", "internal_review", "waiting_client_review", "revision"].includes(status)) return "in_production";
  if (["ready_to_build", "in_progress", "orchestrating", "waiting_review", "converted_to_project"].includes(status)) return "in_production";
  if (status === "completed") return "done";
  if (["rejected", "expired", "cancelled"].includes(status)) return "stopped";
  return "awaiting_quotation";
}

export default function RequestPricingPage() {
  const { t } = useTranslation();
  const { requestId } = useParams<{ requestId: string }>();
  const { data: request, isLoading, error } = useRequestDetail(requestId);
  const checkout = useCheckout();
  const submitProof = useSubmitPaymentProof();
  const [reference, setReference] = useState("");
  const [submittedScheduleId, setSubmittedScheduleId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-32" role="status" aria-live="polite">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </Layout>
    );
  }

  if (error || !request) {
    return (
      <Layout>
        <CommercialErrorState
          title={t('requestPricing.notFound')}
          description={t('requestPricing.notFoundDesc')}
          backHref="/"
          backLabel={t('common.backToHome')}
        />
      </Layout>
    );
  }

  const stage = stageFor(request.status);
  const isPositiveStage = stage === "quotation_pending" || stage === "quotation_approved" || stage === "in_production" || stage === "done";
  const statusLabel = t(`status.${request.status}`) !== `status.${request.status}` ? t(`status.${request.status}`) : request.status;
  const stageCopy = t(`requestPricing.stages.${stage}`) !== `requestPricing.stages.${stage}` ? t(`requestPricing.stages.${stage}`) : "";

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep={STATUS_STEP[request.status] ?? "harga"} />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h1 className="text-3xl font-serif font-medium">Kalkulasi Harga</h1>
          <CommercialStatusBadge status={request.status} />
        </div>
        <p className="text-muted-foreground mb-8">
          Kode permintaan: <span className="font-mono text-sm">{request.requestId}</span>
        </p>

        {/* Status card */}
        <div className={`rounded-2xl border p-6 mb-6 ${isPositiveStage ? "bg-primary/5 border-primary/20" : "bg-card border-border"}`} aria-live="polite">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isPositiveStage ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {isPositiveStage ? <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> : <Clock className="w-5 h-5 text-muted-foreground" aria-hidden="true" />}
            </div>
            <div>
              <p className="font-medium">{statusLabel}</p>
              <p className="text-sm text-muted-foreground mt-1">{stageCopy}</p>
            </div>
          </div>
        </div>

        {/* Fixed-price checkout CTA */}
        {request.serviceFlow === "fixed_price" &&
          !request.createdProjectId &&
          (request.status === "brief_completed" || request.status === "pricing_calculated") && (
            <ActionRequiredPanel
              title={t('requestPricing.continuePayment')}
              description="Layanan ini tidak memerlukan penawaran khusus — checkout langsung untuk memulai pengerjaan."
              primary={{
                label: checkout.isPending ? t('common.loading') : t('requestPricing.continuePayment'),
                onClick: () => checkout.mutate({ requestId: request.requestId }),
                loading: checkout.isPending,
                disabled: checkout.isPending,
              }}
              consequence={checkout.isError ? (checkout.error as Error).message : "Pengerjaan dimulai setelah pembayaran diverifikasi."}
            />
          )}

        {/* Pricing breakdown */}
        {parseFloat(String(request.total ?? "0")) > 0 && (
          <div className="mb-6">
            <h2 className="font-serif text-lg font-medium mb-4">Estimasi Harga</h2>
            <PriceBreakdown
              currency={request.currency}
              lineItems={
                request.pricingBreakdown?.lineItems && request.pricingBreakdown.lineItems.length > 0
                  ? request.pricingBreakdown.lineItems.map((item) => ({ key: item.code, label: item.label, amount: item.amount }))
                  : [{ key: "base", label: "Harga Dasar", amount: Number(request.pricingBreakdown?.basePrice ?? request.subtotal) }]
              }
              subtotal={parseFloat(String(request.subtotal ?? "0"))}
              discount={parseFloat(String(request.discount ?? "0"))}
              taxLabel={`Pajak (PPN ${request.pricingBreakdown?.taxPercent ?? 0}%)`}
              taxAmount={parseFloat(String(request.tax ?? "0"))}
              total={parseFloat(String(request.total ?? "0"))}
              formatMoney={formatMoney}
            />
            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>Harga di atas adalah estimasi. Penawaran resmi akan dikirimkan melalui email dengan detail dan syarat-syarat yang berlaku.</span>
            </div>
          </div>
        )}

        {/* Standard checkout — payment schedule */}
        {request.serviceFlow === "fixed_price" && (request.createdProjectId || checkout.data) && (
          <div className="bg-card border border-border rounded-2xl p-6 mb-6">
            <h2 className="font-serif text-lg font-medium mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5" aria-hidden="true" /> Jadwal Pembayaran
            </h2>
            <div className="space-y-4">
              {(checkout.data?.schedule ?? []).map((s) => (
                <div key={s.id} className="border border-border rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
                    <span className="font-medium text-sm">
                      {s.paymentType === "deposit" ? "Deposit" : s.paymentType === "remaining_balance" ? "Sisa Pembayaran" : "Pembayaran"}
                      {s.percentage != null ? ` (${s.percentage}%)` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{formatMoney(s.amount, s.currency)}</span>
                      <CommercialStatusBadge status={s.status} />
                    </div>
                  </div>
                  {s.reference && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Referensi terkirim: <span className="font-mono">{s.reference}</span>
                    </p>
                  )}
                  {s.status === "pending" && (
                    <div className="space-y-3">
                      <PaymentInstructionCard />
                      <div className="flex flex-col sm:flex-row gap-2">
                        <label className="sr-only" htmlFor={`ref-${s.id}`}>{t('requestPricing.referenceLabel')}</label>
                        <input
                          id={`ref-${s.id}`}
                          type="text"
                          placeholder={t('requestPricing.referencePlaceholder')}
                          className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-background"
                          value={submittedScheduleId === s.id ? reference : ""}
                          onChange={(e) => { setSubmittedScheduleId(s.id); setReference(e.target.value); }}
                        />
                        <button
                          className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 shrink-0"
                          disabled={submitProof.isPending || !reference.trim() || submittedScheduleId !== s.id}
                          onClick={() => submitProof.mutate({ scheduleId: s.id, reference: reference.trim() })}
                        >
                          {submitProof.isPending && submittedScheduleId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Send className="w-3.5 h-3.5" aria-hidden="true" />}
                          {t('requestPricing.submitProof')}
                        </button>
                      </div>
                      {submitProof.isSuccess && submittedScheduleId === s.id && (
                        <p className="text-xs text-green-600 flex items-center gap-1" role="status">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> {t('requestPricing.proofSubmitted')}
                        </p>
                      )}
                      {submitProof.isError && submittedScheduleId === s.id && (
                        <p className="text-xs text-destructive" role="alert">{(submitProof.error as Error).message}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!checkout.data && (
                <p className="text-sm text-muted-foreground">
                  Project sudah dibuat. Buka dashboard Anda untuk melihat status dan jadwal pembayaran lengkap.
                </p>
              )}
            </div>
            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>Setelah kami memverifikasi pembayaran, tim AI kami akan langsung mulai mengerjakan proyek Anda.</span>
            </div>
          </div>
        )}

        {stage === "in_production" || stage === "done" ? <NoActionRequiredPanel /> : null}

        {/* Status panels for custom/enterprise flow */}
        {request.serviceFlow !== "fixed_price" && stage === "quotation_pending" && (
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-medium mb-1">{t('requestPricing.viewQuotation')}</p>
            <p className="text-sm text-muted-foreground">
              Tim kami telah mengirimkan link penawaran ke <strong>{request.customerEmail}</strong>. Jika belum menerima link, hubungi tim kami.
            </p>
          </div>
        )}
        {request.serviceFlow !== "fixed_price" && stage === "quotation_approved" && (
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-medium mb-1">{t('requestPricing.stages.quotation_approved').split('.')[0]}</p>
            <p className="text-sm text-muted-foreground">{t('requestPricing.stages.quotation_approved')}</p>
          </div>
        )}
        {request.serviceFlow !== "fixed_price" && stage === "in_production" && (
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-medium mb-1">Sedang Dikerjakan</p>
            <p className="text-sm text-muted-foreground">{t('requestPricing.stages.in_production')}</p>
          </div>
        )}
        {request.serviceFlow !== "fixed_price" && stage === "done" && (
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-medium mb-1">{t('status.completed')}</p>
            <p className="text-sm text-muted-foreground">
              {t('requestPricing.stages.done')} {request.customerEmail && <>Cek email di <strong>{request.customerEmail}</strong>.</>}
            </p>
          </div>
        )}
        {request.serviceFlow !== "fixed_price" && stage === "stopped" && (
          <div className="bg-muted/30 border border-border rounded-2xl p-6 text-center">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">{t('requestPricing.stages.stopped').split('.')[0]}</p>
            <p className="text-sm text-muted-foreground">
              {statusLabel}. Hubungi tim kami jika ini tidak sesuai harapan Anda.
            </p>
          </div>
        )}
        {request.serviceFlow !== "fixed_price" && stage === "awaiting_quotation" && (
          <div className="bg-muted/30 border border-border rounded-2xl p-6 text-center">
            <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium mb-1">Menunggu Penawaran Resmi</p>
            <p className="text-sm text-muted-foreground">{t('requestPricing.stages.awaiting_quotation')}</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
