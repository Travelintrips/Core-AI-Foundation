/**
 * Discovery Pipeline — Team 1 public entry point
 *
 * Runs the three discovery agents sequentially:
 *   Creative Director → Requirement Analyst → Brand Strategist
 *
 * Each agent result is validated before passing to the next.
 * Pipeline fails fast on any agent failure — downstream agents are skipped.
 */

import { runCreativeDirectorAgent } from "./creativeDirectorAgent.js";
import { runRequirementAnalystAgent } from "./requirementAnalystAgent.js";
import { runBrandStrategistAgent } from "./brandStrategistAgent.js";
import {
  type DiscoveryPipelineInput,
  type DiscoveryTeamOutput,
} from "../../types/discovery.types.js";

export { runCreativeDirectorAgent } from "./creativeDirectorAgent.js";
export { runRequirementAnalystAgent } from "./requirementAnalystAgent.js";
export { runBrandStrategistAgent } from "./brandStrategistAgent.js";
export type { CreativeDirectorInput } from "./creativeDirectorAgent.js";
export type { RequirementAnalystInput } from "./requirementAnalystAgent.js";
export type { BrandStrategistInput } from "./brandStrategistAgent.js";

// ── Pipeline ──────────────────────────────────────────────────────────────────

export class DiscoveryPipelineError extends Error {
  constructor(
    public readonly stage: "creative-director" | "requirement-analyst" | "brand-strategist",
    public readonly agentErrors: string[],
    public readonly agentWarnings: string[],
  ) {
    super(`Discovery pipeline failed at stage "${stage}": ${agentErrors.join("; ")}`);
    this.name = "DiscoveryPipelineError";
  }
}

/**
 * runDiscoveryPipeline
 *
 * Executes the full discovery phase for a design request.
 * Throws DiscoveryPipelineError if any agent fails.
 */
export async function runDiscoveryPipeline(
  input: DiscoveryPipelineInput,
): Promise<DiscoveryTeamOutput> {
  const modelConfig = input.modelConfig;

  // ── Stage 1: Creative Director ──────────────────────────────────────────────
  const briefResult = await runCreativeDirectorAgent({
    userPrompt: input.userPrompt,
    modelConfig,
  });

  if (briefResult.status !== "success" || !briefResult.data) {
    throw new DiscoveryPipelineError(
      "creative-director",
      briefResult.errors,
      briefResult.warnings,
    );
  }

  // ── Stage 2: Requirement Analyst ────────────────────────────────────────────
  const requirementResult = await runRequirementAnalystAgent({
    userPrompt: input.userPrompt,
    creativeBrief: briefResult.data,
    modelConfig,
  });

  if (requirementResult.status !== "success" || !requirementResult.data) {
    throw new DiscoveryPipelineError(
      "requirement-analyst",
      requirementResult.errors,
      requirementResult.warnings,
    );
  }

  // ── Stage 3: Brand Strategist ───────────────────────────────────────────────
  const brandResult = await runBrandStrategistAgent({
    creativeBrief: briefResult.data,
    requirementAnalysis: requirementResult.data,
    brandProfile: input.brandProfile,
    modelConfig,
  });

  if (brandResult.status !== "success" || !brandResult.data) {
    throw new DiscoveryPipelineError(
      "brand-strategist",
      brandResult.errors,
      brandResult.warnings,
    );
  }

  return {
    creativeBrief: briefResult.data,
    requirementAnalysis: requirementResult.data,
    brandStrategy: brandResult.data,
  };
}
