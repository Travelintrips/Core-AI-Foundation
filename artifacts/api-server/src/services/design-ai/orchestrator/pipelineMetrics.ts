/**
 * Pipeline Metrics — aggregates token usage, cost, latency, and retries
 * across all agent executions in a single pipeline run.
 *
 * Rules:
 *  - Uses observabilityService's DEFAULT_PRICING as cost reference
 *  - If model price is unknown, cost is 0 with a warning (never fabricated)
 *  - One pipeline run → one pipelineRunId → one set of aggregated metrics
 *  - Does not call recordCost() here — that is the orchestrator's responsibility
 */

import type { AgentExecutionMetadata } from "../types/discovery.types.js";
import type { PipelineAgentMetric, PipelineMetrics } from "../types/orchestrator.types.js";

// Default pricing per 1M tokens (matches observabilityService defaults)
const DEFAULT_COST_PER_INPUT_TOKEN  = 2.50 / 1_000_000;   // $2.50 / 1M
const DEFAULT_COST_PER_OUTPUT_TOKEN = 10.00 / 1_000_000;  // $10.00 / 1M

/** Estimate cost for a single agent execution. Returns 0 if tokens unknown. */
function estimateAgentCost(inputTokens: number, outputTokens: number): number {
  return (
    inputTokens  * DEFAULT_COST_PER_INPUT_TOKEN +
    outputTokens * DEFAULT_COST_PER_OUTPUT_TOKEN
  );
}

export interface AgentMetricInput {
  metadata: AgentExecutionMetadata;
  status: "success" | "failed" | "skipped";
}

export function buildAgentMetric(input: AgentMetricInput): PipelineAgentMetric {
  const { metadata, status } = input;
  const inputTokens  = metadata.inputTokens  ?? 0;
  const outputTokens = metadata.outputTokens ?? 0;
  const totalTokens  = inputTokens + outputTokens;
  const estimatedCost = estimateAgentCost(inputTokens, outputTokens);

  return {
    agentId:       metadata.agentId,
    agentName:     metadata.agentName,
    model:         metadata.model,
    latencyMs:     metadata.latencyMs,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    retryCount:    metadata.retryCount,
    status,
  };
}

export function aggregateMetrics(agents: PipelineAgentMetric[]): PipelineMetrics {
  const totalLatencyMs      = agents.reduce((s, a) => s + a.latencyMs, 0);
  const totalInputTokens    = agents.reduce((s, a) => s + a.inputTokens, 0);
  const totalOutputTokens   = agents.reduce((s, a) => s + a.outputTokens, 0);
  const totalTokens         = totalInputTokens + totalOutputTokens;
  const estimatedCost       = agents.reduce((s, a) => s + a.estimatedCost, 0);
  const totalRetries        = agents.reduce((s, a) => s + a.retryCount, 0);

  return {
    totalLatencyMs,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    estimatedCost,
    totalRetries,
    agents,
  };
}

export function emptyMetrics(): PipelineMetrics {
  return {
    totalLatencyMs:    0,
    totalInputTokens:  0,
    totalOutputTokens: 0,
    totalTokens:       0,
    estimatedCost:     0,
    totalRetries:      0,
    agents:            [],
  };
}
