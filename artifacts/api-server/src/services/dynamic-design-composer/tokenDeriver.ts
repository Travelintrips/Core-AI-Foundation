/**
 * Team 13 — Dynamic Design Composition Engine
 * Token Deriver
 *
 * Derives the full set of CSS-compatible design tokens from
 * the resolved palette, typography, decoration, and material.
 * Pure deterministic functions — no side effects.
 */

import type { DesignCompositionSpec, PaletteInput, TypographyInput, DecorationInput, MaterialInput } from "./types.js";

type DerivedTokens = DesignCompositionSpec["derivedTokens"];

// ── Spacing ───────────────────────────────────────────────────────────────────

function deriveSpacingUnit(material: MaterialInput): number {
  // Neumorphic and material surfaces need more padding to show their depth
  if (material.surface === "neumorphic" || material.surface === "material") return 8;
  return 4;
}

function deriveSpacingScale(unit: number): number[] {
  // Standard 8-point scale based on the unit
  const multipliers = [1, 2, 3, 4, 6, 8, 12, 16, 24];
  return multipliers.map((m) => m * unit);
}

// ── Font sizes ────────────────────────────────────────────────────────────────

function deriveFontSizeScale(
  baseSize: number,
  ratio: number,
): Record<string, string> {
  const round2 = (n: number): string => `${Math.round(n * 100) / 100}px`;
  return {
    xs: round2(baseSize / ratio / ratio),
    sm: round2(baseSize / ratio),
    base: `${baseSize}px`,
    md: round2(baseSize * ratio),
    lg: round2(baseSize * ratio * ratio),
    xl: round2(baseSize * ratio * ratio * ratio),
    "2xl": round2(baseSize * Math.pow(ratio, 4)),
    "3xl": round2(baseSize * Math.pow(ratio, 5)),
    "4xl": round2(baseSize * Math.pow(ratio, 6)),
  };
}

// ── Border radius ─────────────────────────────────────────────────────────────

const BORDER_RADIUS_MAPS: Record<DecorationInput["borderRadius"], Record<string, string>> = {
  none: { sm: "0px", md: "0px", lg: "0px", pill: "0px", circle: "9999px" },
  small: { sm: "2px", md: "4px", lg: "6px", pill: "9999px", circle: "9999px" },
  medium: { sm: "4px", md: "8px", lg: "12px", pill: "9999px", circle: "9999px" },
  large: { sm: "8px", md: "16px", lg: "24px", pill: "9999px", circle: "9999px" },
  pill: { sm: "9999px", md: "9999px", lg: "9999px", pill: "9999px", circle: "9999px" },
  circle: { sm: "50%", md: "50%", lg: "50%", pill: "9999px", circle: "9999px" },
};

// ── Shadows ───────────────────────────────────────────────────────────────────

const SHADOW_MAPS: Record<DecorationInput["shadowDepth"], Record<string, string>> = {
  none: {
    sm: "none",
    md: "none",
    lg: "none",
    xl: "none",
  },
  low: {
    sm: "0 1px 2px rgba(0,0,0,0.05)",
    md: "0 2px 4px rgba(0,0,0,0.06)",
    lg: "0 4px 8px rgba(0,0,0,0.08)",
    xl: "0 8px 16px rgba(0,0,0,0.10)",
  },
  medium: {
    sm: "0 2px 4px rgba(0,0,0,0.08)",
    md: "0 4px 12px rgba(0,0,0,0.12)",
    lg: "0 8px 24px rgba(0,0,0,0.14)",
    xl: "0 16px 40px rgba(0,0,0,0.16)",
  },
  high: {
    sm: "0 4px 8px rgba(0,0,0,0.12)",
    md: "0 8px 24px rgba(0,0,0,0.16)",
    lg: "0 16px 40px rgba(0,0,0,0.20)",
    xl: "0 24px 64px rgba(0,0,0,0.24)",
  },
  dramatic: {
    sm: "0 8px 16px rgba(0,0,0,0.20)",
    md: "0 16px 48px rgba(0,0,0,0.28)",
    lg: "0 32px 80px rgba(0,0,0,0.32)",
    xl: "0 48px 120px rgba(0,0,0,0.40)",
  },
};

// ── Breakpoints ───────────────────────────────────────────────────────────────

const DEFAULT_BREAKPOINTS: Record<string, number> = {
  xs: 320,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

// ── Z-index layers ────────────────────────────────────────────────────────────

const Z_INDEX_LAYERS: Record<string, number> = {
  base: 0,
  raised: 10,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  toast: 500,
  tooltip: 600,
};

// ── Main deriver ──────────────────────────────────────────────────────────────

export function deriveTokens(
  typography: TypographyInput,
  decoration: DecorationInput,
  material: MaterialInput,
): DerivedTokens {
  const spacingUnit = deriveSpacingUnit(material);
  return {
    spacingUnit,
    spacingScale: deriveSpacingScale(spacingUnit),
    fontSizeScale: deriveFontSizeScale(typography.baseSize, typography.scaleRatio),
    borderRadiusMap: BORDER_RADIUS_MAPS[decoration.borderRadius],
    shadowMap: SHADOW_MAPS[decoration.shadowDepth],
    zIndexLayers: Z_INDEX_LAYERS,
    breakpoints: DEFAULT_BREAKPOINTS,
  };
}

// ── Component style tokens ────────────────────────────────────────────────────

import type { ComponentInput, PaletteInput as PI } from "./types.js";

export function resolveComponentStyleTokens(
  component: ComponentInput,
  palette: PI,
  decoration: DecorationInput,
): {
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  borderRadius: string;
  padding: string;
  shadow: string;
} {
  const radiusMap = BORDER_RADIUS_MAPS[decoration.borderRadius];
  const shadowMap = SHADOW_MAPS[decoration.shadowDepth];

  // Component-specific token rules
  const isHero = component.type === "hero" || component.type === "header";
  const isCTA = component.type === "cta";
  const isFooter = component.type === "footer";
  const isSurface = ["testimonial", "stat-block", "feature-grid", "pricing-table"].includes(component.type);

  return {
    backgroundColor: isHero
      ? palette.primary
      : isFooter
      ? palette.text
      : isSurface
      ? palette.surface
      : palette.background,
    textColor: isHero || isFooter
      ? "#FFFFFF"
      : palette.text,
    accentColor: palette.accent,
    borderRadius: isCTA ? (radiusMap["pill"] ?? radiusMap["lg"]) : (radiusMap["md"] ?? "8px"),
    padding: isHero ? "96px 48px" : isSurface ? "48px 32px" : "32px 24px",
    shadow: shadowMap["md"] ?? "none",
  };
}
