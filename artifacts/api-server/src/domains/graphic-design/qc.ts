/**
 * graphic-design/qc.ts — Team 15
 *
 * Quality Control engine for Graphic Design deliverables.
 *
 * Deterministic, pure-function scoring — no LLM calls, no DB access.
 *
 * Checks:
 *   1. componentPresence   — required components are all present
 *   2. textFitting         — text elements are within the safe-area boundary
 *   3. printDimensions     — canvas size matches spec within tolerance
 *   4. bleedCompliance     — design content extends to bleed edge
 *   5. resolutionCompliance — DPI meets the minimum for the output medium
 *   6. colorModeCompliance  — correct color model for medium (RGB vs CMYK)
 *   7. contrastCompliance  — text elements meet minimum contrast ratio
 *   8. fileFormatCompliance — all expected file formats are present
 *
 * Scoring (0–100): weighted average of per-check scores.
 * QC PASS threshold: 70 (stricter than CP's 60 due to print tolerances).
 */

import { getComponentRequirements } from "./components.js";
import { getBlueprint, isPrintSpec, type PrintSpec, type DigitalSpec } from "./blueprints.js";
import type { GdServiceCode, OutputFormat } from "./schema.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const QC_PASS_THRESHOLD = 70;

/** Allowed canvas dimension variance (percentage). Print is tighter than digital. */
export const DIMENSION_TOLERANCE_PCT_PRINT   = 0.5;   // ±0.5 % for print
export const DIMENSION_TOLERANCE_PCT_DIGITAL = 1.0;   // ±1 % for digital

/** Minimum DPI by output format. */
export const MIN_DPI_PRINT   = 300;
export const MIN_DPI_DIGITAL = 72;

/** Check weights — must sum to 100. */
const WEIGHTS = {
  componentPresence:   25,
  textFitting:         20,
  printDimensions:     15,
  bleedCompliance:     10,
  resolutionCompliance: 10,
  colorModeCompliance:  5,
  contrastCompliance:  10,
  fileFormatCompliance: 5,
} as const satisfies Record<string, number>;

// ── Input types ───────────────────────────────────────────────────────────────

/**
 * A single rendered element present in the deliverable.
 * The renderer (Team 7-8) populates these from the canvas state.
 */
export interface RenderedElement {
  id:         string;
  type:       string;
  /** Bounding box in pixels from top-left of canvas. */
  xPx:        number;
  yPx:        number;
  widthPx:    number;
  heightPx:   number;
  /** For text elements. */
  text?:      string;
  fontSizePt?: number;
  contrastRatio?: number;   // Calculated by renderer against effective background
}

export interface RenderedDeliverable {
  variant:       string;
  canvasWidthPx:  number;
  canvasHeightPx: number;
  resolutionDpi:  number;
  colorMode:      "RGB" | "sRGB" | "CMYK";
  elements:       RenderedElement[];
  /** File formats included in this deliverable (e.g. ["pdf", "svg", "png"]). */
  fileFormats:   string[];
}

export interface QcInput {
  serviceCode:   GdServiceCode;
  outputFormat:  OutputFormat;
  deliverable:   RenderedDeliverable;
  /** Expected file formats from the manifest (for fileFormatCompliance). */
  expectedFormats: string[];
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface QcCheckResult {
  checkName:   string;
  score:       number;    // 0–100 for this check
  weight:      number;
  passed:      boolean;
  warnings:    string[];
  failures:    string[];
}

export interface GraphicDesignQcResult {
  qcScore:     number;    // 0–100 weighted average
  passed:      boolean;   // qcScore >= QC_PASS_THRESHOLD
  checks:      QcCheckResult[];
  warnings:    string[];
  failures:    string[];
}

// ── Check helpers ─────────────────────────────────────────────────────────────

function checkComponentPresence(
  serviceCode: GdServiceCode,
  elements: RenderedElement[]
): QcCheckResult {
  const requirements = getComponentRequirements(serviceCode).filter((r) => r.required);
  const elementTypes = new Set(elements.map((e) => e.type));
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const req of requirements) {
    if (!elementTypes.has(req.type)) {
      failures.push(`Required component missing: "${req.label}" (type: ${req.type})`);
    }
  }

  const score = requirements.length === 0
    ? 100
    : Math.max(0, Math.round(100 - (failures.length / requirements.length) * 100));

