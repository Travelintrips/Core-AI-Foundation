/**
 * Design Template Editor — Reducer
 *
 * Implements the full editor state machine with:
 * - Bounded undo/redo (max HISTORY_MAX_SIZE steps)
 * - Transient drag mode (no history entry per pixel, only on commit)
 * - Deterministic z-index management
 */

import type {
  EditorState,
  EditorAction,
  EditorSnapshot,
  DesignElement,
  DesignCanvas,
  TemplateVariable,
  DesignTemplate,
} from "./types";
import { HISTORY_MAX_SIZE } from "./types";
import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "./constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

function snapshot(state: EditorState): EditorSnapshot {
  return {
    canvas: { ...state.canvas },
    elements: state.elements.map((e) => ({ ...e })),
    variables: state.variables.map((v) => ({ ...v })),
  };
}

function pushHistory(state: EditorState): EditorState {
  const past = [...state.history.past, snapshot(state)].slice(-HISTORY_MAX_SIZE);
  return {
    ...state,
    dirty: true,
    history: { past, future: [] },
  };
}

function restoreSnapshot(state: EditorState, snap: EditorSnapshot): EditorState {
  return {
    ...state,
    canvas: snap.canvas,
    elements: snap.elements,
    variables: snap.variables,
    selectedElementIds: [],
    dirty: true,
  };
}

/** Compute next available zIndex (max + 1) */
function nextZIndex(elements: DesignElement[]): number {
  if (elements.length === 0) return 1;
  return Math.max(...elements.map((e) => e.zIndex)) + 1;
}

/** Re-assign zIndex based on array position (1-based) */
function normalizeZIndices(elements: DesignElement[]): DesignElement[] {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  return sorted.map((el, i) => ({ ...el, zIndex: i + 1 }));
}

/** Move element one step forward in z-order */
function bringForward(elements: DesignElement[], id: string): DesignElement[] {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((e) => e.id === id);
  if (idx === -1 || idx === sorted.length - 1) return elements;
  // Swap with next
  const a = sorted[idx]!;
  const b = sorted[idx + 1]!;
  sorted[idx] = { ...b, zIndex: a.zIndex };
  sorted[idx + 1] = { ...a, zIndex: b.zIndex };
  return sorted;
}

function sendBackward(elements: DesignElement[], id: string): DesignElement[] {
  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const idx = sorted.findIndex((e) => e.id === id);
  if (idx <= 0) return elements;
  const a = sorted[idx]!;
  const b = sorted[idx - 1]!;
  sorted[idx] = { ...b, zIndex: a.zIndex };
  sorted[idx - 1] = { ...a, zIndex: b.zIndex };
  return sorted;
}

/** Duplicate elements with new IDs, offset 20px */
function duplicateElements(elements: DesignElement[], ids: string[]): DesignElement[] {
  const targets = elements.filter((e) => ids.includes(e.id));
  let maxZ = nextZIndex(elements);
  const copies: DesignElement[] = targets.map((el) => ({
    ...el,
    id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    x: el.x + 20,
    y: el.y + 20,
    zIndex: maxZ++,
  }));
  return [...elements, ...copies];
}

// ── Initial state ─────────────────────────────────────────────────────────────

export const initialEditorState: EditorState = {
  templateId: "",
  templateName: "Untitled Template",
  templateStatus: "draft",
  tenantId: "default",
  baseVersionId: undefined,
  canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
  elements: [],
  variables: [],
  selectedElementIds: [],
  sampleData: {},
  dirty: false,
  zoom: 1,
  history: { past: [], future: [] },
};

