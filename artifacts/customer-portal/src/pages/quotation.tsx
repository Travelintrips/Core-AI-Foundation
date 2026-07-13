import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import {
  useGetPublicQuotation,
  useApproveQuotation,
  useRejectQuotation,
} from "@/hooks/use-customer";
import { Loader2, CheckCircle2, XCircle, FileText, Clock, ShieldCheck, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { CommercialStatusBadge } from "@/components/commercial/commercial-status-badge";
import { ActionRequiredPanel } from "@/components/commercial/action-required-panel";
import { PriceBreakdown } from "@/components/commercial/price-breakdown";
import { CommercialErrorState } from "@/components/commercial/commercial-error-state";

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export default function QuotationPage({ params }: { params: { token: string } }) {
  const { data: quotation, isLoading, error } = useGetPublicQuotation(params.token);
  const approve = useApproveQuotation();
  const reject = useRejectQuotation();
  const { toast } = useToast();

  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh]" role="status" aria-live="polite">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" aria-hidden="true" />
          <p className="text-lg font-serif animate-pulse">Loading your quotation...</p>
        </div>
      </Layout>
    );
  }

  if (error || !quotation) {
    return (
      <Layout>
        <CommercialErrorState
          title="Quotation Not Found"
          description="This link may be invalid, expired, or a quotation hasn't been sent for this project yet."
          backHref="/"
          backLabel="Back to home"
        />
      </Layout>
    );
  }

  const isTerminal = quotation.status === "approved" || quotation.status === "rejected";
  // After approve, gate is pending — show commercial gate step
  const gateAwaitingClearance =
    quotation.status === "approved" &&
    quotation.projectStatus !== "running" &&
    quotation.projectStatus !== "completed";

  const stepperStep =
    quotation.status === "sent"
      ? "persetujuan"
      : gateAwaitingClearance
      ? "verifikasi"
      : "produksi";

  const handleApprove = () => {
    approve.mutate({ token: params.token }, {
      onSuccess: () => toast({ title: "Quotation approved!", description: "We're verifying the commercial step before production starts." }),
      onError: (err: unknown) => toast({ title: "Failed to approve", description: String((err as Error)?.message ?? err), variant: "destructive" }),
    });
  };

  const handleReject = () => {
    reject.mutate({ token: params.token, data: { notes: rejectNotes } }, {
      onSuccess: () => toast({ title: "Quotation declined", description: "The offer has been closed." }),
      onError: (err: unknown) => toast({ title: "Failed to decline", description: String((err as Error)?.message ?? err), variant: "destructive" }),
    });
  };

  return (
    <Layout>
      {/* Flow stepper */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep={stepperStep} />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <FileText className="w-4 h-4" />
            Quotation for {quotation.brandName}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-3xl md:text-4xl font-serif font-medium">Price Offer</h1>
            <CommercialStatusBadge status={gateAwaitingClearance ? "waiting_commercial_gate" : quotation.status} />
          </div>
          <p className="text-muted-foreground">
            Hi {quotation.clientName}, please review the offer below before we begin production.
          </p>
        </div>

        {/* Action required: quotation awaiting the customer's decision */}
        {quotation.status === "sent" && (
          <ActionRequiredPanel
            title="Review and respond to this price offer"
            description="Approve to start production, or decline if this offer doesn't work for you."
            {...(quotation.validUntil
              ? { deadline: format(new Date(quotation.validUntil), "MMM d, yyyy") }
              : {})}
            consequence="No production work begins until you approve."
          />
        )}

        {/* Commercial gate pending banner */}
        {gateAwaitingClearance && (
          <div className="mb-6 bg-primary/5 border border-primary/20 rounded-xl px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 text-primary flex-1">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Quotation approved — thank you!</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  We're finalizing the commercial step before production starts.
                </p>
              </div>
            </div>
            <Link
              href={`/gate/${params.token}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline shrink-0"
            >
              View status <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {quotation.status === "approved" && !gateAwaitingClearance && (
          <div className="mb-6 flex items-center gap-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/40 rounded-xl px-4 py-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">Approved — production is underway.</span>
          </div>
        )}
        {quotation.status === "rejected" && (
          <div className="mb-6 flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-xl px-4 py-3">
            <XCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">You declined this offer.</span>
          </div>
        )}
        {quotation.status === "expired" && (
          <div className="mb-6 flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-900/40 rounded-xl px-4 py-3">
            <Clock className="w-5 h-5 shrink-0" />
            <span className="text-sm font-medium">This offer has expired. Please contact us for a new one.</span>
          </div>
        )}

        <PriceBreakdown
          currency={quotation.currency}
          lineItems={quotation.lineItems.map((item, i) => ({
            key: i,
            label: item.description,
            meta: `${item.quantity} × ${formatMoney(item.unitPrice, quotation.currency)}`,
            amount: item.quantity * item.unitPrice,
          }))}
          subtotal={quotation.subtotal}
          discount={quotation.discount}
          taxLabel={`Tax (${quotation.taxPercent}%)`}
          taxAmount={quotation.taxAmount}
          total={quotation.total}
          formatMoney={formatMoney}
        />

        {quotation.notes && (
          <div className="mt-6 text-sm text-muted-foreground whitespace-pre-wrap">{quotation.notes}</div>
        )}

        {quotation.validUntil && (
          <p className="mt-2 mb-8 text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            Valid until {format(new Date(quotation.validUntil), "MMM d, yyyy")}
          </p>
        )}

        {!isTerminal && quotation.status === "sent" && (
          <div className="space-y-4 mt-8">
            <label className="flex items-start gap-2.5 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-border/50"
              />
              I've reviewed the pricing above and agree to proceed on these terms.
            </label>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleApprove}
                disabled={approve.isPending || !confirmChecked}
                aria-disabled={!confirmChecked}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-foreground text-background rounded-full font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
                Approve & Start Project
              </button>
              <button
                onClick={() => setShowRejectInput((v) => !v)}
                disabled={reject.isPending}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 border border-card-border rounded-full font-medium hover:bg-muted/40 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" aria-hidden="true" />
                Decline Offer
              </button>
            </div>

            {showRejectInput && (
              <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
                <textarea
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  placeholder="Optional — tell us why (helps us send a better offer)"
                  className="w-full rounded-lg border border-border/50 bg-background p-3 text-sm min-h-[80px]"
                  aria-label="Reason for declining (optional)"
                />
                <button
                  onClick={handleReject}
                  disabled={reject.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-destructive text-destructive-foreground rounded-full text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {reject.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                  Confirm Decline
                </button>
              </div>
            )}
          </div>
        )}

        <div aria-live="polite" className="sr-only">
          {approve.isSuccess && "Quotation approved."}
          {reject.isSuccess && "Quotation declined."}
          {approve.isError && "Failed to approve quotation."}
          {reject.isError && "Failed to decline quotation."}
        </div>
      </div>
    </Layout>
  );
}
