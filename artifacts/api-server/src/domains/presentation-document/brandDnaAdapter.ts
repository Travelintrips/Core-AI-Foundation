/**
 * brandDnaAdapter.ts — Team 16: Presentation & Document Creative Services
 *
 * Applies Brand DNA (color palette + typography) from creative project
 * workflow outputs to a document or presentation theme.
 *
 * Brand DNA is sourced from:
 *   1. project.result.brandDna   (Phase V4.2E Brand Intelligence)
 *   2. project.result.creativeDirection.color_direction  (legacy)
 *   3. Fallback defaults
 *
 * This adapter never fabricates colors — if no Brand DNA is present, the
 * document engine's own DEFAULT_THEME is used unchanged.
 */

import type { CreativeProject } from "@workspace/db";
import type { PresentationDocumentServiceType } from "./types.js";

// ── Output types ──────────────────────────────────────────────────────────────

export interface DocumentThemeOverride {
  primaryColor?:   string;
  secondaryColor?: string;
  accentColor?:    string;
}

export interface BrandDnaApplicationReport {
  source:          "brand_dna" | "creative_direction" | "default";
  colorsApplied:   boolean;
  primaryColor?:   string;
  secondaryColor?: string;
  accentColor?:    string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function safeColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return HEX_RE.test(trimmed) ? trimmed : undefined;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ── Brand DNA extraction ──────────────────────────────────────────────────────

/**
 * Extract theme colors from a creative project's result object.
 * Tries Brand DNA first, then legacy Creative Direction color_direction.
 */
export function extractBrandDnaTheme(
  project: Pick<CreativeProject, "result">,
  _serviceType: PresentationDocumentServiceType,
): { theme: DocumentThemeOverride; report: BrandDnaApplicationReport } {
  const result   = obj(project.result);

  // ── Source 1: Brand DNA (V4.2E+) ──────────────────────────────────────────
  const brandDna = obj(result["brandDna"]);
  const dnaColors = obj(brandDna["colors"]);
  const dnaPrimary   = safeColor(dnaColors["primary"])   ?? safeColor(brandDna["primaryColor"]);
  const dnaSecondary = safeColor(dnaColors["secondary"]) ?? safeColor(brandDna["secondaryColor"]);
  const dnaAccent    = safeColor(dnaColors["accent"])    ?? safeColor(brandDna["accentColor"]);

  if (dnaPrimary || dnaSecondary || dnaAccent) {
    const theme: DocumentThemeOverride = {};
    if (dnaPrimary)   theme.primaryColor   = dnaPrimary;
    if (dnaSecondary) theme.secondaryColor = dnaSecondary;
    if (dnaAccent)    theme.accentColor    = dnaAccent;
    return {
      theme,
      report: {
        source:        "brand_dna",
        colorsApplied: true,
        primaryColor:   dnaPrimary,
        secondaryColor: dnaSecondary,
        accentColor:    dnaAccent,
      },
    };
  }

  // ── Source 2: Legacy Creative Direction color_direction ──────────────────
  const cd         = obj(result["creativeDirection"]);
  const colorDir   = obj(cd["color_direction"]);
  const cdPrimary   = safeColor(colorDir["primary"]);
  const cdSecondary = safeColor(colorDir["secondary"]);
  const cdAccent    = safeColor(colorDir["accent"]);

  if (cdPrimary || cdSecondary || cdAccent) {
    const theme: DocumentThemeOverride = {};
    if (cdPrimary)   theme.primaryColor   = cdPrimary;
    if (cdSecondary) theme.secondaryColor = cdSecondary;
    if (cdAccent)    theme.accentColor    = cdAccent;
    return {
      theme,
      report: {
        source:        "creative_direction",
        colorsApplied: true,
        primaryColor:   cdPrimary,
        secondaryColor: cdSecondary,
        accentColor:    cdAccent,
      },
    };
  }

  // ── Source 3: Default ────────────────────────────────────────────────────
  return {
    theme: {},
    report: { source: "default", colorsApplied: false },
  };
}
