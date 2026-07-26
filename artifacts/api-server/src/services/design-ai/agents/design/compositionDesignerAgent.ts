/**
 * Agent 5 — Composition Designer AI
 *
 * Responsibility: focal point, eye flow, visual weight, balance, spacing
 * rhythm, and density map given the Layout Spec.
 *
 * Output: CompositionSpec
 */

import { executeAI as defaultExecuteAI } from "../../../aiExecutionService.js";
import type { ExecuteAIFn } from "../../utils/agentRunner.js";
import { runAgent } from "../../utils/agentRunner.js";
import type { AgentOutput, CompositionSpec, LayoutSpec, ModelConfig } from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import { compositionSpecSchema } from "../../schemas/design/composition.schema.js";
import { buildCompositionDesignerPrompt } from "../../prompts/design/composition-designer.prompt.js";

const AGENT_ID      = "design-ai-composition-designer-v1";
const AGENT_NAME    = "Composition Designer AI";
const AGENT_VERSION = "1.0.0";

export async function runCompositionDesigner(
  input: DiscoveryTeamOutput,
  layout: LayoutSpec,
  modelConfig: ModelConfig,
  deps?: { executeAI?: ExecuteAIFn },
): Promise<AgentOutput<CompositionSpec>> {
  const executeAI = deps?.executeAI ?? defaultExecuteAI;

  const result = await runAgent<CompositionSpec>({
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    systemPrompt:
      "You are Composition Designer AI. Respond with ONLY valid JSON matching the CompositionSpec schema — no markdown fences, no explanation. Write all descriptive text values (reason, relationship) in Bahasa Indonesia.",
    userPrompt: buildCompositionDesignerPrompt(input, layout),
    schema: compositionSpecSchema,
    modelConfig,
    executeAI,
  });

  // Post-processing: validate that referenced section IDs exist in the layout
  if (result.status === "success" && result.data) {
    const validIds = new Set(layout.sections.map((s) => s.id));

    const unknown: string[] = [];

    if (!validIds.has(result.data.focalPoint.sectionId)) {
      unknown.push(`focalPoint.sectionId "${result.data.focalPoint.sectionId}"`);
    }

    for (const vw of result.data.visualWeight) {
      if (!validIds.has(vw.sectionId)) {
        unknown.push(`visualWeight sectionId "${vw.sectionId}"`);
      }
    }

    for (const dm of result.data.densityMap) {
      if (!validIds.has(dm.sectionId)) {
        unknown.push(`densityMap sectionId "${dm.sectionId}"`);
      }
    }

    if (unknown.length > 0) {
      result.warnings.push(
        `Composition references section IDs not found in layout: ${unknown.join(", ")}`,
      );
    }
  }

  return result;
}
