/**
 * templateCompatibility.ts — Team 16: Presentation & Document Creative Services
 *
 * Template compatibility matrix. Maps each service type to the design
 * template styles it supports and any rendering constraints.
 *
 * Templates are referenced by slug and evaluated against the project's
 * Brand DNA (color palette, typography) at render time.
 */

import type { PresentationDocumentServiceType } from "./types.js";

// ── Template compatibility entry ──────────────────────────────────────────────

export type TemplateStyle =
  | "corporate"
  | "modern"
  | "minimal"
  | "bold"
  | "editorial"
  | "technical"
  | "warm";

export interface TemplateCompatibilityEntry {
  serviceType:           PresentationDocumentServiceType;
  supportedStyles:       TemplateStyle[];
  /** Default style used when no explicit preference is provided. */
  defaultStyle:          TemplateStyle;
  /** Whether the template supports full-bleed cover images. */
  supportsFullBleedCover: boolean;
  /** Whether section headers use decorative dividers. */
  usesDecorativeDividers: boolean;
  /** Max columns in table sections. */
  maxTableColumns:       number;
  /** Recommended font pairing for brand alignment. */
  fontPairing:           { heading: string; body: string };
}

// ── Compatibility matrix ───────────────────────────────────────────────────────

export const TEMPLATE_COMPATIBILITY: Record<PresentationDocumentServiceType, TemplateCompatibilityEntry> = {
  company_profile: {
    serviceType:            "company_profile",
    supportedStyles:        ["corporate", "modern", "warm"],
    defaultStyle:           "corporate",
    supportsFullBleedCover: true,
    usesDecorativeDividers: true,
    maxTableColumns:        4,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
  pitch_deck: {
    serviceType:            "pitch_deck",
    supportedStyles:        ["modern", "bold", "minimal"],
    defaultStyle:           "modern",
    supportsFullBleedCover: true,
    usesDecorativeDividers: false,
    maxTableColumns:        3,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
  proposal: {
    serviceType:            "proposal",
    supportedStyles:        ["corporate", "modern", "minimal"],
    defaultStyle:           "corporate",
    supportsFullBleedCover: true,
    usesDecorativeDividers: true,
    maxTableColumns:        4,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
  product_catalog: {
    serviceType:            "product_catalog",
    supportedStyles:        ["modern", "bold", "editorial"],
    defaultStyle:           "modern",
    supportsFullBleedCover: true,
    usesDecorativeDividers: false,
    maxTableColumns:        5,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
  annual_report: {
    serviceType:            "annual_report",
    supportedStyles:        ["corporate", "editorial", "minimal"],
    defaultStyle:           "editorial",
    supportsFullBleedCover: true,
    usesDecorativeDividers: true,
    maxTableColumns:        4,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
  whitepaper: {
    serviceType:            "whitepaper",
    supportedStyles:        ["technical", "minimal", "corporate"],
    defaultStyle:           "technical",
    supportsFullBleedCover: false,
    usesDecorativeDividers: true,
    maxTableColumns:        4,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
  case_study: {
    serviceType:            "case_study",
    supportedStyles:        ["modern", "corporate", "bold"],
    defaultStyle:           "modern",
    supportsFullBleedCover: true,
    usesDecorativeDividers: true,
    maxTableColumns:        3,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
  ebook: {
    serviceType:            "ebook",
    supportedStyles:        ["editorial", "warm", "minimal"],
    defaultStyle:           "editorial",
    supportsFullBleedCover: true,
    usesDecorativeDividers: true,
    maxTableColumns:        2,
    fontPairing:            { heading: "Helvetica-Bold", body: "Helvetica" },
  },
};

export function getTemplateCompatibility(
  serviceType: PresentationDocumentServiceType,
): TemplateCompatibilityEntry {
  return TEMPLATE_COMPATIBILITY[serviceType];
}

export function isStyleCompatible(
  serviceType: PresentationDocumentServiceType,
  style: string,
): boolean {
  const entry = TEMPLATE_COMPATIBILITY[serviceType];
  return entry.supportedStyles.includes(style as TemplateStyle);
}
