// Team 10 — Brand DNA Compatibility Service
// Reads Brand DNA (from aiBrandDnaTable via @workspace/db) and scores
// font pairs + palettes against the brand's detected personality and colours.

import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { contrastRatio, hexToRgb, deltaE, normalizeHex } from "./colorUtils.js";
import { listFontPairs, getFontPairWithRoles } from "./fontPairService.js";
import { listColorPalettes, getColorPaletteWithRoles } from "./colorPaletteService.js";
import type {
  BrandDnaInput,
  CompatibilityScore,
  FontMood,
  Industry,
} from "./types.js";
import { ACCESSIBILITY_DISCLAIMER } from "./types.js";

// Personality → mood mapping (based on Brand DNA personality tags)
const PERSONALITY_TO_MOOD: Record<string, FontMood[]> = {
  innovative: ["modern", "bold", "minimal"],
  trustworthy: ["professional", "traditional"],
  playful: ["playful", "friendly"],
  elegant: ["elegant", "minimal"],
  bold: ["bold", "modern"],
  friendly: ["friendly", "playful"],
  professional: ["professional", "modern"],
  creative: ["bold", "playful"],
  minimal: ["minimal", "modern"],
  traditional: ["traditional", "professional"],
  luxurious: ["elegant", "traditional"],
  energetic: ["bold", "playful"],
};

function personalityToMoods(personalities: string[]): FontMood[] {
  const moods = new Set<FontMood>();
  for (const p of personalities) {
    const mapped = PERSONALITY_TO_MOOD[p.toLowerCase()] ?? [];
    for (const m of mapped) moods.add(m);
  }
  return [...moods];
}

/**
 * Score a colour palette against detected brand colours.
 * Uses delta-E proximity: the closer the detected primary to a palette colour,
 * the higher the score.
 */
function scoreColourCompatibility(
  paletteColors: string[],
  brandColors: { primary: string | null; palette: string[] }
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const comparisons = [
    ...(brandColors.primary ? [brandColors.primary] : []),
    ...brandColors.palette,
  ].filter(Boolean);

  if (comparisons.length === 0) {
    reasons.push("No brand colours detected — colour score neutral");
    return { score: 50, reasons };
  }

  let totalDelta = 0;
  let pairs = 0;
  for (const brandHex of comparisons) {
    const normalized = normalizeHex(brandHex);
    let minDelta = Infinity;
    for (const paletteHex of paletteColors) {
      const d = deltaE(normalized, normalizeHex(paletteHex));
      if (d < minDelta) minDelta = d;
    }
    totalDelta += minDelta;
    pairs++;
  }

  const avgDelta = pairs > 0 ? totalDelta / pairs : 100;

  if (avgDelta < 10) {
    score = 100;
    reasons.push("Excellent colour match — palette is very close to brand colours");
  } else if (avgDelta < 25) {
    score = 75;
    reasons.push("Good colour match — palette harmonises with brand colours");
  } else if (avgDelta < 50) {
    score = 50;
    reasons.push("Moderate colour match — palette shares some brand tones");
  } else {
    score = 20;
    reasons.push("Low colour match — palette diverges significantly from brand colours");
  }

  return { score, reasons };
}

