/**
 * Team 13 — Dynamic Design Composition Engine
 * Core TypeScript types for the deterministic composition pipeline.
 */

// ── Input types ───────────────────────────────────────────────────────────────

export type BlueprintInput = {
  id?: string;
  name: string;
  /** Number of columns in the grid */
  columns: number;
  /** Number of rows (0 = fluid) */
  rows: number;
  /** Gutter between columns/rows in px */
  gutter: number;
  /** Maximum content width in px */
  maxWidth: number;
  /** Page/canvas orientation */
  orientation: "portrait" | "landscape" | "square";
  /** Target medium */
  medium: "digital" | "print" | "presentation" | "social";
};

export type LayoutPlanInput = {
  id?: string;
  name: string;
  /** Overall layout strategy */
  strategy:
    | "hero-content"
    | "grid"
    | "asymmetric"
    | "magazine"
    | "editorial"
    | "minimal"
    | "card-grid"
    | "split"
    | "full-bleed"
    | "sidebar";
  /** Primary axis of content flow */
  flow: "vertical" | "horizontal" | "masonry";
  /** Hero prominence (0 = none, 1 = full bleed) */
  heroWeight: number;
  /** Number of content sections */
  sectionCount: number;
  /** Whether a sidebar is present */
  hasSidebar: boolean;
  /** Visual hierarchy emphasis */
  emphasis: "headline" | "image" | "balanced" | "data";
};

export type ComponentInput = {
  id?: string;
  type:
    | "header"
    | "footer"
    | "hero"
    | "cta"
    | "testimonial"
    | "feature-grid"
    | "pricing-table"
    | "image-gallery"
    | "stat-block"
    | "timeline"
    | "team-section"
    | "form"
    | "nav"
    | "breadcrumb"
    | "divider"
    | "quote"
    | "icon-row"
    | "map"
    | "video-embed"
    | "accordion"
    | "tab-group"
    | "badge"
    | "chip"
    | "avatar"
    | "progress-bar";
  /** Required or optional in composition */
  required: boolean;
  /** Preferred placement zone */
  zone?: "top" | "middle" | "bottom" | "sidebar" | "overlay";
  /** Component-level variant preference */
  variant?: string;
};

export type PatternInput = {
  id?: string;
  name: string;
  type:
    | "geometric"
    | "organic"
    | "abstract"
    | "textile"
    | "dot-matrix"
    | "stripe"
    | "wave"
    | "circuit"
    | "botanical"
    | "none";
  /** How prominent (0 = subtle, 1 = dominant) */
  intensity: number;
  /** Where pattern appears */
  placement: "background" | "section" | "accent" | "border" | "overlay";
  /** Whether pattern tiles */
  tile: boolean;
};

export type PaletteInput = {
  id?: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  /** Additional palette swatches */
  extras?: string[];
  /** Palette mood */
  mood: "vibrant" | "muted" | "monochrome" | "earthy" | "cool" | "warm" | "neutral";
};

export type TypographyInput = {
  id?: string;
  name: string;
  headingFont: string;
  bodyFont: string;
  accentFont?: string;
  headingWeight: "300" | "400" | "500" | "600" | "700" | "800" | "900";
  bodyWeight: "300" | "400" | "500";
  baseSize: number; // px
  scaleRatio: number; // e.g. 1.25 = Major Third
  lineHeight: number; // e.g. 1.6
  letterSpacing: "tight" | "normal" | "wide";
  style: "serif" | "sans-serif" | "display" | "monospace" | "mixed";
};

export type DecorationInput = {
  id?: string;
  name: string;
  borderRadius: "none" | "small" | "medium" | "large" | "pill" | "circle";
  borderStyle: "none" | "thin" | "thick" | "dashed" | "double";
  shadowDepth: "none" | "low" | "medium" | "high" | "dramatic";
  dividerStyle: "none" | "line" | "dash" | "dot" | "ornamental";
  useGradients: boolean;
  gradientDirection?: "horizontal" | "vertical" | "diagonal" | "radial";
  overlayOpacity: number; // 0–1
};

