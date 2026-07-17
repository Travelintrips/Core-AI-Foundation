/**
 * Team 13 — Dynamic Design Composition Engine
 * Brand Consistency Checker
 *
 * Evaluates how well the composed design spec aligns with the Brand DNA.
 * Returns a scored report with actionable suggestions.
 * Pure deterministic functions — no side effects.
 */

import type {
  BrandDnaInput,
  PaletteInput,
  TypographyInput,
  LayoutPlanInput,
  DecorationInput,
  MaterialInput,
  BrandConsistencyReport,
} from "./types.js";
import { hexLuminance, computeContrast } from "./compatibilityChecker.js";

// ── Color alignment ───────────────────────────────────────────────────────────

/** Map brand personality traits to expected palette moods */
const PERSONALITY_MOOD_MAP: Record<string, PaletteInput["mood"][]> = {
  professional: ["neutral", "cool", "muted"],
  corporate: ["neutral", "cool"],
  minimalist: ["neutral", "monochrome", "muted"],
  bold: ["vibrant", "warm"],
  innovative: ["cool", "vibrant"],
  luxury: ["neutral", "muted", "monochrome"],
  playful: ["vibrant", "warm"],
  trustworthy: ["cool", "neutral"],
  energetic: ["vibrant", "warm"],
  earthy: ["earthy", "warm"],
  elegant: ["neutral", "muted"],
  creative: ["vibrant", "cool"],
};

/** Map brand personality traits to expected layout strategies */
const PERSONALITY_LAYOUT_MAP: Record<string, LayoutPlanInput["strategy"][]> = {
  professional: ["hero-content", "sidebar", "editorial"],
  corporate: ["hero-content", "split", "sidebar"],
  minimalist: ["minimal", "editorial", "full-bleed"],
  bold: ["full-bleed", "asymmetric", "magazine"],
  innovative: ["asymmetric", "magazine", "grid"],
  luxury: ["editorial", "minimal", "full-bleed"],
  playful: ["grid", "card-grid", "magazine"],
  trustworthy: ["hero-content", "sidebar", "editorial"],
  creative: ["asymmetric", "magazine", "card-grid"],
};

/** Map brand personality to expected decoration (borderRadius + shadow) */
const PERSONALITY_DECORATION_MAP: Record<
  string,
  { borderRadius: DecorationInput["borderRadius"][]; shadow: DecorationInput["shadowDepth"][] }
> = {
  professional: { borderRadius: ["small", "medium", "none"], shadow: ["none", "low", "medium"] },
  corporate: { borderRadius: ["none", "small"], shadow: ["none", "low"] },
  minimalist: { borderRadius: ["none", "small"], shadow: ["none", "low"] },
  bold: { borderRadius: ["medium", "large", "pill"], shadow: ["medium", "high", "dramatic"] },
  innovative: { borderRadius: ["large", "pill", "medium"], shadow: ["medium", "high"] },
  luxury: { borderRadius: ["none", "small"], shadow: ["low", "medium"] },
  playful: { borderRadius: ["large", "pill", "circle"], shadow: ["medium", "high"] },
  creative: { borderRadius: ["pill", "large", "circle"], shadow: ["medium", "high", "dramatic"] },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function colorDistance(hex1: string, hex2: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex1) || !/^#[0-9A-Fa-f]{6}$/.test(hex2)) return 1;
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) / 441.67;
}

function isColorSimilar(hex1: string, hex2: string, threshold = 0.15): boolean {
  return colorDistance(hex1, hex2) <= threshold;
}

// ── Color alignment check ─────────────────────────────────────────────────────

