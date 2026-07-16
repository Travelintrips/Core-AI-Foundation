/**
 * Agent 3 — Brand Strategist AI
 *
 * Responsibility: define visual identity direction from Creative Brief + Requirement Analysis.
 *
 * Contract:
 *   Input  → { creativeBrief; requirementAnalysis; brandProfile?; modelConfig? }
 *   Output → AgentOutput<BrandStrategy>
 *
 * Rules (MASTER RULE):
 *   - Use existing brand profile when provided — never override it with invented values
 *   - Provide directional guidance only (no hex values, no specific font names)
 *   - Returns a new output object — never mutates input
 */

import { executeAI } from "../../../aiExecutionService.js";
import { brandStrategySchema } from "../../schemas/discovery/brandStrategy.schema.js";
import {
  buildBrandStrategistSystemPrompt,
  buildBrandStrategistUserPrompt,
} from "../../prompts/discovery/brand-strategist.prompt.js";
import {
  DEFAULT_MODEL_CONFIG,
  type AgentModelConfig,
  type AgentOutput,
  type BrandStrategy,
  type CreativeBrief,
  type RequirementAnalysis,
} from "../../types/discovery.types.js";

// ── Agent identity ────────────────────────────────────────────────────────────

const AGENT_ID = "discovery-brand-strategist";
const AGENT_NAME = "Brand Strategist AI";
const AGENT_VERSION = "1.0.0";

// ── Input / Output types ──────────────────────────────────────────────────────

export interface BrandStrategistInput {
  creativeBrief: CreativeBrief;
  requirementAnalysis: RequirementAnalysis;
  /** Optional: existing brand profile from the system. When present it is authoritative. */
  brandProfile?: Record<string, unknown>;
  modelConfig?: AgentModelConfig;
}

// ── Implementation ────────────────────────────────────────────────────────────

export async function runBrandStrategistAgent(
  input: BrandStrategistInput,
): Promise<AgentOutput<BrandStrategy>> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const config = input.modelConfig ?? DEFAULT_MODEL_CONFIG;
  const maxRetries = config.maxRetries ?? 2;

  const warnings: string[] = [];
  const errors: string[] = [];

  if (!input.brandProfile) {
    warnings.push("No brand profile provided — all brand decisions are assumptions based on the brief.");
  }

  let retryCount = 0;
  let lastError: string | null = null;
  let result: { content: string; promptTokens: number; completionTokens: number; latencyMs: number } | null = null;

  const systemPrompt = buildBrandStrategistSystemPrompt();
  const userPrompt = buildBrandStrategistUserPrompt(
    input.creativeBrief,
    input.requirementAnalysis,
    input.brandProfile,
  );

  while (retryCount <= maxRetries) {
    try {
      const out = await executeAI({
        prompt: userPrompt,
        systemPrompt,
        model: config.model,
        provider: config.provider,
        temperature: config.temperature ?? 0.3,
        maxTokens: config.model.maxOutputTokens ?? 4096,
      });

      result = {
        content: out.content,
        promptTokens: out.promptTokens,
        completionTokens: out.completionTokens,
        latencyMs: out.latencyMs,
      };
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      retryCount++;
      if (retryCount > maxRetries) break;
      warnings.push(`Retry ${retryCount}/${maxRetries} after error: ${lastError}`);
    }
  }

  const completedAt = new Date().toISOString();
  const latencyMs = Date.now() - startMs;

  const metadata = {
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    model: config.model.modelId,
    startedAt,
    completedAt,
    latencyMs,
    retryCount,
  };

  if (!result) {
    errors.push(`AI provider failed after ${retryCount} attempt(s): ${lastError}`);
    return { status: "failed", data: null, warnings, errors, metadata };
  }

  let parsed: unknown;
  try {
    const cleaned = result.content.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    errors.push(`AI returned invalid JSON: ${result.content.slice(0, 200)}`);
    return {
      status: "failed",
      data: null,
      warnings,
      errors,
      metadata: {
        ...metadata,
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        totalTokens: result.promptTokens + result.completionTokens,
      },
    };
  }

  const validated = brandStrategySchema.safeParse(parsed);
  if (!validated.success) {
    errors.push(`Schema validation failed: ${validated.error.message}`);
    return {
      status: "failed",
      data: null,
      warnings,
      errors,
      metadata: {
        ...metadata,
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        totalTokens: result.promptTokens + result.completionTokens,
      },
    };
  }

  return {
    status: "success",
    data: validated.data as BrandStrategy,
    warnings,
    errors,
    metadata: {
      ...metadata,
      inputTokens: result.promptTokens,
      outputTokens: result.completionTokens,
      totalTokens: result.promptTokens + result.completionTokens,
    },
  };
}
