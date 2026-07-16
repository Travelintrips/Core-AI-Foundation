/**
 * Component Adapter (Team 3 → Orchestrator)
 *
 * STUB — Team 3 pipeline does not exist yet.
 * This adapter produces a structurally valid ComponentTeamOutput so the
 * pipeline can run end-to-end.
 *
 * WHEN TEAM 3 DELIVERS:
 *  1. Import Team 3's runComponentPipeline() function.
 *  2. Map its output to ComponentTeamOutput.
 *  3. Remove the stub below.
 *
 * CONTRACT MISMATCH: None currently — stub returns valid shape.
 */

import type { DiscoveryTeamOutput } from "../../types/discovery.types.js";
import type { DesignTeamOutput, ComponentTeamOutput } from "../../types/orchestrator.types.js";

/** STUB: returns a minimal placeholder ComponentTeamOutput. */
export async function runComponentPipelineStub(
  discovery: DiscoveryTeamOutput,
  _design: DesignTeamOutput,
): Promise<ComponentTeamOutput> {
  const variableKeys = discovery.requirementAnalysis.requestedVariables.length > 0
    ? discovery.requirementAnalysis.requestedVariables
    : ["headline", "subheadline", "cta_label", "background_image"];

  return {
    componentPlan: discovery.requirementAnalysis.sections.map((s: { id: string; name: string; contentPurpose: string }) => ({
      id: s.id,
      type: "section",
      purpose: s.contentPurpose,
    })),
    variableKeys,
    assetBindings: variableKeys
      .filter((k: string) => k.toLowerCase().includes("image") || k.toLowerCase().includes("logo"))
      .map((k: string) => ({ variableKey: k, assetType: "image" })),
    _agentMetadata: [],
  };
}
