/**
 * Agent 2 — Requirement Analyst AI
 *
 * Responsibility: extract all design requirements from the user prompt + Creative Brief.
 *
 * Contract:
 *   Input  → { userPrompt: string; creativeBrief: CreativeBrief; modelConfig?: AgentModelConfig }
 *   Output → AgentOutput<RequirementAnalysis>
 *
 * Rules (MASTER RULE):
 *   - Never guess canvas dimensions without evidence from prompt or preset registry
 *   - Distinguish explicit vs inferred requirements
 *   - Detect and surface requirement conflicts
 *   - Returns a new output object — never mutates input
 */

import { executeAI } from "../../../aiExecutionService.js";
import { requirementAnalysisSchema } from "../../schemas/discovery/requirementAnalysis.schema.js";
import {
  buildRequirementAnalystSystemPrompt,
  buildRequirementAnalystUserPrompt,
} from "../../prompts/discovery/requirement-analyst.prompt.js";
import {
  DEFAULT_MODEL_CONFIG,
  type AgentModelConfig,
  type AgentOutput,
  type CreativeBrief,
  type RequirementAnalysis,
} from "../../types/discovery.types.js";

// ── Agent identity ────────────────────────────────────────────────────────────

const AGENT_ID = "discovery-requirement-analyst";
const AGENT_NAME = "Requirement Analyst AI";
const AGENT_VERSION = "1.0.0";

// ── Input / Output types ──────────────────────────────────────────────────────

export interface RequirementAnalystInput {
  userPrompt: string;
  creativeBrief: CreativeBrief;
  modelConfig?: AgentModelConfig;
}

// ── Implementation ────────────────────────────────────────────────────────────

export async function runRequirementAnalystAgent(
  input: RequirementAnalystInput,
): Promise<AgentOutput<RequirementAnalysis>> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const config = input.modelConfig ?? DEFAULT_MODEL_CONFIG;
  const maxRetries = config.maxRetries ?? 2;

  const warnings: string[] = [];
  const errors: string[] = [];

  let retryCount = 0;
  let lastError: string | null = null;
  let result: { content: string; promptTokens: number; completionTokens: number; latencyMs: number } | null = null;

  const systemPrompt = buildRequirementAnalystSystemPrompt();
  const userPrompt = buildRequirementAnalystUserPrompt(input.userPrompt, input.creativeBrief);

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

  const validated = requirementAnalysisSchema.safeParse(parsed);
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

  // ── Warn on detected conflicts ──────────────────────────────────────────────
  const data = validated.data as RequirementAnalysis;
  if (data.conflicts.length > 0) {
    for (const c of data.conflicts) {
      warnings.push(
        `Requirement conflict: "${c.requirementA}" vs "${c.requirementB}"` +
          (c.resolution ? ` → Resolution: ${c.resolution}` : " → Unresolved"),
      );
    }
  }

  return {
    status: "success",
    data,
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
