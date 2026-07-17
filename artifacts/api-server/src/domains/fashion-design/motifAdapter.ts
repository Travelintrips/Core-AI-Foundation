/**
 * motifAdapter.ts — Brand Intelligence V2 → Fashion Motif adapter (Team 18)
 *
 * P2 Duplication fix: instead of duplicating motif/style logic, this adapter
 * wraps getBrandDNA from creativeBrandIntelligenceService and translates brand
 * DNA fields into fashion-domain motif style suggestions.
 *
 * Provides: getMotifStyleForFashion(clientId) → FashionMotifStyle
 *
 * Falls back gracefully if brand DNA is unavailable for a client.
 */

import { getBrandDNA } from "../../services/creativeBrandIntelligenceService.js";
import { logger } from "../../lib/logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FashionMotifStyle {
  /** Primary recommended motif pattern */
  primaryPattern: string;
  /** Secondary / accent motif */
  secondaryPattern: string;
  /** Suggested color palette from brand DNA */
  suggestedColors: string[];
  /** Illustrative style aligned with brand (Flat, Detailed, Outline, etc.) */
  illustrationStyle: string;
  /** Visual density recommendation */
  visualDensity: string;
  /** Motif repeat scale recommendation (0–10) */
  recommendedScale: number;
  /** Is this derived from real brand DNA, or a generic fallback? */
  source: "brand_dna" | "fallback";
}

// ── Motif pattern mapping ─────────────────────────────────────────────────────

const ILLUSTRATION_TO_MOTIF: Record<string, string> = {
  "Flat":       "geometric",
  "Detailed":   "realistic",
  "Outline":    "line-art",
  "3D":         "dimensional",
  "Isometric":  "isometric",
  "Watercolor": "organic",
  "Minimalist": "minimal",
  "Bold":       "block-color",
};

const DENSITY_TO_SCALE: Record<string, number> = {
  "Dense":     8,
  "Balanced":  5,
  "Spacious":  3,
  "Generous":  2,
  "Minimal":   1,
};

const FALLBACK_STYLE: FashionMotifStyle = {
  primaryPattern:    "geometric",
  secondaryPattern:  "minimal",
  suggestedColors:   ["#1A237E", "#FFFFFF", "#F44336"],
  illustrationStyle: "Flat",
  visualDensity:     "Balanced",
  recommendedScale:  5,
  source:            "fallback",
};

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * getMotifStyleForFashion
 *
 * Retrieves brand DNA for the given clientId and maps it to fashion motif
 * style recommendations. Falls back to generic defaults if brand DNA is
 * unavailable, has insufficient confidence, or the service errors.
 */
export async function getMotifStyleForFashion(
  clientId: string,
): Promise<FashionMotifStyle> {
  try {
    const dna = await getBrandDNA(clientId);

    if (!dna) {
      logger.info({ clientId }, "[fashion-design/motifAdapter] No brand DNA — using fallback");
      return FALLBACK_STYLE;
    }

    // Low confidence DNA → fallback (avoid misleading suggestions)
    const confidence = Number(dna.confidenceScore ?? 0);
    if (confidence < 0.3) {
      logger.info({ clientId, confidence }, "[fashion-design/motifAdapter] Low confidence brand DNA — using fallback");
      return FALLBACK_STYLE;
    }

    const illustrationStyle = dna.illustrationStyle ?? "Flat";
    const primaryPattern    = ILLUSTRATION_TO_MOTIF[illustrationStyle] ?? "geometric";
    const secondaryPattern  = ILLUSTRATION_TO_MOTIF[dna.iconStyle ?? "Outline"] ?? "line-art";

    const palette = dna.detectedColors as Record<string, unknown> | null;
    const suggestedColors: string[] = [];
    if (palette) {
      if (typeof palette["primary"] === "string")   suggestedColors.push(palette["primary"]);
      if (typeof palette["secondary"] === "string") suggestedColors.push(palette["secondary"]);
      if (typeof palette["accent"] === "string")    suggestedColors.push(palette["accent"]);
    }
    if (suggestedColors.length === 0) suggestedColors.push(...FALLBACK_STYLE.suggestedColors);

    const visualDensity    = dna.visualDensity ?? "Balanced";
    const recommendedScale = DENSITY_TO_SCALE[visualDensity] ?? 5;

    logger.info({ clientId, illustrationStyle, primaryPattern, confidence },
      "[fashion-design/motifAdapter] Brand DNA mapped to fashion motif style");

    return {
      primaryPattern,
      secondaryPattern,
      suggestedColors,
      illustrationStyle,
      visualDensity,
      recommendedScale,
      source: "brand_dna",
    };
  } catch (err) {
    logger.warn({ err, clientId }, "[fashion-design/motifAdapter] Brand intel unavailable — using fallback");
    return FALLBACK_STYLE;
  }
}
