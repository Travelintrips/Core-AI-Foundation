import { cn } from "@/lib/utils";

export type CommercialTone = "neutral" | "info" | "warning" | "success" | "danger";

const TONE_CLASSES: Record<CommercialTone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200/60 dark:border-blue-900/40",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200/60 dark:border-amber-900/40",
  success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200/60 dark:border-green-900/40",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
};

/**
 * Generic status pill for the commercial/quotation/checkout flow.
 *
 * Deliberately does NOT own its own status→label mapping: each page keeps
 * its existing, backend-status-derived label map (STATUS_LABEL, TERMINAL,
 * etc. — see request-pricing.tsx / request-quotation.tsx) and only passes
 * the resulting label + a semantic tone here. This keeps a single source of
 * truth for "what backend status means what" while still giving every
 * commercial page the same pill look & feel.
 */
export function CommercialStatusBadge({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: CommercialTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", tone === "neutral" ? "bg-muted-foreground/50" : "bg-current")} />
      {label}
export interface CommercialStatusMeta {
  label: string;
  tone: CommercialTone;
}

const TONE_CLASSES: Record<CommercialTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const DOT_CLASSES: Record<CommercialTone, string> = {
  neutral: "bg-muted-foreground/50",
  info: "bg-blue-500",
  warning: "bg-amber-500",
  success: "bg-green-500",
  danger: "bg-red-500",
};

/**
 * Canonical customer-facing status vocabulary for the commercial / quotation /
 * checkout experience. Maps *existing* backend status strings (quotation,
 * service-request, payment-schedule, invoice) to a small, consistent set of
 * labels — presentation only, no new statuses are introduced anywhere here.
 */
const STATUS_MAP: Record<string, CommercialStatusMeta> = {
  // Quotation lifecycle
  draft: { label: "Preparing Quotation", tone: "neutral" },
  sent: { label: "Awaiting Approval", tone: "warning" },
  quoted: { label: "Preparing Quotation", tone: "neutral" },
  quotation_ready: { label: "Awaiting Approval", tone: "warning" },
  waiting_customer_approval: { label: "Awaiting Approval", tone: "warning" },
  issued: { label: "Awaiting Approval", tone: "warning" },
  viewed: { label: "Awaiting Approval", tone: "warning" },
  revision_requested: { label: "Revision Requested", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  waiting_commercial_gate: { label: "Payment Verification", tone: "info" },

  // Payment / checkout
  waiting_payment: { label: "Awaiting Payment", tone: "warning" },
  waiting_payment_verification: { label: "Payment Verification", tone: "info" },
  pending: { label: "Awaiting Payment", tone: "warning" },
  deposit_paid: { label: "Payment Verification", tone: "info" },
  payment_verified: { label: "In Production", tone: "info" },
  waiting_remaining_payment: { label: "Awaiting Payment", tone: "warning" },
  remaining_paid: { label: "In Production", tone: "info" },

  // Production
  ready_to_build: { label: "In Production", tone: "info" },
  building: { label: "In Production", tone: "info" },
  in_progress: { label: "In Production", tone: "info" },
  orchestrating: { label: "In Production", tone: "info" },
  internal_review: { label: "In Production", tone: "info" },
  waiting_client_review: { label: "In Production", tone: "info" },
  waiting_review: { label: "In Production", tone: "info" },
  revision: { label: "In Production", tone: "info" },
  running: { label: "In Production", tone: "info" },

  // Terminal / billing
  completed: { label: "Completed", tone: "success" },
  converted_to_project: { label: "Completed", tone: "success" },
  paid: { label: "Paid", tone: "success" },
  settled: { label: "Paid", tone: "success" },
  partially_paid: { label: "Partially Paid", tone: "info" },
  overdue: { label: "Overdue", tone: "danger" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  voided: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  brief_in_progress: { label: "Preparing Quotation", tone: "neutral" },
  brief_completed: { label: "Preparing Quotation", tone: "neutral" },
};

export function getCommercialStatusMeta(status: string | null | undefined): CommercialStatusMeta {
  if (!status) return { label: "Unknown", tone: "neutral" };
  return STATUS_MAP[status] ?? { label: status, tone: "neutral" };
}

export function CommercialStatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const meta = getCommercialStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", DOT_CLASSES[meta.tone])} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
