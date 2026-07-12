import { Link } from "wouter";
import { ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionButtonProps {
  label: string;
  onClick?: () => void;
  href?: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}

function ActionButton({ label, onClick, href, loading, disabled, variant = "primary" }: ActionButtonProps) {
  const cls = cn(
    "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "border border-card-border hover:bg-muted/40",
  );

  if (href && !onClick) {
    return (
      <Link href={href} className={cls}>
        {label}
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled || loading} className={cls}>
      {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {label}
    </button>
  );
}

export interface ActionRequiredPanelProps {
  title: string;
  description: string;
  deadline?: string | null;
  primary?: ActionButtonProps;
  secondary?: ActionButtonProps;
  consequence?: string;
  className?: string;
}

/**
 * "Action Required" panel — only render this when the customer genuinely has
 * something to do. Use <NoActionRequiredPanel /> otherwise.
 */
export function ActionRequiredPanel({
  title,
  description,
  deadline,
  primary,
  secondary,
  consequence,
  className,
}: ActionRequiredPanelProps) {
  return (
    <section
      role="region"
      aria-label="Action required"
      className={cn(
        "mb-6 rounded-2xl border border-primary/30 bg-primary/5 px-5 py-5",
        className,
      )}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Action Required</p>
          <h3 className="font-medium text-base leading-snug">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
          {deadline && (
            <p className="text-xs text-muted-foreground mt-2">
              Due <span className="font-medium text-foreground">{deadline}</span>
            </p>
          )}
        </div>
      </div>

      {(primary || secondary) && (
        <div className="flex flex-col sm:flex-row gap-2.5">
          {primary && <ActionButton {...primary} variant="primary" />}
          {secondary && <ActionButton {...secondary} variant="secondary" />}
        </div>
      )}

      {consequence && (
        <p className="text-xs text-muted-foreground mt-3 border-t border-primary/10 pt-3">{consequence}</p>
      )}
    </section>
  );
}

export function NoActionRequiredPanel({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "mb-6 flex items-center gap-2 rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground",
        className,
      )}
    >
      No action required from you right now.
    </div>
  );
}
