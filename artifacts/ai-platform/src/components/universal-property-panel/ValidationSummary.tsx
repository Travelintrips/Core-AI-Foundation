/**
 * ValidationSummary — shows all validation errors for the panel.
 * Uses a live region so screen readers announce errors.
 * All text rendered as text nodes — no raw HTML.
 */

import { AlertCircle } from "lucide-react";
import { sanitizeLabel } from "./security";
import { usePropertyPanelCtx } from "./context";

export function ValidationSummary() {
  const { editingState } = usePropertyPanelCtx();
  const allErrors = Object.entries(editingState.fieldErrors).flatMap(
    ([fieldId, msgs]) => (msgs ?? []).map((m) => ({ fieldId, message: m })),
  );

  if (allErrors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-label="Validation errors"
      className="mx-3 mb-2 rounded border border-destructive/40 bg-destructive/5 p-2 space-y-1"
    >
      <div className="flex items-center gap-1.5 text-destructive text-xs font-semibold">
        <AlertCircle className="size-3" aria-hidden="true" />
        <span>{allErrors.length} error{allErrors.length !== 1 ? "s" : ""}</span>
      </div>
      <ul className="space-y-0.5 list-none">
        {allErrors.map((e, i) => (
          <li key={`${e.fieldId}-${i}`} className="text-[11px] text-destructive">
            {/* Plain text only — no dangerouslySetInnerHTML */}
            {sanitizeLabel(e.message)}
          </li>
        ))}
      </ul>
    </div>
  );
}
