/**
 * Re-export of canonical DesignTemplate types for the frontend editor.
 * Mirrors artifacts/api-server/src/types/designTemplate.ts without the Node.js imports.
 */

export const DESIGN_TEMPLATE_SCHEMA_VERSION = "1.0";

export type AssetReference =
  | { type: "storage"; storagePath: string; url?: string }
  | { type: "url"; url: string }
  | { type: "upload"; uploadId: string };

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

export type TextOverflow = "wrap" | "truncate" | "auto-shrink";
export type TextAlign = "left" | "center" | "right" | "justify";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type ObjectFit = "cover" | "contain" | "fill";

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
  textTransform?: TextTransform;
  maxLines?: number;
  overflow?: TextOverflow;
  ellipsis?: boolean;
  minFontSize?: number;
};

export type ImageElement = BaseElement & {
  type: "image";
  src?: AssetReference | { binding: VariableBinding };
  objectFit?: ObjectFit;
  borderRadius?: number;
  placeholder?: AssetReference;
};

export type ShapeKind = "rectangle" | "circle" | "rounded-rectangle";

export type Shadow = { offsetX: number; offsetY: number; blur: number; color: string };
export type Border = { width: number; color: string; style?: "solid" | "dashed" | "dotted" };
export type GradientStop = { offset: number; color: string };
export type LinearGradient = { type: "linear"; angle: number; stops: GradientStop[] };

export type ShapeElement = BaseElement & {
  type: "shape";
  shape: ShapeKind;
  borderRadius?: number;
  fill?: string | LinearGradient;
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

export type IconElement = BaseElement & {
  type: "icon";
  iconName: string;
  color?: string;
};

export type GroupElement = BaseElement & {
  type: "group";
  children: DesignElement[];
};

export type DesignElement =
  | TextElement | ImageElement | ShapeElement
  | QrCodeElement | LineElement | IconElement | GroupElement;

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
