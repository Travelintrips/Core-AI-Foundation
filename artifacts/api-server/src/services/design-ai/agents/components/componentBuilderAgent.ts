/**
 * Agent 9 — Component Builder AI
 *
 * Responsibilities:
 *   - Produce a list of logical components from discovery + design specs
 *   - Map each component to a section, type, region, layer role, and content source
 *   - Never produce Konva final nodes
 *
 * Architecture rules (Master Rule):
 *   - Single responsibility — only builds component plans
 *   - Accepts structured JSON input, returns structured JSON output
 *   - No hard-coded AI provider — uses dependency-injected apiKey
 *   - Records latency, token usage, model, retry count, and errors
 *   - Never mutates the input; returns a new object at each stage
 */

import OpenAI from "openai";
import { logger } from "../../../../lib/logger.js";
import {
  buildComponentBuilderSystemPrompt,
  buildComponentBuilderUserPrompt,
} from "../../prompts/components/component-builder.prompt.js";
import { componentPlanSchema } from "../../schemas/components/componentBuilderSchema.js";
import type {
  AgentOutput,
  ComponentPlan,
  ComponentTeamInput,
} from "../../types/component-plan.types.js";

export const AGENT_ID = "component-builder-ai";
export const AGENT_NAME = "Component Builder AI";
export const AGENT_VERSION = "1.0.0";
const MAX_REPAIR_ATTEMPTS = 2;
const DEFAULT_MODEL = "gpt-4o";

export async function runComponentBuilderAgent(
  input: ComponentTeamInput,
  apiKey: string,
  model: string = DEFAULT_MODEL,
): Promise<AgentOutput<ComponentPlan>> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  const canvasW = input.design.canvasWidth;
  const canvasH = input.design.canvasHeight;

  const client = new OpenAI({ apiKey });
  const systemPrompt = buildComponentBuilderSystemPrompt();
  const userPrompt = buildComponentBuilderUserPrompt(input, canvasW, canvasH);

  const warnings: string[] = [];
  const errors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let retryCount = 0;
  let lastError: unknown;

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
        temperature: 0.5,
        max_tokens: 4096,
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

      const result = componentPlanSchema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.warn({ attempt, error: lastError }, `[${AGENT_ID}] Validation failed, retrying`);
        continue;
      }

      const completedAt = new Date().toISOString();

      // Warn on any components that reference sections not in the design spec
      const validSectionIds = new Set(input.design.sections.map((s) => s.id));
      for (const comp of result.data.components) {
        if (!validSectionIds.has(comp.sectionId)) {
          warnings.push(`Component "${comp.id}" references unknown sectionId "${comp.sectionId}"`);
        }
      }

      logger.info(
        { componentCount: result.data.components.length, retryCount, inputTokens, outputTokens },
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
  const errorMessage = `Component Builder failed after ${MAX_REPAIR_ATTEMPTS + 1} attempts: ${String(lastError)}`;
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
