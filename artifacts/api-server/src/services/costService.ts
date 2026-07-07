/**
 * costService — records and aggregates AI execution costs.
 *
 * Cost is estimated from model token pricing:
 *   estimated_cost = (input_tokens * cost_per_input) + (output_tokens * cost_per_output)
 *
 * Records are written per-request and can be queried per:
 *   project, workflow, client, agent, provider
 */

import { eq, and, sql, sum, avg, count, desc } from "drizzle-orm";
import { db, aiCostRecordsTable, aiModelsTable } from "@workspace/db";
import type { InsertAiCostRecord } from "@workspace/db";

// ── Cost estimation ───────────────────────────────────────────────────────────

/** Estimate USD cost for a request given model pricing. */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: { costPerInputToken?: string | null; costPerOutputToken?: string | null },
): number {
  const inputRate = model.costPerInputToken ? parseFloat(model.costPerInputToken) : 0;
  const outputRate = model.costPerOutputToken ? parseFloat(model.costPerOutputToken) : 0;
  return inputTokens * inputRate + outputTokens * outputRate;
}

// ── Record ────────────────────────────────────────────────────────────────────

export type CostRecordInput = {
  projectId?: string;
  stepId?: number;
  workflowId?: number;
  clientId?: string;
  agentSlug?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  retryCount?: number;
  fallbackCount?: number;
  status?: "success" | "failed" | "partial";
  // Optionally pass model DB record for cost estimation
  modelRecord?: { costPerInputToken?: string | null; costPerOutputToken?: string | null };
};

export async function recordCost(input: CostRecordInput): Promise<void> {
  const totalTokens = input.inputTokens + input.outputTokens;
  const estimated = input.modelRecord
    ? estimateCost(input.inputTokens, input.outputTokens, input.modelRecord)
    : 0;

  const record: InsertAiCostRecord = {
    projectId: input.projectId ?? null,
    stepId: input.stepId ?? null,
    workflowId: input.workflowId ?? null,
    clientId: input.clientId ?? null,
    agentSlug: input.agentSlug ?? null,
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens,
    estimatedCostUsd: estimated > 0 ? String(estimated.toFixed(8)) : null,
    actualCostUsd: null, // actual cost requires provider billing API — set to null
    latencyMs: input.latencyMs ?? null,
    retryCount: input.retryCount ?? 0,
    fallbackCount: input.fallbackCount ?? 0,
    status: input.status ?? "success",
  };

  await db.insert(aiCostRecordsTable).values(record);
}

// ── Aggregation queries ───────────────────────────────────────────────────────

export interface CostSummary {
  totalRequests: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number | null;
  totalRetries: number;
  totalFallbacks: number;
  successRate: number;
}

export async function getProjectCosts(projectId: string): Promise<CostSummary> {
  const [row] = await db
    .select({
      totalRequests: count(),
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalCost: sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
      avgLatency: avg(aiCostRecordsTable.latencyMs),
      totalRetries: sql<number>`coalesce(sum(retry_count), 0)::int`,
      totalFallbacks: sql<number>`coalesce(sum(fallback_count), 0)::int`,
      successCount: sql<number>`count(*) filter (where status = 'success')::int`,
    })
    .from(aiCostRecordsTable)
    .where(eq(aiCostRecordsTable.projectId, projectId));

  const total = row?.totalRequests ?? 0;
  return {
    totalRequests: total,
    totalTokens: row?.totalTokens ?? 0,
    totalEstimatedCostUsd: row?.totalCost != null ? Number(row.totalCost) : 0,
    avgLatencyMs: row?.avgLatency != null ? Number(row.avgLatency) : null,
    totalRetries: row?.totalRetries ?? 0,
    totalFallbacks: row?.totalFallbacks ?? 0,
    successRate: total > 0 ? (row?.successCount ?? 0) / total : 0,
  };
}

export interface AgentCostStats {
  agentSlug: string;
  totalRequests: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number | null;
  successRate: number;
}

export async function getAgentCostStats(days = 30): Promise<AgentCostStats[]> {
  const rows = await db
    .select({
      agentSlug: aiCostRecordsTable.agentSlug,
      totalRequests: count(),
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalCost: sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
      avgLatency: avg(aiCostRecordsTable.latencyMs),
      successCount: sql<number>`count(*) filter (where status = 'success')::int`,
    })
    .from(aiCostRecordsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .groupBy(aiCostRecordsTable.agentSlug)
    .orderBy(desc(sql`sum(estimated_cost_usd::numeric)`));

  return rows
    .filter((r) => r.agentSlug != null)
    .map((r) => ({
      agentSlug: r.agentSlug!,
      totalRequests: r.totalRequests,
      totalTokens: r.totalTokens,
      totalEstimatedCostUsd: r.totalCost != null ? Number(r.totalCost) : 0,
      avgLatencyMs: r.avgLatency != null ? Number(r.avgLatency) : null,
      successRate: r.totalRequests > 0 ? (r.successCount ?? 0) / r.totalRequests : 0,
    }));
}

export interface ProviderCostStats {
  provider: string;
  totalRequests: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number | null;
}

export async function getProviderCostStats(days = 30): Promise<ProviderCostStats[]> {
  const rows = await db
    .select({
      provider: aiCostRecordsTable.provider,
      totalRequests: count(),
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalCost: sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
      avgLatency: avg(aiCostRecordsTable.latencyMs),
    })
    .from(aiCostRecordsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .groupBy(aiCostRecordsTable.provider)
    .orderBy(desc(sql`sum(estimated_cost_usd::numeric)`));

  return rows.map((r) => ({
    provider: r.provider,
    totalRequests: r.totalRequests,
    totalTokens: r.totalTokens,
    totalEstimatedCostUsd: r.totalCost != null ? Number(r.totalCost) : 0,
    avgLatencyMs: r.avgLatency != null ? Number(r.avgLatency) : null,
  }));
}

export interface DailyCostPoint {
  date: string;
  totalRequests: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number | null;
}

export async function getDailyCosts(days = 14): Promise<DailyCostPoint[]> {
  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', created_at)::date::text`,
      totalRequests: count(),
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalCost: sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
      avgLatency: avg(aiCostRecordsTable.latencyMs),
    })
    .from(aiCostRecordsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .groupBy(sql`date_trunc('day', created_at)`)
    .orderBy(sql`date_trunc('day', created_at)`);

  return rows.map((r) => ({
    date: r.date,
    totalRequests: r.totalRequests,
    totalTokens: r.totalTokens,
    totalEstimatedCostUsd: r.totalCost != null ? Number(r.totalCost) : 0,
    avgLatencyMs: r.avgLatency != null ? Number(r.avgLatency) : null,
  }));
}
