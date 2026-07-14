// V4.5 AI Design Studio — shared types

export type ElementType = "text" | "image" | "rect" | "circle" | "line" | "frame";
export type ToolType = "select" | "text" | "image" | "rect" | "circle" | "line" | "frame" | "hand";

export interface DesignElement {
  id: string;
  name: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  // style
  fill: string;
  stroke: string;
  strokeWidth: number;
  borderRadius: number;
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: string;
  color?: string;
  lineHeight?: number;
  // image
  src?: string;
  objectFit?: "cover" | "contain" | "fill";
}

export interface CanvasState {
  width: number;
  height: number;
  background: string;
  elements: DesignElement[];
}

export type ResizeHandle =
  | "nw" | "n" | "ne"
  | "e"
  | "se" | "s" | "sw"
  | "w";

export interface Guide {
  id: string;
  axis: "x" | "y";
  value: number;
}

export interface HistoryState {
  past: CanvasState[];
  present: CanvasState;
  future: CanvasState[];
}

export type HistoryAction =
  | { type: "SET"; state: CanvasState }
  | { type: "UNDO" }
  | { type: "REDO" };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "SET": {
      if (JSON.stringify(state.present) === JSON.stringify(action.state)) return state;
      return {
        past: [...state.past.slice(-49), state.present],
        present: action.state,
        future: [],
      };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1]!;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0]!;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
  }
}

export function makeElement(type: ElementType, x: number, y: number): DesignElement {
  const id = `el-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const base: DesignElement = {
    id,
    name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${id.slice(-4)}`,
    type,
    x, y,
    width: type === "text" ? 200 : 160,
    height: type === "text" ? 40 : 120,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    visible: true,
    fill: type === "text" ? "transparent" : type === "image" ? "#f3f4f6" : "#6366f1",
    stroke: "transparent",
    strokeWidth: 0,
    borderRadius: type === "circle" ? 9999 : 4,
  };
  if (type === "text") {
    base.text = "Double-click to edit";
    base.fontSize = 18;
    base.fontFamily = "Inter, sans-serif";
    base.fontWeight = "400";
    base.textAlign = "left";
    base.color = "#111827";
    base.lineHeight = 1.4;
  }
  if (type === "line") {
    base.width = 200;
    base.height = 2;
    base.fill = "transparent";
    base.stroke = "#6366f1";
    base.strokeWidth = 2;
    base.borderRadius = 0;
  }
  if (type === "circle") {
    base.fill = "#a78bfa";
  }
  if (type === "frame") {
    base.width = 300;
    base.height = 200;
    base.fill = "#f9fafb";
    base.stroke = "#e5e7eb";
    base.strokeWidth = 1;
  }
  return base;
}
