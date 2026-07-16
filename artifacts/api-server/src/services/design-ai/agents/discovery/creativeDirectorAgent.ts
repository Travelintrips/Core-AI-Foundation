/**
 * Agent 1 — Creative Director AI
 *
 * Responsibility: translate a raw user prompt into a structured CreativeBrief.
 *
 * Contract:
 *   Input  → { userPrompt: string; modelConfig?: AgentModelConfig }
 *   Output → AgentOutput<CreativeBrief>
 *
 * Rules (MASTER RULE):
 *   - Single responsibility: brief extraction only
 *   - No layout, no font names, no hex colours, no Konva JSON
 *   - Never fabricate business facts
 *   - Supports dependency injection for AI model
 *   - Records latency, token usage, retries
 *   - Returns a new output object — never mutates input
 */

import { executeAI } from "../../../aiExecutionService.js";
import { creativeBriefSchema } from "../../schemas/discovery/creativeBrief.schema.js";
import {
  buildCreativeDirectorSystemPrompt,
  buildCreativeDirectorUserPrompt,
} from "../../prompts/discovery/creative-director.prompt.js";
import {
  DEFAULT_MODEL_CONFIG,
  type AgentModelConfig,
  type AgentOutput,
  type CreativeBrief,
} from "../../types/discovery.types.js";

// ── Agent identity ────────────────────────────────────────────────────────────

const AGENT_ID = "discovery-creative-director";
const AGENT_NAME = "Creative Director AI";
const AGENT_VERSION = "1.0.0";

// ── Input / Output types ──────────────────────────────────────────────────────

export interface CreativeDirectorInput {
  userPrompt: string;
  modelConfig?: AgentModelConfig;
}

// ── Implementation ────────────────────────────────────────────────────────────

export async function runCreativeDirectorAgent(
  input: CreativeDirectorInput,
): Promise<AgentOutput<CreativeBrief>> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const config = input.modelConfig ?? DEFAULT_MODEL_CONFIG;
  const maxRetries = config.maxRetries ?? 2;

  const warnings: string[] = [];
  const errors: string[] = [];

  let retryCount = 0;
  let lastError: string | null = null;
  let result: { content: string; promptTokens: number; completionTokens: number; latencyMs: number } | null = null;

  const systemPrompt = buildCreativeDirectorSystemPrompt();
  const userPrompt = buildCreativeDirectorUserPrompt(input.userPrompt);

  // ── Retry loop ──────────────────────────────────────────────────────────────
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

  // ── AI provider failure ─────────────────────────────────────────────────────
  if (!result) {
    errors.push(`AI provider failed after ${retryCount} attempt(s): ${lastError}`);
    return { status: "failed", data: null, warnings, errors, metadata };
  }

  // ── Parse JSON ──────────────────────────────────────────────────────────────
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

  // ── Schema validation ───────────────────────────────────────────────────────
  const validated = creativeBriefSchema.safeParse(parsed);
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
    data: validated.data as CreativeBrief,
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