export type MaterialInput = {
  id?: string;
  name: string;
  surface:
    | "flat"
    | "glass"
    | "neumorphic"
    | "material"
    | "frosted"
    | "metallic"
    | "matte"
    | "paper"
    | "fabric";
  texture: "smooth" | "grain" | "noise" | "halftone" | "none";
  elevation: "flat" | "low" | "medium" | "high";
  opacity: "solid" | "semi-transparent" | "transparent";
  blendMode: "normal" | "multiply" | "screen" | "overlay" | "soft-light";
};

export type MotifInput = {
  id?: string;
  name: string;
  theme:
    | "nature"
    | "technology"
    | "human"
    | "abstract"
    | "geometric"
    | "cultural"
    | "industrial"
    | "luxury"
    | "playful"
    | "scientific"
    | "none";
  /** Repetition strategy */
  repetition: "single" | "scattered" | "systematic" | "none";
  /** Scale of motif elements */
  scale: "micro" | "small" | "medium" | "large" | "hero";
  /** Motif color treatment */
  colorTreatment: "monochrome" | "tinted" | "full-color" | "ghost";
};

export type BrandDnaInput = {
  clientId?: string;
  brandPersonality?: string[]; // e.g. ["Professional", "Corporate", "Minimalist"]
  brandVoice?: string; // e.g. "Formal"
  writingStyle?: string; // e.g. "Corporate"
  photographyStyle?: string;
  illustrationStyle?: string;
  iconStyle?: string;
  layoutStyle?: string;
  visualDensity?: string; // "Dense" | "Airy" | "Balanced"
  spacingStyle?: string; // "Compact" | "Generous"
  detectedColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    palette?: string[];
  };
  detectedTypography?: {
    heading?: string;
    body?: string;
    style?: string;
  };
  targetAudience?: {
    primary?: string;
    secondary?: string;
    demographics?: string;
    psychographics?: string;
  };
  industry?: string;
  riskProfile?: string; // "Conservative" | "Moderate" | "Innovative"
  completenessScore?: number; // 0–100
  confidenceScore?: number; // 0.0–1.0
};

export type CompositionRequest = {
  /** Optional stable ID for idempotent recompose */
  requestId?: string;
  blueprint: BlueprintInput;
  layoutPlan: LayoutPlanInput;
  components: ComponentInput[];
  pattern: PatternInput;
  palette: PaletteInput;
  typography: TypographyInput;
  decoration: DecorationInput;
  material: MaterialInput;
  motif: MotifInput;
  brandDna?: BrandDnaInput;
  /** Allow the engine to override inputs to improve brand/style consistency */
  allowOverrides?: boolean;
  /**
   * Idempotency key — scoped to tenantId.
   * If provided, the engine returns the existing result for completed sessions
   * without reprocessing. Requires tenantId to prevent cross-tenant collisions.
   */
  idempotencyKey?: string;
  /**
   * Tenant identifier for ownership scoping.
   * Required when idempotencyKey is provided. The session store never allows
   * cross-tenant lookup — a mismatched tenantId returns 404.
   */
  tenantId?: string;
  /**
   * Set to true to allow re-execution of a previously failed session.
   * Must be an explicit caller decision — never automatic.
   */
  allowRetry?: boolean;
};

// ── Composition state machine ──────────────────────────────────────────────────

/**
 * Lifecycle states for a composition session.
 *
 *   pending → processing → completed  (terminal)
 *                        → failed     (terminal, unless retried explicitly)
 *             cancelled               (terminal)
 */
