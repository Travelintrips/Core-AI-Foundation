import { cn } from "@/lib/utils";
import { ShieldOff } from "lucide-react";
import type { ReviewPermission } from "@/hooks/use-review-workspace";

interface ReviewPermissionStateProps {
  /** Required permission to render children */
  required: ReviewPermission;
  /** Actual permissions from workspace summary */
  permissions: ReviewPermission[];
  /** Custom message shown when permission is denied */
  deniedMessage?: string;
  /** If true, renders nothing instead of a denied badge */
  silent?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a section of the Review Workspace with a permission guard.
 * When the required permission is absent, renders a disabled state
 * (or nothing, when `silent` is true).
 */
export function ReviewPermissionState({
  required,
  permissions,
  deniedMessage,
  silent = false,
  children,
  className,
}: ReviewPermissionStateProps) {
  const hasPermission = permissions.includes(required);

  if (hasPermission) {
    return <div className={className}>{children}</div>;
  }

  if (silent) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/50 bg-muted/20 p-4 flex items-center gap-3",
        className,
      )}
      role="status"
      aria-label="Action unavailable"
    >
      <ShieldOff className="size-4 text-muted-foreground shrink-0" aria-hidden />
      <p className="text-xs text-muted-foreground">
        {deniedMessage ?? "This action is not available in the current review state."}
      </p>
    </div>
  );
}

/** Convenience: renders a block as disabled / greyed-out without hiding it */
interface ReviewDisabledOverlayProps {
  disabled: boolean;
  children: React.ReactNode;
  className?: string;
}

export function ReviewDisabledOverlay({ disabled, children, className }: ReviewDisabledOverlayProps) {
  if (!disabled) return <div className={className}>{children}</div>;
  return (
    <div
      className={cn("relative", className)}
      aria-disabled="true"
    >
      <div className="pointer-events-none opacity-40 select-none" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 rounded-2xl" aria-hidden />
    </div>
  );
}
