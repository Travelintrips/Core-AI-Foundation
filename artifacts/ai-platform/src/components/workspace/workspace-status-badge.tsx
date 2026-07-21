/**
 * WorkspaceStatusBadge — Canonical visual status indicator for workspace UI.
 *
 * Uses resolveWorkspaceStatus() to map any platform status string to a
 * consistent label + tone. Status is communicated via colour AND text
 * (never colour alone) for accessibility.
 *
 * Usage:
 *   <WorkspaceStatusBadge status="generating" />
 *   <WorkspaceStatusBadge status="approved" dot={false} />
 *   <WorkspaceStatusBadge status={project.status} size="lg" />
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  resolveWorkspaceStatus,
  STATUS_TONE_CLASSES,
  STATUS_DOT_CLASSES,
} from "./workspace-status";

export interface WorkspaceStatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: string | null | undefined;
  /** Show the coloured dot indicator */
  dot?: boolean;
  /** Animate the dot for active/in-progress statuses */
  pulse?: boolean;
  size?: "sm" | "md" | "lg";
}

export function WorkspaceStatusBadge({
  status,
  dot = true,
  pulse,
  size = "md",
  className,
  ...props
}: WorkspaceStatusBadgeProps) {
  const meta = resolveWorkspaceStatus(status);
  const shouldPulse =
    pulse ?? (meta.tone === "info" || meta.label === "Generating");

  return (
    <span
      role="status"
      aria-label={meta.ariaLabel ?? meta.label}
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium whitespace-nowrap rounded-full border",
        STATUS_TONE_CLASSES[meta.tone],
        size === "sm" && "px-2 py-0.5 text-[10px]",
        size === "md" && "px-2.5 py-0.5 text-xs",
        size === "lg" && "px-3 py-1 text-sm",
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            "rounded-full shrink-0",
            size === "sm" && "size-1.5",
            size === "md" && "size-1.5",
            size === "lg" && "size-2",
            STATUS_DOT_CLASSES[meta.tone],
            shouldPulse && "animate-pulse",
          )}
        />
      )}
      {meta.label}
    </span>
  );
}
