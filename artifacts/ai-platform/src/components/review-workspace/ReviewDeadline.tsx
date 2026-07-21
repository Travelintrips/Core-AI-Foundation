import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, Edit2, X, Check, Loader2, AlertCircle } from "lucide-react";
import { format, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import { useSetDueDate, type WorkspaceMeta } from "@/hooks/use-review-workspace";

interface ReviewDeadlineProps {
  reviewId: number;
  meta: WorkspaceMeta | null;
  canEdit: boolean;
  className?: string;
}

export function ReviewDeadline({ reviewId, meta, canEdit, className }: ReviewDeadlineProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState<string>("");
  const [inputError, setInputError] = useState<string | null>(null);

  const setDueDateMutation = useSetDueDate(reviewId);

  const dueDate = meta?.dueDate ? new Date(meta.dueDate) : null;
  const isOverdue = dueDate ? isPast(dueDate) : false;

  function startEditing() {
    setInputValue(dueDate ? format(dueDate, "yyyy-MM-dd'T'HH:mm") : "");
    setInputError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setInputError(null);
  }

  function handleSave() {
    if (!inputValue) {
      // Clear due date
      setDueDateMutation.mutate(null, { onSuccess: () => setEditing(false) });
      return;
    }
    const parsed = new Date(inputValue);
    if (isNaN(parsed.getTime())) {
      setInputError("Please enter a valid date and time.");
      return;
    }
    setInputError(null);
    setDueDateMutation.mutate(parsed.toISOString(), { onSuccess: () => setEditing(false) });
  }

  function handleClear() {
    setDueDateMutation.mutate(null, { onSuccess: () => setEditing(false) });
  }

  return (
    <section
      className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}
      aria-label="Review deadline"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" aria-hidden />
          Due Date
        </h3>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={startEditing}
            aria-label="Edit due date"
          >
            <Edit2 className="size-3" aria-hidden /> Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <label htmlFor="due-date-input" className="text-xs text-muted-foreground">
            Date and time (leave blank to clear)
          </label>
          <input
            id="due-date-input"
            type="datetime-local"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-invalid={!!inputError}
            aria-describedby={inputError ? "due-date-error" : undefined}
          />
          {inputError && (
            <p id="due-date-error" role="alert" className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="size-3" aria-hidden /> {inputError}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1"
              onClick={handleSave}
              disabled={setDueDateMutation.isPending}
              aria-busy={setDueDateMutation.isPending}
            >
              {setDueDateMutation.isPending
                ? <Loader2 className="size-3 animate-spin" aria-hidden />
                : <Check className="size-3" aria-hidden />}
              Save
            </Button>
            {dueDate && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground hover:text-destructive"
                onClick={handleClear}
                disabled={setDueDateMutation.isPending}
                aria-label="Clear due date"
              >
                <X className="size-3" aria-hidden /> Clear
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={cancelEditing}
              disabled={setDueDateMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : dueDate ? (
        <div
          className={cn(
            "rounded-lg px-3 py-2.5 text-sm font-medium",
            isOverdue
              ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
              : "bg-muted/50 text-foreground",
          )}
          role="status"
          aria-label={isOverdue ? `Overdue: ${format(dueDate, "PPPp")}` : `Due ${format(dueDate, "PPPp")}`}
        >
          {isOverdue && <span className="font-bold mr-1">⚠ Overdue —</span>}
          {format(dueDate, "d MMMM yyyy, HH:mm")}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No due date set.{canEdit && " Click Edit to add one."}
        </p>
      )}
    </section>
  );
}
