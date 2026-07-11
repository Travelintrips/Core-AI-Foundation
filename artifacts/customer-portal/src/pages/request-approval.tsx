/**
 * Post-approval status page — shows commercial gate status.
 * Route: /request-service/:requestId/approval?token=<reviewToken>
 */
import { useParams } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { useServiceQuotation } from "@/hooks/use-catalog";
import { requestStatusToStep } from "@/pages/request-quotation";
import { Loader2, CheckCircle2, Clock, ShieldCheck, Zap } from "lucide-react";

export default function RequestApprovalPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const { data, isLoading } = useServiceQuotation(token || undefined);

  const gateCleared = data?.gateStatus === "verified" || data?.gateStatus === "waived";
  const pastCommercialGate = !!data?.requestStatus && ["ready_to_build", "in_progress", "orchestrating", "waiting_review", "completed", "converted_to_project"].includes(data.requestStatus);
  const inProduction = !!data?.requestStatus && ["in_progress", "orchestrating", "waiting_review", "completed", "converted_to_project"].includes(data.requestStatus);
  const stepperStep =
    data?.quotation?.status === "approved"
      ? requestStatusToStep(data?.requestStatus ?? "approved")
      : "persetujuan";

  return (
    <Layout>
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <FlowStepper currentStep={stepperStep} />
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-12 max-w-3xl">
        <h1 className="text-3xl font-serif font-medium mb-2">Status Proyek</h1>
        <p className="text-muted-foreground mb-10">
          Kode permintaan: <span className="font-mono text-sm">{requestId}</span>
        </p>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Step 1: Quotation approved */}
            <StatusStep
              icon={CheckCircle2}
              title="Penawaran Disetujui"
              description="Anda telah menyetujui penawaran harga."
              done={data?.quotation?.status === "approved"}
              iconColor="text-green-600"
              bgColor="bg-green-50 dark:bg-green-950/20"
              borderColor="border-green-200 dark:border-green-800"
            />

            {/* Step 2: Commercial gate */}
            <StatusStep
              icon={ShieldCheck}
              title="Verifikasi Komersial"
              description={
                gateCleared || pastCommercialGate
                  ? "Verifikasi komersial telah selesai."
                  : data?.quotation?.status === "approved"
                    ? "Tim kami sedang memverifikasi pembayaran / dokumen. Anda akan dihubungi dalam 1 hari kerja."
                    : "Menunggu persetujuan penawaran terlebih dahulu."
              }
              done={gateCleared || pastCommercialGate}
              pending={data?.quotation?.status === "approved" && !(gateCleared || pastCommercialGate)}
              iconColor="text-primary"
              bgColor="bg-primary/5"
              borderColor="border-primary/20"
            />

            {/* Step 3: Production */}
            <StatusStep
              icon={Zap}
              title="Produksi Dimulai"
              description={
                inProduction
                  ? "Tim AI kami sedang mengerjakan project Anda."
                  : "Setelah verifikasi selesai, tim AI kami akan segera memulai pengerjaan project Anda."
              }
              done={inProduction}
              pending={pastCommercialGate && !inProduction}
              iconColor="text-muted-foreground"
              bgColor="bg-muted/20"
              borderColor="border-border"
            />
          </div>
        )}

        <div className="mt-10 text-center text-sm text-muted-foreground">
          <p>Punya pertanyaan? Hubungi kami melalui email atau WhatsApp.</p>
        </div>
      </div>
    </Layout>
  );
}

function StatusStep({
  icon: Icon,
  title,
  description,
  done,
  pending,
  iconColor,
  bgColor,
  borderColor,
}: {
  icon: typeof CheckCircle2;
  title: string;
  description: string;
  done: boolean;
  pending?: boolean;
  iconColor: string;
  bgColor: string;
  borderColor: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 flex items-start gap-4 ${done || pending ? `${bgColor} ${borderColor}` : "bg-muted/20 border-border opacity-60"}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-green-100 dark:bg-green-900/30" : pending ? "bg-primary/10" : "bg-muted"}`}>
        {pending && !done ? (
          <Clock className={`w-4 h-4 ${iconColor}`} />
        ) : (
          <Icon className={`w-4 h-4 ${done ? "text-green-600" : iconColor}`} />
        )}
      </div>
      <div>
        <p className={`font-medium ${done ? "text-green-700 dark:text-green-400" : ""}`}>{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      {done && <CheckCircle2 className="w-5 h-5 text-green-600 ml-auto shrink-0 mt-0.5" />}
    </div>
  );
}
