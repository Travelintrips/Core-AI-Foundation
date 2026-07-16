/**
 * Design Template Engine — Domain Types
 *
 * These are the TypeScript types for the DesignTemplate JSON blob stored in
 * design_template_versions.template_json. The schema version "1.0" covers
 * all element types required for Phase 1–3.
 *
 * Rules:
 *  - No executable code may live in a template (no JS expressions, no eval).
 *  - Variable binding uses VariableBinding objects, not raw string interpolation.
 *  - Conditional visibility uses a restricted operator set — no user code.
 */

export const DESIGN_TEMPLATE_SCHEMA_VERSION = "1.0";

// ── Asset Reference ───────────────────────────────────────────────────────────

/** Reference to an image stored in object storage, a pre-validated URL, or a pending upload. */
export type AssetReference = {
  type: "storage";
  storagePath: string;
  url?: string; // cached public URL
} | {
  type: "url";
  url: string; // validated at template-save time via SSRF guard
} | {
  type: "upload";
  uploadId: string; // resolves to storage path before render
};

// ── Variable System ───────────────────────────────────────────────────────────

export type VariableFormatter =
  | "currency"
  | "number"
  | "percentage"
  | "date"
  | "uppercase"
  | "lowercase"
  | "titlecase"
  | "truncate";

/** Safe binding object — no string interpolation, no injection risk. */
export type VariableBinding = {
  variableKey: string;
  fallback?: string;
  formatter?: VariableFormatter;
  /** Only used by "truncate" formatter */
  truncateAt?: number;
  /** Currency code for "currency" formatter, e.g. "USD" */
  currencyCode?: string;
  /** Date format string (safe subset), e.g. "DD MMM YYYY" */
  dateFormat?: string;
};

export type VariableOperator =
  | "equals"
  | "not_equals"
  | "is_empty"
  | "is_not_empty";

/**
 * Controls element visibility based on a single variable condition.
 * Deliberately restricted — no compound logic, no JS expressions.
 */
export type ConditionalVisibility = {
  variable: string;
  operator: VariableOperator;
  value?: string | number | boolean;
};

export type TemplateVariableType =
  | "text"
  | "number"
  | "currency"
  | "image"
  | "color"
  | "url"
  | "date"
  | "boolean";

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
    /** Regex pattern string (no flags) — validated server-side before store */
    pattern?: string;
  };
};

// ── Element Base ──────────────────────────────────────────────────────────────

export type BaseElement = {
  id: string;
  type: string;
  name?: string;
  /** Pixels from left edge of canvas */
  x: number;
  /** Pixels from top edge of canvas */
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise */
  rotation?: number;
  /** 0–1 */
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  /** Paint order — higher = on top */
  zIndex: number;
  visibleWhen?: ConditionalVisibility;
};

// ── Element Types ─────────────────────────────────────────────────────────────

export type TextOverflow = "wrap" | "truncate" | "auto-shrink";
export type TextAlign = "left" | "center" | "right" | "justify";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type ObjectFit = "cover" | "contain" | "fill";

export type TextElement = BaseElement & {
  type: "text";
  /** Static string or variable binding */
  content: string | { binding: VariableBinding };
  fontFamily?: string;
  fontSize?: number;
  /** Numeric weight (100–900) or "bold" / "normal" */
  fontWeight?: number | "bold" | "normal";
  italic?: boolean;
  /** CSS hex color, e.g. "#1a1a1a" */
  color?: string;
  textAlign?: TextAlign;
  /** Multiplier, e.g. 1.4 */
  lineHeight?: number;
  /** Em units */
  letterSpacing?: number;
  underline?: boolean;
  textTransform?: TextTransform;
  maxLines?: number;
  overflow?: TextOverflow;
  ellipsis?: boolean;
  /** Minimum font size when overflow = "auto-shrink" */
  minFontSize?: number;
};

export type ImageElement = BaseElement & {
  type: "image";
  /** Static asset or variable binding (resolves to an AssetReference) */
  src?: AssetReference | { binding: VariableBinding };
  objectFit?: ObjectFit;
  borderRadius?: number;
  /** Shown when src is empty or fails to load */
  placeholder?: AssetReference;
};

export type ShapeKind = "rectangle" | "circle" | "rounded-rectangle";

export type Shadow = {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
};

export type Border = {
  width: number;
  color: string;
  style?: "solid" | "dashed" | "dotted";
};

export type GradientStop = { offset: number; color: string };
export type LinearGradient = {
  type: "linear";
  angle: number;
  stops: GradientStop[];
};

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
  /** Default black */
  fgColor?: string;
  /** Default white */
  bgColor?: string;
  /** Error correction level */
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
  /** Name from the platform icon registry */
  iconName: string;
  color?: string;
};

export type GroupElement = BaseElement & {
  type: "group";
  children: DesignElement[];
};

export type DesignElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | QrCodeElement
  | LineElement
  | IconElement
  | GroupElement;

// ── Canvas ────────────────────────────────────────────────────────────────────

export type DesignCanvas = {
  width: number;
  height: number;
  unit: "px";
  backgroundColor?: string;
  backgroundImage?: AssetReference;
};

// ── Root Template ─────────────────────────────────────────────────────────────

/**
 * DesignTemplate — the full JSON blob stored in design_template_versions.template_json.
 * This is the contract between the editor, the renderer, and the batch system.
 */
export type DesignTemplate = {
  schemaVersion: string;
  /** Matches design_templates.id (string form for portability in JSON) */
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

// ── Render Input / Output ─────────────────────────────────────────────────────

/** The variable data supplied per-row in a batch render */
export type RenderDataRow = Record<string, string | number | boolean | null | undefined>;

export type RenderFormat = "png" | "jpg" | "webp" | "pdf";

export type RenderRequest = {
  templateVersionId: number;
  format: RenderFormat;
  data: RenderDataRow;
  /** Client-supplied key for idempotent single renders */
  idempotencyKey?: string;
  width?: number;
  height?: number;
};

export type RenderWarning = {
  elementId: string;
  code: "text_truncated" | "text_auto_shrunk" | "image_fallback" | "variable_missing" | "font_fallback" | "element_clipped" | "qr_too_long";
  message: string;
};

export type RenderResult = {
  outputUrl: string;
  outputStoragePath: string;
  width: number;
  height: number;
  format: RenderFormat;
  fileSizeBytes: number;
  renderDurationMs: number;
  warnings: RenderWarning[];
};

// ── Security Limits ───────────────────────────────────────────────────────────

export const DESIGN_LIMITS = {
  MAX_CANVAS_WIDTH: 8000,
  MAX_CANVAS_HEIGHT: 8000,
  MAX_ELEMENT_COUNT: 200,
  MAX_VARIABLE_COUNT: 50,
  MAX_BATCH_SIZE: 10_000,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_QR_CONTENT_LENGTH: 2048,
  MIN_FONT_SIZE: 6,
  RENDER_TIMEOUT_MS: 60_000,
  RENDER_CONCURRENCY: 4,
  RENDER_MAX_ATTEMPTS: 3,
} as const;