  return {
    checkName: "componentPresence",
    score,
    weight: WEIGHTS.componentPresence,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

function checkTextFitting(
  safeAreaPx: number,
  canvasW: number,
  canvasH: number,
  elements: RenderedElement[]
): QcCheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const textElements = elements.filter((e) => e.text !== undefined);

  const safeLeft   = safeAreaPx;
  const safeTop    = safeAreaPx;
  const safeRight  = canvasW - safeAreaPx;
  const safeBottom = canvasH - safeAreaPx;

  for (const el of textElements) {
    const right  = el.xPx + el.widthPx;
    const bottom = el.yPx + el.heightPx;

    const overflowLeft   = el.xPx < safeLeft;
    const overflowTop    = el.yPx < safeTop;
    const overflowRight  = right  > safeRight;
    const overflowBottom = bottom > safeBottom;

    if (overflowLeft || overflowTop || overflowRight || overflowBottom) {
      const sides = [
        overflowLeft   ? "left"   : null,
        overflowTop    ? "top"    : null,
        overflowRight  ? "right"  : null,
        overflowBottom ? "bottom" : null,
      ].filter(Boolean).join(", ");
      failures.push(`Text element "${el.id}" overflows safe area on: ${sides}`);
    }

    if (el.fontSizePt !== undefined && el.fontSizePt < 6) {
      warnings.push(`Text element "${el.id}" font size ${el.fontSizePt}pt may be too small for legibility`);
    }
  }

  const score = textElements.length === 0
    ? 100
    : Math.max(0, Math.round(100 - (failures.length / textElements.length) * 100));

  return {
    checkName: "textFitting",
    score,
    weight: WEIGHTS.textFitting,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

function checkPrintDimensions(
  spec: PrintSpec | DigitalSpec,
  canvasW: number,
  canvasH: number,
  isPrint: boolean
): QcCheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const tolerance = isPrint ? DIMENSION_TOLERANCE_PCT_PRINT : DIMENSION_TOLERANCE_PCT_DIGITAL;

  const expectedW = isPrint
    ? (spec as PrintSpec).widthPxWithBleed
    : (spec as DigitalSpec).widthPx;
  const expectedH = isPrint
    ? (spec as PrintSpec).heightPxWithBleed
    : (spec as DigitalSpec).heightPx;

  const wDiff = Math.abs(canvasW - expectedW) / expectedW * 100;
  const hDiff = Math.abs(canvasH - expectedH) / expectedH * 100;

  if (wDiff > tolerance) {
    failures.push(`Canvas width ${canvasW}px deviates ${wDiff.toFixed(2)}% from expected ${expectedW}px (tolerance: ${tolerance}%)`);
  }
  if (hDiff > tolerance) {
    failures.push(`Canvas height ${canvasH}px deviates ${hDiff.toFixed(2)}% from expected ${expectedH}px (tolerance: ${tolerance}%)`);
  }

  const score = failures.length === 0 ? 100 : 0;

  return {
    checkName: "printDimensions",
    score,
    weight: WEIGHTS.printDimensions,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

function checkBleedCompliance(
  spec: PrintSpec | DigitalSpec,
  canvasW: number,
  canvasH: number,
  elements: RenderedElement[],
  isPrint: boolean
): QcCheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!isPrint) {
    // Digital deliverables have no bleed requirement.
    return { checkName: "bleedCompliance", score: 100, weight: WEIGHTS.bleedCompliance, passed: true, warnings, failures };
  }

  const ps = spec as PrintSpec;
  const bleedPx = Math.round((ps.bleedMm / 25.4) * ps.resolutionDpi);

  // At least one non-guide element must reach all four bleed edges.
  const nonGuideElements = elements.filter(
    (e) => !e.type.includes("guide") && !e.type.includes("seal") && !e.type.includes("watermark")
  );

  const reachesLeft   = nonGuideElements.some((e) => e.xPx <= bleedPx);
  const reachesTop    = nonGuideElements.some((e) => e.yPx <= bleedPx);
  const reachesRight  = nonGuideElements.some((e) => e.xPx + e.widthPx >= canvasW - bleedPx);
  const reachesBottom = nonGuideElements.some((e) => e.yPx + e.heightPx >= canvasH - bleedPx);

  if (!reachesLeft)   failures.push("No background element extends to left bleed edge");
  if (!reachesTop)    failures.push("No background element extends to top bleed edge");
  if (!reachesRight)  failures.push("No background element extends to right bleed edge");
  if (!reachesBottom) failures.push("No background element extends to bottom bleed edge");

  if (failures.length > 0) {
    warnings.push(`Bleed zone: ${bleedPx}px (${ps.bleedMm}mm at ${ps.resolutionDpi}dpi). Background/color must fill to bleed.`);
  }

  const score = Math.max(0, 100 - failures.length * 25);

  return {
    checkName: "bleedCompliance",
    score,
    weight: WEIGHTS.bleedCompliance,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

function checkResolutionCompliance(
  actualDpi: number,
  isPrint: boolean
): QcCheckResult {
  const minDpi = isPrint ? MIN_DPI_PRINT : MIN_DPI_DIGITAL;
  const failures: string[] = [];
  const warnings: string[] = [];

  if (actualDpi < minDpi) {
    failures.push(`Resolution ${actualDpi}dpi is below minimum ${minDpi}dpi for ${isPrint ? "print" : "digital"} output`);
  } else if (isPrint && actualDpi < 300) {
    warnings.push(`Resolution ${actualDpi}dpi is sufficient for small print but 300dpi+ is recommended for fine detail`);
  }

  return {
    checkName: "resolutionCompliance",
    score: failures.length === 0 ? 100 : 0,
    weight: WEIGHTS.resolutionCompliance,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

function checkColorModeCompliance(
  actualMode: string,
  isPrint: boolean,
  expectedMode: "CMYK" | "RGB" | "both" | "sRGB"
): QcCheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (isPrint && expectedMode === "CMYK" && actualMode !== "CMYK") {
    failures.push(`Print deliverable uses ${actualMode} color mode; CMYK is required for commercial printing`);
  } else if (!isPrint && (actualMode === "CMYK")) {
    warnings.push("CMYK color mode detected in digital deliverable; RGB/sRGB is preferred for screens");
  }

  return {
    checkName: "colorModeCompliance",
    score: failures.length === 0 ? 100 : 0,
    weight: WEIGHTS.colorModeCompliance,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

function checkContrastCompliance(elements: RenderedElement[]): QcCheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const textElements = elements.filter((e) => e.text !== undefined && e.contrastRatio !== undefined);

  for (const el of textElements) {
    const ratio = el.contrastRatio ?? 0;
    const sizePt = el.fontSizePt ?? 12;
    const isLargeText = sizePt >= 18 || (sizePt >= 14);  // simplified check

    const minRatio = isLargeText ? 3 : 4.5;   // WCAG AA
    if (ratio < minRatio) {
      failures.push(`Text "${el.id}" contrast ratio ${ratio.toFixed(2)} is below WCAG AA minimum ${minRatio} (font: ${sizePt}pt)`);
    }
  }

  const score = textElements.length === 0
    ? 100
    : Math.max(0, Math.round(100 - (failures.length / textElements.length) * 100));

  return {
    checkName: "contrastCompliance",
    score,
    weight: WEIGHTS.contrastCompliance,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

function checkFileFormatCompliance(
  actualFormats: string[],
  expectedFormats: string[]
): QcCheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const actualSet = new Set(actualFormats.map((f) => f.toLowerCase()));

  for (const fmt of expectedFormats) {
    if (!actualSet.has(fmt.toLowerCase())) {
      failures.push(`Expected file format "${fmt}" is missing from deliverable package`);
    }
  }

  const score = expectedFormats.length === 0
    ? 100
    : Math.max(0, Math.round(100 - (failures.length / expectedFormats.length) * 100));

  return {
    checkName: "fileFormatCompliance",
    score,
    weight: WEIGHTS.fileFormatCompliance,
    passed: failures.length === 0,
    warnings,
    failures,
  };
}

// ── Main QC runner ────────────────────────────────────────────────────────────

/**
 * Run all QC checks against a rendered deliverable.
 * Pure function — no side effects.
 */
export function runQc(input: QcInput): GraphicDesignQcResult {
  const { serviceCode, outputFormat, deliverable, expectedFormats } = input;
  const { variant, canvasWidthPx, canvasHeightPx, resolutionDpi, colorMode, elements, fileFormats } = deliverable;

  const blueprint = getBlueprint(serviceCode);
  const specEntry: PrintSpec | DigitalSpec | undefined =
    (blueprint.printVariants as Record<string, PrintSpec | undefined>)[variant] ??
    (blueprint.digitalVariants as Record<string, DigitalSpec | undefined>)[variant];
  const isPrint   = !!specEntry && isPrintSpec(specEntry as PrintSpec | DigitalSpec) && outputFormat !== "digital";

  const safeAreaPx = specEntry
    ? (isPrint
        ? Math.round(((specEntry as PrintSpec).safeAreaMm / 25.4) * resolutionDpi)
        : (specEntry as DigitalSpec).safeAreaPx)
    : 40;

  const checks: QcCheckResult[] = [
    checkComponentPresence(serviceCode, elements),
    checkTextFitting(safeAreaPx, canvasWidthPx, canvasHeightPx, elements),
    checkPrintDimensions((specEntry ?? { widthPxWithBleed: canvasWidthPx, heightPxWithBleed: canvasHeightPx, widthPx: canvasWidthPx, heightPx: canvasHeightPx } as unknown) as PrintSpec, canvasWidthPx, canvasHeightPx, isPrint),
    checkBleedCompliance((specEntry ?? {} as unknown) as PrintSpec, canvasWidthPx, canvasHeightPx, elements, isPrint),
    checkResolutionCompliance(resolutionDpi, isPrint),
    checkColorModeCompliance(colorMode, isPrint, isPrint ? "CMYK" : "RGB"),
    checkContrastCompliance(elements),
    checkFileFormatCompliance(fileFormats, expectedFormats),
  ];

  // Weighted average score
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const qcScore = Math.round(
    checks.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight
  );

  const allFailures = checks.flatMap((c) => c.failures);
  const allWarnings = checks.flatMap((c) => c.warnings);

  return {
    qcScore,
    passed: qcScore >= QC_PASS_THRESHOLD,
    checks,
    warnings: allWarnings,
    failures: allFailures,
  };
}

/** Re-export threshold for external consumers. */
export { QC_PASS_THRESHOLD as GD_QC_PASS_THRESHOLD };
