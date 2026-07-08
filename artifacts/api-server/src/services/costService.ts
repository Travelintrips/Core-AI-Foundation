/**
 * costService.ts — Per-step AI cost recording and project budget queries.
 *
 * recordCost()      → inserts a row into ai_cost_records
 * getProjectCosts() → aggregates spend for a given project UUID
 */

import { eq, sum, count, sql } from "drizzle-orm";
import { db, aiCostRecordsTable } from "@workspace/db";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelPricing {
  costPerInputToken?: string | null;
  costPerOutputToken?: string | null;
}

export interface RecordCostParams {
  projectId: string;
  stepId: number;
  clientId: string;
  agentSlug: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  retryCount?: number;
  fallbackCount?: number;
  status: string;
  modelRecord?: ModelPricing;
}

export interface ProjectCosts {
  totalEstimatedCostUsd: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  recordCount: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_COST_PER_INPUT_TOKEN  = 0.0000025; // ~$2.50 / 1M
const DEFAULT_COST_PER_OUTPUT_TOKEN = 0.00001;   // ~$10   / 1M

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  pricing?: ModelPricing,
): number {
  const cIn  = pricing?.costPerInputToken  ? parseFloat(pricing.costPerInputToken)  : DEFAULT_COST_PER_INPUT_TOKEN;
  const cOut = pricing?.costPerOutputToken ? parseFloat(pricing.costPerOutputToken) : DEFAULT_COST_PER_OUTPUT_TOKEN;
  return inputTokens * cIn + outputTokens * cOut;
}

// ── recordCost ────────────────────────────────────────────────────────────────

export async function recordCost(params: RecordCostParams): Promise<void> {
  const {
    projectId, stepId, clientId, agentSlug,
    provider, model, inputTokens, outputTokens,
    latencyMs = 0, retryCount = 0, fallbackCount = 0,
    status, modelRecord,
  } = params;

  const totalTokens       = inputTokens + outputTokens;
  const estimatedCostUsd  = estimateCost(inputTokens, outputTokens, modelRecord);

  await db.insert(aiCostRecordsTable).values({
    projectId,
    stepId,
    clientId,
    agentSlug,
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: estimatedCostUsd.toFixed(8),
    latencyMs,
    retryCount,
    fallbackCount,
    status,
  } as unknown as typeof aiCostRecordsTable.$inferInsert);
}

// ── getProjectCosts ───────────────────────────────────────────────────────────

export async function getProjectCosts(projectId: string): Promise<ProjectCosts> {
  const [row] = await db
    .select({
      totalCost:   sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalInput:  sql<number>`coalesce(sum(input_tokens),  0)::int`,
      totalOutput: sql<number>`coalesce(sum(output_tokens), 0)::int`,
      recordCount: count(),
    })
    .from(aiCostRecordsTable)
    .where(eq(aiCostRecordsTable.projectId, projectId));

  return {
    totalEstimatedCostUsd: row ? Number(row.totalCost) : 0,
    totalTokens:           row ? Number(row.totalTokens) : 0,
    totalInputTokens:      row ? Number(row.totalInput) : 0,
    totalOutputTokens:     row ? Number(row.totalOutput) : 0,
    recordCount:           row ? Number(row.recordCount) : 0,
  };
}
