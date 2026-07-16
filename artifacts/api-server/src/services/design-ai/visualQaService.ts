/**
 * Visual QA Service — Post-generation quality assurance
 *
 * Runs after AI generation + Zod validation + coordinate sanitization.
 * Enforces two classes of visual correctness that the AI cannot guarantee:
 *
 *   1. Bounds containment  — every element fully inside the canvas (right and
 *      bottom edges included, not just top-left corner).
 *   2. WCAG contrast       — every text element has ≥ 4.5:1 contrast ratio
 *      against its effective background (AA normal text) or ≥ 3.0:1 for
 *      large text (fontSize ≥ 24 px, or ≥ 18 px bold).
 *
 * Auto-fix strategy:
 *   - Out-of-bounds elements are clamped so their right/bottom edges touch the
 *     canvas edge rather than crossing it.
 *   - Failing text elements have their color replaced with whichever of
 *     #000000 / #ffffff yields better contrast against the resolved background.
 *
 * Background resolution order (per text element):
 *   overlapping shape element with highest zIndex < text.zIndex
 *   → canvas.backgroundColor
 *   → #ffffff (final fallback)
 *
 * Gradient fills are opaque to contrast analysis — if the topmost underlying
 * shape has a gradient fill the element is skipped (no auto-fix, warning only).
 */

import type {
  DesignElement,
  TextElement,
  ShapeElement,
  BaseElement,
} from "../../types/designTemplate.js";
import type { AiTemplateProposal } from "../../validators/designTemplateAiSchema.js";

// ─────────────────────────────────────────────────────────────────────────────
// WCAG 2.1 colour math
// ─────────────────────────────────────────────────────────────────────────────

/** Expand #RGB or #RRGGBB to [r,g,b] (0-255). Returns null for invalid input. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const linearise = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** Relative luminance from a hex string. Returns null if hex is invalid. */
export function luminanceFromHex(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return relativeLuminance(...rgb);
}

/**
 * WCAG contrast ratio between two hex colours.
 * Returns null if either colour is invalid (non-hex, gradient reference, etc.).
 */
