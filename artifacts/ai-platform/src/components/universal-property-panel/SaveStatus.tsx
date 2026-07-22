/**
 * SaveStatus — communicates save/dirty/error/conflict state.
 * Uses aria-live="polite" so screen readers are notified.
 * Not relying on colour alone — uses icons and text.
 */

import { Loader2, CheckCircle, AlertCircle, AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sanitizeLabel } from "./security";
import { usePropertyPanelCtx } from "./context";
import { isDirty, canSave } from "./editing-model";

interface Props {
  onSave?: () => void;
  onReset?: () => void;
}

export function SaveStatus({ onSave, onReset }: Props) {
  const { editingState } = usePropertyPanelCtx();
  const { saveStatus, saveError } = editingState;
  const dirty = isDirty(editingState);
  const saveable = canSave(editingState);

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-t border-border bg-background/80"
      aria-label="Save status"
    >
      {/* Status indicator — live region for screen readers */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center gap-1.5 flex-1 text-xs min-w-0"
      >
        {saveStatus === "saving" && (
          <>
            <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="text-muted-foreground">Saving…</span>
          </>
        )}
        {saveStatus === "saved" && !dirty && (
          <>
            <CheckCircle className="size-3 text-green-600 shrink-0" aria-hidden="true" />
            <span className="text-green-700">Saved</span>
          </>
        )}
        {saveStatus === "failed" && (
          <>
            <AlertCircle className="size-3 text-destructive shrink-0" aria-hidden="true" />
            <span className="text-destructive truncate">{sanitizeLabel(saveError ?? "Save failed")}</span>
          </>
        )}
        {saveStatus === "conflict" && (
          <>
            <AlertTriangle className="size-3 text-amber-600 shrink-0" aria-hidden="true" />
            <span className="text-amber-700 truncate">Version conflict</span>
          </>
        )}
        {saveStatus === "permission-denied" && (
          <>
            <Lock className="size-3 text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="text-muted-foreground">Read-only</span>
          </>
        )}
        {(saveStatus === "idle" || (saveStatus === "saved" && dirty)) && dirty && (
          <span className="text-amber-600">Unsaved changes</span>
        )}
        {saveStatus === "idle" && !dirty && (
          <span className="text-muted-foreground/60 text-[10px]">No changes</span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1 shrink-0">
        {dirty && onReset && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onReset}
            aria-label="Reset changes"
          >
            Reset
          </Button>
        )}
        {onSave && (
          <Button
            size="sm"
            className={cn("h-6 text-xs px-2", !saveable && "opacity-50")}
            onClick={onSave}
            disabled={!saveable}
            aria-disabled={!saveable}
            aria-label="Save changes"
          >
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
