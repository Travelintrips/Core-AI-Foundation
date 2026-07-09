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
      case 'pending':
        label = "In Queue";
        variant = "bg-accent text-accent-foreground";
        break;
      case 'running':
        label = "Generating...";
        variant = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
        break;
      case 'completed':
        label = "Completed";
        variant = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
        break;
      case 'failed':
        label = "Failed";
        variant = "bg-destructive/10 text-destructive";
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
