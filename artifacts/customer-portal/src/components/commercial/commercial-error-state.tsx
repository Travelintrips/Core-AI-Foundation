import { Link } from "wouter";
import { AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react";

export interface CommercialErrorStateProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
}

/**
 * Consistent explicit error/expired/invalid-token state for the commercial
 * flow — always has a title, explanation, and a way forward. Never a bare
 * spinner or a silent blank page. Callers already wrap this in <Layout>, so
 * it renders only the content region, not a full page shell.
 */
export function CommercialErrorState({
  title,
  description,
  icon: Icon = AlertTriangle,
  onRetry,
  backHref,
  backLabel = "Back to home",
}: CommercialErrorStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-4 min-h-[50vh]" role="alert">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-muted flex items-center justify-center">
          <Icon className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-serif mb-2">{title}</h2>
        <p className="text-muted-foreground mb-6">{description}</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-card-border text-sm font-medium hover:bg-muted/40 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Try again
            </button>
          )}
          {backHref && (
            <Link
              href={backHref}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {backLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