export type CompositionState =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type CompositionSession = {
  /** SHA-256 of `tenantId\0idempotencyKey` — never expose raw key parts */
  sessionId: string;
  tenantId: string;
  idempotencyKey: string;
  state: CompositionState;
  /** Present when state === "completed" */
  result?: DesignCompositionSpec;
  /** Present when state === "failed" */
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

// ── Output types ──────────────────────────────────────────────────────────────

export type DecisionExplanation = {
  /** What was chosen */
  chosen: string;
  /** Primary reason for the choice */
  why: string;
  /** Brand DNA signal that influenced this decision, if any */
  brandSignal: string | null;
  /** Alternatives that were evaluated but rejected */
  alternativesRejected: Array<{
    option: string;
    reason: string;
  }>;
  /** Whether this decision was overridden from the original input */
  overridden: boolean;
  /** If overridden, what the original input was */
  originalInput?: string;
};

export type ExplainabilityReport = {
  layout: DecisionExplanation;
  palette: DecisionExplanation;
  typography: DecisionExplanation;
  pattern: DecisionExplanation;
  components: Array<DecisionExplanation & { componentType: string }>;
  decoration: DecisionExplanation;
  material: DecisionExplanation;
  motif: DecisionExplanation;
  /** Overall composition rationale */
  compositionRationale: string;
};

export type FallbackRecord = {
  field: string;
  reason: "missing" | "invalid" | "brand-conflict" | "compatibility-conflict";
  originalValue: unknown;
  fallbackValue: unknown;
  fallbackSource: "default" | "brand-dna" | "compatibility-rule";
};

export type BrandConsistencyReport = {
  score: number; // 0–100
  colorAlignment: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
  typographyAlignment: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
  layoutAlignment: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
  personalityAlignment: {
    score: number;
    traits: string[];
    mismatches: string[];
  };
};

export type CompatibilityReport = {
  score: number; // 0–100
  materialPatternCompatible: boolean;
  layoutComponentCompatible: boolean;
  paletteTypographyCompatible: boolean;
  decorationMaterialCompatible: boolean;
  issues: Array<{
    field: string;
    conflict: string;
    severity: "warning" | "error";
  }>;
};

export type ResolvedComponent = ComponentInput & {
  resolvedVariant: string;
  resolvedZone: "top" | "middle" | "bottom" | "sidebar" | "overlay";
  styleTokens: {
    backgroundColor: string;
    textColor: string;
    accentColor: string;
    borderRadius: string;
    padding: string;
    shadow: string;
  };
  explanation: DecisionExplanation;
};

export type DesignCompositionSpec = {
  /** Deterministic SHA-256 of the normalized input */
  compositionId: string;
  version: "1.0";

  // ── Resolved inputs ────────────────────────────────────────────────────────
  blueprint: BlueprintInput;
  layout: LayoutPlanInput;
  palette: PaletteInput;
  typography: TypographyInput;
  components: ResolvedComponent[];
  pattern: PatternInput;
  decoration: DecorationInput;
  material: MaterialInput;
  motif: MotifInput;

  // ── Derived design tokens ──────────────────────────────────────────────────
  derivedTokens: {
    spacingUnit: number; // px
    spacingScale: number[]; // [4, 8, 12, 16, 24, 32, 48, 64, 96]
    fontSizeScale: Record<string, string>; // { xs, sm, base, md, lg, xl, 2xl, 3xl, 4xl }
    borderRadiusMap: Record<string, string>;
    shadowMap: Record<string, string>;
    zIndexLayers: Record<string, number>;
    breakpoints: Record<string, number>;
  };

  // ── Quality reports ────────────────────────────────────────────────────────
  styleConsistencyScore: number; // 0–100
  brandConsistencyScore: number; // 0–100
  brandConsistency: BrandConsistencyReport;
  compatibility: CompatibilityReport;

  // ── Explainability ─────────────────────────────────────────────────────────
  explainability: ExplainabilityReport;

  // ── Fallbacks ──────────────────────────────────────────────────────────────
  fallbacksApplied: FallbackRecord[];
  hasNoAssetFallbacks: boolean;

  composedAt: string; // ISO-8601
};