function scoreMoodCompatibility(
  itemMoods: FontMood[],
  targetMoods: FontMood[]
): { score: number; reasons: string[] } {
  if (targetMoods.length === 0) return { score: 50, reasons: ["No personality moods derived"] };

  const overlap = itemMoods.filter((m) => targetMoods.includes(m));
  const score = Math.round((overlap.length / targetMoods.length) * 100);
  const reasons =
    overlap.length > 0
      ? [`Mood match: ${overlap.join(", ")}`]
      : ["No mood overlap with brand personality"];

  return { score, reasons };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getCompatibleFontPairs(
  brandDna: BrandDnaInput,
  limit = 10
): Promise<CompatibilityScore[]> {
  const targetMoods = personalityToMoods(brandDna.brandPersonality);
  const pairs = await listFontPairs({ activeOnly: true, limit: 100 });

  const scored: CompatibilityScore[] = pairs.map((pair) => {
    const pairMoods = (pair.mood as FontMood[]) ?? [];
    const moodResult = scoreMoodCompatibility(pairMoods, targetMoods);

    // Confidence-weighted final score
    const confidence = Math.max(0.3, brandDna.confidenceScore);
    const finalScore = Math.round(
      moodResult.score * confidence + 50 * (1 - confidence)
    );

    const warnings: string[] = [];
    if (brandDna.confidenceScore < 0.4) {
      warnings.push("Brand DNA confidence is low — recommendations may not be accurate");
    }

    return {
      id: pair.id,
      name: pair.name,
      slug: pair.slug,
      score: finalScore,
      scoreMethod: "estimated_compatibility" as const,
      reasons: moodResult.reasons,
      warnings,
      disclaimer: ACCESSIBILITY_DISCLAIMER,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function getCompatiblePalettes(
  brandDna: BrandDnaInput,
  limit = 10
): Promise<CompatibilityScore[]> {
  const targetMoods = personalityToMoods(brandDna.brandPersonality);
  const palettes = await listColorPalettes({ activeOnly: true, limit: 100 });

  const scored: CompatibilityScore[] = palettes.map((palette) => {
    const paletteMoods = (palette.mood as FontMood[]) ?? [];
    const moodResult = scoreMoodCompatibility(paletteMoods, targetMoods);
    const colourResult = scoreColourCompatibility(
      palette.colors,
      brandDna.detectedColors
    );

    const confidence = Math.max(0.3, brandDna.confidenceScore);
    // 40% mood, 60% colour for palettes
    const finalScore = Math.round(
      (moodResult.score * 0.4 + colourResult.score * 0.6) * confidence +
        50 * (1 - confidence)
    );

    const warnings: string[] = [];
    if (brandDna.confidenceScore < 0.4) {
      warnings.push("Brand DNA confidence is low — colour recommendations may not be accurate");
    }
    if (!palette.accessible) {
      warnings.push("Palette does not meet WCAG AA — verify before use");
    }

    return {
      id: palette.id,
      name: palette.name,
      slug: palette.slug,
      score: finalScore,
      scoreMethod: "estimated_compatibility" as const,
      reasons: [...moodResult.reasons, ...colourResult.reasons],
      warnings,
      disclaimer: ACCESSIBILITY_DISCLAIMER,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function scoreSpecificCombination(
  pairId: number,
  paletteId: number,
  brandDna: BrandDnaInput
): Promise<{
  fontPair: CompatibilityScore;
  palette: CompatibilityScore;
  combinedScore: number;
  recommendation: string;
}> {
  const [pair, palette] = await Promise.all([
    getFontPairWithRoles(pairId),
    getColorPaletteWithRoles(paletteId),
  ]);

  if (!pair) throw new Error(`Font pair ${pairId} not found`);
  if (!palette) throw new Error(`Color palette ${paletteId} not found`);

  const targetMoods = personalityToMoods(brandDna.brandPersonality);

  const pairMoods = (pair.mood as FontMood[]) ?? [];
  const pairMood = scoreMoodCompatibility(pairMoods, targetMoods);
  const fontPairScore: CompatibilityScore = {
    id: pair.id,
    name: pair.name,
    slug: pair.slug,
    score: pairMood.score,
    scoreMethod: "estimated_compatibility" as const,
    reasons: pairMood.reasons,
    warnings: [],
    disclaimer: ACCESSIBILITY_DISCLAIMER,
  };

  const paletteMoods = (palette.mood as FontMood[]) ?? [];
  const palMood = scoreMoodCompatibility(paletteMoods, targetMoods);
  const palColour = scoreColourCompatibility(palette.colors, brandDna.detectedColors);
  const paletteScore: CompatibilityScore = {
    id: palette.id,
    name: palette.name,
    slug: palette.slug,
    score: Math.round(palMood.score * 0.4 + palColour.score * 0.6),
    scoreMethod: "estimated_compatibility" as const,
    reasons: [...palMood.reasons, ...palColour.reasons],
    warnings: palette.accessible ? [] : ["Palette does not meet WCAG AA"],
    disclaimer: ACCESSIBILITY_DISCLAIMER,
  };

  const combinedScore = Math.round(
    (fontPairScore.score + paletteScore.score) / 2
  );

  const recommendation =
    combinedScore >= 80
      ? "Excellent match for your brand — highly recommended"
      : combinedScore >= 60
      ? "Good match — minor adjustments may improve alignment"
      : combinedScore >= 40
      ? "Partial match — consider alternatives for better brand consistency"
      : "Poor match — this combination may conflict with your brand identity";

  return { fontPair: fontPairScore, palette: paletteScore, combinedScore, recommendation };
}