export function contrastRatio(hex1: string, hex2: string): number | null {
  const l1 = luminanceFromHex(hex1);
  const l2 = luminanceFromHex(hex2);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Return #ffffff or #000000 — whichever has better contrast against bgHex.
 * Falls back to #000000 if bgHex cannot be parsed.
 */
export function bestTextColor(bgHex: string): "#ffffff" | "#000000" {
  const lBg = luminanceFromHex(bgHex);
  if (lBg === null) return "#000000";
  // Contrast of white against bg, vs black against bg
  const contrastWhite = (1 + 0.05) / (lBg + 0.05);
  const contrastBlack = (lBg + 0.05) / (0 + 0.05);
  return contrastWhite >= contrastBlack ? "#ffffff" : "#000000";
}

// ─────────────────────────────────────────────────────────────────────────────
// Effective background resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Axis-aligned bounding-box overlap check. */
function boxesOverlap(
  a: Pick<BaseElement, "x" | "y" | "width" | "height">,
  b: Pick<BaseElement, "x" | "y" | "width" | "height">,
): boolean {
  return (
    a.x < b.x + b.width  &&
    a.x + a.width  > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Find the effective background hex colour for a given element.
 *
 * Resolution order:
 *   1. Shape elements that overlap `el` with zIndex < el.zIndex, sorted by
 *      zIndex descending → pick the topmost one with a solid hex fill.
 *   2. canvasBg (canvas.backgroundColor).
 *   3. #ffffff (final fallback).
 *
 * Returns { color, source } where source is "shape" | "canvas" | "fallback".
 */
export function getEffectiveBg(
  el: BaseElement,
  allElements: DesignElement[],
  canvasBg: string,
): { color: string; source: "shape" | "canvas" | "fallback"; gradientSkip?: true } {
  // Collect candidate shape elements that visually underlie el
  const candidates: ShapeElement[] = (allElements as DesignElement[])
    .filter((other): other is ShapeElement =>
      other !== (el as unknown) &&
      other.type === "shape" &&
      other.zIndex < el.zIndex &&
      boxesOverlap(other, el),
    )
    .sort((a, b) => b.zIndex - a.zIndex); // highest-zIndex first

  for (const candidate of candidates) {
    const fill = candidate.fill;
    if (typeof fill === "string" && /^#[0-9a-fA-F]{3,6}$/.test(fill)) {
      return { color: fill, source: "shape" };
    }
    if (fill && typeof fill === "object") {
      // Gradient fill — we cannot determine a single contrast colour reliably.
      return { color: "#808080" /* mid-grey stub */, source: "shape", gradientSkip: true };
    }
    // fill is undefined → this shape is transparent; continue searching
  }

  // Fall through to canvas background
  if (/^#[0-9a-fA-F]{3,6}$/.test(canvasBg)) {
    return { color: canvasBg, source: "canvas" };
  }

  return { color: "#ffffff", source: "fallback" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounds containment
// ─────────────────────────────────────────────────────────────────────────────

export interface BoundsIssue {
  elementId: string;
  /** Human-readable description of the violation before clamping. */
  description: string;
}

/** Find every element whose bounding box (right or bottom edge) exceeds the canvas. */
export function checkBounds(
  elements: DesignElement[],
  canvasW: number,
  canvasH: number,
): BoundsIssue[] {
  const issues: BoundsIssue[] = [];
  for (const el of elements) {
    const parts: string[] = [];
    if (el.x < 0)                              parts.push(`x=${el.x} < 0`);
    if (el.y < 0)                              parts.push(`y=${el.y} < 0`);
    if (el.x + el.width  > canvasW)            parts.push(`right edge ${el.x + el.width} > ${canvasW}`);
    if (el.y + el.height > canvasH)            parts.push(`bottom edge ${el.y + el.height} > ${canvasH}`);
    if (parts.length > 0) {
      issues.push({ elementId: el.id, description: parts.join(", ") });
    }
  }
  return issues;
}

/**
 * Clamp element so that its ENTIRE bounding box fits within the canvas.
 * - x clamped to [0, canvasW − 1]
 * - y clamped to [0, canvasH − 1]
 * - width  clamped to [1, canvasW − x]  (so right edge ≤ canvasW)
 * - height clamped to [1, canvasH − y]  (so bottom edge ≤ canvasH)
 */
export function clampToBounds<T extends BaseElement>(
  el: T,
  canvasW: number,
  canvasH: number,
): T {
  const x      = Math.max(0, Math.min(el.x,      canvasW - 1));
  const y      = Math.max(0, Math.min(el.y,      canvasH - 1));
  const width  = Math.max(1, Math.min(el.width,  canvasW - x));
  const height = Math.max(1, Math.min(el.height, canvasH - y));
  return { ...el, x, y, width, height };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrast validation + auto-fix
// ─────────────────────────────────────────────────────────────────────────────

/** WCAG AA thresholds */
const CONTRAST_AA_NORMAL = 4.5; // < 24 px or < 18 px bold
const CONTRAST_AA_LARGE  = 3.0; // ≥ 24 px  or ≥ 18 px bold

export interface ContrastIssue {
  elementId: string;
  fgColor: string;       // original colour before fix
  bgColor: string;       // resolved background colour
  bgSource: "shape" | "canvas" | "fallback";
  ratio: number | null;  // null if ratio could not be computed
  required: number;
  autoFixed: boolean;
  /** Only present when autoFixed = true */
  newColor?: string;
  /** Only present when auto-fix was skipped (gradient background) */
  gradientSkip?: true;
}

function isLargeText(el: TextElement): boolean {
  const size   = el.fontSize ?? 24;
  const isBold = el.fontWeight === "bold" || (typeof el.fontWeight === "number" && el.fontWeight >= 700);
  return size >= 24 || (size >= 18 && isBold);
}

/**
 * Validate contrast for every text element and auto-fix failing ones.
 *
 * @param elements  Elements after bounds clamping (shape positions are final).
 * @param canvasBg  canvas.backgroundColor (or "#ffffff" if absent).
 * @returns { elements: fixed array, issues: per-element contrast report }
 */
export function autoFixContrast(
  elements: DesignElement[],
  canvasBg: string,
): { elements: DesignElement[]; issues: ContrastIssue[] } {
  const issues: ContrastIssue[] = [];

  const fixed = elements.map((el): DesignElement => {
    if (el.type !== "text") return el;
    const textEl = el as TextElement;

    const fg = textEl.color ?? "#000000";
    if (!/^#[0-9a-fA-F]{3,6}$/.test(fg)) {
      // Non-hex foreground (shouldn't happen after Zod validation) — skip
      return el;
    }

    const { color: bg, source: bgSource, gradientSkip } = getEffectiveBg(textEl, elements, canvasBg);

    if (gradientSkip) {
      // Can't calculate contrast against gradient — emit warning, don't touch color
      issues.push({
        elementId: textEl.id,
        fgColor: fg,
        bgColor: bg,
        bgSource,
        ratio: null,
        required: isLargeText(textEl) ? CONTRAST_AA_LARGE : CONTRAST_AA_NORMAL,
        autoFixed: false,
        gradientSkip: true,
      });
      return el;
    }

    const ratio    = contrastRatio(fg, bg);
    const required = isLargeText(textEl) ? CONTRAST_AA_LARGE : CONTRAST_AA_NORMAL;

    if (ratio === null || ratio >= required) return el; // passes or uncomputable

    const newColor = bestTextColor(bg);
    issues.push({ elementId: textEl.id, fgColor: fg, bgColor: bg, bgSource, ratio, required, autoFixed: true, newColor });
    return { ...textEl, color: newColor } as DesignElement;
  });

  return { elements: fixed, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// QA score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a 0-100 visual quality score.
 *
 * Deductions:
 *   - Up to 40 pts for bounds violations  (proportional to # elements OOB)
 *   - Up to 40 pts for contrast failures  (proportional to # text elements failing)
 *   - Up to 10 pts if >50 % text elements needed auto-fix
 */
export function computeQaScore(opts: {
  totalElements: number;
  boundsIssueCount: number;
  textElements: number;
  contrastIssueCount: number;
}): number {
  const { totalElements, boundsIssueCount, textElements, contrastIssueCount } = opts;
  const safeTotal = Math.max(1, totalElements);
  const safeText  = Math.max(1, textElements);
  const boundsDeduction   = Math.min(40, (boundsIssueCount  / safeTotal) * 40);
  const contrastDeduction = Math.min(40, (contrastIssueCount / safeText) * 40);
  const highFixDeduction  = contrastIssueCount / safeText > 0.5 ? 10 : 0;
  return Math.round(Math.max(0, 100 - boundsDeduction - contrastDeduction - highFixDeduction));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface VisualQaReport {
  boundsIssues:    BoundsIssue[];
  contrastIssues:  ContrastIssue[];
  /** Human-readable warnings suitable for appending to proposal.warnings */
  warnings:        string[];
  visualQaScore:   number; // 0-100
  autoFixedBounds: number;
  autoFixedColors: number;
}

/**
 * Run full visual QA on an AI-generated proposal:
 *   1. Clamp all elements to canvas bounds (right + bottom edge inclusive).
 *   2. Auto-fix text contrast using WCAG AA thresholds.
 *   3. Produce a VisualQaReport with human-readable warnings and a score.
 *
 * Returns the corrected proposal and the QA report.
 *
 * NOTE: elements in AiTemplateProposal are typed as unknown[] due to the Zod
 * lazy-schema pattern. We cast to DesignElement[] here — the runtime values
 * always conform to that shape after Zod validation.
 */
export function runVisualQa(
  proposal: AiTemplateProposal,
  canvasW: number,
  canvasH: number,
): { proposal: AiTemplateProposal; qa: VisualQaReport } {
  const canvasBg = proposal.template.canvas.backgroundColor ?? "#ffffff";
  // Cast: safe because AiTemplateProposal elements are Zod-validated DesignElement shapes
  const rawElements = proposal.template.elements as unknown as DesignElement[];

  // ── Step 1: bounds ──────────────────────────────────────────────────────────
  const boundsIssues = checkBounds(rawElements, canvasW, canvasH);
  const boundsClamped = rawElements.map((el) =>
    clampToBounds(el, canvasW, canvasH),
  );

  // ── Step 2: contrast ────────────────────────────────────────────────────────
  const { elements: contrastFixed, issues: contrastIssues } =
    autoFixContrast(boundsClamped, canvasBg);

  // ── Step 3: warnings (truncated to fit proposal schema max 20 × 500 chars) ──
  const newWarnings: string[] = [];

  for (const bi of boundsIssues) {
    newWarnings.push(
      `[bounds] "${bi.elementId}" was out of canvas (${bi.description.slice(0, 120)}); clamped.`,
    );
  }

  for (const ci of contrastIssues) {
    if (ci.gradientSkip) {
      newWarnings.push(
        `[contrast] "${ci.elementId}" sits on a gradient; contrast not auto-fixed. Check manually.`,
      );
    } else {
      newWarnings.push(
        `[contrast] "${ci.elementId}" had ${ci.ratio?.toFixed(2) ?? "?"}:1 contrast (need ${ci.required}:1); color ${ci.fgColor}→${ci.newColor}.`,
      );
    }
  }

  // Merge existing AI warnings with QA warnings, capped at 20 total (schema limit)
  const existingWarnings = proposal.warnings ?? [];
  const mergedWarnings = [
    ...existingWarnings,
    ...newWarnings,
  ]
    .map((w) => w.slice(0, 498))   // each string max 500 chars per schema
    .slice(0, 20);                  // max 20 items per schema

  // ── Step 4: score ───────────────────────────────────────────────────────────
  const textCount = rawElements.filter((e) => e.type === "text").length;
  const visualQaScore = computeQaScore({
    totalElements:    rawElements.length,
    boundsIssueCount: boundsIssues.length,
    textElements:     textCount,
    contrastIssueCount: contrastIssues.filter((c) => c.autoFixed).length,
  });

  return {
    proposal: {
      ...proposal,
      warnings: mergedWarnings,
      template: {
        ...proposal.template,
        elements: contrastFixed as unknown as AiTemplateProposal["template"]["elements"],
      },
    },
    qa: {
      boundsIssues,
      contrastIssues,
      warnings: newWarnings,
      visualQaScore,
      autoFixedBounds: boundsIssues.length,
      autoFixedColors: contrastIssues.filter((c) => c.autoFixed).length,
    },
  };
}
