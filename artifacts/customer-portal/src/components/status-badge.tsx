import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  type?: 'project' | 'review';
}

export function StatusBadge({ status, type = 'project' }: StatusBadgeProps) {
  let label = status;
  let variant = "bg-muted text-muted-foreground";
  
  if (type === 'project') {
    switch (status) {
      // Pre-production / brief
      case 'draft':
      case 'brief_in_progress':
        label = "Waiting Brief";
        variant = "bg-accent text-accent-foreground";
        break;
      case 'brief_submitted':
      case 'brief_completed':
        label = "Brief Submitted";
        variant = "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300";
        break;
      case 'pending':
        label = "In Queue";
        variant = "bg-accent text-accent-foreground";
        break;
      // Commercial gate
      case 'waiting_customer_approval':
      case 'quotation_ready':
      case 'sent':
      case 'issued':
      case 'quoted':
        label = "Waiting Approval";
        variant = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
        break;
      case 'waiting_payment':
      case 'pending_payment':
      case 'waiting_remaining_payment':
        label = "Waiting Payment";
        variant = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
        break;
      case 'waiting_payment_verification':
      case 'waiting_commercial_gate':
      case 'deposit_paid':
        label = "Payment Verification";
        variant = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
        break;
      // Production
      case 'running':
      case 'in_progress':
      case 'generating':
      case 'ready_to_build':
      case 'building':
      case 'orchestrating':
      case 'internal_review':
      case 'payment_verified':
      case 'remaining_paid':
        label = "In Production";
        variant = "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
        break;
      case 'generating_document':
        label = "Preparing Document";
        variant = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
        break;
      case 'generating_presentation':
        label = "Preparing Presentation";
        variant = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
        break;
      // Review / revision
      case 'waiting_review':
      case 'waiting_client_review':
      case 'waiting_customer_review':
        label = "Waiting Review";
        variant = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
        break;
      case 'revision_requested':
      case 'revision':
        label = "Revision";
        variant = "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
        break;
      // Delivery
      case 'workflow_completed':
      case 'production_completed':
        label = "Preparing Files";
        variant = "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300";
        break;
      case 'deliverable_ready':
      case 'commercial_completed':
        label = "Files Ready";
        variant = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
        break;
      case 'files_unlocked':
        label = "Files Unlocked";
        variant = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
        break;
      case 'completed':
      case 'order_completed':
      case 'delivered':
      case 'converted_to_project':
        label = "Completed";
        variant = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
        break;
      case 'failed':
        label = "Failed";
        variant = "bg-destructive/10 text-destructive";
        break;
      case 'cancelled':
        label = "Cancelled";
        variant = "bg-muted text-muted-foreground";
        break;
    }
  } else if (type === 'review') {
    switch (status) {
      case 'not_shared':
        label = "Not Ready";
        variant = "bg-muted text-muted-foreground";
        break;
      case 'shared':
        label = "Action Required";
        variant = "bg-primary/10 text-primary";
        break;
      case 'viewed':
        label = "In Review";
        variant = "bg-accent text-accent-foreground";
        break;
      case 'approved':
        label = "Approved";
        variant = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
        break;
      case 'rejected':
        label = "Rejected";
        variant = "bg-destructive/10 text-destructive";
        break;
      case 'revision_requested':
        label = "Revising";
        variant = "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
        break;
    }
  }

  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border", variant, variant.includes('bg-muted') ? 'border-transparent' : 'border-current/20')}>
      {label}
    </span>
  );
}
