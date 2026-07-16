/**
 * Shared agent runner utility — Design Team (Team 2).
 *
 * Provides the retry loop, JSON extraction, and AgentOutput assembly so each
 * agent focuses purely on its prompt and post-processing logic.
 */

import type { ExecutionInput, ExecutionOutput } from "../../aiExecutionService.js";
import type {
  AgentExecutionMetadata,
  AgentOutput,
  ModelConfig,
} from "../types/design.types.js";
import type { ZodSchema } from "zod";

export type ExecuteAIFn = (input: ExecutionInput) => Promise<ExecutionOutput>;

const MAX_RETRIES = 2;

/** Strip markdown code fences (```json … ``` or ``` … ```) from AI response. */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return raw.trim();
}

export interface RunAgentOptions<T> {
  agentId: string;
  agentName: string;
  agentVersion: string;
  systemPrompt: string;
  userPrompt: string;
  schema: ZodSchema<T>;
  modelConfig: ModelConfig;
  executeAI: ExecuteAIFn;
}

/**
 * Execute an agent call with up to MAX_RETRIES retries on JSON parse or
 * schema validation failure. Returns a fully-formed AgentOutput<T>.
 */
export async function runAgent<T>(opts: RunAgentOptions<T>): Promise<AgentOutput<T>> {
  const startedAt = new Date();
  const warnings: string[] = [];
  const errors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalLatencyMs = 0;
  let retryCount = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    retryCount = attempt;
    const attemptStart = Date.now();

    try {
      const result = await opts.executeAI({
        prompt: opts.userPrompt,
        systemPrompt: opts.systemPrompt,
        model: {
          modelId: opts.modelConfig.model.modelId,
          maxOutputTokens: opts.modelConfig.model.maxOutputTokens,
        },
        provider: {
          slug: opts.modelConfig.provider.slug,
          baseUrl: opts.modelConfig.provider.baseUrl,
        },
        temperature: opts.modelConfig.temperature,
        maxTokens: opts.modelConfig.maxTokens,
      });

      totalLatencyMs += Date.now() - attemptStart;
      inputTokens += result.promptTokens;
      outputTokens += result.completionTokens;

      // ── Parse ──────────────────────────────────────────────────────────────
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(result.content));
      } catch {
        const msg = "AI response was not valid JSON";
        if (attempt < MAX_RETRIES) {
          warnings.push(`Attempt ${attempt + 1}: ${msg}. Retrying.`);
          continue;
        }
        errors.push(`${msg} after ${attempt + 1} attempts.`);
        break;
      }

      // ── Validate ───────────────────────────────────────────────────────────
      const validated = opts.schema.safeParse(parsed);
      if (!validated.success) {
        const msg = validated.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        if (attempt < MAX_RETRIES) {
          warnings.push(`Attempt ${attempt + 1}: schema validation failed — ${msg}. Retrying.`);
          continue;
        }
        errors.push(`Schema validation failed after ${attempt + 1} attempts: ${msg}`);
        break;
      }

      // ── Success ────────────────────────────────────────────────────────────
      const meta: AgentExecutionMetadata = {
        agentId: opts.agentId,
        agentName: opts.agentName,
        agentVersion: opts.agentVersion,
        model: opts.modelConfig.model.modelId,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs: totalLatencyMs,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        retryCount,
      };

      return {
        status: "success",
        data: validated.data,
        warnings,
        errors: [],
        metadata: meta,
      };
    } catch (err) {
      totalLatencyMs += Date.now() - attemptStart;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        warnings.push(`Attempt ${attempt + 1}: ${msg}. Retrying.`);
      } else {
        errors.push(`Failed after ${attempt + 1} attempts: ${msg}`);
      }
    }
  }

  // ── All retries exhausted ──────────────────────────────────────────────────
  return {
    status: "failed",
    data: null,
    warnings,
    errors,
    metadata: {
      agentId: opts.agentId,
      agentName: opts.agentName,
      agentVersion: opts.agentVersion,
      model: opts.modelConfig.model.modelId,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      latencyMs: totalLatencyMs,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      retryCount,
    },
  };
}
