/**
 * Team 13 — Dynamic Design Composition Engine
 * Fallback Handler
 *
 * Provides sensible defaults for missing, invalid, or brand-conflicting
 * inputs. All fallbacks are deterministic — no randomness.
 */

import type {
  BlueprintInput,
  LayoutPlanInput,
  ComponentInput,
  PatternInput,
  PaletteInput,
  TypographyInput,
  DecorationInput,
  MaterialInput,
  MotifInput,
  BrandDnaInput,
  FallbackRecord,
} from "./types.js";

// ── Default values ────────────────────────────────────────────────────────────

export const DEFAULT_BLUEPRINT: BlueprintInput = {
  name: "Standard 12-column",
  columns: 12,
  rows: 0,
  gutter: 24,
  maxWidth: 1280,
  orientation: "portrait",
  medium: "digital",
};

export const DEFAULT_LAYOUT: LayoutPlanInput = {
  name: "Hero + Content",
  strategy: "hero-content",
  flow: "vertical",
  heroWeight: 0.4,
  sectionCount: 3,
  hasSidebar: false,
  emphasis: "balanced",
};

export const DEFAULT_PALETTE: PaletteInput = {
  name: "Neutral Professional",
  primary: "#1E3A5F",
  secondary: "#2D6A9F",
  accent: "#F4A261",
  background: "#FFFFFF",
  surface: "#F8F9FA",
  text: "#1A1A2E",
  textMuted: "#6C757D",
  mood: "neutral",
};

export const DEFAULT_TYPOGRAPHY: TypographyInput = {
  name: "Professional Sans",
  headingFont: "Inter",
  bodyFont: "Inter",
  headingWeight: "700",
  bodyWeight: "400",
  baseSize: 16,
  scaleRatio: 1.25,
  lineHeight: 1.6,
  letterSpacing: "normal",
  style: "sans-serif",
};

export const DEFAULT_PATTERN: PatternInput = {
  name: "No Pattern",
  type: "none",
  intensity: 0,
  placement: "background",
  tile: false,
};

export const DEFAULT_DECORATION: DecorationInput = {
  name: "Clean Minimal",
  borderRadius: "medium",
  borderStyle: "none",
  shadowDepth: "low",
  dividerStyle: "line",
  useGradients: false,
  overlayOpacity: 0,
};

export const DEFAULT_MATERIAL: MaterialInput = {
  name: "Flat",
  surface: "flat",
  texture: "smooth",
  elevation: "low",
  opacity: "solid",
  blendMode: "normal",
};

export const DEFAULT_MOTIF: MotifInput = {
  name: "Abstract",
  theme: "abstract",
  repetition: "none",
  scale: "small",
  colorTreatment: "monochrome",
};

export const DEFAULT_COMPONENTS: ComponentInput[] = [
  { type: "header", required: true, zone: "top", variant: "standard" },
  { type: "hero", required: true, zone: "top", variant: "standard" },
  { type: "cta", required: true, zone: "bottom", variant: "standard" },
  { type: "footer", required: true, zone: "bottom", variant: "standard" },
];

// ── Industry-specific palette overrides ───────────────────────────────────────

const INDUSTRY_PALETTES: Record<string, Partial<PaletteInput>> = {
  technology: {
    primary: "#0F4C81",
    secondary: "#1976D2",
    accent: "#00BCD4",
    mood: "cool",
  },
  healthcare: {
    primary: "#1B5E20",
    secondary: "#388E3C",
    accent: "#4CAF50",
    mood: "neutral",
  },
  finance: {
    primary: "#1A237E",
    secondary: "#283593",
    accent: "#C8A951",
    mood: "neutral",
  },
  creative: {
    primary: "#6A1B9A",
    secondary: "#8E24AA",
    accent: "#F06292",
    mood: "vibrant",
  },
  retail: {
    primary: "#BF360C",
    secondary: "#E64A19",
    accent: "#FF8F00",
    mood: "warm",
  },
  hospitality: {
    primary: "#4E342E",
    secondary: "#6D4C41",
    accent: "#D4AF37",
    mood: "warm",
  },
  education: {
    primary: "#1565C0",
    secondary: "#1976D2",
    accent: "#FF8F00",
    mood: "cool",
  },
  logistics: {
    primary: "#1B2631",
    secondary: "#2E4057",
    accent: "#F39C12",
    mood: "neutral",
  },
};

