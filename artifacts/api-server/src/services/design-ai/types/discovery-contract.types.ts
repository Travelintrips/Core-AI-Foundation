/**
 * Discovery Team output contract adapter — Team 2 local copy.
 *
 * Team 1 (Discovery Team) has not yet shipped its types. This file defines
 * a local adapter that represents the expected Team 1 output shape.
 *
 * Integration rule: When Team 1 publishes its package, replace usages of
 * `DiscoveryTeamOutput` here with imports from Team 1's package and delete
 * this file. DO NOT import from Team 1's source files directly — keep the
 * adapter boundary to decouple Teams.
 */

export interface CreativeBrief {
  projectName: string;
  clientName?: string;
  industry?: string;
  /** e.g. "instagram_portrait", "square_post", "banner_landscape", "presentation" */
  projectType: string;
  targetAudience?: string;
  primaryObjective?: string;
  keyMessages?: string[];
  callToAction?: string;
  /** Text blocks, product names, taglines, etc. */
  contentItems?: string[];
  /** Explicit canvas dimensions; agents infer from projectType if absent */
  dimensions?: {
    width: number;
    height: number;
  };
  additionalNotes?: string;
}

export interface RequirementAnalysis {
  requiredSections: string[];
  optionalSections: string[];
  contentDensity: "low" | "medium" | "high";
  layoutComplexity: "simple" | "moderate" | "complex";
  hasHeroImage: boolean;
  hasCta: boolean;
  hasProductShowcase: boolean;
  /** Total expected section count (required + optional that fit) */
  estimatedSectionCount: number;
  constraints?: string[];
}

export interface BrandStrategy {
  brandName: string;
  /** Brand personality descriptors e.g. ["bold", "modern", "trustworthy"] */
  brandPersonality: string[];
  /** Hex color hints from brand guidelines */
  preferredColors?: string[];
  /** Font name hints from brand guidelines */
  preferredFonts?: string[];
  styleDirection: "minimalist" | "bold" | "elegant" | "playful" | "corporate" | "organic";
  mood: string;
  targetEmotion?: string;
  existingBrandColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
}

export interface DiscoveryTeamOutput {
  creativeBrief: CreativeBrief;
  requirementAnalysis: RequirementAnalysis;
  brandStrategy: BrandStrategy;
}
