/**
 * WorkspaceStatus — Canonical status vocabulary for workspace UI.
 *
 * Maps platform status strings → a small, consistent presentation layer.
 * This is the single adapter for workspace status display.
 * Do NOT introduce new business statuses here.
 */

export type WorkspaceStatusTone =
  | "neutral"   // muted/default
  | "info"      // blue — in-progress
  | "warning"   // amber — needs attention
  | "success"   // green — done / approved
  | "danger"    // red — failed / error
  | "dim";      // faded — archived / read-only / unavailable

export interface WorkspaceStatusMeta {
  /** Human-readable label */
  label: string;
  tone: WorkspaceStatusTone;
  /** Screen-reader-safe description (may differ from label) */
  ariaLabel?: string;
}

/**
 * Canonical workspace status strings as specified in the Team 20 brief.
 * Teams 11–19 should use these to communicate status to WorkspaceStatusBadge.
 */
export type WorkspaceStatus =
  | "draft"
  | "generating"
  | "ready"
  | "in_review"
  | "approved"
  | "revision_requested"
  | "failed"
  | "archived"
  | "unavailable"
  | "read_only";

const CANONICAL_MAP: Record<WorkspaceStatus, WorkspaceStatusMeta> = {
  draft:              { label: "Draft",               tone: "neutral",  ariaLabel: "Draft — not yet submitted" },
  generating:         { label: "Generating",          tone: "info",     ariaLabel: "AI generation in progress" },
  ready:              { label: "Ready",               tone: "success",  ariaLabel: "Ready for review" },
  in_review:          { label: "In Review",           tone: "warning",  ariaLabel: "Awaiting client review" },
  approved:           { label: "Approved",            tone: "success",  ariaLabel: "Approved by client" },
  revision_requested: { label: "Revision Requested",  tone: "warning",  ariaLabel: "Client requested revisions" },
  failed:             { label: "Failed",              tone: "danger",   ariaLabel: "Processing failed" },
  archived:           { label: "Archived",            tone: "dim",      ariaLabel: "Archived — read-only" },
  unavailable:        { label: "Unavailable",         tone: "dim",      ariaLabel: "Unavailable" },
  read_only:          { label: "Read-Only",           tone: "dim",      ariaLabel: "Read-only mode" },
};

/**
 * Fallback map: bridges existing platform status strings → canonical display.
 * Additive only — does not replace CommercialStatusBadge for commercial flows.
 */
const PLATFORM_ALIAS: Record<string, WorkspaceStatusMeta> = {
  // Job engine / AI statuses
  pending:         { label: "Queued",        tone: "neutral" },
  running:         { label: "Generating",    tone: "info" },
  completed:       { label: "Ready",         tone: "success" },
  in_progress:     { label: "Generating",    tone: "info" },
  cancelled:       { label: "Cancelled",     tone: "dim" },
  // Review statuses
  shared:          { label: "In Review",     tone: "warning" },
  viewed:          { label: "In Review",     tone: "warning" },
  rejected:        { label: "Revision Requested", tone: "warning" },
  revision:        { label: "Revision Requested", tone: "warning" },
  // Lifecycle
  published:       { label: "Ready",         tone: "success" },
  unpublished:     { label: "Draft",         tone: "neutral" },
  deleted:         { label: "Archived",      tone: "dim" },
};

/**
 * Resolve any status string → WorkspaceStatusMeta for display.
 * Canonical keys take priority over platform aliases.
 */
export function resolveWorkspaceStatus(
  status: string | null | undefined,
): WorkspaceStatusMeta {
  if (!status) return { label: "Unknown", tone: "neutral", ariaLabel: "Status unknown" };
  if (status in CANONICAL_MAP)
    return CANONICAL_MAP[status as WorkspaceStatus];
  if (status in PLATFORM_ALIAS)
    return PLATFORM_ALIAS[status];
  // Unknown status: display raw string as neutral
  return { label: status, tone: "neutral" };
}

/**
 * Token classes per tone — always uses design-system tokens, never hard-coded colours.
 */
export const STATUS_TONE_CLASSES: Record<WorkspaceStatusTone, string> = {
  neutral: "bg-muted text-muted-foreground border-muted-foreground/20",
  info:    "bg-primary/10 text-primary border-primary/20",
  warning: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/30",
  success: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-700/30",
  danger:  "bg-destructive/10 text-destructive border-destructive/20",
  dim:     "bg-muted/50 text-muted-foreground/60 border-border/50",
};

export const STATUS_DOT_CLASSES: Record<WorkspaceStatusTone, string> = {
  neutral: "bg-muted-foreground/50",
  info:    "bg-primary",
  warning: "bg-amber-500",
  success: "bg-green-500",
  danger:  "bg-destructive",
  dim:     "bg-muted-foreground/30",
};
