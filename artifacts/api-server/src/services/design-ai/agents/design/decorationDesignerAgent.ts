/**
 * Agent 8 — Decoration Designer AI
 *
 * Responsibility: ornaments, dividers, badges, frames, patterns, abstract
 * shapes, and decorative backgrounds. Must not obstruct CTA or content
 * hierarchy.
 *
 * Output: DecorationSpec
 */

import { executeAI as defaultExecuteAI } from "../../../aiExecutionService.js";
import type { ExecuteAIFn } from "../../utils/agentRunner.js";
import { runAgent } from "../../utils/agentRunner.js";
import type {
  AgentOutput,
  ColorSpec,
  CompositionSpec,
  DecorationSpec,
  LayoutSpec,
  ModelConfig,
} from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import { decorationSpecSchema } from "../../schemas/design/decoration.schema.js";
import { buildDecorationDesignerPrompt } from "../../prompts/design/decoration-designer.prompt.js";

const AGENT_ID      = "design-ai-decoration-designer-v1";
const AGENT_NAME    = "Decoration Designer AI";
const AGENT_VERSION = "1.0.0";

export async function runDecorationDesigner(
  input: DiscoveryTeamOutput,
  layout: LayoutSpec,
  composition: CompositionSpec,
  colors: ColorSpec,
  modelConfig: ModelConfig,
  deps?: { executeAI?: ExecuteAIFn },
): Promise<AgentOutput<DecorationSpec>> {
  const executeAI = deps?.executeAI ?? defaultExecuteAI;

  const result = await runAgent<DecorationSpec>({
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    systemPrompt:
      "You are Decoration Designer AI. Respond with ONLY valid JSON matching the DecorationSpec schema — no markdown fences, no explanation. Write all descriptive text values (purpose) in Bahasa Indonesia.",
    userPrompt: buildDecorationDesignerPrompt(input, layout, composition, colors),
    schema: decorationSpecSchema,
    modelConfig,
    executeAI,
  });

  // Post-processing: validate targetSectionId references
  if (result.status === "success" && result.data) {
    const validIds = new Set(layout.sections.map((s) => s.id));
    for (const deco of result.data.decorations) {
      if (deco.targetSectionId && !validIds.has(deco.targetSectionId)) {
        result.warnings.push(
          `Decoration "${deco.id}" references unknown targetSectionId "${deco.targetSectionId}".`,
        );
      }
    }
  }

  return result;
}
