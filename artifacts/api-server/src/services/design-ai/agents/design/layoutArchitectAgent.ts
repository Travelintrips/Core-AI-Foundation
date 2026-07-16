/**
 * Agent 4 — Layout Architect AI
 *
 * Responsibility: determine grid, section hierarchy, safe area, reading order,
 * whitespace, alignment, and regions given a canvas.
 *
 * Output: LayoutSpec
 * Does NOT produce Konva JSON, component bindings, or final assets.
 */

import { executeAI as defaultExecuteAI } from "../../../aiExecutionService.js";
import type { ExecuteAIFn } from "../../utils/agentRunner.js";
import { runAgent } from "../../utils/agentRunner.js";
import type { AgentOutput, LayoutSpec, ModelConfig } from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import { layoutSpecSchema } from "../../schemas/design/layout.schema.js";
import { buildLayoutArchitectPrompt } from "../../prompts/design/layout-architect.prompt.js";

// ─── Canvas resolution ────────────────────────────────────────────────────────

const CANVAS_PRESETS: Record<string, { width: number; height: number }> = {
  instagram_portrait: { width: 1080, height: 1350 },
  instagram_square:   { width: 1080, height: 1080 },
  square_post:        { width: 1080, height: 1080 },
  square:             { width: 1080, height: 1080 },
  banner_landscape:   { width: 1200, height: 628 },
  banner:             { width: 1200, height: 628 },
  landscape:          { width: 1200, height: 628 },
  presentation:       { width: 1920, height: 1080 },
  story:              { width: 1080, height: 1920 },
  facebook_cover:     { width: 1640, height: 624 },
};

const DEFAULT_CANVAS = { width: 1080, height: 1080 };

export function resolveCanvasDimensions(
  input: DiscoveryTeamOutput,
): { width: number; height: number } {
  if (input.creativeBrief.dimensions) {
    return input.creativeBrief.dimensions;
  }
  const key = input.creativeBrief.projectType.toLowerCase().replace(/[\s-]+/g, "_");
  return CANVAS_PRESETS[key] ?? DEFAULT_CANVAS;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

const AGENT_ID      = "design-ai-layout-architect-v1";
const AGENT_NAME    = "Layout Architect AI";
const AGENT_VERSION = "1.0.0";

export async function runLayoutArchitect(
  input: DiscoveryTeamOutput,
  modelConfig: ModelConfig,
  deps?: { executeAI?: ExecuteAIFn },
): Promise<AgentOutput<LayoutSpec>> {
  const executeAI = deps?.executeAI ?? defaultExecuteAI;
  const canvas = resolveCanvasDimensions(input);

  const result = await runAgent<LayoutSpec>({
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    systemPrompt:
      "You are Layout Architect AI. Respond with ONLY valid JSON matching the LayoutSpec schema — no markdown fences, no explanation.",
    userPrompt: buildLayoutArchitectPrompt(input, canvas),
    schema: layoutSpecSchema,
    modelConfig,
    executeAI,
  });

  // Post-processing: warn on sections that overflow the canvas
  if (result.status === "success" && result.data) {
    const w = result.data.canvas.width;
    const h = result.data.canvas.height;
    const overflowing = result.data.sections.filter(
      (s) => s.region.x + s.region.width > w || s.region.y + s.region.height > h,
    );
    if (overflowing.length > 0) {
      const ids = overflowing.map((s) => s.id).join(", ");
      result.warnings.push(
        `Section(s) overflow canvas bounds (${w}×${h}px): ${ids}. Downstream renderers will clip.`,
      );
    }
  }

  return result;
}
