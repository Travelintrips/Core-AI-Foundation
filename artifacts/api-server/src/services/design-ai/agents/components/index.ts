/**
 * Team 3 — Component Team Pipeline
 *
 * Orchestrates Agents 9 → 10 → 11 and returns the aggregated ComponentTeamOutput.
 *
 * Execution order (sequential — each agent depends on the previous):
 *   1. Component Builder AI  (Agent 9) — component plan
 *   2. Variable Designer AI  (Agent 10) — variable registry
 *   3. Asset Planner AI      (Agent 11) — asset placeholders
 *
 * Internal validation is applied before output is returned:
 *   - Duplicate component ID
 *   - Duplicate variable key
 *   - Component without section
 *   - Variable without component
 *   - Asset without component
 *   - Region outside canvas
 *   - Invalid asset dimensions
 *   - Required component without valid source
 *
 * This is NOT the final validator — Team 4 (Engineering Team) performs final QA.
 */

import { getProviderApiKey } from "../../../aiSecretService.js";
import { logger } from "../../../../lib/logger.js";
import { runComponentBuilderAgent } from "./componentBuilderAgent.js";
import { runVariableDesignerAgent } from "./variableDesignerAgent.js";
import { runAssetPlannerAgent } from "./assetPlannerAgent.js";
import type {
  ComponentTeamInput,
  ComponentTeamOutput,
  ComponentTeamValidationError,
  ComponentPlan,
  VariablePlan,
  AssetPlan,
} from "../../types/component-plan.types.js";

export { runComponentBuilderAgent } from "./componentBuilderAgent.js";
export { runVariableDesignerAgent } from "./variableDesignerAgent.js";
export { runAssetPlannerAgent } from "./assetPlannerAgent.js";
export type {
  ComponentTeamInput,
  ComponentTeamOutput,
  ComponentPlan,
  VariablePlan,
  AssetPlan,
} from "../../types/component-plan.types.js";

// ─── Internal validation ──────────────────────────────────────────────────────

function validateComponentTeamOutput(
  output: ComponentTeamOutput,
  input: ComponentTeamInput,
): ComponentTeamValidationError[] {
  const errs: ComponentTeamValidationError[] = [];
  const canvasW = input.design.canvasWidth;
  const canvasH = input.design.canvasHeight;
  const validSectionIds = new Set(input.design.sections.map((s) => s.id));

  const { components } = output.componentPlan;
  const { variables } = output.variablePlan;
  const { assets } = output.assetPlan;

  // 1. Duplicate component ID
  const compIdsSeen = new Set<string>();
  for (const c of components) {
    if (compIdsSeen.has(c.id)) {
      errs.push({ code: "DUPLICATE_COMPONENT_ID", message: `Duplicate component ID: "${c.id}"` });
    }
    compIdsSeen.add(c.id);
  }

  // 2. Duplicate variable key
  const varKeysSeen = new Set<string>();
  for (const v of variables) {
    if (varKeysSeen.has(v.key)) {
      errs.push({ code: "DUPLICATE_VARIABLE_KEY", message: `Duplicate variable key: "${v.key}"` });
    }
    varKeysSeen.add(v.key);
  }

  // 3. Component without valid section
  for (const c of components) {
    if (!validSectionIds.has(c.sectionId)) {
      errs.push({
        code: "COMPONENT_WITHOUT_SECTION",
        message: `Component "${c.id}" references unknown sectionId "${c.sectionId}"`,
        context: { validSectionIds: [...validSectionIds] },
      });
    }
  }

  // 4. Variable without any component
  for (const v of variables) {
    const referencedIds = v.usedByComponentIds.filter((id) => compIdsSeen.has(id));
    if (referencedIds.length === 0) {
      errs.push({
        code: "VARIABLE_WITHOUT_COMPONENT",
        message: `Variable "${v.key}" is not used by any valid component`,
      });
    }
  }

  // 5. Asset without a valid component
  for (const a of assets) {
    if (!compIdsSeen.has(a.componentId)) {
      errs.push({
        code: "ASSET_WITHOUT_COMPONENT",
        message: `Asset "${a.id}" references unknown componentId "${a.componentId}"`,
      });
    }
  }

  // 6. Region outside canvas bounds (allow x/y to be 0 or negative for bleed, but width/height must fit)
  for (const c of components) {
    const r = c.region;
    if (r.width <= 0 || r.height <= 0 || r.width > canvasW * 2 || r.height > canvasH * 2) {
      errs.push({
        code: "REGION_OUT_OF_CANVAS",
        message: `Component "${c.id}" has invalid region dimensions (${r.width}×${r.height}) for canvas ${canvasW}×${canvasH}`,
      });
    }
  }

  // 7. Invalid asset dimensions
  for (const a of assets) {
    if (a.dimensions.width <= 0 || a.dimensions.height <= 0) {
      errs.push({
        code: "INVALID_ASSET_DIMENSION",
        message: `Asset "${a.id}" has invalid dimensions (${a.dimensions.width}×${a.dimensions.height})`,
      });
    }
  }

  // 8. Required component without valid content source
  for (const c of components) {
    if (c.required && c.contentSource === "generated-placeholder" && !c.bindingKey) {
      errs.push({
        code: "REQUIRED_COMPONENT_WITHOUT_SOURCE",
        message: `Required component "${c.id}" uses "generated-placeholder" but has no bindingKey`,
      });
    }
  }

  return errs;
}

