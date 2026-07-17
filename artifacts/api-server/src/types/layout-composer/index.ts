// ============================================================
// TEAM 12 — Constraint-Based AI Layout Composer
// Domain types — do not import from outside layout-composer
// ============================================================

// ── Geometry primitives ─────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

// ── Element ──────────────────────────────────────────────────

export type ElementType = "box" | "text" | "image" | "group" | "furniture" | "panel";

export interface TextStyle {
  fontSize: number;       // px
  lineHeight: number;     // multiplier, e.g. 1.4
  letterSpacing?: number; // px
  charWidthRatio?: number; // avg char width as fraction of fontSize (default 0.55)
  maxLines?: number;
}

export interface LayoutElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;  // degrees
  zIndex?: number;
  content?: string;   // text content for type=text
  textStyle?: TextStyle;
  zone?: string;      // assigned zone id (room or garment)
  children?: string[]; // child element ids for type=group
  locked?: boolean;   // if true, solver will not move/resize
  meta?: Record<string, unknown>;
}

// ── Canvas ───────────────────────────────────────────────────

export interface LayoutCanvas {
  width: number;
  height: number;
  padding?: Padding;
  safeZone?: Rect;   // inner safe zone rect (absolute coords)
  background?: string;
}

// ── Zones ─────────────────────────────────────────────────────

export type ZoneCategory = "room" | "garment" | "generic";

export interface LayoutZone {
  id: string;
  label: string;
  category: ZoneCategory;
  rect: Rect;
  /** For garment panels: seam lines that bound this zone */
  seamLines?: SeamLine[];
  /** Only elements with matching elementType may be placed here */
  allowedElementTypes?: ElementType[];
}

export interface SeamLine {
  id: string;
  /** Start and end points of the seam line */
  from: Point;
  to: Point;
}

// ── Constraints ──────────────────────────────────────────────

export type ConstraintType =
  // Position
  | "fixed_position"
  | "align_left"
  | "align_right"
  | "align_top"
  | "align_bottom"
  | "align_center_x"
  | "align_center_y"
  | "align_to_element"
  // Size
  | "fixed_size"
  | "min_width"
  | "max_width"
  | "min_height"
  | "max_height"
  | "aspect_ratio"
  // Spacing / padding
  | "spacing_min"
  | "spacing_exact"
  | "padding"
  // Distribution
  | "distribute_horizontal"
  | "distribute_vertical"
  // Hierarchy
  | "hierarchy_above"
  | "hierarchy_below"
  // Content
  | "text_fit"
  | "text_min_size"
  | "text_max_size"
  // Collision / bounds
  | "no_collision"
  | "safe_zone"
  // Responsive
  | "responsive"
  // Domain-specific
  | "room_zone"
  | "garment_panel";

export type ConstraintPriority = "hard" | "soft" | "hint";

export interface Constraint {
  id: string;
  type: ConstraintType;
  /** Element ids this constraint applies to */
  elementIds: string[];
  /** Typed parameters vary by constraint type */
  params?: ConstraintParams;
  priority: ConstraintPriority;
  /** Used to break ties among same-priority constraints */
  order?: number;
}

export type ConstraintParams =
  | FixedPositionParams
  | FixedSizeParams
  | AlignToElementParams
  | MinMaxParams
  | AspectRatioParams
  | SpacingParams
  | PaddingParams
  | HierarchyParams
  | TextFitParams
  | ResponsiveParams
  | ZoneParams
  | Record<string, unknown>;

export interface FixedPositionParams {
  x: number;
  y: number;
}

export interface FixedSizeParams {
  width: number;
  height: number;
}

export interface AlignToElementParams {
  targetId: string;
  edge: "left" | "right" | "top" | "bottom" | "centerX" | "centerY";
}

export interface MinMaxParams {
  value: number;
}

export interface AspectRatioParams {
  ratio: number; // width / height
}

export interface SpacingParams {
  gap: number;
  axis?: "horizontal" | "vertical" | "both";
}

export interface PaddingParams {
  containerId: string;
  padding: Partial<Padding>;
}

export interface HierarchyParams {
  referenceId: string;
}

export interface TextFitParams {
  autoResize?: boolean;
  shrinkOnly?: boolean;
  minFontSize?: number;
  maxFontSize?: number;
}

export interface ResponsiveParams {
  breakpoints: ResponsiveBreakpoint[];
}

export interface ResponsiveBreakpoint {
  name: string;
  minWidth: number;
  maxWidth?: number;
  overrides: Partial<Pick<LayoutElement, "x" | "y" | "width" | "height" | "zIndex">>;
}

export interface ZoneParams {
  zoneId: string;
}

// ── Operations ───────────────────────────────────────────────

export type OperationType =
  | "place"
  | "move"
  | "resize"
  | "align"
  | "distribute"
  | "reorder"
  | "text_reflow"
  | "clamp"
  | "push_apart"
  | "zone_assign";

export interface LayoutOperation {
  type: OperationType;
  elementId: string;
  constraintId: string;
  before: Partial<LayoutElement>;
  after: Partial<LayoutElement>;
  reason: string;
  iteration: number;
}

// ── Violations ────────────────────────────────────────────────

export type ViolationSeverity = "error" | "warning" | "info";

export interface ConstraintViolation {
  constraintId: string;
  constraintType: ConstraintType;
  elementIds: string[];
  message: string;
  severity: ViolationSeverity;
  /** Actual vs expected values for debugging */
  detail?: Record<string, unknown>;
}

// ── Layout plan (solver output) ───────────────────────────────

export interface LayoutPlan {
  id: string;
  operations: LayoutOperation[];
  elements: LayoutElement[];
  violations: ConstraintViolation[];
  /** 0–1: fraction of constraints satisfied */
  satisfactionScore: number;
  iterations: number;
  converged: boolean;
  deterministic: boolean;
  /** Responsive variant plans keyed by breakpoint name */
  responsiveVariants?: Record<string, LayoutPlan>;
  solvedAt: string; // ISO timestamp
}

// ── Request / Response ────────────────────────────────────────

export interface LayoutRequest {
  id?: string;
  canvas: LayoutCanvas;
  elements: LayoutElement[];
  constraints: Constraint[];
  zones?: LayoutZone[];
  /** Max solver iterations, default 50 */
  maxIterations?: number;
  /** Whether to also produce responsive variants */
  includeResponsive?: boolean;
}

export interface ValidateRequest {
  canvas: LayoutCanvas;
  elements: LayoutElement[];
  constraints: Constraint[];
  zones?: LayoutZone[];
}

export interface ValidateResult {
  valid: boolean;
  violations: ConstraintViolation[];
  warnings: string[];
}

export interface SupportedOperation {
  type: OperationType;
  description: string;
  params?: string;
}

// ── Collision ──────────────────────────────────────────────────

export interface CollisionPair {
  elementA: string;
  elementB: string;
  overlapX: number;
  overlapY: number;
  overlapArea: number;
}

// ── Text fitting ──────────────────────────────────────────────

export interface TextFitResult {
  fits: boolean;
  linesRequired: number;
  linesAvailable: number;
  overflow: number; // px overflow (negative = underflow)
  suggestedHeight?: number;
  suggestedFontSize?: number;
}
