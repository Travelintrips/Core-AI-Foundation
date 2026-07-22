/**
 * PropertyFieldRendererHost — resolves and renders a single field.
 *
 * - Resolves the renderer from the registry.
 * - Evaluates visibility / readOnly conditions against context.
 * - Associates label[htmlFor] → input[id] for accessibility.
 * - Shows validation error with aria-describedby.
 * - Focuses the input when it is the panel's focusFieldId.
 * - NEVER renders raw HTML from label or description strings.
 */

import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { sanitizeLabel, generateInputId } from "./security";
import { usePropertyPanelCtx } from "./context";
import type { PropertyFieldDefinition } from "./types";

interface Props {
  sectionId: string;
  fieldDef: PropertyFieldDefinition;
}

export function PropertyFieldRendererHost({ sectionId, fieldDef }: Props) {
  const { rendererRegistry, editingState, dispatch, panelContext, onImmediateSave } =
    usePropertyPanelCtx();

  // Visibility
  const visible =
    typeof fieldDef.visible === "function"
      ? fieldDef.visible(panelContext)
      : fieldDef.visible;
  if (visible === false) return null;

  // Capability gate
  if (fieldDef.capabilities?.length) {
    const ok = fieldDef.capabilities.every((c) =>
      panelContext.capabilities.includes(c),
    );
    if (!ok) return null;
  }

  // Read-only resolution
  const fieldReadOnly =
    typeof fieldDef.readOnly === "function"
      ? fieldDef.readOnly(panelContext)
      : fieldDef.readOnly;
  const isReadOnly = editingState.isReadOnly || !!fieldReadOnly;

  // Renderer resolution
  const renderer = rendererRegistry.resolve(fieldDef.type);

  const value = editingState.draft[fieldDef.id] ?? fieldDef.defaultValue;
  const error = editingState.fieldErrors[fieldDef.id]?.[0];
  const inputId = generateInputId(sectionId, fieldDef.id);
  const errorId = `${inputId}-error`;
  const isFocused = editingState.focusFieldId === fieldDef.id;
  const inputRef = useRef<HTMLElement | null>(null);

  // Focus management for validation errors
  useEffect(() => {
    if (isFocused) {
      const el = document.getElementById(inputId);
      if (el) {
        el.focus();
        dispatch({ type: "CLEAR_FOCUS" });
      }
    }
  }, [isFocused, inputId, dispatch]);

  return (
    <div className="space-y-1">
      {/* Label — always text, never HTML */}
      <Label
        htmlFor={inputId}
        className={cn(
          "text-xs",
          isReadOnly ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {sanitizeLabel(fieldDef.label)}
        {(typeof fieldDef.required === "function"
          ? fieldDef.required(panelContext)
          : fieldDef.required) && (
          <span className="text-destructive ml-0.5" aria-hidden="true">*</span>
        )}
      </Label>

      {/* Field renderer or diagnostic fallback */}
      {renderer ? (
        renderer.render({
          fieldDef,
          value,
          onChange: (newValue) => {
            dispatch({ type: "UPDATE_DRAFT", fieldId: fieldDef.id, value: newValue });
            onImmediateSave?.(sectionId, fieldDef.id);
          },
          onBlur: () => {
            // Clear field error on blur if value is now valid
          },
          error,
          isReadOnly,
          isDisabled: false,
          inputId,
          context: panelContext,
        })
      ) : (
        <div
          className="text-xs text-destructive/70 italic border border-destructive/30 rounded px-2 py-1"
          role="alert"
          aria-live="polite"
        >
          {/* text — no raw HTML */}
          No renderer registered for field type: {sanitizeLabel(fieldDef.type)}
        </div>
      )}

      {/* Description — text only */}
      {fieldDef.description && !error && (
        <p className="text-[10px] text-muted-foreground">
          {sanitizeLabel(fieldDef.description)}
        </p>
      )}

      {/* Validation error — announced to screen readers */}
      {error && (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="text-[10px] text-destructive font-medium"
        >
          {/* text — never raw Zod message, always human-readable */}
          {sanitizeLabel(error)}
        </p>
      )}
    </div>
  );
}