// ── Fallback builder ──────────────────────────────────────────────────────────

export function applyFallbacks(
  blueprint: BlueprintInput | undefined,
  layoutPlan: LayoutPlanInput | undefined,
  components: ComponentInput[] | undefined,
  pattern: PatternInput | undefined,
  palette: PaletteInput | undefined,
  typography: TypographyInput | undefined,
  decoration: DecorationInput | undefined,
  material: MaterialInput | undefined,
  motif: MotifInput | undefined,
  brandDna?: BrandDnaInput,
): {
  blueprint: BlueprintInput;
  layoutPlan: LayoutPlanInput;
  components: ComponentInput[];
  pattern: PatternInput;
  palette: PaletteInput;
  typography: TypographyInput;
  decoration: DecorationInput;
  material: MaterialInput;
  motif: MotifInput;
  fallbacks: FallbackRecord[];
} {
  const fallbacks: FallbackRecord[] = [];

  // ── Blueprint fallback ──────────────────────────────────────────────────────
  const resolvedBlueprint = blueprint ?? (() => {
    fallbacks.push({
      field: "blueprint",
      reason: "missing",
      originalValue: null,
      fallbackValue: DEFAULT_BLUEPRINT.name,
      fallbackSource: "default",
    });
    return DEFAULT_BLUEPRINT;
  })();

  // ── Layout fallback ─────────────────────────────────────────────────────────
  let resolvedLayout = layoutPlan ?? (() => {
    fallbacks.push({
      field: "layoutPlan",
      reason: "missing",
      originalValue: null,
      fallbackValue: DEFAULT_LAYOUT.name,
      fallbackSource: "default",
    });
    return DEFAULT_LAYOUT;
  })();

  // Adapt layout from Brand DNA layout style
  if (!layoutPlan && brandDna?.layoutStyle) {
    const layoutFromDna = layoutStyleToStrategy(brandDna.layoutStyle);
    if (layoutFromDna) {
      resolvedLayout = { ...resolvedLayout, strategy: layoutFromDna };
      fallbacks.push({
        field: "layoutPlan.strategy",
        reason: "missing",
        originalValue: null,
        fallbackValue: layoutFromDna,
        fallbackSource: "brand-dna",
      });
    }
  }

  // ── Components fallback ─────────────────────────────────────────────────────
  const resolvedComponents = (components && components.length > 0) ? components : (() => {
    fallbacks.push({
      field: "components",
      reason: "missing",
      originalValue: [],
      fallbackValue: DEFAULT_COMPONENTS.map((c) => c.type).join(", "),
      fallbackSource: "default",
    });
    return DEFAULT_COMPONENTS;
  })();

  // ── Pattern fallback ────────────────────────────────────────────────────────
  const resolvedPattern = pattern ?? (() => {
    fallbacks.push({
      field: "pattern",
      reason: "missing",
      originalValue: null,
      fallbackValue: "none",
      fallbackSource: "default",
    });
    return DEFAULT_PATTERN;
  })();

  // ── Palette fallback ────────────────────────────────────────────────────────
  let resolvedPalette = palette ?? DEFAULT_PALETTE;
  if (!palette) {
    // Try to pull palette from Brand DNA
    if (brandDna?.detectedColors?.primary) {
      const dnaPalette = buildPaletteFromDna(brandDna);
      resolvedPalette = dnaPalette;
      fallbacks.push({
        field: "palette",
        reason: "missing",
        originalValue: null,
        fallbackValue: "Derived from Brand DNA",
        fallbackSource: "brand-dna",
      });
    } else if (brandDna?.industry) {
      const industryOverride = INDUSTRY_PALETTES[brandDna.industry.toLowerCase()];
      if (industryOverride) {
        resolvedPalette = { ...DEFAULT_PALETTE, ...industryOverride };
        fallbacks.push({
          field: "palette",
          reason: "missing",
          originalValue: null,
          fallbackValue: `Industry default for ${brandDna.industry}`,
          fallbackSource: "brand-dna",
        });
      } else {
        fallbacks.push({
          field: "palette",
          reason: "missing",
          originalValue: null,
          fallbackValue: DEFAULT_PALETTE.name,
          fallbackSource: "default",
        });
      }
    } else {
      fallbacks.push({
        field: "palette",
        reason: "missing",
        originalValue: null,
        fallbackValue: DEFAULT_PALETTE.name,
        fallbackSource: "default",
      });
    }
  }

  // ── Typography fallback ─────────────────────────────────────────────────────
  let resolvedTypography = typography ?? DEFAULT_TYPOGRAPHY;
  if (!typography) {
    if (brandDna?.detectedTypography?.heading) {
      resolvedTypography = {
        ...DEFAULT_TYPOGRAPHY,
        headingFont: brandDna.detectedTypography.heading,
        bodyFont: brandDna.detectedTypography.body ?? DEFAULT_TYPOGRAPHY.bodyFont,
      };
      fallbacks.push({
        field: "typography",
        reason: "missing",
        originalValue: null,
        fallbackValue: "Derived from Brand DNA typography",
        fallbackSource: "brand-dna",
      });
    } else {
      fallbacks.push({
        field: "typography",
        reason: "missing",
        originalValue: null,
        fallbackValue: DEFAULT_TYPOGRAPHY.name,
        fallbackSource: "default",
      });
    }
  }

  // ── Decoration fallback ─────────────────────────────────────────────────────
  const resolvedDecoration = decoration ?? (() => {
    fallbacks.push({
      field: "decoration",
      reason: "missing",
      originalValue: null,
      fallbackValue: DEFAULT_DECORATION.name,
      fallbackSource: "default",
    });
    return DEFAULT_DECORATION;
  })();

  // ── Material fallback ───────────────────────────────────────────────────────
  const resolvedMaterial = material ?? (() => {
    fallbacks.push({
      field: "material",
      reason: "missing",
      originalValue: null,
      fallbackValue: DEFAULT_MATERIAL.name,
      fallbackSource: "default",
    });
    return DEFAULT_MATERIAL;
  })();

  // ── Motif fallback ──────────────────────────────────────────────────────────
  let resolvedMotif = motif ?? DEFAULT_MOTIF;
  if (!motif) {
    const industryMotif = brandDna?.industry
      ? industryToMotifTheme(brandDna.industry)
      : null;
    if (industryMotif) {
      resolvedMotif = { ...DEFAULT_MOTIF, theme: industryMotif };
      fallbacks.push({
        field: "motif",
        reason: "missing",
        originalValue: null,
        fallbackValue: `Industry motif: ${industryMotif}`,
        fallbackSource: "brand-dna",
      });
    } else {
      fallbacks.push({
        field: "motif",
        reason: "missing",
        originalValue: null,
        fallbackValue: DEFAULT_MOTIF.name,
        fallbackSource: "default",
      });
    }
  }

  return {
    blueprint: resolvedBlueprint,
    layoutPlan: resolvedLayout,
    components: resolvedComponents,
    pattern: resolvedPattern,
    palette: resolvedPalette,
    typography: resolvedTypography,
    decoration: resolvedDecoration,
    material: resolvedMaterial,
    motif: resolvedMotif,
    fallbacks,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function layoutStyleToStrategy(
  layoutStyle: string,
): LayoutPlanInput["strategy"] | null {
  const map: Record<string, LayoutPlanInput["strategy"]> = {
    corporate: "hero-content",
    grid: "grid",
    asymmetric: "asymmetric",
    magazine: "magazine",
    editorial: "editorial",
    minimal: "minimal",
    "card-based": "card-grid",
    split: "split",
  };
  return map[layoutStyle.toLowerCase()] ?? null;
}

function buildPaletteFromDna(brandDna: BrandDnaInput): PaletteInput {
  const c = brandDna.detectedColors ?? {};
  return {
    name: "Brand DNA Derived",
    primary: c.primary ?? DEFAULT_PALETTE.primary,
    secondary: c.secondary ?? DEFAULT_PALETTE.secondary,
    accent: c.accent ?? DEFAULT_PALETTE.accent,
    background: "#FFFFFF",
    surface: "#F8F9FA",
    text: "#1A1A2E",
    textMuted: "#6C757D",
    extras: c.palette,
    mood: "neutral",
  };
}

function industryToMotifTheme(
  industry: string,
): MotifInput["theme"] | null {
  const map: Record<string, MotifInput["theme"]> = {
    technology: "technology",
    healthcare: "human",
    finance: "geometric",
    creative: "abstract",
    retail: "playful",
    hospitality: "luxury",
    education: "human",
    logistics: "industrial",
    agriculture: "nature",
    science: "scientific",
    cultural: "cultural",
  };
  return map[industry.toLowerCase()] ?? null;
}
