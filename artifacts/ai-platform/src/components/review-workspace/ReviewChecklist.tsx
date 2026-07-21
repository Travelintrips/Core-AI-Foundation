import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useWorkspaceChecklist, useToggleChecklistItem, type ChecklistItem } from "@/hooks/use-review-workspace";

interface ReviewChecklistProps {
  reviewId: number;
  canManage: boolean;
  completedBy?: string;
  className?: string;
}

const SOURCE_LABELS: Record<ChecklistItem["source"], string> = {
  core: "Core",
  workflow: "Workflow",
  plugin: "Plugin",
  service_policy: "Service Policy",
};

const SOURCE_COLORS: Record<ChecklistItem["source"], string> = {
  core: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  workflow: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  plugin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  service_policy: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
};

function ChecklistRow({
  item,
  canManage,
  onToggle,
  isToggling,
}: {
  item: ChecklistItem;
  canManage: boolean;
  onToggle: (completed: boolean) => void;
  isToggling: boolean;
}) {
  const isComplete = item.completedAt !== null;

  return (
    <li
      className={cn(
        "flex items-start gap-3 p-3 rounded-xl transition-colors",
        isComplete
          ? "bg-green-50 dark:bg-green-900/10"
          : "bg-muted/30 hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        disabled={!canManage || isToggling}
        onClick={() => onToggle(!isComplete)}
        className={cn(
          "shrink-0 mt-0.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !canManage ? "cursor-default" : "cursor-pointer",
        )}
        aria-label={isComplete ? `Uncheck: ${item.label}` : `Check: ${item.label}`}
        aria-checked={isComplete}
        role="checkbox"
      >
        {isToggling ? (
          <Loader2 className="size-5 text-muted-foreground animate-spin" aria-hidden />
        ) : isComplete ? (
          <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" aria-hidden />
        ) : (
          <Circle className="size-5 text-muted-foreground" aria-hidden />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-sm font-medium", isComplete ? "line-through text-muted-foreground" : "text-foreground")}>
            {item.label}
          </span>
          {item.required && !isComplete && (
            <span className="text-[10px] text-destructive font-semibold shrink-0" aria-label="Required">Required</span>
          )}
          <span
            className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0", SOURCE_COLORS[item.source])}
          >
            {SOURCE_LABELS[item.source]}
          </span>
        </div>

        {item.description && !isComplete && (
          <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
        )}

        {isComplete && item.completedAt && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Completed by <strong>{item.completedBy}</strong> · {format(new Date(item.completedAt), "d MMM yyyy, HH:mm")}
          </p>
        )}
      </div>
    </li>
  );
}

export function ReviewChecklist({ reviewId, canManage, completedBy = "internal", className }: ReviewChecklistProps) {
  const { data, isLoading, error } = useWorkspaceChecklist(reviewId);
  const toggleMutation = useToggleChecklistItem(reviewId);

  if (isLoading) {
    return (
      <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm flex items-center gap-2", className)}>
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-sm text-muted-foreground">Loading checklist…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("rounded-2xl border border-destructive/30 bg-card p-5 shadow-sm flex items-center gap-2", className)}>
        <AlertCircle className="size-4 text-destructive" aria-hidden />
        <span className="text-sm text-destructive">Failed to load checklist</span>
      </div>
    );
  }

  const items = data?.items ?? [];
  const completedCount = items.filter((i) => i.completedAt !== null).length;
  const requiredItems = items.filter((i) => i.required);
  const requiredDone = requiredItems.filter((i) => i.completedAt !== null).length;

  return (
    <section className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)} aria-label="Review checklist">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">
          Checklist
        </h3>
        <span className="text-xs text-muted-foreground">
          {completedCount}/{items.length} done
          {requiredItems.length > 0 && (
            <span className="ml-2">
              ({requiredDone}/{requiredItems.length} required)
            </span>
          )}
        </span>
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-label={`${completedCount} of ${items.length} checklist items completed`}
          className="h-1.5 rounded-full bg-muted mb-4 overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${items.length > 0 ? (completedCount / items.length) * 100 : 0}%` }}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklist items configured.</p>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Checklist items">
          {items.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              canManage={canManage}
              isToggling={
                toggleMutation.isPending &&
                (toggleMutation.variables as { itemId: string } | undefined)?.itemId === item.id
              }
              onToggle={(completed) =>
                toggleMutation.mutate({ itemId: item.id, completed, completedBy })
              }
            />
          ))}
        </ul>
      )}

      {!canManage && (
        <p className="text-xs text-muted-foreground mt-3 italic">
          Checklist is read-only in the current review state.
        </p>
      )}
    </section>
  );
}
