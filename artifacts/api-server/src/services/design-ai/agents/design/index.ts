/**
 * Design Team pipeline — Team 2
 *
 * Runs Agents 4–8 in sequence:
 *   Layout Architect → Composition Designer → Typography Designer
 *   → Color Designer → Decoration Designer
 *
 * Exported contract for Team 3 (Component) and Team 4 (Engineering).
 */

import { executeAI as defaultExecuteAI } from "../../../aiExecutionService.js";
import type { ExecuteAIFn } from "../../utils/agentRunner.js";
import type { DesignTeamOutput, ModelConfig } from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import { runLayoutArchitect } from "./layoutArchitectAgent.js";
import { runCompositionDesigner } from "./compositionDesignerAgent.js";
import { runTypographyDesigner } from "./typographyDesignerAgent.js";
import { runColorDesigner } from "./colorDesignerAgent.js";
import { runDecorationDesigner } from "./decorationDesignerAgent.js";

export {
  runLayoutArchitect,
  runCompositionDesigner,
  runTypographyDesigner,
  runColorDesigner,
  runDecorationDesigner,
};

export type { DesignTeamOutput, ModelConfig } from "../../types/design.types.js";
export type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";

// ─── Default model config ─────────────────────────────────────────────────────

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: { slug: "openai" },
  model: { modelId: "gpt-4o", maxOutputTokens: 4096 },
  temperature: 0.4,
  maxTokens: 4096,
};

// ─── Pipeline options ─────────────────────────────────────────────────────────

export interface RunDesignPipelineOptions {
  modelConfig?: ModelConfig;
  deps?: { executeAI?: ExecuteAIFn };
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Execute the full Design Team pipeline.
 *
 * Each agent receives the output of its predecessors; none mutate prior outputs.
 * Throws if any agent fails (status !== "success").
 */
export async function runDesignPipeline(
  input: DiscoveryTeamOutput,
  options: RunDesignPipelineOptions = {},
): Promise<DesignTeamOutput> {
  const modelConfig = options.modelConfig ?? DEFAULT_MODEL_CONFIG;
  const deps = options.deps;

  // 1 — Layout Architect
  const layoutResult = await runLayoutArchitect(input, modelConfig, deps);
  if (layoutResult.status !== "success" || !layoutResult.data) {
    throw new Error(
      `[Layout Architect] failed: ${layoutResult.errors.join("; ")}`,
    );
  }
  const layout = layoutResult.data;

  // 2 — Composition Designer
  const compositionResult = await runCompositionDesigner(input, layout, modelConfig, deps);
  if (compositionResult.status !== "success" || !compositionResult.data) {
    throw new Error(
      `[Composition Designer] failed: ${compositionResult.errors.join("; ")}`,
    );
  }
  const composition = compositionResult.data;

  // 3 — Typography Designer
  const typographyResult = await runTypographyDesigner(input, layout, modelConfig, deps);
  if (typographyResult.status !== "success" || !typographyResult.data) {
    throw new Error(
      `[Typography Designer] failed: ${typographyResult.errors.join("; ")}`,
    );
  }
  const typography = typographyResult.data;

  // 4 — Color Designer
  const colorResult = await runColorDesigner(input, layout, typography, modelConfig, deps);
  if (colorResult.status !== "success" || !colorResult.data) {
    throw new Error(
      `[Color Designer] failed: ${colorResult.errors.join("; ")}`,
    );
  }
  const colors = colorResult.data;

  // 5 — Decoration Designer
  const decorationResult = await runDecorationDesigner(
    input, layout, composition, colors, modelConfig, deps,
  );
  if (decorationResult.status !== "success" || !decorationResult.data) {
    throw new Error(
      `[Decoration Designer] failed: ${decorationResult.errors.join("; ")}`,
    );
  }
  const decorations = decorationResult.data;

  // Return a new object — never mutate agent outputs
  return { layout, composition, typography, colors, decorations };
}