// ── Reducer ───────────────────────────────────────────────────────────────────

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    case "LOAD_TEMPLATE": {
      const t = action.template;
      return {
        ...initialEditorState,
        templateId: t.id,
        templateName: t.name,
        templateStatus: "draft",
        tenantId: t.tenantId,
        baseVersionId: action.versionId,
        canvas: { ...t.canvas },
        elements: normalizeZIndices(t.elements as DesignElement[]),
        variables: t.variables,
        selectedElementIds: [],
        sampleData: buildInitialSampleData(t.variables),
        dirty: false,
        zoom: 1,
        history: { past: [], future: [] },
      };
    }

    case "MARK_SAVED": {
      return {
        ...state,
        dirty: false,
        baseVersionId: action.versionId ?? state.baseVersionId,
      };
    }

    // ── Canvas ────────────────────────────────────────────────────────────────

    case "SET_CANVAS": {
      const next = pushHistory(state);
      return { ...next, canvas: { ...state.canvas, ...action.patch } };
    }

    case "SET_ZOOM": {
      const z = Math.max(0.1, Math.min(5, action.zoom));
      return { ...state, zoom: z };
    }

    // ── Element CRUD ──────────────────────────────────────────────────────────

    case "ADD_ELEMENT": {
      const el = { ...action.element, zIndex: nextZIndex(state.elements) };
      const next = pushHistory(state);
      return {
        ...next,
        elements: [...state.elements, el],
        selectedElementIds: [el.id],
      };
    }

    case "UPDATE_ELEMENT": {
      const next = pushHistory(state);
      return {
        ...next,
        elements: state.elements.map((e) =>
          e.id === action.id ? ({ ...e, ...action.patch } as DesignElement) : e,
        ),
      };
    }

    // Transient: no history push — for continuous drag/resize
    case "UPDATE_ELEMENT_TRANSIENT": {
      return {
        ...state,
        dirty: true,
        elements: state.elements.map((e) =>
          e.id === action.id ? ({ ...e, ...action.patch } as DesignElement) : e,
        ),
      };
    }

    // Commit transient (drag end) → push one history entry
    case "COMMIT_TRANSIENT": {
      return pushHistory({ ...state, history: { ...state.history } });
    }

    case "DELETE_ELEMENTS": {
      if (action.ids.length === 0) return state;
      const next = pushHistory(state);
      return {
        ...next,
        elements: state.elements.filter((e) => !action.ids.includes(e.id)),
        selectedElementIds: state.selectedElementIds.filter((id) => !action.ids.includes(id)),
      };
    }

    case "DUPLICATE_ELEMENTS": {
      const next = pushHistory(state);
      const newElements = duplicateElements(state.elements, action.ids);
      const newIds = newElements
        .slice(state.elements.length)
        .map((e) => e.id);
      return {
        ...next,
        elements: newElements,
        selectedElementIds: newIds,
      };
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    case "SELECT_ELEMENTS": {
      if (action.toggle) {
        const current = new Set(state.selectedElementIds);
        for (const id of action.ids) {
          if (current.has(id)) current.delete(id);
          else current.add(id);
        }
        return { ...state, selectedElementIds: [...current] };
      }
      return { ...state, selectedElementIds: action.ids };
    }

    case "DESELECT_ALL": {
      return { ...state, selectedElementIds: [] };
    }

    // ── Layers ────────────────────────────────────────────────────────────────

    case "BRING_FORWARD": {
      const next = pushHistory(state);
      return { ...next, elements: bringForward(state.elements, action.id) };
    }

    case "SEND_BACKWARD": {
      const next = pushHistory(state);
      return { ...next, elements: sendBackward(state.elements, action.id) };
    }

    case "BRING_TO_FRONT": {
      const next = pushHistory(state);
      const maxZ = nextZIndex(state.elements);
      return {
        ...next,
        elements: state.elements.map((e) =>
          e.id === action.id ? { ...e, zIndex: maxZ } : e,
        ),
      };
    }

    case "SEND_TO_BACK": {
      const next = pushHistory(state);
      return {
        ...next,
        elements: normalizeZIndices(
          state.elements.map((e) =>
            e.id === action.id ? { ...e, zIndex: 0 } : e,
          ),
        ),
      };
    }

    case "REORDER_ELEMENTS": {
      const next = pushHistory(state);
      const ordered = action.orderedIds
        .map((id, i) => {
          const el = state.elements.find((e) => e.id === id);
          return el ? { ...el, zIndex: i + 1 } : null;
        })
        .filter(Boolean) as DesignElement[];
      return { ...next, elements: ordered };
    }

    // ── Variables ─────────────────────────────────────────────────────────────

    case "ADD_VARIABLE": {
      if (state.variables.find((v) => v.key === action.variable.key)) return state;
      const next = pushHistory(state);
      return { ...next, variables: [...state.variables, action.variable] };
    }

    case "UPDATE_VARIABLE": {
      const next = pushHistory(state);
      return {
        ...next,
        variables: state.variables.map((v) =>
          v.key === action.key ? { ...v, ...action.patch } : v,
        ),
      };
    }

    case "DELETE_VARIABLE": {
      const next = pushHistory(state);
      return {
        ...next,
        variables: state.variables.filter((v) => v.key !== action.key),
      };
    }

    // ── Sample data ───────────────────────────────────────────────────────────

    case "SET_SAMPLE_DATA": {
      return { ...state, sampleData: action.data };
    }

    // ── History ───────────────────────────────────────────────────────────────

    case "UNDO": {
      if (state.history.past.length === 0) return state;
      const past = [...state.history.past];
      const snap = past.pop()!;
      const future = [snapshot(state), ...state.history.future].slice(0, HISTORY_MAX_SIZE);
      return {
        ...restoreSnapshot(state, snap),
        history: { past, future },
      };
    }

    case "REDO": {
      if (state.history.future.length === 0) return state;
      const future = [...state.history.future];
      const snap = future.shift()!;
      const past = [...state.history.past, snapshot(state)].slice(-HISTORY_MAX_SIZE);
      return {
        ...restoreSnapshot(state, snap),
        history: { past, future },
      };
    }

    default:
      return state;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildInitialSampleData(
  variables: TemplateVariable[],
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const v of variables) {
    if (v.defaultValue !== undefined) {
      result[v.key] = v.defaultValue as string | number | boolean;
    } else {
      result[v.key] = getSampleValue(v.type);
    }
  }
  return result;
}

function getSampleValue(type: string): string | number | boolean | null {
  switch (type) {
    case "text": return "Sample Text";
    case "number": return 42;
    case "currency": return "1000";
    case "image": return null;
    case "color": return "#7C6EFA";
    case "url": return "https://example.com";
    case "date": return new Date().toISOString().slice(0, 10);
    case "boolean": return true;
    default: return null;
  }
}

export type { DesignTemplate };
export { DESIGN_TEMPLATE_SCHEMA_VERSION };
