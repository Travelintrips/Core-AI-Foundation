/**
 * Discovery Adapter (Team 1 → Orchestrator)
 *
 * Team 1 types are authoritative — no transformation needed.
 * This file exists for symmetry and documents the pass-through contract.
 *
 * If Team 1 renames types in the future, apply the mapping here
 * without touching QA agent or orchestrator files.
 */

import type { DiscoveryTeamOutput } from "../../types/discovery.types.js";

/**
 * Identity adapter — Team 1 output already matches the orchestrator contract.
 * Returns a new object to preserve immutability invariant.
 */
export function adaptDiscoveryOutput(raw: DiscoveryTeamOutput): DiscoveryTeamOutput {
  return {
    creativeBrief:       { ...raw.creativeBrief,       targetAudience: { ...raw.creativeBrief.targetAudience } },
    requirementAnalysis: { ...raw.requirementAnalysis, canvas: { ...raw.requirementAnalysis.canvas }           },
    brandStrategy:       { ...raw.brandStrategy,       colorDirection: { ...raw.brandStrategy.colorDirection }, typographyDirection: { ...raw.brandStrategy.typographyDirection } },
  };
}
