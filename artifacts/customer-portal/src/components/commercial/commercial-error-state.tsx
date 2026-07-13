import { Link } from "wouter";
import { AlertTriangle, RefreshCw, ArrowLeft, MessageCircle } from "lucide-react";
import { Layout } from "@/components/layout";

/**
 * Consistent, explicit error/empty state for the commercial flow — used for
 * invalid tokens, expired quotations, request-not-found, network errors,
 * etc. Never renders an endless spinner; always gives the customer a way
 * forward (retry, go back, or contact support).
 */
export function CommercialErrorState({
  title,
  description,
  onRetry,
  backHref,
  backLabel = "Kembali",
  showSupport = true,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
  showSupport?: boolean;
}) {
  return (
    <Layout>
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-6 h-6 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-serif font-medium mb-2">{title}</h2>
          <p className="text-sm text-muted-foreground mb-6">{description}</p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Coba Lagi
              </button>
            )}
            {backHref && (
              <Link
                href={backHref}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> {backLabel}
              </Link>
            )}
          </div>
          {showSupport && (
            <p className="text-xs text-muted-foreground mt-6 flex items-center justify-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" />
              Butuh bantuan? Hubungi tim kami melalui email atau WhatsApp.
            </p>
          )}
        </div>
      </div>
    </Layout>
  );
}
