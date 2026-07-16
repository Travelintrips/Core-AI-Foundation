/**
 * Agent 10 — Variable Designer AI
 *
 * Responsibilities:
 *   - Identify all editable text/data fields in a component plan
 *   - Build a variable registry with types, defaults, validation, and formatting
 *   - Map every variable to the component IDs that use it
 *   - Never produce duplicate variable keys
 *
 * Architecture rules (Master Rule):
 *   - Single responsibility — only designs the variable registry
 *   - Dependency-injected apiKey; no hard-coded provider
 *   - Records latency, token usage, model, retry count, errors
 *   - Does not mutate the component plan; returns a new object
 */

import OpenAI from "openai";
import { logger } from "../../../../lib/logger.js";
import {
  buildVariableDesignerSystemPrompt,
  buildVariableDesignerUserPrompt,
} from "../../prompts/components/variable-designer.prompt.js";
import { variablePlanSchema } from "../../schemas/components/variableDesignerSchema.js";
import type {
  AgentOutput,
  ComponentPlan,
  ComponentTeamInput,
  VariablePlan,
} from "../../types/component-plan.types.js";

export const AGENT_ID = "variable-designer-ai";
export const AGENT_NAME = "Variable Designer AI";
export const AGENT_VERSION = "1.0.0";
const MAX_REPAIR_ATTEMPTS = 2;
const DEFAULT_MODEL = "gpt-4o";

export async function runVariableDesignerAgent(
  input: ComponentTeamInput,
  componentPlan: ComponentPlan,
  apiKey: string,
  model: string = DEFAULT_MODEL,
): Promise<AgentOutput<VariablePlan>> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const client = new OpenAI({ apiKey });
  const systemPrompt = buildVariableDesignerSystemPrompt();
  const userPrompt = buildVariableDesignerUserPrompt(input, componentPlan);

  const warnings: string[] = [];
  const errors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let retryCount = 0;
  let lastError: unknown;

  const componentIds = new Set(componentPlan.components.map((c) => c.id));

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    if (attempt > 0) retryCount++;

    try {
      const repairNote =
        attempt > 0
          ? `\n\nPrevious attempt failed validation: ${String(lastError)}. Fix and return valid JSON only.`
          : "";

      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt + repairNote },
        ],
        temperature: 0.4,
        max_tokens: 3072,
      });

      inputTokens = completion.usage?.prompt_tokens ?? 0;
      outputTokens = completion.usage?.completion_tokens ?? 0;

      const raw = completion.choices[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        lastError = "AI response was not valid JSON";
        logger.warn({ attempt }, `[${AGENT_ID}] JSON parse failed, retrying`);
        continue;
      }

      const result = variablePlanSchema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.warn({ attempt, error: lastError }, `[${AGENT_ID}] Validation failed, retrying`);
        continue;
      }

      // Post-parse: warn on references to non-existent component IDs
      for (const variable of result.data.variables) {
        for (const cid of variable.usedByComponentIds) {
          if (!componentIds.has(cid)) {
            warnings.push(
              `Variable "${variable.key}" references unknown componentId "${cid}"`,
            );
          }
        }
      }

      // Post-parse: warn on components that declare a bindingKey but no variable covers them
      const variableKeys = new Set(result.data.variables.map((v) => v.key));
      for (const comp of componentPlan.components) {
        if (comp.bindingKey && !variableKeys.has(comp.bindingKey)) {
          warnings.push(
            `Component "${comp.id}" bindingKey "${comp.bindingKey}" has no matching variable`,
          );
        }
      }

      const completedAt = new Date().toISOString();

      logger.info(
        { variableCount: result.data.variables.length, retryCount, inputTokens, outputTokens },
        `[${AGENT_ID}] Completed`,
      );

      return {
        status: "success",
        data: result.data,
        warnings,
        errors,
        metadata: {
          agentId: AGENT_ID,
          agentName: AGENT_NAME,
          agentVersion: AGENT_VERSION,
          model,
          startedAt,
          completedAt,
          latencyMs: Date.now() - startTime,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          retryCount,
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, err }, `[${AGENT_ID}] AI call failed`);
    }
  }

  const completedAt = new Date().toISOString();
  const errorMessage = `Variable Designer failed after ${MAX_REPAIR_ATTEMPTS + 1} attempts: ${String(lastError)}`;
  errors.push(errorMessage);
  logger.error({ errors }, `[${AGENT_ID}] All attempts exhausted`);

  return {
    status: "failed",
    data: null,
    warnings,
    errors,
    metadata: {
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      agentVersion: AGENT_VERSION,
      model,
      startedAt,
      completedAt,
      latencyMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      retryCount,
    },
  };
}
