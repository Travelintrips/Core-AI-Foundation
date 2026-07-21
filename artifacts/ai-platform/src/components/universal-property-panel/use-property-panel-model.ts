/**
 * Universal Property Panel — Editing Model Hook
 *
 * Wraps the pure editingModelReducer in React useReducer.
 * Provides autosave (optional, debounced), validation runner,
 * and the complete editing API surface.
 */

import { useReducer, useCallback, useEffect, useRef } from "react";
import {
  editingModelReducer,
  makeInitialEditingState,
  isDirty,
  hasErrors,
  canSave,
  getFieldError,
  buildPatch,
} from "./editing-model";
import type {
  EditingModelState,
  EditingModelAction,
  PropertyValue,
  PropertySectionDefinition,
  PropertyPanelContext,
} from "./types";

export interface UsePropertyPanelModelOptions {
  initialValues?: Record<string, PropertyValue>;
  concurrencyToken?: string;
  isReadOnly?: boolean;
  /** If provided, autosave fires this many ms after the last change */
  autosaveDelayMs?: number;
  /**
   * Called with a flat patch when autosave or explicit save fires.
   * Returns a promise resolving to the new concurrency token (or throws).
   */
  onSave?: (
    patches: Array<{
      sectionId: string;
      fieldId: string;
      value: PropertyValue;
      concurrencyToken?: string;
    }>,
  ) => Promise<{ token?: string } | void>;
  /** Section ID used to build patch entries */
  sectionId?: string;
}

export interface UsePropertyPanelModelResult {
  state: EditingModelState;
  dispatch: React.Dispatch<EditingModelAction>;
  // convenience accessors
  isDirty: boolean;
  hasErrors: boolean;
  canSave: boolean;
  getFieldError: (fieldId: string) => string | undefined;
  // actions
  updateField: (fieldId: string, value: PropertyValue) => void;
  reset: () => void;
  save: () => Promise<void>;
  runValidation: (
    sections: PropertySectionDefinition[],
    ctx: PropertyPanelContext,
  ) => boolean;
}

export function usePropertyPanelModel(
  opts: UsePropertyPanelModelOptions = {},
): UsePropertyPanelModelResult {
  const {
    initialValues = {},
    concurrencyToken,
    isReadOnly = false,
    autosaveDelayMs,
    onSave,
    sectionId = "__default__",
  } = opts;

  const [state, dispatch] = useReducer(
    editingModelReducer,
    { isReadOnly, concurrencyToken },
    (o) => makeInitialEditingState(initialValues, o),
  );

  // ── Autosave ──────────────────────────────────────────────────────────────

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimer.current !== null) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAutosaveTimer();
    };
  }, [clearAutosaveTimer]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    const s = stateRef.current;
    if (!canSave(s) || !onSave) return;

    dispatch({ type: "BEGIN_SAVE" });
    const patches = buildPatch(s, sectionId);

    try {
      const result = await onSave(patches);
      dispatch({
        type: "SAVE_SUCCESS",
        token: result && "token" in result ? result.token : undefined,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Save failed. Please try again.";
      if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("403")) {
        dispatch({ type: "PERMISSION_DENIED", error: msg });
      } else if (msg.toLowerCase().includes("conflict") || msg.toLowerCase().includes("409")) {
        dispatch({
          type: "STALE_VERSION_CONFLICT",
          serverValues: stateRef.current.canonicalValues,
          token: stateRef.current.concurrencyToken ?? "",
        });
      } else {
        dispatch({ type: "SAVE_FAILED", error: msg });
      }
    }
  }, [onSave, sectionId]);

  // ── Field update ──────────────────────────────────────────────────────────

  const updateField = useCallback(
    (fieldId: string, value: PropertyValue) => {
      dispatch({ type: "UPDATE_DRAFT", fieldId, value });

      if (autosaveDelayMs !== undefined && onSave) {
        clearAutosaveTimer();
        autosaveTimer.current = setTimeout(() => {
          void save();
        }, autosaveDelayMs);
      }
    },
    [autosaveDelayMs, onSave, clearAutosaveTimer, save],
  );

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    clearAutosaveTimer();
    dispatch({ type: "RESET" });
  }, [clearAutosaveTimer]);

  // ── Validation ────────────────────────────────────────────────────────────

  const runValidation = useCallback(
    (sections: PropertySectionDefinition[], ctx: PropertyPanelContext): boolean => {
      const errors: Record<string, string[]> = {};
      const draft = stateRef.current.draft;

      for (const section of sections) {
        for (const field of section.fields) {
          const value = draft[field.id];
          const fieldErrors: string[] = [];

          // Required check
          const isRequired =
            typeof field.required === "function"
              ? field.required(ctx)
              : field.required;
          if (isRequired) {
            const isEmpty =
              value === null ||
              value === undefined ||
              value === "" ||
              (Array.isArray(value) && value.length === 0);
            if (isEmpty) {
              fieldErrors.push(`${field.label} is required.`);
            }
          }

          // Numeric bounds
          if (typeof value === "number") {
            if (field.min !== undefined && value < field.min) {
              fieldErrors.push(`${field.label} must be at least ${field.min}.`);
            }
            if (field.max !== undefined && value > field.max) {
              fieldErrors.push(`${field.label} must be at most ${field.max}.`);
            }
          }

          // Enum restriction
          if ((field.type === "select" || field.type === "enum") && field.options) {
            const str = typeof value === "string" ? value : null;
            if (str !== null && str !== "" && !field.options.some((o) => o.value === str)) {
              fieldErrors.push(
                `${field.label} contains an invalid value.`,
              );
            }
          }

          // Custom validation
          if (field.validate && value !== undefined) {
            const result = field.validate(value, draft, ctx);
            if (result && !result.valid) {
              for (const e of result.errors) {
                fieldErrors.push(e.message);
              }
            }
          }

          if (fieldErrors.length > 0) {
            errors[field.id] = fieldErrors;
          }
        }
      }

      dispatch({ type: "SET_FIELD_ERRORS", errors });
      return Object.keys(errors).length === 0;
    },
    [],
  );

  return {
    state,
    dispatch,
    isDirty: isDirty(state),
    hasErrors: hasErrors(state),
    canSave: canSave(state),
    getFieldError: (id) => getFieldError(state, id),
    updateField,
    reset,
    save,
    runValidation,
  };
}
