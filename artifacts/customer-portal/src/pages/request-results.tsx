/**
 * Project Results page — shown to the customer after a service request is
 * marked as completed by the admin.
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
} from "lucide-react";

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
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h1 className="text-3xl font-serif font-medium mb-1">
                  Proyek Selesai!
                </h1>
                <p className="text-muted-foreground">
                  Kode permintaan:{" "}
                  <span className="font-mono text-sm">{requestId}</span>
                </p>
              </div>
            </div>

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

            {/* Deliverable links */}
            {data.completionLinks && data.completionLinks.length > 0 ? (
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

            {/* Empty state — no notes or links yet */}
            {!data.completionNotes && (!data.completionLinks || data.completionLinks.length === 0) && (
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