function checkColorAlignment(
  palette: PaletteInput,
  brandDna: BrandDnaInput,
): BrandConsistencyReport["colorAlignment"] {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const dnaColors = brandDna.detectedColors;

  if (dnaColors?.primary && !isColorSimilar(palette.primary, dnaColors.primary)) {
    score -= 30;
    issues.push(
      `Primary color (#${palette.primary}) differs significantly from Brand DNA primary (#${dnaColors.primary})`,
    );
    suggestions.push(`Consider using #${dnaColors.primary} as primary to maintain brand recognition`);
  }

  if (dnaColors?.secondary && !isColorSimilar(palette.secondary, dnaColors.secondary, 0.2)) {
    score -= 20;
    issues.push(`Secondary color deviates from Brand DNA secondary`);
    suggestions.push(`Brand DNA secondary (${dnaColors.secondary}) would strengthen consistency`);
  }

  if (dnaColors?.accent && !isColorSimilar(palette.accent, dnaColors.accent, 0.25)) {
    score -= 10;
    issues.push(`Accent color deviates from Brand DNA accent`);
    suggestions.push(`Consider aligning accent with Brand DNA (${dnaColors.accent})`);
  }

  // Check palette mood against brand personality
  const personalities = (brandDna.brandPersonality ?? []).map((p) => p.toLowerCase());
  const moodMatches = personalities.some((p) => {
    const allowedMoods = PERSONALITY_MOOD_MAP[p];
    return allowedMoods?.includes(palette.mood);
  });

  if (personalities.length > 0 && !moodMatches) {
    score -= 20;
    const expectedMoods = personalities
      .flatMap((p) => PERSONALITY_MOOD_MAP[p] ?? [])
      .filter((v, i, a) => a.indexOf(v) === i);
    issues.push(
      `Palette mood "${palette.mood}" doesn't match brand personality [${personalities.join(", ")}]`,
    );
    suggestions.push(`Expected mood: ${expectedMoods.join(" or ")}`);
  }

  // WCAG body text contrast
  const bgLum = hexLuminance(palette.background);
  const textLum = hexLuminance(palette.text);
  const contrast = computeContrast(bgLum, textLum);
  if (contrast < 4.5) {
    score -= 15;
    issues.push(`Text contrast ratio (${contrast.toFixed(2)}) is below WCAG AA minimum of 4.5`);
    suggestions.push("Increase contrast between text and background colors");
  }

  return { score: Math.max(0, score), issues, suggestions };
}

// ── Typography alignment check ────────────────────────────────────────────────

function checkTypographyAlignment(
  typography: TypographyInput,
  brandDna: BrandDnaInput,
): BrandConsistencyReport["typographyAlignment"] {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const dnaTypo = brandDna.detectedTypography;

  if (dnaTypo?.heading && typography.headingFont.toLowerCase() !== dnaTypo.heading.toLowerCase()) {
    score -= 25;
    issues.push(
      `Heading font "${typography.headingFont}" differs from Brand DNA heading font "${dnaTypo.heading}"`,
    );
    suggestions.push(`Use "${dnaTypo.heading}" for headings to maintain brand typographic voice`);
  }

  if (dnaTypo?.body && typography.bodyFont.toLowerCase() !== dnaTypo.body.toLowerCase()) {
    score -= 20;
    issues.push(`Body font "${typography.bodyFont}" differs from Brand DNA body font "${dnaTypo.body}"`);
    suggestions.push(`Use "${dnaTypo.body}" for body text`);
  }

  if (dnaTypo?.style) {
    const dnaStyle = dnaTypo.style.toLowerCase() as TypographyInput["style"];
    if (typography.style !== dnaStyle) {
      score -= 15;
      issues.push(
        `Typography style "${typography.style}" doesn't match Brand DNA style "${dnaTypo.style}"`,
      );
      suggestions.push(`Switch typography style to "${dnaTypo.style}"`);
    }
  }

  // Brand personality ↔ font weight check
  const personalities = (brandDna.brandPersonality ?? []).map((p) => p.toLowerCase());
  if (personalities.includes("bold") && parseInt(typography.headingWeight) < 700) {
    score -= 10;
    issues.push("Brand personality is 'Bold' but heading weight is below 700");
    suggestions.push("Use headingWeight 700 or 800 for a bold brand");
  }
  if (personalities.includes("minimalist") && parseInt(typography.headingWeight) > 600) {
    score -= 10;
    issues.push("Brand personality is 'Minimalist' but heading weight is above 600");
    suggestions.push("Use headingWeight 300–500 for a minimalist aesthetic");
  }

  return { score: Math.max(0, score), issues, suggestions };
}

// ── Layout alignment check ────────────────────────────────────────────────────

