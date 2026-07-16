/**
 * Component Adapter (Discovery + Design → Team 3 Component Pipeline → Orchestrator)
 *
 * Bridges:
 *  1. Maps orchestrator DiscoveryTeamOutput + DesignTeamOutput → Team 3 ComponentTeamInput
 *  2. Calls runComponentPipeline() — Team 3's real implementation (agents 9–11)
 *  3. Maps Team 3 real ComponentTeamOutput → orchestrator ComponentTeamOutput shape
 *
 * Rules (per Tahap 5 policy): pure, deterministic, no fabricated data.
 */

import type { DiscoveryTeamOutput } from "../../types/discovery.types.js";
import type {
  DesignTeamOutput as OrchestratorDesignOutput,
  ComponentTeamOutput as OrchestratorComponentOutput,
} from "../../types/orchestrator.types.js";
import type {
  ComponentTeamInput,
  ComponentTeamOutput as T3RealOutput,
  DiscoveryTeamOutput as T3DiscoveryInput,
  DesignTeamOutput as T3DesignInput,
} from "../../types/component-plan.types.js";
import { runComponentPipeline } from "../../agents/components/index.js";

// ── Input mapping ─────────────────────────────────────────────────────────────

function adaptDiscoveryForComponentTeam(discovery: DiscoveryTeamOutput): T3DiscoveryInput {
  const brief = discovery.creativeBrief;
  const brand = discovery.brandStrategy;
  const req   = discovery.requirementAnalysis;
  return {
    category:       req.sections[0]?.contentPurpose ?? "general",
    industry:       brand.brandPersonality.slice(0, 3).join(", ") || undefined,
    objective:      brief.communicationObjective,
    targetAudience: brief.targetAudience.primary,
    keyMessages:    brief.contentPriority.slice(0, 5),
    brandName:      brand.brandName,
  };
}

/** Parse "key:value" notes written by designAdapter into a lookup map. */
function parseColorNotes(notes: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const note of notes) {
    const colon = note.indexOf(":");
    if (colon > 0) {
      result[note.slice(0, colon)] = note.slice(colon + 1);
    }
  }
  return result;
}

function adaptDesignForComponentTeam(
  discovery: DiscoveryTeamOutput,
  design: OrchestratorDesignOutput,
): T3DesignInput {
  const req    = discovery.requirementAnalysis;
  const colors = parseColorNotes(design.colorSystemNotes);

  return {
    style:        design.layoutDecisions.gridSystem,
    colorPalette: [colors["primary"], colors["background"], colors["text"]].filter((c): c is string => !!c && c !== "undefined"),
    fontPrimary:  design.typographyChoices.primaryCategory,
    fontSecondary: design.typographyChoices.secondaryCategory,
    canvasWidth:  req.canvas.width,
    canvasHeight: req.canvas.height,
    sections: design.layoutDecisions.sectionOrder.map((id, idx) => {
      const section = req.sections.find(s => s.id === id);
      return {
        id,
        name:    section?.name ?? id,
        order:   idx + 1,
        purpose: section?.contentPurpose ?? "content",
      };
    }),
  };
}

// ── Output mapping: Team 3 real → orchestrator contract ──────────────────────

function adaptComponentOutput(real: T3RealOutput): OrchestratorComponentOutput {
  return {
    componentPlan: real.componentPlan.components.map(c => ({
      id:      c.id,
      type:    c.type,
      purpose: c.role,
    })),
    variableKeys: real.variablePlan.variables.map(v => v.key),
    assetBindings: real.assetPlan.assets.map(a => ({
      variableKey: a.id,
      assetType:   a.type,
    })),
    _agentMetadata: [],
  };
}

// ── Public adapter (replaces runComponentPipelineStub) ───────────────────────

export async function runComponentAdapter(
  discovery: DiscoveryTeamOutput,
  design: OrchestratorDesignOutput,
): Promise<OrchestratorComponentOutput> {
  const t3Input: ComponentTeamInput = {
    discovery: adaptDiscoveryForComponentTeam(discovery),
    design:    adaptDesignForComponentTeam(discovery, design),
  };
  const realOutput = await runComponentPipeline(t3Input);
  return adaptComponentOutput(realOutput);
}
