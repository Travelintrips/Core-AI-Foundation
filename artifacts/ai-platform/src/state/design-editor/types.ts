/**
 * Design Template Editor — Canonical State Types
 *
 * These are the frontend editor types. The canonical data types (DesignTemplate,
 * DesignElement, etc.) are imported as plain objects matching the Phase 1 backend schema.
 * The editor adds UI-only state (selection, zoom, history, dirty flag) on top.
 */

// ── Re-export domain types from backend (duplicated here for frontend independence)
// We duplicate rather than share to avoid backend bundle leaking into frontend.

export type VariableFormatter =
  | "currency" | "number" | "percentage" | "date"
  | "uppercase" | "lowercase" | "titlecase" | "truncate";

export type VariableBinding = {
  variableKey: string;
  fallback?: string;
  formatter?: VariableFormatter;
  truncateAt?: number;
  currencyCode?: string;
  dateFormat?: string;
};

export type VariableOperator = "equals" | "not_equals" | "is_empty" | "is_not_empty";

export type ConditionalVisibility = {
  variable: string;
  operator: VariableOperator;
  value?: string | number | boolean;
};

export type TemplateVariableType =
  | "text" | "number" | "currency" | "image" | "color" | "url" | "date" | "boolean";

export type TemplateVariable = {
  key: string;
  label: string;
  type: TemplateVariableType;
  required?: boolean;
  defaultValue?: string | number | boolean;
  validation?: {
    maxLength?: number;
    minLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
};

export type AssetReference =
  | { type: "storage"; storagePath: string; url?: string }
  | { type: "url"; url: string }
  | { type: "upload"; uploadId: string };

export type TextOverflow = "wrap" | "truncate" | "auto-shrink";
export type TextAlign = "left" | "center" | "right" | "justify";
export type ObjectFit = "cover" | "contain" | "fill";
export type ShapeKind = "rectangle" | "circle" | "rounded-rectangle";

export type Shadow = { offsetX: number; offsetY: number; blur: number; color: string };
export type Border = { width: number; color: string; style?: "solid" | "dashed" | "dotted" };

export type BaseElement = {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  zIndex: number;
  visibleWhen?: ConditionalVisibility;
};

export type TextElement = BaseElement & {
  type: "text";
  content: string | { binding: VariableBinding };
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | "bold" | "normal";
  italic?: boolean;
  color?: string;
  textAlign?: TextAlign;
  lineHeight?: number;
  letterSpacing?: number;
  underline?: boolean;
  maxLines?: number;
  overflow?: TextOverflow;
  minFontSize?: number;
};

export type ImageElement = BaseElement & {
  type: "image";
  src?: AssetReference | { binding: VariableBinding };
  objectFit?: ObjectFit;
  borderRadius?: number;
  placeholder?: AssetReference;
};

export type ShapeElement = BaseElement & {
  type: "shape";
  shape: ShapeKind;
  borderRadius?: number;
  fill?: string;
  border?: Border;
  shadow?: Shadow;
};

export type QrCodeElement = BaseElement & {
  type: "qrcode";
  content: string | { binding: VariableBinding };
  fgColor?: string;
  bgColor?: string;
  errorLevel?: "L" | "M" | "Q" | "H";
};

export type LineElement = BaseElement & {
  type: "line";
  stroke?: string;
  strokeWidth?: number;
  dashArray?: number[];
};

export type DesignElement = TextElement | ImageElement | ShapeElement | QrCodeElement | LineElement;

export type DesignCanvas = {
  width: number;
  height: number;
  unit: "px";
  backgroundColor?: string;
  backgroundImage?: AssetReference;
};

export type DesignTemplate = {
  schemaVersion: string;
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  category?: string;
  canvas: DesignCanvas;
  elements: DesignElement[];
  variables: TemplateVariable[];
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    version: number;
  };
};

// ── Editor-only types ─────────────────────────────────────────────────────────

/** A point-in-time snapshot pushed to history on each meaningful change */
export type EditorSnapshot = {
  canvas: DesignCanvas;
  elements: DesignElement[];
  variables: TemplateVariable[];
};

export const HISTORY_MAX_SIZE = 100;

export type EditorHistory = {
  past: EditorSnapshot[];
  future: EditorSnapshot[];
};

/** Canonical editor state — single source of truth */
export type EditorState = {
  templateId: string;
  templateName: string;
  templateStatus: string;
  tenantId: string;
  baseVersionId?: string;
  /** Canvas settings (width/height/background) */
  canvas: DesignCanvas;
  /** Flat list of elements sorted by zIndex ascending */
  elements: DesignElement[];
  variables: TemplateVariable[];
  /** Currently selected element IDs */
  selectedElementIds: string[];
  /** Sample data for variable preview */
  sampleData: Record<string, string | number | boolean | null>;
  /** true when unsaved changes exist */
  dirty: boolean;
  /** Canvas zoom level (1 = 100%) */
  zoom: number;
  history: EditorHistory;
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type EditorAction =
  // Lifecycle
  | { type: "LOAD_TEMPLATE"; template: DesignTemplate; versionId?: string }
  | { type: "MARK_SAVED"; versionId?: string }
  // Canvas
  | { type: "SET_CANVAS"; patch: Partial<DesignCanvas> }
  | { type: "SET_ZOOM"; zoom: number }
  // Element CRUD
  | { type: "ADD_ELEMENT"; element: DesignElement }
  | { type: "UPDATE_ELEMENT"; id: string; patch: Partial<DesignElement> }
  | { type: "UPDATE_ELEMENT_TRANSIENT"; id: string; patch: Partial<DesignElement> }
  | { type: "COMMIT_TRANSIENT" }
  | { type: "DELETE_ELEMENTS"; ids: string[] }
  | { type: "DUPLICATE_ELEMENTS"; ids: string[] }
  // Selection
  | { type: "SELECT_ELEMENTS"; ids: string[]; toggle?: boolean }
  | { type: "DESELECT_ALL" }
  // Layers
  | { type: "BRING_FORWARD"; id: string }
  | { type: "SEND_BACKWARD"; id: string }
  | { type: "BRING_TO_FRONT"; id: string }
  | { type: "SEND_TO_BACK"; id: string }
  | { type: "REORDER_ELEMENTS"; orderedIds: string[] }
  // Variables
  | { type: "ADD_VARIABLE"; variable: TemplateVariable }
  | { type: "UPDATE_VARIABLE"; key: string; patch: Partial<TemplateVariable> }
  | { type: "DELETE_VARIABLE"; key: string }
  // Sample data
  | { type: "SET_SAMPLE_DATA"; data: Record<string, string | number | boolean | null> }
  // History
  | { type: "UNDO" }
  | { type: "REDO" };