function checkLayoutAlignment(
  layout: LayoutPlanInput,
  decoration: DecorationInput,
  material: MaterialInput,
  brandDna: BrandDnaInput,
): BrandConsistencyReport["layoutAlignment"] {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const personalities = (brandDna.brandPersonality ?? []).map((p) => p.toLowerCase());

  // Check layout strategy against personality
  const layoutMatches = personalities.some((p) => {
    const allowed = PERSONALITY_LAYOUT_MAP[p];
    return allowed?.includes(layout.strategy);
  });

  if (personalities.length > 0 && !layoutMatches) {
    score -= 25;
    const expectedLayouts = personalities
      .flatMap((p) => PERSONALITY_LAYOUT_MAP[p] ?? [])
      .filter((v, i, a) => a.indexOf(v) === i);
    issues.push(
      `Layout strategy "${layout.strategy}" is not typical for brand personality [${personalities.join(", ")}]`,
    );
    suggestions.push(`Consider: ${expectedLayouts.slice(0, 3).join(", ")}`);
  }

  // Check visual density vs brand DNA
  if (brandDna.visualDensity) {
    const density = brandDna.visualDensity.toLowerCase();
    if (density === "airy" && layout.sectionCount > 6) {
      score -= 15;
      issues.push(
        `Brand DNA specifies "Airy" visual density but composition has ${layout.sectionCount} sections`,
      );
      suggestions.push("Reduce section count to 3–4 for an airy feel");
    }
    if (density === "dense" && layout.sectionCount < 3) {
      score -= 10;
      issues.push(`Brand DNA specifies "Dense" visual density but composition has only ${layout.sectionCount} sections`);
      suggestions.push("Add more sections for a content-rich layout");
    }
  }

  // Check decoration vs personality
  const decorMatches = personalities.some((p) => {
    const allowed = PERSONALITY_DECORATION_MAP[p];
    return (
      allowed?.borderRadius.includes(decoration.borderRadius) &&
      allowed?.shadow.includes(decoration.shadowDepth)
    );
  });

  if (personalities.length > 0 && !decorMatches) {
    score -= 15;
    issues.push(
      `Decoration (borderRadius: ${decoration.borderRadius}, shadow: ${decoration.shadowDepth}) mismatches brand personality`,
    );
  }

  // Risk profile vs material
  if (brandDna.riskProfile) {
    const risk = brandDna.riskProfile.toLowerCase();
    if (risk === "conservative" && ["glass", "neumorphic", "metallic"].includes(material.surface)) {
      score -= 15;
      issues.push(
        `Conservative brand risk profile conflicts with experimental "${material.surface}" material`,
      );
      suggestions.push("Use flat, matte, or paper surfaces for a conservative brand");
    }
    if (risk === "innovative" && ["flat", "matte"].includes(material.surface)) {
      score -= 5;
      issues.push(`Innovative brand would benefit from more expressive material than "${material.surface}"`);
      suggestions.push("Consider glass, frosted, or metallic material for an innovative brand");
    }
  }

  return { score: Math.max(0, score), issues, suggestions };
}

// ── Personality alignment check ───────────────────────────────────────────────

function checkPersonalityAlignment(
  palette: PaletteInput,
  typography: TypographyInput,
  layout: LayoutPlanInput,
  brandDna: BrandDnaInput,
): BrandConsistencyReport["personalityAlignment"] {
  const traits = (brandDna.brandPersonality ?? []).map((p) => p.toLowerCase());
  const mismatches: string[] = [];

  if (traits.includes("luxury")) {
    if (palette.mood === "vibrant") mismatches.push("Vibrant palette conflicts with luxury brand");
    if (typography.style === "monospace") mismatches.push("Monospace font conflicts with luxury brand");
  }
  if (traits.includes("playful")) {
    if (palette.mood === "monochrome") mismatches.push("Monochrome palette conflicts with playful brand");
    if (layout.strategy === "minimal") mismatches.push("Minimal layout conflicts with playful brand");
  }
  if (traits.includes("trustworthy")) {
    if (decoration_isTooExperimental(palette)) {
      mismatches.push("Highly experimental palette may undermine trustworthiness");
    }
  }

  const score = Math.max(0, 100 - mismatches.length * 20);
  return { score, traits, mismatches };
}

function decoration_isTooExperimental(palette: PaletteInput): boolean {
  return palette.mood === "vibrant" && palette.extras !== undefined && (palette.extras?.length ?? 0) > 4;
}

// ── Main check ────────────────────────────────────────────────────────────────

export function checkBrandConsistency(params: {
  palette: PaletteInput;
  typography: TypographyInput;
  layout: LayoutPlanInput;
  decoration: DecorationInput;
  material: MaterialInput;
  brandDna: BrandDnaInput;
}): BrandConsistencyReport {
  const { palette, typography, layout, decoration, material, brandDna } = params;

  const colorAlignment = checkColorAlignment(palette, brandDna);
  const typographyAlignment = checkTypographyAlignment(typography, brandDna);
  const layoutAlignment = checkLayoutAlignment(layout, decoration, material, brandDna);
  const personalityAlignment = checkPersonalityAlignment(palette, typography, layout, brandDna);

  // Weighted average: color 35%, typography 30%, layout 25%, personality 10%
  const score = Math.round(
    colorAlignment.score * 0.35 +
    typographyAlignment.score * 0.3 +
    layoutAlignment.score * 0.25 +
    personalityAlignment.score * 0.1,
  );

  return {
    score,
    colorAlignment,
    typographyAlignment,
    layoutAlignment,
    personalityAlignment,
  };
}
