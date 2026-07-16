/**
 * Design Adapter (Team 2 → Orchestrator)
 *
 * STUB — Team 2 pipeline does not exist yet.
 * This adapter runs a minimal stub that produces a structurally valid
 * DesignTeamOutput from the discovery output so the rest of the pipeline
 * can run end-to-end.
 *
 * WHEN TEAM 2 DELIVERS:
 *  1. Import Team 2's runDesignPipeline() function.
 *  2. Call it and map its output to DesignTeamOutput.
 *  3. Remove the stub below.
 *  4. Add a test for the mapping.
 *
 * CONTRACT MISMATCH: None currently — stub returns valid DesignTeamOutput shape.
 */

import type { DiscoveryTeamOutput } from "../../types/discovery.types.js";
import type { DesignTeamOutput } from "../../types/orchestrator.types.js";

/** STUB: returns a minimal placeholder DesignTeamOutput. */
export async function runDesignPipelineStub(
  discovery: DiscoveryTeamOutput,
): Promise<DesignTeamOutput> {
  return {
    layoutDecisions: {
      gridSystem: "12-column",
      sectionOrder: discovery.requirementAnalysis.sections.map(s => s.id),
      densityRating: "medium",
    },
    compositionNotes: discovery.creativeBrief.visualDirection.slice(0, 3) as string[],
    typographyChoices: {
      primaryCategory: discovery.brandStrategy.typographyDirection.category[0] ?? "sans-serif",
      hierarchyLevels: 3,
    },
    colorSystemNotes: [
      `Primary mood: ${discovery.brandStrategy.colorDirection.primaryMood}`,
      ...discovery.brandStrategy.colorDirection.supportingMood,
    ],
    decorationNotes: discovery.brandStrategy.imageryDirection.slice(0, 2),
    _agentMetadata: [],
  };
}
