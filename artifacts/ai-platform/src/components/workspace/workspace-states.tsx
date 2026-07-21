/**
 * Workspace state components — Empty, Error, Loading, Unavailable.
 *
 * Built on top of existing Empty + Spinner primitives from ui/.
 * All states carry accessible roles and support reduced-motion.
 *
 * Usage:
 *   <WorkspaceLoadingState message="Loading layers…" />
 *   <WorkspaceEmptyState
 *     icon={<LayersIcon />}
 *     title="No layers yet"
 *     description="Add a layer to get started."
 *     action={<button>Add Layer</button>}
 *   />
 *   <WorkspaceErrorState message="Failed to load assets." onRetry={refetch} />
 *   <WorkspaceUnavailableState reason="premium" />
 */
import * as React from "react";
import {
  AlertTriangleIcon,
  InboxIcon,
  LockIcon,
  ServerOffIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { useDensity } from "./workspace-density";

// ─── Shared shell ─────────────────────────────────────────────────────────────

function StateShell({
  className,
  compact,
  children,
  role = "status",
  "aria-label": ariaLabel,
}: {
  className?: string;
  compact: boolean;
  children: React.ReactNode;
  role?: React.AriaRole;
  "aria-label"?: string;
}) {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col items-center justify-center text-center text-muted-foreground",
        compact ? "gap-2 p-4 min-h-[80px]" : "gap-3 p-8 min-h-[160px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── WorkspaceLoadingState ───────────────────────────────────────────────────

export interface WorkspaceLoadingStateProps {
  message?: string;
  className?: string;
}

export function WorkspaceLoadingState({
  message = "Loading…",
  className,
}: WorkspaceLoadingStateProps) {
  const { density } = useDensity();
  const compact = density === "compact";
  return (
    <StateShell compact={compact} aria-label={message} className={className}>
      <Spinner
        className={cn(
          "text-muted-foreground motion-reduce:animate-none",
          compact ? "size-4" : "size-6",
        )}
      />
      <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
        {message}
      </p>
    </StateShell>
  );
}

// ─── WorkspaceEmptyState ─────────────────────────────────────────────────────

export interface WorkspaceEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function WorkspaceEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: WorkspaceEmptyStateProps) {
  const { density } = useDensity();
  const compact = density === "compact";
  return (
    <StateShell
      role="region"
      aria-label={`Empty state: ${title}`}
      compact={compact}
      className={className}
    >
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:pointer-events-none",
            compact
              ? "size-8 [&_svg]:size-4"
              : "size-12 [&_svg]:size-6",
          )}
        >
          {icon}
        </span>
      )}
      {!icon && (
        <InboxIcon
          aria-hidden="true"
          className={cn(
            "text-muted-foreground/40",
            compact ? "size-6" : "size-10",
          )}
        />
      )}
      <div className={cn("flex flex-col", compact ? "gap-0.5" : "gap-1")}>
        <p className={cn("font-medium text-foreground", compact ? "text-xs" : "text-sm")}>
          {title}
        </p>
        {description && (
          <p className={cn("text-muted-foreground max-w-xs text-balance", compact ? "text-[10px]" : "text-xs")}>
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </StateShell>
  );
}

// ─── WorkspaceErrorState ─────────────────────────────────────────────────────

export interface WorkspaceErrorStateProps {
  message?: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}

export function WorkspaceErrorState({
  message = "Something went wrong.",
  detail,
  onRetry,
  className,
}: WorkspaceErrorStateProps) {
  const { density } = useDensity();
  const compact = density === "compact";
  return (
    <StateShell
      role="alert"
      aria-label={`Error: ${message}`}
      compact={compact}
      className={className}
    >
      <AlertTriangleIcon
        aria-hidden="true"
        className={cn(
          "text-destructive",
          compact ? "size-5" : "size-8",
        )}
      />
      <div className={cn("flex flex-col", compact ? "gap-0.5" : "gap-1")}>
        <p className={cn("font-medium text-destructive", compact ? "text-xs" : "text-sm")}>
          {message}
        </p>
        {detail && (
          <p className={cn("text-muted-foreground max-w-xs text-balance", compact ? "text-[10px]" : "text-xs")}>
            {detail}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded outline-none px-1"
        >
          Try again
        </button>
      )}
    </StateShell>
  );
}

// ─── WorkspaceUnavailableState ───────────────────────────────────────────────

export type UnavailableReason = "premium" | "permission" | "offline" | "generic";

const UNAVAILABLE_COPY: Record<
  UnavailableReason,
  { title: string; description: string; Icon: React.ElementType }
> = {
  premium: {
    title: "Premium feature",
    description: "Upgrade your plan to access this workspace feature.",
    Icon: LockIcon,
  },
  permission: {
    title: "Access restricted",
    description: "You don't have permission to view this content.",
    Icon: LockIcon,
  },
  offline: {
    title: "Offline",
    description: "Check your connection and try again.",
    Icon: ServerOffIcon,
  },
  generic: {
    title: "Unavailable",
    description: "This feature is currently unavailable.",
    Icon: ServerOffIcon,
  },
};

export interface WorkspaceUnavailableStateProps {
  reason?: UnavailableReason;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function WorkspaceUnavailableState({
  reason = "generic",
  title,
  description,
  action,
  className,
}: WorkspaceUnavailableStateProps) {
  const { density } = useDensity();
  const compact = density === "compact";
  const copy = UNAVAILABLE_COPY[reason];
  const { Icon } = copy;
  return (
    <StateShell
      role="region"
      aria-label={title ?? copy.title}
      compact={compact}
      className={className}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "text-muted-foreground/40",
          compact ? "size-5" : "size-8",
        )}
      />
      <div className={cn("flex flex-col", compact ? "gap-0.5" : "gap-1")}>
        <p className={cn("font-medium text-foreground", compact ? "text-xs" : "text-sm")}>
          {title ?? copy.title}
        </p>
        <p className={cn("text-muted-foreground max-w-xs text-balance", compact ? "text-[10px]" : "text-xs")}>
          {description ?? copy.description}
        </p>
      </div>
      {action && <div className="mt-1">{action}</div>}
    </StateShell>
  );
}
