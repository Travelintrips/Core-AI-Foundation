import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { FlowStepper } from "@/components/flow-stepper";
import { StatusBadge } from "@/components/status-badge";
import { useGetPublicCreativeReview } from "@/hooks/use-customer";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCcw,
  Image as ImageIcon,
  FileText,
  MessageSquare,
  ArrowLeft,
} from "lucide-react";

function stepForProject(status: string, reviewStatus: string): string {
  if (reviewStatus === "approved") return "selesai";
  if (reviewStatus === "revision_requested") return "review";
  if (status === "completed") return "review";
  if (status === "running") return "produksi";
  return "produksi";
}

export default function ProjectPage({
  params,
}: {
  params: { token: string };
}) {
  const { data: review, isLoading, error } = useGetPublicCreativeReview(
    params.token,
  );

  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-lg font-serif animate-pulse">
            Loading project workspace…
          </p>
        </div>
      </Layout>
    );
  }

  if (error || !review) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-serif mb-4">Project Not Found</h2>
            <p className="text-muted-foreground">
              This project link may be invalid, expired, or the project hasn't
              started yet.
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  const isGenerating =
    review.status === "pending" || review.status === "running";
  const stepperStep = stepForProject(review.status, review.reviewStatus);

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-8 pt-6 max-w-5xl">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group">
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Kembali
        </Link>
      </div>
      {/* Stepper */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 md:px-8 max-w-5xl">
          <FlowStepper currentStep={stepperStep} />
        </div>
      </div>

      {/* Header bar */}
      <div className="bg-card border-b border-card-border shadow-sm">
        <div className="container mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-serif font-semibold">
              {review.brandName} — Project Workspace
            </h1>
            <p className="text-sm text-muted-foreground">
              For {review.clientName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={review.status} type="project" />
            <StatusBadge status={review.reviewStatus} type="review" />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-8 py-10 max-w-5xl space-y-10">
        {/* Production status */}
        {isGenerating && (
          <div className="bg-accent/20 border border-accent rounded-2xl p-10 text-center flex flex-col items-center justify-center min-h-[260px]">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
              <Loader2 className="w-12 h-12 text-primary animate-spin relative z-10" />
            </div>
            <h2 className="text-xl font-serif mb-2">
              Generating your assets…
            </h2>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              Our AI agents are working on your brief. This page refreshes
              automatically.
            </p>
          </div>
        )}

        {/* Assets grid */}
        {!isGenerating && review.assets && review.assets.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-6">
              <ImageIcon className="w-5 h-5 text-primary" />
              <h2 className="text-2xl font-serif font-medium">
                Visual Assets
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {review.assets.map((asset) => (
                <div
                  key={asset.id}
                  className="group relative rounded-2xl overflow-hidden border border-border bg-card shadow-sm aspect-square"
                >
                  <img
                    src={asset.imageUrl}
                    alt="Generated asset"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                    <a
                      href={asset.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 bg-white/20 backdrop-blur-md text-white rounded-lg text-sm font-medium hover:bg-white/30 transition-colors"
                    >
                      View Full Size
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Copy / creative direction */}
        {!isGenerating && (review.copyOutput || review.creativeDirection) && (
          <section className="grid md:grid-cols-2 gap-8">
            {review.copyOutput && (
              <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4 border-b border-border pb-4">
                  <FileText className="w-5 h-5 text-secondary" />
                  <h2 className="text-lg font-serif font-medium">
                    Generated Copy
                  </h2>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap">
                  {typeof review.copyOutput === "string"
                    ? review.copyOutput
                    : JSON.stringify(review.copyOutput, null, 2)}
                </div>
              </div>
            )}
            {review.creativeDirection && (
              <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4 border-b border-border pb-4">
                  <MessageSquare className="w-5 h-5 text-orange-500" />
                  <h2 className="text-lg font-serif font-medium">
                    Creative Direction
                  </h2>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap">
                  {typeof review.creativeDirection === "string"
                    ? review.creativeDirection
                    : JSON.stringify(review.creativeDirection, null, 2)}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Review status card */}
        {!isGenerating && (
          <section className="bg-card border border-card-border rounded-2xl p-6 md:p-8 shadow-sm">
            <h3 className="font-serif text-lg font-medium mb-4">
              Review Status
            </h3>
            {review.reviewStatus === "approved" ? (
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/20 text-green-600 rounded-full flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">Project approved</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Thank you for approving this project. We'll finalize the
                    deliverables shortly.
                  </p>
                </div>
              </div>
            ) : review.reviewStatus === "rejected" ? (
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-destructive/10 text-destructive rounded-full flex items-center justify-center shrink-0">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">Project rejected</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    This project has been closed.
                  </p>
                </div>
              </div>
            ) : review.reviewStatus === "revision_requested" ? (
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/20 text-orange-600 rounded-full flex items-center justify-center shrink-0">
                  <RefreshCcw className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">Revision in progress</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Our AI is generating updated assets based on your feedback.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  Your assets are ready for review. Visit the full review portal
                  to approve, request revisions, or leave comments.
                </p>
                <Link
                  href={`/review/${params.token}`}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:bg-primary/90 transition-all shrink-0"
                >
                  Open Review Portal
                </Link>
              </div>
            )}
          </section>
        )}

        {/* Brief summary */}
        <section className="bg-muted/30 rounded-2xl p-6 md:p-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">
            Original Brief
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Brand</p>
              <p className="font-medium text-sm">
                {review.brandName} ({review.businessType})
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Target Market
              </p>
              <p className="font-medium text-sm">{review.targetMarket}</p>
            </div>
            {review.stylePreference && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Style</p>
                <p className="font-medium text-sm">{review.stylePreference}</p>
              </div>
            )}
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-xs text-muted-foreground mb-1">Goal</p>
              <p className="text-sm">{review.goal}</p>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
