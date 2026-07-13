import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export type CommercialAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "destructive";
};

/**
 * "Action Required" panel — the single, prominent place on a commercial page
 * that tells the customer whether they need to do something right now, what
 * it is, and what happens if they do or don't act.
 *
 * Only ever shown with real data: no invented deadlines/SLAs — pass
 * `deadline` only when the API actually returned a validUntil/due date.
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
  primaryAction,
  secondaryAction,
  consequence,
  errorMessage,
}: {
  title: string;
  description: string;
  deadline?: string | null;
  primaryAction?: CommercialAction;
  secondaryAction?: CommercialAction;
  consequence?: string;
  errorMessage?: string | null;
}) {
  return (
    <div
      role="region"
      aria-live="polite"
      className="rounded-2xl border border-primary/30 bg-primary/5 p-5 md:p-6 mb-6"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <AlertCircle className="w-3.5 h-3.5" />
          Action Required
        </span>
      </div>
      <h2 className="font-serif text-lg font-medium mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground mb-3">{description}</p>

      {deadline && (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-3">Deadline: {deadline}</p>
      )}

      {(primaryAction || secondaryAction) && (
        <div className="flex flex-col sm:flex-row gap-2.5 mt-4">
          {primaryAction && <ActionButton action={primaryAction} kind="primary" />}
          {secondaryAction && <ActionButton action={secondaryAction} kind="secondary" />}
        </div>
      )}

      {errorMessage && <p className="text-sm text-destructive mt-3">{errorMessage}</p>}

      {consequence && <p className="text-xs text-muted-foreground mt-3">{consequence}</p>}
    </div>
  );
}

function ActionButton({ action, kind }: { action: CommercialAction; kind: "primary" | "secondary" }) {
  const base =
    "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const style =
    action.variant === "destructive"
      ? "bg-destructive text-destructive-foreground hover:opacity-90"
      : kind === "primary"
        ? "bg-primary text-primary-foreground hover:bg-primary/90"
        : "border border-border hover:bg-muted/50";

  const content = (
    <>
      {action.loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {action.label}
    </>
  );

  if (action.href) {
    return (
      <a href={action.href} className={`${base} ${style}`}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} disabled={action.disabled || action.loading} className={`${base} ${style}`}>
      {content}
    </button>
  );
}

/** Shown instead of ActionRequiredPanel when the customer has nothing to do. */
export function NoActionRequired({ message = "No action required from you right now." }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-5 mb-6 flex items-center gap-3" role="status" aria-live="polite">
      <CheckCircle2 className="w-5 h-5 text-muted-foreground shrink-0" />
      <p className="text-sm text-muted-foreground">{message}</p>
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
