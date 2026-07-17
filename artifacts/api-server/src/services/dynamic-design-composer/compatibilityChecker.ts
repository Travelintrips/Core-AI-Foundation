/**
 * Team 13 — Dynamic Design Composition Engine
 * Compatibility Checker
 *
 * Validates that design elements work well together.
 * Pure deterministic functions — no side effects.
 */

import type {
  PatternInput,
  PaletteInput,
  MaterialInput,
  DecorationInput,
  LayoutPlanInput,
  ComponentInput,
  TypographyInput,
  CompatibilityReport,
} from "./types.js";

type CompatibilityIssue = {
  field: string;
  conflict: string;
  severity: "warning" | "error";
};

// ── Material ↔ Pattern ────────────────────────────────────────────────────────

/** Certain surface materials clash with busy patterns */
const MATERIAL_PATTERN_CONFLICTS: Array<{
  surface: MaterialInput["surface"][];
  patternType: PatternInput["type"][];
  reason: string;
  severity: "warning" | "error";
}> = [
  {
    surface: ["glass", "frosted"],
    patternType: ["circuit", "textile", "botanical"],
    reason: "Transparent/glass surfaces clash with dense patterns — the layering creates visual noise",
    severity: "warning",
  },
  {
    surface: ["neumorphic"],
    patternType: ["geometric", "stripe", "dot-matrix", "circuit"],
    reason: "Neumorphic surfaces rely on subtle shadow depth; busy patterns undermine the soft-light effect",
    severity: "error",
  },
  {
    surface: ["paper", "fabric"],
    patternType: ["circuit"],
    reason: "Organic/tactile surfaces conflict with digital circuit patterns",
    severity: "warning",
  },
  {
    surface: ["metallic"],
    patternType: ["botanical", "organic", "wave"],
    reason: "Metallic surfaces pair poorly with organic/natural patterns — the contrast is jarring",
    severity: "warning",
  },
];

// ── Layout ↔ Component ────────────────────────────────────────────────────────

/** Layout strategies that cannot host certain component types */
const LAYOUT_COMPONENT_CONFLICTS: Array<{
  strategy: LayoutPlanInput["strategy"][];
  componentType: ComponentInput["type"][];
  reason: string;
  severity: "warning" | "error";
}> = [
  {
    strategy: ["minimal"],
    componentType: ["pricing-table", "feature-grid", "image-gallery", "tab-group"],
    reason: "Minimal layouts lack the visual space for data-dense or multi-column components",
    severity: "warning",
  },
  {
    strategy: ["full-bleed"],
    componentType: ["sidebar", "breadcrumb", "accordion"],
    reason: "Full-bleed layouts have no sidebars or nested structures — these components have no place",
    severity: "error",
  },
  {
    strategy: ["sidebar"],
    componentType: ["hero"],
    reason: "Sidebar layouts allocate primary width to navigation — hero components need full width",
    severity: "warning",
  },
];

// ── Palette ↔ Typography ──────────────────────────────────────────────────────

/** Mood/contrast checks between palette and typography choices */
function checkPaletteTypographyCompatibility(
  palette: PaletteInput,
  typography: TypographyInput,
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  // Check that palette mood aligns with typography style
  const moodTypographyMismatches: Array<{
    mood: PaletteInput["mood"][];
    typographyStyle: TypographyInput["style"][];
    reason: string;
  }> = [
    {
      mood: ["vibrant", "warm"],
      typographyStyle: ["monospace"],
      reason: "Warm/vibrant palettes with monospace fonts signal technical contexts — mismatched brand message",
    },
    {
      mood: ["cool", "neutral"],
      typographyStyle: ["display"],
      reason: "Cool/neutral palettes with display fonts create tension — display fonts expect bolder color contexts",
    },
  ];

  for (const check of moodTypographyMismatches) {
    if (
      check.mood.includes(palette.mood) &&
      check.typographyStyle.includes(typography.style)
    ) {
      issues.push({
        field: "palette.mood + typography.style",
        conflict: check.reason,
        severity: "warning",
      });
    }
  }

  // Check WCAG text contrast
  const bgLuminance = hexLuminance(palette.background);
  const textLuminance = hexLuminance(palette.text);
  const contrastRatio = computeContrast(bgLuminance, textLuminance);

  if (contrastRatio < 4.5) {
    issues.push({
      field: "palette.background + palette.text",
      conflict: `WCAG AA contrast ratio is ${contrastRatio.toFixed(2)} (minimum 4.5 required for normal text)`,
      severity: "error",
    });
  } else if (contrastRatio < 7.0) {
    issues.push({
      field: "palette.background + palette.text",
      conflict: `WCAG AAA contrast ratio is ${contrastRatio.toFixed(2)} (7.0 preferred for body text)`,
      severity: "warning",
    });
  }

  // Primary on background contrast
  const primaryLuminance = hexLuminance(palette.primary);
  const primaryOnBgContrast = computeContrast(bgLuminance, primaryLuminance);
  if (primaryOnBgContrast < 3.0) {
    issues.push({
      field: "palette.primary on palette.background",
      conflict: `Primary color has insufficient contrast on background (${primaryOnBgContrast.toFixed(2)} < 3.0)`,
      severity: "warning",
    });
  }

  return issues;
}

