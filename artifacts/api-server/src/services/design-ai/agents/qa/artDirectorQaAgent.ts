/**
 * Agent 15 — Art Director QA AI
 *
 * Responsibility: evaluate the optimized template and produce a structured QA report.
 *
 * Contract:
 *   Input  → ArtDirectorQaInput
 *   Output → AgentOutput<ArtDirectorQaReport>
 *
 * Rules (MASTER RULE):
 *   - Single responsibility: evaluation and reporting only
 *   - NEVER modifies the template, nodes, bindings, or validation results
 *   - Supports dependency injection for AI model
 *   - Records latency, token usage, retries
 *   - Returns a new output object — never mutates input
 */

import { executeAI } from "../../../aiExecutionService.js";
import { artDirectorQaReportSchema } from "../../schemas/qa/art-director-report.schema.js";
import { buildQaSystemPrompt, buildQaUserPrompt } from "../../prompts/qa/art-director-qa.prompt.js";
import {
  DEFAULT_MODEL_CONFIG,
  type AgentOutput,
} from "../../types/discovery.types.js";
import type { ArtDirectorQaInput, ArtDirectorQaReport } from "../../types/qa.types.js";

// ── Agent identity ─────────────────────────────────────────────────────────────

const AGENT_ID = "qa-art-director";
const AGENT_NAME = "Art Director QA AI";
const AGENT_VERSION = "1.0.0";

// ── Implementation ────────────────────────────────────────────────────────────

export async function runArtDirectorQaAgent(
  input: ArtDirectorQaInput,
): Promise<AgentOutput<ArtDirectorQaReport>> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const config = input.modelConfig ?? DEFAULT_MODEL_CONFIG;
  const maxRetries = config.maxRetries ?? 2;

  const warnings: string[] = [];
  const errors: string[] = [];

  // Warn if engineering validation already failed — QA still runs but gate will block
  if (!input.engineering.finalValidation.passed) {
    warnings.push(
      "Engineering validation did not pass — QA will complete but deterministic gate will block publish.",
    );
  }
  if (input.engineering.finalValidation.errors.length > 0) {
    warnings.push(
      `Engineering has ${input.engineering.finalValidation.errors.length} validation error(s): ` +
        input.engineering.finalValidation.errors.slice(0, 3).join("; "),
    );
  }

  let retryCount = 0;
  let lastError: string | null = null;
  let aiResult: {
    content: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
  } | null = null;

  const systemPrompt = buildQaSystemPrompt();
  const userPrompt = buildQaUserPrompt(input);

  // ── Retry loop ──────────────────────────────────────────────────────────────
  while (retryCount <= maxRetries) {
    try {
      const out = await executeAI({
        prompt: userPrompt,
        systemPrompt,
        model: config.model,
        provider: config.provider,
        temperature: config.temperature ?? 0.2, // Lower temperature for evaluation
        maxTokens: config.model.maxOutputTokens ?? 4096,
      });

      aiResult = {
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
  if (!aiResult) {
    errors.push(`AI provider failed after ${retryCount} attempt(s): ${lastError}`);
    return { status: "failed", data: null, warnings, errors, metadata };
  }

  // ── Parse JSON ──────────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    const cleaned = aiResult.content.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    errors.push(`AI returned invalid JSON: ${aiResult.content.slice(0, 200)}`);
    return {
      status: "failed",
      data: null,
      warnings,
      errors,
      metadata: {
        ...metadata,
        inputTokens: aiResult.promptTokens,
        outputTokens: aiResult.completionTokens,
        totalTokens: aiResult.promptTokens + aiResult.completionTokens,
      },
    };
  }

  // ── Schema validation ───────────────────────────────────────────────────────
  const validated = artDirectorQaReportSchema.safeParse(parsed);
  if (!validated.success) {
    errors.push(`Schema validation failed: ${validated.error.message}`);
    return {
      status: "failed",
      data: null,
      warnings,
      errors,
      metadata: {
        ...metadata,
        inputTokens: aiResult.promptTokens,
        outputTokens: aiResult.completionTokens,
        totalTokens: aiResult.promptTokens + aiResult.completionTokens,
      },
    };
  }

  // ── Safety: ensure QA never claims a score ≥ 90 with blocking issues ───────
  const raw = validated.data;
  const adjustedWarnings = [...warnings];
  if (raw.overallScore >= 90 && raw.blockingIssues.length > 0) {
    adjustedWarnings.push(
      `QA AI reported overallScore=${raw.overallScore} with ${raw.blockingIssues.length} blocking issue(s). ` +
        "Deterministic gate will prevent publish regardless.",
    );
  }

  const report: ArtDirectorQaReport = {
    ...raw,
    warnings: [...raw.warnings, ...adjustedWarnings],
    metadata: {
      ...metadata,
      inputTokens: aiResult.promptTokens,
      outputTokens: aiResult.completionTokens,
      totalTokens: aiResult.promptTokens + aiResult.completionTokens,
    },
  };

  return {
    status: "success",
    data: report,
    warnings: adjustedWarnings,
    errors,
    metadata: report.metadata,
  };
}
