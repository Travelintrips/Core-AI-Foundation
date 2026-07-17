/**
 * Team 17 — Interior Design — Brand Intelligence V2 adapter.
 *
 * Interior Design MUST NOT duplicate brand style/material data.
 * This adapter wraps the existing Brand Intelligence V2 service
 * (creativeBrandIntelligenceService) as a read-only interface.
 *
 * Interior Design stores only:
 *   - selected preference snapshot (user's brief)
 *   - sourceBrandProfileId / sourceBrandProfileVersion (reference)
 *   - project-specific overrides (brief.primaryColors, brief.style, etc.)
 *
 * Style/material source of truth always flows from Brand Intelligence V2.
 */
import {
  getBrandDNA,
  getCreativeDirectorRecommendation,
} from "../../services/creativeBrandIntelligenceService.js";

export interface BrandStyleSnapshot {
  /** clientId whose Brand DNA was read */
  clientId: string;
  /** Opaque version string — included in id_outputs for traceability */
  profileVersion: string;
  /** Hex palette from Brand DNA */
  palette: string[];
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  /** Photography / illustration / layout style indicators */
  photographyStyle: string;
  layoutStyle: string;
  visualDensity: string;
  /** Brand personality keywords — used to enrich moodboard mood words */
  brandPersonality: string[];
  /** Creative director's recommended direction — used to seed visualConcept */
  creativeDirection: string | null;
}

/**
 * Read brand style data for a given client from Brand Intelligence V2.
 * Returns null if no brand profile exists (new client / not yet analyzed).
 *
 * The caller (generateOutputs) should treat null as "no brand context" and
 * fall back to the brief's own preference snapshot — it must NOT store a
 * separate in-domain copy of any brand data.
 */
export async function readBrandStyleSnapshot(
  clientId: string,
): Promise<BrandStyleSnapshot | null> {
  try {
    const dna = await getBrandDNA(clientId);
    if (!dna) return null;

    let creativeDirection: string | null = null;
    try {
      const rec = await getCreativeDirectorRecommendation(clientId);
      // Use creativeStrategy as the primary direction; fall back to visualDirection
      creativeDirection = rec?.creativeStrategy ?? rec?.visualDirection ?? null;
    } catch {
      // Best-effort — do not fail output generation if direction is unavailable
    }

    const colors = dna.detectedColors ?? {};
    const palette: string[] = Array.isArray(colors.palette) ? (colors.palette as string[]) : [];

    return {
      clientId,
      // BrandDnaView has analyzedAt (ISO string) as the version indicator
      profileVersion: String(dna.analyzedAt ?? "unknown"),
      palette,
      primaryColor:   (colors.primary as string | null) ?? null,
      secondaryColor: (colors.secondary as string | null) ?? null,
      accentColor:    (colors.accent as string | null) ?? null,
      photographyStyle: String(dna.photographyStyle ?? "Natural"),
      layoutStyle:      String(dna.layoutStyle ?? "Balanced"),
      visualDensity:    String(dna.visualDensity ?? "Moderate"),
      brandPersonality: Array.isArray(dna.brandPersonality) ? (dna.brandPersonality as string[]) : [],
      creativeDirection,
    };
  } catch {
    // If Brand Intelligence is unavailable, return null — caller uses brief preferences
    return null;
  }
}
