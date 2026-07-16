/**
 * Agent 11 — Asset Planner AI
 *
 * Responsibilities:
 *   - Identify every component that needs a real or uploaded asset
 *   - Define placeholder metadata: type, dimensions, aspect ratio, crop focus,
 *     accepted MIME types, and visual upload guidance
 *   - NEVER generate image URLs, base64, logos, or call any image generation API
 *
 * Architecture rules (Master Rule):
 *   - Single responsibility — only plans asset requirements
 *   - Dependency-injected apiKey; no hard-coded provider
 *   - Records latency, token usage, model, retry count, errors
 *   - Does not mutate previous agent outputs; returns a new object
 */

import OpenAI from "openai";
import { logger } from "../../../../lib/logger.js";
import {
  buildAssetPlannerSystemPrompt,
  buildAssetPlannerUserPrompt,
} from "../../prompts/components/asset-planner.prompt.js";
import { assetPlanSchema } from "../../schemas/components/assetPlannerSchema.js";
import type {
  AgentOutput,
  AssetPlan,
  ComponentPlan,
} from "../../types/component-plan.types.js";

export const AGENT_ID = "asset-planner-ai";
export const AGENT_NAME = "Asset Planner AI";
export const AGENT_VERSION = "1.0.0";
const MAX_REPAIR_ATTEMPTS = 2;
const DEFAULT_MODEL = "gpt-4o";

export async function runAssetPlannerAgent(
  componentPlan: ComponentPlan,
  canvasW: number,
  canvasH: number,
  apiKey: string,
  model: string = DEFAULT_MODEL,
): Promise<AgentOutput<AssetPlan>> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Short-circuit: no asset components → skip AI call
  const assetComponents = componentPlan.components.filter(
    (c) => c.contentSource === "asset" || c.contentSource === "generated-placeholder",
  );

  if (assetComponents.length === 0) {
    const completedAt = new Date().toISOString();
    logger.info(`[${AGENT_ID}] No asset components found — skipping`);
    return {
      status: "skipped",
      data: { assets: [] },
      warnings: [],
      errors: [],
      metadata: {
        agentId: AGENT_ID,
        agentName: AGENT_NAME,
        agentVersion: AGENT_VERSION,
        model,
        startedAt,
        completedAt,
        latencyMs: Date.now() - startTime,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        retryCount: 0,
      },
    };
  }

  const client = new OpenAI({ apiKey });
  const systemPrompt = buildAssetPlannerSystemPrompt();
  const userPrompt = buildAssetPlannerUserPrompt(componentPlan, canvasW, canvasH);

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
        temperature: 0.3,
        max_tokens: 2048,
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

      const result = assetPlanSchema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.warn({ attempt, error: lastError }, `[${AGENT_ID}] Validation failed, retrying`);
        continue;
      }

      // Post-parse: warn on references to non-existent component IDs
      for (const asset of result.data.assets) {
        if (!componentIds.has(asset.componentId)) {
          warnings.push(
            `Asset "${asset.id}" references unknown componentId "${asset.componentId}"`,
          );
        }
      }

      const completedAt = new Date().toISOString();

      logger.info(
        { assetCount: result.data.assets.length, retryCount, inputTokens, outputTokens },
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
  const errorMessage = `Asset Planner failed after ${MAX_REPAIR_ATTEMPTS + 1} attempts: ${String(lastError)}`;
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
