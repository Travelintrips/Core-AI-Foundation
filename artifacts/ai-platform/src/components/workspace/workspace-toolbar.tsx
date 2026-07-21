/**
 * WorkspaceToolbar — Toolbar primitives for workspace panels.
 *
 * Usage:
 *   <WorkspaceToolbarGroup label="Tools">
 *     <WorkspaceToolbarButton icon={<PenIcon />} label="Pen" onClick={…} />
 *     <WorkspaceToolbarButton icon={<EraserIcon />} label="Eraser" active />
 *   </WorkspaceToolbarGroup>
 *
 *   <WorkspaceIconButton icon={<PlusIcon />} label="Add layer" onClick={…} />
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { useDensity } from "./workspace-density";

// ─── WorkspaceToolbarGroup ───────────────────────────────────────────────────

export interface WorkspaceToolbarGroupProps {
  /** Accessible label for the group */
  label: string;
  children: React.ReactNode;
  /** Orientation of the toolbar */
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function WorkspaceToolbarGroup({
  label,
  children,
  orientation = "horizontal",
  className,
  ...props
}: WorkspaceToolbarGroupProps & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        "flex items-center",
        orientation === "horizontal" ? "flex-row gap-0.5" : "flex-col gap-0.5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── WorkspaceToolbarButton ──────────────────────────────────────────────────

export interface WorkspaceToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon element (recommended size: 16px / size-4) */
  icon?: React.ReactNode;
  /** Required accessible label — shown as tooltip when icon-only */
  label: string;
  /** Whether label text is rendered visibly alongside the icon */
  showLabel?: boolean;
  /** Marks the button as the active/selected tool */
  active?: boolean;
}

export function WorkspaceToolbarButton({
  icon,
  label,
  showLabel = false,
  active = false,
  className,
  disabled,
  ...props
}: WorkspaceToolbarButtonProps) {
  const { density } = useDensity();
  return (
    <button
      type="button"
      aria-label={showLabel ? undefined : label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      className={cn(
        // Base
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium",
        "transition-colors outline-none",
        // Focus
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        // Size by density
        density === "compact"
          ? "h-6 px-1.5 text-xs [&_svg]:size-3"
          : "h-7 px-2 text-xs [&_svg]:size-4",
        // State
        active
          ? "bg-primary/10 text-primary border border-primary/30"
          : "bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground border border-transparent",
        // Disabled
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </button>
  );
}

// ─── WorkspaceIconButton ─────────────────────────────────────────────────────

export interface WorkspaceIconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon element */
  icon: React.ReactNode;
  /** Required accessible label */
  label: string;
  /** Visual variant */
  variant?: "ghost" | "outline";
}

export function WorkspaceIconButton({
  icon,
  label,
  variant = "ghost",
  className,
  disabled,
  ...props
}: WorkspaceIconButtonProps) {
  const { density } = useDensity();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-md",
        "transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        density === "compact"
          ? "size-6 [&_svg]:size-3"
          : "size-7 [&_svg]:size-4",
        variant === "ghost"
          ? "bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          : "border border-border bg-card text-foreground hover:bg-accent",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}
