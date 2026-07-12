import { useEffect } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useGetPublicQuotation } from "@/hooks/use-customer";
import {
  Loader2,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
} from "lucide-react";
import { CommercialErrorState } from "@/components/commercial/commercial-error-state";

export default function CommercialGatePage({
  params,
}: {
  params: { token: string };
}) {
  const { data: quotation, isLoading, error, refetch } = useGetPublicQuotation(
    params.token,
  );

  // Poll every 5 seconds while quotation is approved but project not yet running
  useEffect(() => {
    if (
      !quotation ||
      quotation.status !== "approved" ||
      quotation.projectStatus === "running" ||
      quotation.projectStatus === "completed"
    )
      return;

    const id = setInterval(() => {
      refetch();
    }, 5000);
    return () => clearInterval(id);
  }, [quotation, refetch]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh]" role="status" aria-live="polite">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" aria-hidden="true" />
          <p className="text-lg font-serif animate-pulse">Loading status…</p>
        </div>
      </Layout>
    );
  }

  if (error || !quotation) {
    return (
      <Layout>
        <CommercialErrorState
          title="Status Not Found"
          description="This link may be invalid or expired. Please use the link from your latest email, or contact us for a new one."
          backHref="/"
          backLabel="Back to home"
        />
      </Layout>
    );
  }

  // Determine which stepper step we're on
  const projectActive =
    quotation.projectStatus === "running" ||
    quotation.projectStatus === "completed";

  const stepperStep = projectActive ? "produksi" : "verifikasi";

  return (
    <Layout>
      {/* Stepper */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-4xl">
          <FlowStepper currentStep={stepperStep} />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-16 max-w-2xl flex flex-col items-center text-center">
        {projectActive ? (
          /* Gate cleared — project is now running */
          <>
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-8">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-medium mb-4">
              Production has started!
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-md mx-auto">
              The commercial step has been cleared. Our AI is now building your
              project — you'll be able to review the results soon.
            </p>
            <Link
              href={`/review/${params.token}`}
              className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-all"
            >
              Go to project review
              <ArrowRight className="w-5 h-5" />
            </Link>
          </>
        ) : quotation.status !== "approved" ? (
          /* Quotation not yet approved */
          <>
            <div className="w-20 h-20 bg-muted text-muted-foreground rounded-full flex items-center justify-center mb-8">
              <XCircle className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-serif font-medium mb-4">
              Quotation not approved
            </h1>
            <p className="text-muted-foreground mb-8">
              Please approve your quotation first before the commercial
              verification step can begin.
            </p>
            <Link
              href={`/quotation/${params.token}`}
              className="inline-flex items-center gap-2 px-6 py-3 bg-foreground text-background rounded-full font-medium hover:opacity-90 transition-opacity"
            >
              Review Quotation
            </Link>
          </>
        ) : (
          /* Approved, gate pending */
          <>
            <div className="relative mb-8">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />
              <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center relative z-10">
                <ShieldCheck className="w-10 h-10" />
              </div>
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-medium mb-4">
              Quotation approved — thank you!
            </h1>
            <p className="text-lg text-muted-foreground mb-6 max-w-md mx-auto">
              We're finalizing the commercial step (payment / verification)
              before production starts. This usually takes just a few minutes.
            </p>

            <div className="bg-card border border-card-border rounded-2xl p-6 mb-8 w-full text-left space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/20 text-green-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Quotation approved</p>
                  <p className="text-xs text-muted-foreground">
                    Your acceptance has been recorded.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
                <div>
                  <p className="text-sm font-medium">Commercial verification</p>
                  <p className="text-xs text-muted-foreground">
                    Awaiting internal clearance — checking automatically…
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 opacity-40">
                <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Production</p>
                  <p className="text-xs text-muted-foreground">
                    Starts once verification is complete.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground flex items-center gap-1.5" role="status" aria-live="polite">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              This page refreshes automatically every few seconds.
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
