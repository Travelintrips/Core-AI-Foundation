/**
 * Design Team output types — Team 2.
 *
 * These are the structured visual specification types produced by Agents 4–8.
 * Downstream teams (Team 3 Component, Team 4 Engineering) consume these via
 * the DesignTeamOutput contract at the bottom of this file.
 */

// ─── Master agent contract (from Master Rule) ─────────────────────────────────

export type AgentStatus = "success" | "failed" | "skipped";

export interface AgentExecutionMetadata {
  agentId: string;
  agentName: string;
  agentVersion: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  retryCount: number;
}

export interface AgentOutput<T> {
  status: AgentStatus;
  data: T | null;
  warnings: string[];
  errors: string[];
  metadata: AgentExecutionMetadata;
}

// ─── Model config for dependency injection ────────────────────────────────────

export interface ModelConfig {
  provider: { slug: string; baseUrl?: string | null };
  model: { modelId: string; maxOutputTokens?: number | null };
  temperature?: number | null;
  maxTokens?: number | null;
}

// ─── Agent 4: Layout Spec ─────────────────────────────────────────────────────

export interface LayoutSection {
  id: string;
  name: string;
  order: number;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  alignment: "left" | "center" | "right";
  /** 1 (lowest) – 10 (highest) */
  priority: number;
}

export interface LayoutSpec {
  canvas: {
    width: number;
    height: number;
  };
  grid: {
    columns: number;
    rows?: number;
    gutter: number;
    margin: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  safeArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sections: LayoutSection[];
  readingOrder: string[];
  whitespaceRules: string[];
}

// ─── Agent 5: Composition Spec ────────────────────────────────────────────────

export interface CompositionSpec {
  focalPoint: {
    sectionId: string;
    reason: string;
  };
  eyeFlow: string[];
  balance: "symmetrical" | "asymmetrical" | "radial";
  visualWeight: Array<{
    sectionId: string;
    /** 0–100 */
    weight: number;
  }>;
  spacingScale: number[];
  relationships: Array<{
    fromSectionId: string;
    toSectionId: string;
    relationship: string;
  }>;
  densityMap: Array<{
    sectionId: string;
    density: "low" | "medium" | "high";
  }>;
}

// ─── Agent 6: Typography Spec ─────────────────────────────────────────────────

export interface TextStyle {
  fontFamily: string;
  /** px */
  fontSize: number;
  /** Numeric weight (400, 700…) or CSS keyword */
  fontWeight: number | string;
  /** Unitless multiplier */
  lineHeight: number;
  /** em or px */
  letterSpacing: number;
  color?: string;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
}

export interface TypographySpec {
  fontPairing: {
    headingFont: string;
    bodyFont: string;
    accentFont?: string;
  };
  styles: {
    display: TextStyle;
    heading: TextStyle;
    subheading: TextStyle;
    body: TextStyle;
    caption: TextStyle;
    button: TextStyle;
    price?: TextStyle;
  };
  /** Ordered fallback font list */
  fallbackFonts: string[];
  readabilityRules: string[];
}

// ─── Agent 7: Color Spec ──────────────────────────────────────────────────────

export interface ColorTokens {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  success?: string;
  warning?: string;
  danger?: string;
}

export interface GradientDef {
  id: string;
  type: "linear" | "radial";
  colors: string[];
  /** 0–1 stops matching colors array */
  stops: number[];
  /** degrees; only for linear */
  angle?: number;
}

export interface ShadowDef {
  id: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  /** 0–1 */
  opacity: number;
}

export interface ContrastCheck {
  foreground: string;
  background: string;
  /** WCAG 2.1 contrast ratio */
  ratio: number;
  /** true if ratio ≥ 4.5 (AA normal text) */
  passed: boolean;
}

export interface ColorSpec {
  tokens: ColorTokens;
  gradients: GradientDef[];
  shadows: ShadowDef[];
  contrastChecks: ContrastCheck[];
}

// ─── Agent 8: Decoration Spec ─────────────────────────────────────────────────

export type DecorationType =
  | "shape"
  | "divider"
  | "frame"
  | "badge"
  | "pattern"
  | "background-accent";

export interface Decoration {
  id: string;
  type: DecorationType;
  /** Optional target section; absent means canvas-level decoration */
  targetSectionId?: string;
  geometry: Record<string, unknown>;
  style: Record<string, unknown>;
  purpose: string;
  /** true = purely decorative, no semantic content */
  decorativeOnly: boolean;
}

export interface DecorationSpec {
  decorations: Decoration[];
}

// ─── Aggregated output (Team 2 → Team 3 / Team 4 contract) ───────────────────

export interface DesignTeamOutput {
  layout: LayoutSpec;
  composition: CompositionSpec;
  typography: TypographySpec;
  colors: ColorSpec;
  decorations: DecorationSpec;
}
