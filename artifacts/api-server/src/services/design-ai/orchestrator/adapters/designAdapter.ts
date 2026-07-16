/**
 * Design Adapter (Team 1 Discovery output → Team 2 Design Pipeline → Orchestrator)
 *
 * Bridges three contracts:
 *  1. Maps Team 1 canonical DiscoveryTeamOutput → Team 2 local DiscoveryTeamOutput stub
 *  2. Calls runDesignPipeline() — Team 2's real implementation (agents 4–8)
 *  3. Maps Team 2 real DesignTeamOutput → orchestrator DesignTeamOutput shape
 *
 * Rules (per Tahap 5 policy): pure, deterministic, no fabricated data.
 */

import type { DiscoveryTeamOutput as T1DiscoveryTeamOutput } from "../../types/discovery.types.js";
import type { DiscoveryTeamOutput as T2DiscoveryInput } from "../../types/discovery-contract.types.js";
import type { DesignTeamOutput as T2RealOutput } from "../../types/design.types.js";
import { runDesignPipeline } from "../../agents/design/index.js";
import type { DesignTeamOutput as OrchestratorDesignOutput } from "../../types/orchestrator.types.js";

// ── Input mapping: Team 1 canonical → Team 2 local contract ──────────────────

function adaptDiscoveryForDesignTeam(t1: T1DiscoveryTeamOutput): T2DiscoveryInput {
  const brief = t1.creativeBrief;
  const req   = t1.requirementAnalysis;
  const brand = t1.brandStrategy;

  return {
    creativeBrief: {
      projectName:      brief.campaignName ?? brief.designGoal.slice(0, 80),
      clientName:       brand.brandName,
      projectType:      req.canvas.preset ?? (req.canvas.orientation === "portrait" ? "instagram_portrait" : "square_post"),
      targetAudience:   brief.targetAudience.primary,
      primaryObjective: brief.communicationObjective,
      keyMessages:      brief.contentPriority.slice(0, 5),
      callToAction:     req.callsToAction[0]?.label ?? req.callsToAction[0]?.purpose,
      contentItems:     req.requiredContent,
      dimensions:       { width: req.canvas.width, height: req.canvas.height },
      additionalNotes:  brief.assumptions.length > 0 ? brief.assumptions.join("; ") : undefined,
    },
    requirementAnalysis: {
      requiredSections:      req.sections.filter(s => s.required).map(s => s.name),
      optionalSections:      req.sections.filter(s => !s.required).map(s => s.name),
      contentDensity:        req.sections.length <= 2 ? "low" : req.sections.length <= 5 ? "medium" : "high",
      layoutComplexity:      req.sections.length <= 3 ? "simple" : req.sections.length <= 6 ? "moderate" : "complex",
      hasHeroImage:          req.sections.some(s => /hero|image|photo|banner/i.test(s.contentPurpose)),
      hasCta:                req.callsToAction.length > 0,
      hasProductShowcase:    req.sections.some(s => /product|showcase|catalog/i.test(s.contentPurpose)),
      estimatedSectionCount: req.sections.length,
      constraints:           [...req.contentConstraints, ...req.visualConstraints],
    },
    brandStrategy: {
      brandName:          brand.brandName ?? "",
      brandPersonality:   brand.brandPersonality,
      styleDirection:     resolveStyleDirection(brand.brandStyle),
      mood:               brand.mood.join(", "),
      preferredColors:    undefined,
      preferredFonts:     undefined,
      existingBrandColors: undefined,
    },
  };
}

/** Map free-form brand style array to Team 2's enum — deterministic first-match. */
function resolveStyleDirection(
  styles: string[],
): "minimalist" | "bold" | "elegant" | "playful" | "corporate" | "organic" {
  const lower = styles.map(s => s.toLowerCase());
  if (lower.some(s => /minim|clean|simple/.test(s)))             return "minimalist";
  if (lower.some(s => /bold|strong|impact|power/.test(s)))       return "bold";
  if (lower.some(s => /eleg|luxur|premium|sophist/.test(s)))     return "elegant";
  if (lower.some(s => /play|fun|vibr|cheer/.test(s)))            return "playful";
  if (lower.some(s => /organ|natural|earth|sustain/.test(s)))    return "organic";
  // corporate as neutral default — professional context
  return "corporate";
}

// ── Output mapping: Team 2 real → orchestrator contract ──────────────────────

function adaptDesignOutput(real: T2RealOutput): OrchestratorDesignOutput {
  const highDensityCount = real.composition.densityMap.filter(d => d.density === "high").length;
  const densityRating: "low" | "medium" | "high" =
    real.composition.densityMap.length === 0 ? "medium"
    : highDensityCount >= real.composition.densityMap.length / 2 ? "high"
    : highDensityCount === 0 ? "low"
    : "medium";

  return {
    layoutDecisions: {
      gridSystem:  `${real.layout.grid.columns}-column`,
      sectionOrder: real.layout.sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(s => s.id),
      densityRating,
    },
    compositionNotes: [
      `focal:${real.composition.focalPoint.sectionId}:${real.composition.focalPoint.reason}`,
      `balance:${real.composition.balance}`,
      ...real.composition.eyeFlow,
    ],
    typographyChoices: {
      primaryCategory:   real.typography.fontPairing.headingFont,
      secondaryCategory: real.typography.fontPairing.bodyFont,
      hierarchyLevels:   Object.keys(real.typography.styles).length,
    },
    // Structured as "key:value" for downstream adapter parsing
    colorSystemNotes: [
      `background:${real.colors.tokens.background}`,
      `primary:${real.colors.tokens.primary}`,
      `secondary:${real.colors.tokens.secondary}`,
      `accent:${real.colors.tokens.accent}`,
      `text:${real.colors.tokens.textPrimary}`,
      `textMuted:${real.colors.tokens.textSecondary}`,
    ],
    decorationNotes: real.decorations.decorations.map(d => `${d.type}:${d.purpose}`),
    _agentMetadata:  [],
  };
}

// ── Public adapter (replaces runDesignPipelineStub) ───────────────────────────

export async function runDesignAdapter(
  discovery: T1DiscoveryTeamOutput,
): Promise<OrchestratorDesignOutput> {
  const t2Input  = adaptDiscoveryForDesignTeam(discovery);
  const realOutput = await runDesignPipeline(t2Input);
  return adaptDesignOutput(realOutput);
}