// ─── Pipeline entry point ─────────────────────────────────────────────────────

export async function runComponentPipeline(
  input: ComponentTeamInput,
): Promise<ComponentTeamOutput> {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) {
    throw new Error(
      "OpenAI API key not configured. Add an OpenAI provider with a valid API key in the AI registry.",
    );
  }

  const canvasW = input.design.canvasWidth;
  const canvasH = input.design.canvasHeight;

  logger.info({ canvasW, canvasH, sections: input.design.sections.length }, "[component-pipeline] Starting");

  // ── Step 1: Component Builder ──────────────────────────────────────────────
  const compResult = await runComponentBuilderAgent(input, apiKey);
  if (compResult.status === "failed" || !compResult.data) {
    throw new Error(
      `[component-pipeline] Agent 9 (Component Builder) failed: ${compResult.errors.join("; ")}`,
    );
  }
  const componentPlan: ComponentPlan = compResult.data;

  // ── Step 2: Variable Designer ──────────────────────────────────────────────
  const varResult = await runVariableDesignerAgent(input, componentPlan, apiKey);
  if (varResult.status === "failed" || !varResult.data) {
    throw new Error(
      `[component-pipeline] Agent 10 (Variable Designer) failed: ${varResult.errors.join("; ")}`,
    );
  }
  const variablePlan: VariablePlan = varResult.data;

  // ── Step 3: Asset Planner ──────────────────────────────────────────────────
  const assetResult = await runAssetPlannerAgent(componentPlan, canvasW, canvasH, apiKey);
  if (assetResult.status === "failed" || !assetResult.data) {
    throw new Error(
      `[component-pipeline] Agent 11 (Asset Planner) failed: ${assetResult.errors.join("; ")}`,
    );
  }
  const assetPlan: AssetPlan = assetResult.data;

  const output: ComponentTeamOutput = { componentPlan, variablePlan, assetPlan };

  // ── Internal validation ────────────────────────────────────────────────────
  const validationErrors = validateComponentTeamOutput(output, input);
  if (validationErrors.length > 0) {
    const allWarnings = [
      ...compResult.warnings,
      ...varResult.warnings,
      ...(assetResult.warnings ?? []),
      ...validationErrors.map((e) => `[${e.code}] ${e.message}`),
    ];
    logger.warn({ validationErrors }, "[component-pipeline] Internal validation warnings");
    // Validation errors are warnings at this stage (Team 4 does final QA)
    void allWarnings;
  }

  const totalTokens =
    (compResult.metadata.totalTokens ?? 0) +
    (varResult.metadata.totalTokens ?? 0) +
    (assetResult.metadata.totalTokens ?? 0);

  logger.info(
    {
      componentCount: componentPlan.components.length,
      variableCount: variablePlan.variables.length,
      assetCount: assetPlan.assets.length,
      totalTokens,
      validationIssues: validationErrors.length,
    },
    "[component-pipeline] Complete",
  );

  return output;
}