// ── Decoration ↔ Material ─────────────────────────────────────────────────────

function checkDecorationMaterialCompatibility(
  decoration: DecorationInput,
  material: MaterialInput,
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  // Neumorphic + dramatic shadows don't stack well
  if (material.surface === "neumorphic" && decoration.shadowDepth === "dramatic") {
    issues.push({
      field: "material.surface + decoration.shadowDepth",
      conflict: "Neumorphic surfaces already define their own shadow system — external 'dramatic' shadows break the effect",
      severity: "error",
    });
  }

  // Glass + heavy borders look wrong
  if (
    (material.surface === "glass" || material.surface === "frosted") &&
    (decoration.borderStyle === "thick" || decoration.borderStyle === "double")
  ) {
    issues.push({
      field: "material.surface + decoration.borderStyle",
      conflict: "Thick borders negate the transparency effect of glass/frosted surfaces",
      severity: "warning",
    });
  }

  // Flat material + dramatic shadows are contradictory
  if (material.elevation === "flat" && decoration.shadowDepth === "dramatic") {
    issues.push({
      field: "material.elevation + decoration.shadowDepth",
      conflict: "Flat elevation and dramatic shadows send conflicting depth signals",
      severity: "warning",
    });
  }

  // Paper/fabric + gradients are mismatched
  if ((material.surface === "paper" || material.surface === "fabric") && decoration.useGradients) {
    issues.push({
      field: "material.surface + decoration.useGradients",
      conflict: "Organic material surfaces (paper/fabric) are undermined by digital gradients",
      severity: "warning",
    });
  }

  return issues;
}

// ── Main compatibility check ──────────────────────────────────────────────────

export function checkCompatibility(params: {
  material: MaterialInput;
  pattern: PatternInput;
  palette: PaletteInput;
  decoration: DecorationInput;
  layout: LayoutPlanInput;
  components: ComponentInput[];
  typography: TypographyInput;
}): CompatibilityReport {
  const { material, pattern, palette, decoration, layout, components, typography } = params;
  const issues: CompatibilityIssue[] = [];

  // Material ↔ Pattern
  let materialPatternCompatible = true;
  for (const rule of MATERIAL_PATTERN_CONFLICTS) {
    if (
      rule.surface.includes(material.surface) &&
      rule.patternType.includes(pattern.type)
    ) {
      issues.push({
        field: `material.surface (${material.surface}) + pattern.type (${pattern.type})`,
        conflict: rule.reason,
        severity: rule.severity,
      });
      if (rule.severity === "error") materialPatternCompatible = false;
    }
  }

  // Layout ↔ Components
  let layoutComponentCompatible = true;
  const componentTypes = components.map((c) => c.type);
  for (const rule of LAYOUT_COMPONENT_CONFLICTS) {
    if (rule.strategy.includes(layout.strategy)) {
      const conflictingComponents = componentTypes.filter((t) =>
        rule.componentType.includes(t),
      );
      for (const ct of conflictingComponents) {
        issues.push({
          field: `layout.strategy (${layout.strategy}) + component.type (${ct})`,
          conflict: rule.reason,
          severity: rule.severity,
        });
        if (rule.severity === "error") layoutComponentCompatible = false;
      }
    }
  }

  // Palette ↔ Typography
  const paletteTypoIssues = checkPaletteTypographyCompatibility(palette, typography);
  issues.push(...paletteTypoIssues);
  const paletteTypographyCompatible = !paletteTypoIssues.some(
    (i) => i.severity === "error",
  );

  // Decoration ↔ Material
  const decorationMaterialIssues = checkDecorationMaterialCompatibility(decoration, material);
  issues.push(...decorationMaterialIssues);
  const decorationMaterialCompatible = !decorationMaterialIssues.some(
    (i) => i.severity === "error",
  );

  // Compute overall score
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 100 - errorCount * 25 - warningCount * 8);

  return {
    score,
    materialPatternCompatible,
    layoutComponentCompatible,
    paletteTypographyCompatible,
    decorationMaterialCompatible,
    issues,
  };
}

// ── WCAG color utilities ──────────────────────────────────────────────────────

export function hexLuminance(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return 0.5;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function computeContrast(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}
