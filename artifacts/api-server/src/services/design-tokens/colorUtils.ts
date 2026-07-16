// Team 10 — Color utility functions (WCAG, HSL, CMYK, print-safe)
// Pure functions — no DB dependency.

import type { CmykColor, ContrastResult, WcagLevel } from "./types.js";

// ── Hex Parsing ───────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

export function normalizeHex(hex: string): string {
  const clean = hex.replace("#", "").toLowerCase();
  if (clean.length === 3) return "#" + clean.split("").map((c) => c + c).join("");
  return "#" + clean;
}

// ── WCAG Contrast ─────────────────────────────────────────────────────────────

/** Linearise an 8-bit sRGB channel value (0-255) → [0,1] */
function linearise(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance — returns value in [0,1] */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** WCAG contrast ratio between two hex colours */
export function contrastRatio(hex1: string, hex2: string): number {
  const { r: r1, g: g1, b: b1 } = hexToRgb(hex1);
  const { r: r2, g: g2, b: b2 } = hexToRgb(hex2);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  return "fail";
}

export function checkContrast(hex1: string, hex2: string): ContrastResult {
  const ratio = contrastRatio(hex1, hex2);
  const rounded = Math.round(ratio * 100) / 100;
  return {
    hex1,
    hex2,
    ratio: rounded,
    ratioFormatted: `${rounded.toFixed(2)}:1`,
    wcagAA: ratio >= 4.5,
    wcagAALarge: ratio >= 3,
    wcagAAA: ratio >= 7,
    wcagAAALarge: ratio >= 4.5,
    level: wcagLevel(ratio),
  };
}

/** Validate a full set of foreground colours against a background */
export function validatePaletteContrast(
  foregrounds: string[],
  background: string
): ContrastResult[] {
  return foregrounds.map((fg) => checkContrast(fg, background));
}

// ── HSL Conversion ─────────────────────────────────────────────────────────────

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToHsl(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ── CMYK Conversion ───────────────────────────────────────────────────────────

export function rgbToCmyk(r: number, g: number, b: number): CmykColor {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - rn - k) / (1 - k);
  const m = (1 - gn - k) / (1 - k);
  const y = (1 - bn - k) / (1 - k);
  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100),
  };
}

export function hexToCmyk(hex: string): CmykColor {
  const { r, g, b } = hexToRgb(hex);
  return rgbToCmyk(r, g, b);
}

export function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const cn = c / 100, mn = m / 100, yn = y / 100, kn = k / 100;
  return {
    r: Math.round(255 * (1 - cn) * (1 - kn)),
    g: Math.round(255 * (1 - mn) * (1 - kn)),
    b: Math.round(255 * (1 - yn) * (1 - kn)),
  };
}

export function cmykToHex(c: number, m: number, y: number, k: number): string {
  const { r, g, b } = cmykToRgb(c, m, y, k);
  return rgbToHex(r, g, b);
}

export function formatCmyk(cmyk: CmykColor): string {
  return `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`;
}

// ── Print-Safe Gamut Check ────────────────────────────────────────────────────

/**
 * A colour is considered print-safe if its CMYK representation, when
 * converted back to RGB, is within an acceptable delta (< 15 per channel).
 * Highly saturated RGB colours (e.g. pure #ff0000) are often out of CMYK gamut.
 */
export function isPrintSafe(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const cmyk = rgbToCmyk(r, g, b);
  const back = cmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k);
  const deltaR = Math.abs(r - back.r);
  const deltaG = Math.abs(g - back.g);
  const deltaB = Math.abs(b - back.b);
  return deltaR <= 15 && deltaG <= 15 && deltaB <= 15;
}

/**
 * Approximate delta-E (CIE76 simplified — fast, good enough for gamut warnings)
 */
export function deltaE(hex1: string, hex2: string): number {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  return Math.sqrt(
    Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2)
  ) / Math.sqrt(3);
}

/**
 * Nudge an out-of-gamut colour towards the nearest print-safe version by
 * clamping CMYK total ink coverage and re-converting.
 */
export function toPrintSafeHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const cmyk = rgbToCmyk(r, g, b);
  // Clamp total ink to 300% (common press limit)
  const total = cmyk.c + cmyk.m + cmyk.y + cmyk.k;
  if (total <= 300 && isPrintSafe(hex)) return hex;
  const scale = 300 / total;
  const clamped: CmykColor = {
    c: Math.round(cmyk.c * scale),
    m: Math.round(cmyk.m * scale),
    y: Math.round(cmyk.y * scale),
    k: Math.min(100, Math.round(cmyk.k * scale)),
  };
  return cmykToHex(clamped.c, clamped.m, clamped.y, clamped.k);
}

// ── Duplicate Detection ───────────────────────────────────────────────────────

/** Compare two palette colour arrays — order-insensitive */
export function paletteSignature(colors: string[]): string {
  return [...colors]
    .map((c) => normalizeHex(c).toLowerCase())
    .sort()
    .join(",");
}

export function palettesAreDuplicate(a: string[], b: string[]): boolean {
  return paletteSignature(a) === paletteSignature(b);
}

// ── Typography Hierarchy Validation ──────────────────────────────────────────

export interface TypographyHierarchyError {
  role: string;
  message: string;
}

/**
 * Validate that font sizes follow a meaningful hierarchy.
 * display > h1 > h2 > h3 > h4 > body > bodySmall > caption
 */
const HIERARCHY_ORDER: string[] = [
  "display",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "subtitle",
  "body",
  "bodySmall",
  "caption",
];

export function validateTypographyHierarchy(
  roles: Array<{ role: string; fontSize: number }>
): TypographyHierarchyError[] {
  const errors: TypographyHierarchyError[] = [];
  const sizeMap = new Map<string, number>(roles.map((r) => [r.role, r.fontSize]));

  // Compare every pair of defined roles that appear in the hierarchy order.
  // The role that appears earlier (lower index) must have a strictly larger font size.
  const defined = HIERARCHY_ORDER.filter((r) => sizeMap.has(r));

  for (let i = 0; i < defined.length - 1; i++) {
    const upper = defined[i];
    const lower = defined[i + 1];
    const upperSize = sizeMap.get(upper)!;
    const lowerSize = sizeMap.get(lower)!;
    if (upperSize <= lowerSize) {
      errors.push({
        role: lower,
        message: `${lower} (${lowerSize}px) must be smaller than ${upper} (${upperSize}px)`,
      });
    }
  }
  return errors;
}
