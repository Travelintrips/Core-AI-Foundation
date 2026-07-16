/**
 * Design Template Editor — shared types and history reducer
 * Max undo/redo history: 50 steps
 */

import type { Scene, SceneElement } from "@/lib/designTemplateAdapter";

export const MAX_HISTORY = 50;

export interface EditorState {
  scene: Scene;
  selectedIds: string[];
}

export interface HistoryState {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

export type HistoryAction =
  | { type: "SET_SCENE"; scene: Scene }
  | { type: "SELECT"; ids: string[] }
  | { type: "UNDO" }
  | { type: "REDO" };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "SELECT":
      return { ...state, present: { ...state.present, selectedIds: action.ids } };

    case "SET_SCENE": {
      // Don't push to history if nothing actually changed
      if (JSON.stringify(state.present.scene) === JSON.stringify(action.scene)) {
        return { ...state, present: { ...state.present, scene: action.scene } };
      }
      const snapshot: EditorState = { scene: action.scene, selectedIds: state.present.selectedIds };
      return {
        past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present],
        present: snapshot,
        future: [],
      };
    }

    case "UNDO": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1]!;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future].slice(0, MAX_HISTORY),
      };
    }

    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0]!;
      return {
        past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
  }
}

export function makeId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeDefaultElement(type: SceneElement["type"], canvasW: number, canvasH: number): SceneElement {
  const id = makeId();
  const cx = Math.round(canvasW / 2);
  const cy = Math.round(canvasH / 2);
  const base = { id, name: `${type} ${id.slice(-4)}`, rotation: 0, opacity: 1, visible: true, locked: false };

  switch (type) {
    case "text":
      return { ...base, type: "text", x: cx - 100, y: cy - 20, width: 200, height: 40, zIndex: 1,
        contentMode: "static", staticContent: "Text", fontFamily: "Inter", fontSize: 18,
        fontWeight: "normal", italic: false, underline: false, color: "#111827",
        textAlign: "left", lineHeight: 1.4, letterSpacing: 0, textTransform: "none" };

    case "image":
      return { ...base, type: "image", x: cx - 75, y: cy - 75, width: 150, height: 150, zIndex: 1,
        objectFit: "cover", borderRadius: 0 };

    case "shape":
      return { ...base, type: "shape", x: cx - 75, y: cy - 50, width: 150, height: 100, zIndex: 1,
        shapeKind: "rectangle", fillColor: "#6366f1", strokeColor: "transparent", strokeWidth: 0, cornerRadius: 0 };

    case "line":
      return { ...base, type: "line", x: cx - 100, y: cy, width: 200, height: 2, zIndex: 1,
        strokeColor: "#374151", strokeWidth: 2, dashArray: [] };

    case "qrcode":
      return { ...base, type: "qrcode", x: cx - 75, y: cy - 75, width: 150, height: 150, zIndex: 1,
        contentMode: "static", staticContent: "https://example.com", fgColor: "#000000",
        bgColor: "#ffffff", errorLevel: "M" };
  }
}
