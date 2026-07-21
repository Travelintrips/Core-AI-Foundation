/**
 * Universal Property Panel — Editing Model (Pure Reducer)
 *
 * Separates the seven state concerns:
 *   1. canonicalValues  — last confirmed server state
 *   2. draft            — local working copy
 *   3. dirtyFields      — fields that differ from canonical
 *   4. fieldErrors      — per-field validation messages
 *   5. saveStatus       — lifecycle of the save operation
 *   6. saveError        — human-readable failure message
 *   7. conflictServerValues — server values on stale-version conflict
 *
 * This module is a pure reducer — no React dependency — so it is
 * fully testable in the `node` vitest environment.
 */

import type {
  EditingModelState,
  EditingModelAction,
  PropertyValue,
} from "./types";

// ── Initial state factory ─────────────────────────────────────────────────────

export function makeInitialEditingState(
  canonicalValues: Record<string, PropertyValue> = {},
  opts: { isReadOnly?: boolean; concurrencyToken?: string } = {},
): EditingModelState {
  return {
    canonicalValues,
    draft: { ...canonicalValues },
    dirtyFields: new Set<string>(),
    fieldErrors: {},
    saveStatus: "idle",
    saveError: undefined,
    conflictServerValues: undefined,
    concurrencyToken: opts.concurrencyToken,
    isReadOnly: opts.isReadOnly ?? false,
    focusFieldId: undefined,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeDirty(
  canonical: Record<string, PropertyValue>,
  draft: Record<string, PropertyValue>,
): Set<string> {
  const dirty = new Set<string>();
  const allKeys = new Set([...Object.keys(canonical), ...Object.keys(draft)]);
  for (const key of allKeys) {
    if (!shallowEqual(canonical[key], draft[key])) {
      dirty.add(key);
    }
  }
  return dirty;
}

/** Shallow equality for PropertyValue (handles primitives + arrays + objects) */
function shallowEqual(a: PropertyValue, b: PropertyValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined)
    return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as unknown as Record<string, unknown>;
    const bo = b as unknown as Record<string, unknown>;
    const ka = Object.keys(ao).sort();
    const kb = Object.keys(bo).sort();
    if (ka.join(",") !== kb.join(",")) return false;
    return ka.every((k) => ao[k] === bo[k]);
  }
  return false;
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function editingModelReducer(
  state: EditingModelState,
  action: EditingModelAction,
): EditingModelState {
  switch (action.type) {
    // ── Draft mutations ───────────────────────────────────────────────────────

    case "UPDATE_DRAFT": {
      // Read-only panels must not accept edits
      if (state.isReadOnly) return state;
      // Terminal save states block further edits until resolved
      if (
        state.saveStatus === "conflict" ||
        state.saveStatus === "permission-denied"
      ) {
        return state;
      }
      const draft = { ...state.draft, [action.fieldId]: action.value };
      return {
        ...state,
        draft,
        dirtyFields: computeDirty(state.canonicalValues, draft),
        // Clear per-field error on edit
        fieldErrors: { ...state.fieldErrors, [action.fieldId]: [] },
        saveStatus: state.saveStatus === "saved" ? "idle" : state.saveStatus,
      };
    }

    // ── Load from server ──────────────────────────────────────────────────────

    case "UPDATE_CANONICAL": {
      const canonical = action.values;
      const draft = { ...canonical };
      return {
        ...state,
        canonicalValues: canonical,
        draft,
        dirtyFields: new Set<string>(),
        fieldErrors: {},
        saveStatus: "idle",
        saveError: undefined,
        conflictServerValues: undefined,
        concurrencyToken: action.token ?? state.concurrencyToken,
        focusFieldId: undefined,
      };
    }

    // ── Reset to canonical ────────────────────────────────────────────────────

    case "RESET": {
      return {
        ...state,
        draft: { ...state.canonicalValues },
        dirtyFields: new Set<string>(),
        fieldErrors: {},
        saveStatus: "idle",
        saveError: undefined,
        conflictServerValues: undefined,
        focusFieldId: undefined,
      };
    }

    // ── Save lifecycle ────────────────────────────────────────────────────────

    case "BEGIN_SAVE": {
      if (state.isReadOnly) return state;
      return { ...state, saveStatus: "saving", saveError: undefined };
    }

    case "SAVE_SUCCESS": {
      return {
        ...state,
        canonicalValues: { ...state.draft },
        dirtyFields: new Set<string>(),
        saveStatus: "saved",
        saveError: undefined,
        conflictServerValues: undefined,
        concurrencyToken: action.token ?? state.concurrencyToken,
        focusFieldId: undefined,
      };
    }

    case "SAVE_FAILED": {
      return {
        ...state,
        saveStatus: "failed",
        saveError: action.error,
      };
    }

    case "PERMISSION_DENIED": {
      return {
        ...state,
        saveStatus: "permission-denied",
        saveError: action.error,
        isReadOnly: true,
      };
    }

    // ── Conflict resolution ───────────────────────────────────────────────────

    case "STALE_VERSION_CONFLICT": {
      return {
        ...state,
        saveStatus: "conflict",
        conflictServerValues: action.serverValues,
        concurrencyToken: action.token,
        saveError: "Your changes conflict with a newer version. Choose how to resolve.",
      };
    }

    case "RESOLVE_CONFLICT_USE_LOCAL": {
      // Keep draft, discard server values, allow re-save with new token
      return {
        ...state,
        saveStatus: "idle",
        saveError: undefined,
        conflictServerValues: undefined,
      };
    }

    case "RESOLVE_CONFLICT_USE_SERVER": {
      // Accept server version
      const canonical = state.conflictServerValues ?? state.canonicalValues;
      return {
        ...state,
        canonicalValues: canonical,
        draft: { ...canonical },
        dirtyFields: new Set<string>(),
        fieldErrors: {},
        saveStatus: "idle",
        saveError: undefined,
        conflictServerValues: undefined,
        focusFieldId: undefined,
      };
    }

    // ── Validation ────────────────────────────────────────────────────────────

    case "SET_FIELD_ERRORS": {
      // Find first field with errors for focus
      const firstErrorField = Object.entries(action.errors).find(
        ([, errs]) => errs && errs.length > 0,
      )?.[0];
      return {
        ...state,
        fieldErrors: action.errors,
        focusFieldId: firstErrorField ?? state.focusFieldId,
      };
    }

    case "CLEAR_FIELD_ERROR": {
      const { [action.fieldId]: _removed, ...rest } = state.fieldErrors;
      return { ...state, fieldErrors: rest };
    }

    // ── Permissions & mode ────────────────────────────────────────────────────

    case "SET_READ_ONLY": {
      return { ...state, isReadOnly: action.isReadOnly };
    }

    // ── Focus ─────────────────────────────────────────────────────────────────

    case "FOCUS_FIELD": {
      return { ...state, focusFieldId: action.fieldId };
    }

    case "CLEAR_FOCUS": {
      return { ...state, focusFieldId: undefined };
    }

    default:
      return state;
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export function isDirty(state: EditingModelState): boolean {
  return state.dirtyFields.size > 0;
}

export function hasErrors(state: EditingModelState): boolean {
  return Object.values(state.fieldErrors).some((e) => e && e.length > 0);
}

export function canSave(state: EditingModelState): boolean {
  return (
    isDirty(state) &&
    !hasErrors(state) &&
    state.saveStatus !== "saving" &&
    state.saveStatus !== "conflict" &&
    state.saveStatus !== "permission-denied" &&
    !state.isReadOnly
  );
}

export function getFieldError(
  state: EditingModelState,
  fieldId: string,
): string | undefined {
  const errs = state.fieldErrors[fieldId];
  return errs && errs.length > 0 ? errs[0] : undefined;
}

/** Build a partial patch for the fields that are dirty */
export function buildPatch(
  state: EditingModelState,
  sectionId: string,
): Array<{ sectionId: string; fieldId: string; value: PropertyValue; concurrencyToken?: string }> {
  return Array.from(state.dirtyFields).map((fieldId) => ({
    sectionId,
    fieldId,
    value: state.draft[fieldId],
    concurrencyToken: state.concurrencyToken,
  }));
}
