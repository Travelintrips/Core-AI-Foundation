/**
 * WorkspacePanel — Core layout primitive for workspace panels.
 *
 * Usage:
 *   <WorkspacePanel>
 *     <WorkspacePanelHeader title="Layers" actions={<button>…</button>} />
 *     <WorkspaceSection>…</WorkspaceSection>
 *     <WorkspaceDivider />
 *     <WorkspaceSection>…</WorkspaceSection>
 *   </WorkspacePanel>
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useDensity } from "./workspace-density";

// ─── WorkspacePanel ───────────────────────────────────────────────────────────

export interface WorkspacePanelProps extends React.ComponentProps<"div"> {
  /** Elevates the panel with a card-like appearance */
  elevated?: boolean;
}

export function WorkspacePanel({
  className,
  elevated = false,
  ...props
}: WorkspacePanelProps) {
  return (
    <div
      data-slot="workspace-panel"
      className={cn(
        "flex flex-col min-h-0 overflow-hidden",
        "bg-card text-card-foreground",
        elevated && "border border-card-border rounded-lg shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

// ─── WorkspacePanelHeader ─────────────────────────────────────────────────────

export interface WorkspacePanelHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function WorkspacePanelHeader({
  title,
  description,
  actions,
  className,
}: WorkspacePanelHeaderProps) {
  const { density } = useDensity();
  return (
    <div
      data-slot="workspace-panel-header"
      className={cn(
        "flex items-center justify-between gap-2 shrink-0 border-b border-border",
        density === "compact" ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className={cn(
          "font-semibold leading-none tracking-tight truncate",
          density === "compact" ? "text-xs" : "text-sm",
        )}>
          {title}
        </h2>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-1 shrink-0">{actions}</div>
      )}
    </div>
  );
}

// ─── WorkspaceSection ────────────────────────────────────────────────────────

export function WorkspaceSection({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { density } = useDensity();
  return (
    <div
      data-slot="workspace-section"
      className={cn(
        "flex flex-col",
        density === "compact" ? "gap-1 p-2" : "gap-2 p-4",
        className,
      )}
      {...props}
    />
  );
}

// ─── WorkspaceDivider ────────────────────────────────────────────────────────

export function WorkspaceDivider({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  if (label) {
    return (
      <div
        role="separator"
        aria-label={label}
        className={cn(
          "relative flex items-center gap-2 px-4 py-1",
          className,
        )}
      >
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
    );
  }
  return (
    <hr
      role="separator"
      className={cn("border-0 border-t border-border mx-0", className)}
    />
  );
}
