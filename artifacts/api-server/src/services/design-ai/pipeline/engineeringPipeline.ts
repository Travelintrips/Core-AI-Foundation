/**
 * Engineering Pipeline
 *
 * Orchestrates Agents 12 → 13 → 14 → 13 (validate again after optimize).
 *
 * Flow:
 *   1. JSON Architect AI  → assemble initial DesignTemplate
 *   2. Validator AI        → validate initial template
 *   3. Optimizer AI        → apply safe structural fixes
 *   4. Validator AI        → re-validate optimized template
 *
 * The pipeline fails fast if the Architect fails (no template to validate).
 * A failed validation does NOT stop the pipeline — the report is forwarded
 * to the Optimizer which filters fixable vs unfixable issues.
 *
 * Observability: all agent metadata (latency, tokens, retry) is recorded.
 */

import { logger } from "../../../lib/logger.js";
import type {
  EngineeringTeamInput,
  EngineeringPipelineOutput,
  ModelProvider,
} from "../types/engineering.types.js";
import { runJsonArchitectAgent } from "../agents/engineering/jsonArchitectAgent.js";
import { runValidatorAgent }     from "../agents/engineering/validatorAgent.js";
import { runOptimizerAgent }     from "../agents/engineering/optimizerAgent.js";

export interface EngineeringPipelineOptions {
  tenantId: string;
  actorId: string;
  templateId?: string;
  /** Inject model provider for tests */
  modelProvider?: ModelProvider;
}

export async function runEngineeringPipeline(
  input: EngineeringTeamInput,
  opts: EngineeringPipelineOptions,
): Promise<EngineeringPipelineOutput> {
  const pipelineStart = Date.now();

  // ── Step 1: JSON Architect ────────────────────────────────────────────────
  logger.info("[engineering-pipeline] Step 1: JSON Architect AI");
  const architectResult = await runJsonArchitectAgent(input, {
    tenantId:      opts.tenantId,
    actorId:       opts.actorId,
    templateId:    opts.templateId,
    modelProvider: opts.modelProvider,
  });

  if (architectResult.status !== "success" || !architectResult.data) {
    throw new Error(
      `[engineering-pipeline] JSON Architect failed: ${architectResult.errors.join("; ")}`,
    );
  }

  const initialTemplate = architectResult.data;

  // ── Step 2: Initial Validation ───────────────────────────────────────────
  logger.info("[engineering-pipeline] Step 2: Validator AI (initial)");
  const initialValidationResult = await runValidatorAgent(initialTemplate);

  if (initialValidationResult.status !== "success" || !initialValidationResult.data) {
    throw new Error(
      `[engineering-pipeline] Initial Validator failed unexpectedly: ${initialValidationResult.errors.join("; ")}`,
    );
  }
  const initialValidation = initialValidationResult.data;

  // ── Step 3: Optimizer ─────────────────────────────────────────────────────
  logger.info("[engineering-pipeline] Step 3: Optimizer AI");
  const optimizerResult = await runOptimizerAgent(initialTemplate, initialValidation);

  if (optimizerResult.status !== "success" || !optimizerResult.data) {
    throw new Error(
      `[engineering-pipeline] Optimizer failed: ${optimizerResult.errors.join("; ")}`,
    );
  }

  const optimizationResult = optimizerResult.data;
  const optimizedTemplate  = optimizationResult.template;

  // ── Step 4: Re-validate optimized template ───────────────────────────────
  logger.info("[engineering-pipeline] Step 4: Validator AI (post-optimize)");
  const finalValidationResult = await runValidatorAgent(optimizedTemplate);

  if (finalValidationResult.status !== "success" || !finalValidationResult.data) {
    throw new Error(
      `[engineering-pipeline] Final Validator failed unexpectedly: ${finalValidationResult.errors.join("; ")}`,
    );
  }
  const finalValidation = finalValidationResult.data;

  logger.info(
    {
      templateId:         initialTemplate.id,
      pipelineMs:         Date.now() - pipelineStart,
      initialScore:       initialValidation.score,
      finalScore:         finalValidation.score,
      optimizationCount:  optimizationResult.changes.length,
      unresolvedIssues:   optimizationResult.unresolvedIssues.length,
    },
    "[engineering-pipeline] Pipeline complete",
  );

  return {
    initialTemplate,
    initialValidation,
    optimizedTemplate,
    finalValidation,
    optimizationChanges: optimizationResult.changes,
  };
}
