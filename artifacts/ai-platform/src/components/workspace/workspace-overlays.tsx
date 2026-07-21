/**
 * WorkspaceOverlays — Tooltip, KeyboardHint, Drawer/Sheet wrappers.
 *
 * Thin adapters over existing Shadcn primitives that enforce:
 * - Tooltips always carry an accessible label (not color-only)
 * - Keyboard hints are visually styled consistently
 * - Drawer/Sheet follows workspace panel sizing conventions
 *
 * Usage:
 *   <WorkspaceTooltip content="Delete layer">
 *     <WorkspaceIconButton icon={<Trash2Icon />} label="Delete layer" />
 *   </WorkspaceTooltip>
 *
 *   <WorkspaceKeyboardHint keys={["⌘", "Z"]} label="Undo" />
 *
 *   <WorkspaceDrawer open={open} onClose={() => setOpen(false)} title="Properties">
 *     …content…
 *   </WorkspaceDrawer>
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// ─── WorkspaceTooltip ────────────────────────────────────────────────────────

export interface WorkspaceTooltipProps {
  /** The tooltip text — must not be the only accessible label on the trigger */
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Delay in ms before showing */
  delayDuration?: number;
}

export function WorkspaceTooltip({
  content,
  children,
  side = "top",
  delayDuration = 400,
}: WorkspaceTooltipProps) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="text-xs">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── WorkspaceKeyboardHint ───────────────────────────────────────────────────

export interface WorkspaceKeyboardHintProps {
  /** Keys to display, e.g. ["⌘", "Z"] */
  keys: string[];
  /** Accessible label for the shortcut */
  label: string;
  className?: string;
}

export function WorkspaceKeyboardHint({
  keys,
  label,
  className,
}: WorkspaceKeyboardHintProps) {
  return (
    <span
      aria-label={`Keyboard shortcut: ${label} — ${keys.join(" + ")}`}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {keys.map((key, i) => (
        <kbd
          key={i}
          className={cn(
            "inline-flex items-center justify-center rounded border border-border",
            "bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground leading-none",
          )}
        >
          {key}
        </kbd>
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ─── WorkspaceDrawer ─────────────────────────────────────────────────────────

export interface WorkspaceDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Which edge the sheet slides from */
  side?: "left" | "right" | "bottom";
  children: React.ReactNode;
  className?: string;
}

export function WorkspaceDrawer({
  open,
  onClose,
  title,
  description,
  side = "right",
  children,
  className,
}: WorkspaceDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={side}
        className={cn(
          "flex flex-col gap-0 p-0 overflow-hidden",
          side === "bottom" ? "max-h-[80vh]" : "w-80 sm:w-96",
          className,
        )}
        aria-label={title}
      >
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <SheetTitle className="text-sm font-semibold">{title}</SheetTitle>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

// ─── WorkspaceResizeHandle ────────────────────────────────────────────────────

/**
 * Style contract for resize handles between panels.
 * Teams can apply these classes to any resize divider implementation.
 */
export const WORKSPACE_RESIZE_HANDLE_CLASSES = {
  base: "relative shrink-0 bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none",
  vertical: "w-px cursor-col-resize",
  horizontal: "h-px cursor-row-resize",
  indicator:
    "absolute inset-0 m-auto rounded-full bg-muted-foreground/40 opacity-0 hover:opacity-100 transition-opacity",
  indicatorVertical: "w-0.5 h-6",
  indicatorHorizontal: "h-0.5 w-6",
} as const;
