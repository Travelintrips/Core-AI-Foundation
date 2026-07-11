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

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-lg font-serif animate-pulse">Loading your quotation...</p>
        </div>
      </Layout>
    );
  }

  if (error || !quotation) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-serif mb-4">Quotation Not Found</h2>
            <p className="text-muted-foreground">
              This link may be invalid, expired, or a quotation hasn't been sent for this project yet.
            </p>
          </div>
        </div>
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
          <h1 className="text-3xl md:text-4xl font-serif font-medium mb-2">Price Offer</h1>
          <p className="text-muted-foreground">
            Hi {quotation.clientName}, please review the offer below before we begin production.
          </p>
        </div>

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

        <div className="bg-card border border-card-border rounded-2xl p-6 md:p-8 shadow-sm mb-8">
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border/50">
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 font-medium text-right">Qty</th>
                <th className="pb-2 font-medium text-right">Unit Price</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotation.lineItems.map((item, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="py-3 pr-2">{item.description}</td>
                  <td className="py-3 text-right">{item.quantity}</td>
                  <td className="py-3 text-right">{formatMoney(item.unitPrice, quotation.currency)}</td>
                  <td className="py-3 text-right font-medium">{formatMoney(item.quantity * item.unitPrice, quotation.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-1.5 text-sm ml-auto max-w-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(quotation.subtotal, quotation.currency)}</span>
            </div>
            {quotation.discount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span>-{formatMoney(quotation.discount, quotation.currency)}</span>
              </div>
            )}
            {quotation.taxPercent > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tax ({quotation.taxPercent}%)</span>
                <span>{formatMoney(quotation.taxAmount, quotation.currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-serif text-lg font-semibold pt-2 border-t border-border/50">
              <span>Total</span>
              <span>{formatMoney(quotation.total, quotation.currency)}</span>
            </div>
          </div>

          {quotation.notes && (
            <div className="mt-6 pt-6 border-t border-border/50 text-sm text-muted-foreground whitespace-pre-wrap">
              {quotation.notes}
            </div>
          )}

          {quotation.validUntil && (
            <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Valid until {format(new Date(quotation.validUntil), "MMM d, yyyy")}
            </p>
          )}
        </div>

        {!isTerminal && quotation.status === "sent" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleApprove}
                disabled={approve.isPending}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-foreground text-background rounded-full font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {approve.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Approve & Start Project
              </button>
              <button
                onClick={() => setShowRejectInput((v) => !v)}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 border border-card-border rounded-full font-medium hover:bg-muted/40 transition-colors"
              >
                <XCircle className="w-4 h-4" />
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
                />
                <button
                  onClick={handleReject}
                  disabled={reject.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-destructive text-destructive-foreground rounded-full text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {reject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Confirm Decline
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
