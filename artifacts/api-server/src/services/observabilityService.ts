/**
 * observabilityService — AI Observability & Cost Intelligence
 *
 * logExecutionSafe()      → fire-and-forget: writes one row to ai_execution_logs
 * finalizeWorkflowCost()  → aggregates all logs for a job/workflow into ai_workflow_costs
 * ensureTables()          → idempotent DDL: creates the 3 observability tables if absent
 * getPricingForModel()    → looks up ai_provider_pricing; falls back to hardcoded defaults
 *
 * SAFETY RULE: every public function wraps its body in try/catch and never throws.
 * Callers use fire-and-forget (no await) so observability can never break AI execution.
 */

import { eq, and, sql, desc, asc, count, sum, avg, inArray } from "drizzle-orm";
import {
  db,
  aiExecutionLogsTable,
  aiWorkflowCostsTable,
  aiProviderPricingTable,
} from "@workspace/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ObservabilityContext {
  /** Source of the execution */
  jobId?: number | null;
  workflowId?: number | null;
  orderId?: string | null;
  companyId?: string | null;
  conversationId?: string | null;

  /** Agent that triggered this call */
  agentId?: number | null;
  agentName?: string | null;

  /** Provider/model IDs from the registry */
  providerId?: number | null;
  providerName?: string | null;
  modelId?: number | null;
  modelName?: string | null;

  requestType?: string; // "text" | "image" | "embedding"
  createdBy?: string;
}

export interface ExecutionLogInput extends ObservabilityContext {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  latencyMs: number;
  startedAt?: Date;
  finishedAt?: Date;
  status: "success" | "failed" | "timeout" | "retried";
  errorMessage?: string | null;
  retryCount?: number;
}

// ── Default pricing (fallback when ai_provider_pricing has no row) ─────────────

const DEFAULT_PRICING: Record<string, { in: number; out: number }> = {
  "openai/gpt-4o":                { in: 2.50,  out: 10.00 },
  "openai/gpt-4o-mini":           { in: 0.15,  out: 0.60 },
  "openai/gpt-4-turbo":           { in: 10.00, out: 30.00 },
  "openai/gpt-3.5-turbo":         { in: 0.50,  out: 1.50 },
  "anthropic/claude-3-5-sonnet":  { in: 3.00,  out: 15.00 },
  "anthropic/claude-3-haiku":     { in: 0.25,  out: 1.25 },
  "anthropic/claude-3-opus":      { in: 15.00, out: 75.00 },
  "google/gemini-1.5-pro":        { in: 1.25,  out: 5.00 },
  "google/gemini-1.5-flash":      { in: 0.075, out: 0.30 },
  "mistral/mistral-large-latest": { in: 2.00,  out: 6.00 },
  "mistral/mistral-small-latest": { in: 0.20,  out: 0.60 },
};

function getDefaultPricing(provider: string, model: string) {
  const exact = DEFAULT_PRICING[`${provider}/${model}`];
  if (exact) return exact;
  // Prefix match
  const prefix = Object.keys(DEFAULT_PRICING).find(
    (k) => k.startsWith(`${provider}/`) && model.includes(k.split("/")[1]),
  );
  return prefix ? DEFAULT_PRICING[prefix] : { in: 2.50, out: 10.00 };
}

// ── Cost calculation ──────────────────────────────────────────────────────────

export async function getPricingForModel(
  provider: string,
  model: string,
): Promise<{ inputPer1m: number; outputPer1m: number; cachedPer1m: number | null; reasoningPer1m: number | null }> {
  try {
    // Exact match first; then prefix
    const rows = await db
      .select()
      .from(aiProviderPricingTable)
      .where(and(eq(aiProviderPricingTable.provider, provider), eq(aiProviderPricingTable.active, true)))
      .orderBy(desc(aiProviderPricingTable.effectiveDate));

    const row = rows.find((r) => r.model === model || model.startsWith(r.model) || r.model.startsWith(model));
    if (row) {
      return {
        inputPer1m:    Number(row.inputPricePer1m),
        outputPer1m:   Number(row.outputPricePer1m),
        cachedPer1m:   row.cachedInputPrice  ? Number(row.cachedInputPrice)  : null,
        reasoningPer1m: row.reasoningPrice   ? Number(row.reasoningPrice)    : null,
      };
    }
  } catch {
    // Fall through to defaults
  }
  const def = getDefaultPricing(provider, model);
  return { inputPer1m: def.in, outputPer1m: def.out, cachedPer1m: null, reasoningPer1m: null };
}

function calculateCost(
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number,
  reasoningTokens: number,
  pricing: { inputPer1m: number; outputPer1m: number; cachedPer1m: number | null; reasoningPer1m: number | null },
): number {
  const promptCost = (promptTokens / 1_000_000) * pricing.inputPer1m;
  const completionCost = (completionTokens / 1_000_000) * pricing.outputPer1m;
  const cachedCost = cachedTokens > 0 && pricing.cachedPer1m != null
    ? (cachedTokens / 1_000_000) * pricing.cachedPer1m
    : 0;
  const reasoningCost = reasoningTokens > 0 && pricing.reasoningPer1m != null
    ? (reasoningTokens / 1_000_000) * pricing.reasoningPer1m
    : 0;
  return promptCost + completionCost + cachedCost + reasoningCost;
}

// ── logExecutionSafe ──────────────────────────────────────────────────────────

/**
 * Fire-and-forget: write one row to ai_execution_logs.
 * Always returns void and never throws — safe to call without await.
 */
export function logExecutionSafe(input: ExecutionLogInput): void {
  void (async () => {
    try {
      const providerName = input.providerName ?? "";
      const modelName    = input.modelName    ?? "";
      const pricing      = await getPricingForModel(providerName, modelName);
      const cached       = input.cachedTokens    ?? 0;
      const reasoning    = input.reasoningTokens ?? 0;
      const totalTokens  = input.promptTokens + input.completionTokens + cached + reasoning;
      const costUsd      = calculateCost(
        input.promptTokens, input.completionTokens, cached, reasoning, pricing,
      );

      await db.insert(aiExecutionLogsTable).values({
        companyId:        input.companyId    ?? null,
        workflowId:       input.workflowId   ?? null,
        jobId:            input.jobId        ?? null,
        orderId:          input.orderId      ?? null,
        conversationId:   input.conversationId ?? null,
        agentId:          input.agentId      ?? null,
        agentName:        input.agentName    ?? null,
        providerId:       input.providerId   ?? null,
        providerName:     providerName       || null,
        modelId:          input.modelId      ?? null,
        modelName:        modelName          || null,
        requestType:      input.requestType  ?? "text",
        promptTokens:     input.promptTokens,
        completionTokens: input.completionTokens,
        cachedTokens:     cached,
        reasoningTokens:  reasoning,
        totalTokens,
        estimatedCostUsd: costUsd.toFixed(8),
        currency:         "USD",
        latencyMs:        input.latencyMs,
        startedAt:        input.startedAt  ?? null,
        finishedAt:       input.finishedAt ?? null,
        status:           input.status,
        errorMessage:     input.errorMessage ?? null,
        retryCount:       input.retryCount   ?? 0,
        createdBy:        input.createdBy    ?? null,
      });
    } catch {
      // Intentionally silent — observability must never break callers
    }
  })();
}

// ── finalizeWorkflowCost ──────────────────────────────────────────────────────

/**
 * Aggregate all ai_execution_logs rows for a given job/workflow into one
 * ai_workflow_costs row. Call this once after a workflow/job fully completes.
 * Safe to fire-and-forget — never throws.
 */
export async function finalizeWorkflowCost(opts: {
  jobId?: number | null;
  workflowId?: number | null;
  orderId?: string | null;
  companyId?: string | null;
  processingTimeMs?: number | null;
}): Promise<void> {
  try {
    const conditions = [];
    if (opts.jobId)      conditions.push(eq(aiExecutionLogsTable.jobId,      opts.jobId));
    if (opts.workflowId) conditions.push(eq(aiExecutionLogsTable.workflowId, opts.workflowId));
    if (opts.orderId)    conditions.push(eq(aiExecutionLogsTable.orderId,     opts.orderId));
    if (conditions.length === 0) return;

    const [agg] = await db
      .select({
        totalAgents:           count(sql`DISTINCT ${aiExecutionLogsTable.agentName}`),
        totalPromptTokens:     sum(aiExecutionLogsTable.promptTokens),
        totalCompletionTokens: sum(aiExecutionLogsTable.completionTokens),
        totalTokens:           sum(aiExecutionLogsTable.totalTokens),
        totalCostUsd:          sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`),
      })
      .from(aiExecutionLogsTable)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions));

    if (!agg) return;

    await db.insert(aiWorkflowCostsTable).values({
      workflowId:            opts.workflowId  ?? null,
      jobId:                 opts.jobId       ?? null,
      orderId:               opts.orderId     ?? null,
      companyId:             opts.companyId   ?? null,
      totalAgents:           Number(agg.totalAgents)           || 0,
      totalPromptTokens:     Number(agg.totalPromptTokens)     || 0,
      totalCompletionTokens: Number(agg.totalCompletionTokens) || 0,
      totalTokens:           Number(agg.totalTokens)           || 0,
      totalCostUsd:          agg.totalCostUsd != null ? String(Number(agg.totalCostUsd).toFixed(8)) : null,
      processingTimeMs:      opts.processingTimeMs ?? null,
    });
  } catch {
    // Silent — never break callers
  }
}

// ── ensureTables ──────────────────────────────────────────────────────────────

/**
 * Idempotent DDL: create the 3 observability tables if they don't exist yet.
 * Called once at server startup. Never throws.
 */
export async function ensureObservabilityTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_execution_logs (
        id                 serial PRIMARY KEY,
        company_id         text,
        workflow_id        integer,
        job_id             integer,
        order_id           text,
        conversation_id    text,
        agent_id           integer,
        agent_name         text,
        provider_id        integer,
        provider_name      text,
        model_id           integer,
        model_name         text,
        request_type       text NOT NULL DEFAULT 'text',
        prompt_tokens      integer NOT NULL DEFAULT 0,
        completion_tokens  integer NOT NULL DEFAULT 0,
        cached_tokens      integer NOT NULL DEFAULT 0,
        reasoning_tokens   integer NOT NULL DEFAULT 0,
        total_tokens       integer NOT NULL DEFAULT 0,
        estimated_cost_usd numeric(14,8),
        currency           text NOT NULL DEFAULT 'USD',
        latency_ms         integer,
        started_at         timestamptz,
        finished_at        timestamptz,
        status             text NOT NULL DEFAULT 'success',
        error_message      text,
        retry_count        integer NOT NULL DEFAULT 0,
        created_by         text,
        created_at         timestamptz NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_workflow_costs (
        id                      serial PRIMARY KEY,
        workflow_id             integer,
        job_id                  integer,
        order_id                text,
        company_id              text,
        total_agents            integer NOT NULL DEFAULT 0,
        total_prompt_tokens     integer NOT NULL DEFAULT 0,
        total_completion_tokens integer NOT NULL DEFAULT 0,
        total_tokens            integer NOT NULL DEFAULT 0,
        total_cost_usd          numeric(14,8),
        processing_time_ms      integer,
        created_at              timestamptz NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_provider_pricing (
        id                   serial PRIMARY KEY,
        provider             text NOT NULL,
        model                text NOT NULL,
        input_price_per_1m   numeric(12,6) NOT NULL DEFAULT 2.50,
        output_price_per_1m  numeric(12,6) NOT NULL DEFAULT 10.00,
        cached_input_price   numeric(12,6),
        reasoning_price      numeric(12,6),
        currency             text NOT NULL DEFAULT 'USD',
        effective_date       date,
        active               boolean NOT NULL DEFAULT true,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Indexes (IF NOT EXISTS keeps it safe to re-run)
    const idxQueries = [
      `CREATE INDEX IF NOT EXISTS ai_execution_logs_job_id_idx        ON ai_platform.ai_execution_logs (job_id)`,
      `CREATE INDEX IF NOT EXISTS ai_execution_logs_workflow_id_idx   ON ai_platform.ai_execution_logs (workflow_id)`,
      `CREATE INDEX IF NOT EXISTS ai_execution_logs_created_at_idx    ON ai_platform.ai_execution_logs (created_at)`,
      `CREATE INDEX IF NOT EXISTS ai_execution_logs_provider_name_idx ON ai_platform.ai_execution_logs (provider_name)`,
      `CREATE INDEX IF NOT EXISTS ai_execution_logs_agent_name_idx    ON ai_platform.ai_execution_logs (agent_name)`,
      `CREATE INDEX IF NOT EXISTS ai_workflow_costs_workflow_id_idx   ON ai_platform.ai_workflow_costs (workflow_id)`,
      `CREATE INDEX IF NOT EXISTS ai_workflow_costs_order_id_idx      ON ai_platform.ai_workflow_costs (order_id)`,
      `CREATE INDEX IF NOT EXISTS ai_workflow_costs_created_at_idx    ON ai_platform.ai_workflow_costs (created_at)`,
      `CREATE INDEX IF NOT EXISTS ai_provider_pricing_provider_model_idx ON ai_platform.ai_provider_pricing (provider, model)`,
      `CREATE INDEX IF NOT EXISTS ai_provider_pricing_active_idx         ON ai_platform.ai_provider_pricing (active)`,
    ];
    for (const q of idxQueries) {
      await db.execute(sql.raw(q)).catch(() => {});
    }
  } catch {
    // Silent — startup should not be blocked by observability
  }
}

// ── Query helpers (used by the API route) ─────────────────────────────────────

export interface ExecutionLogFilters {
  provider?: string;
  agent?: string;
  status?: string;
  jobId?: number;
  workflowId?: number;
  orderId?: string;
  limit?: number;
  offset?: number;
}

export async function listExecutionLogs(filters: ExecutionLogFilters = {}) {
  const { limit = 50, offset = 0 } = filters;

  const rows = await db
    .select()
    .from(aiExecutionLogsTable)
    .where(
      and(
        filters.provider   ? eq(aiExecutionLogsTable.providerName, filters.provider) : undefined,
        filters.agent      ? eq(aiExecutionLogsTable.agentName,    filters.agent)    : undefined,
        filters.status     ? eq(aiExecutionLogsTable.status,       filters.status)   : undefined,
        filters.jobId      ? eq(aiExecutionLogsTable.jobId,        filters.jobId)    : undefined,
        filters.workflowId ? eq(aiExecutionLogsTable.workflowId,   filters.workflowId) : undefined,
        filters.orderId    ? eq(aiExecutionLogsTable.orderId,      filters.orderId)  : undefined,
      ),
    )
    .orderBy(desc(aiExecutionLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(aiExecutionLogsTable);

  return { items: rows, total: Number(total) };
}

export async function getCostSummary() {
  // Overall totals
  const [totals] = await db
    .select({
      totalCalls:    count(),
      totalTokens:   sum(aiExecutionLogsTable.totalTokens),
      totalCostUsd:  sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`),
      avgLatencyMs:  avg(aiExecutionLogsTable.latencyMs),
      errorCount:    sum(sql<number>`CASE WHEN ${aiExecutionLogsTable.status} = 'failed' THEN 1 ELSE 0 END`),
    })
    .from(aiExecutionLogsTable);

  // By provider
  const byProvider = await db
    .select({
      provider:     aiExecutionLogsTable.providerName,
      calls:        count(),
      totalTokens:  sum(aiExecutionLogsTable.totalTokens),
      totalCostUsd: sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`),
      avgLatencyMs: avg(aiExecutionLogsTable.latencyMs),
    })
    .from(aiExecutionLogsTable)
    .groupBy(aiExecutionLogsTable.providerName)
    .orderBy(desc(sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`)));

  // By model
  const byModel = await db
    .select({
      model:        aiExecutionLogsTable.modelName,
      provider:     aiExecutionLogsTable.providerName,
      calls:        count(),
      totalTokens:  sum(aiExecutionLogsTable.totalTokens),
      totalCostUsd: sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`),
    })
    .from(aiExecutionLogsTable)
    .groupBy(aiExecutionLogsTable.modelName, aiExecutionLogsTable.providerName)
    .orderBy(desc(sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`)));

  // By agent
  const byAgent = await db
    .select({
      agent:        aiExecutionLogsTable.agentName,
      calls:        count(),
      totalTokens:  sum(aiExecutionLogsTable.totalTokens),
      totalCostUsd: sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`),
      avgLatencyMs: avg(aiExecutionLogsTable.latencyMs),
    })
    .from(aiExecutionLogsTable)
    .groupBy(aiExecutionLogsTable.agentName)
    .orderBy(desc(sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`)));

  // By order
  const byOrder = await db
    .select({
      orderId:      aiExecutionLogsTable.orderId,
      calls:        count(),
      totalCostUsd: sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`),
      totalTokens:  sum(aiExecutionLogsTable.totalTokens),
    })
    .from(aiExecutionLogsTable)
    .where(sql`${aiExecutionLogsTable.orderId} IS NOT NULL`)
    .groupBy(aiExecutionLogsTable.orderId)
    .orderBy(desc(sum(sql<number>`${aiExecutionLogsTable.estimatedCostUsd}::numeric`)))
    .limit(20);

  return {
    totals: {
      calls:       Number(totals?.totalCalls)   || 0,
      tokens:      Number(totals?.totalTokens)  || 0,
      costUsd:     Number(totals?.totalCostUsd) || 0,
      avgLatencyMs: totals?.avgLatencyMs != null ? Math.round(Number(totals.avgLatencyMs)) : 0,
      errorCount:  Number(totals?.errorCount)   || 0,
    },
    byProvider: byProvider.map((r) => ({ ...r, calls: Number(r.calls), totalTokens: Number(r.totalTokens), totalCostUsd: Number(r.totalCostUsd) || 0, avgLatencyMs: r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : 0 })),
    byModel:    byModel.map((r)    => ({ ...r, calls: Number(r.calls), totalTokens: Number(r.totalTokens), totalCostUsd: Number(r.totalCostUsd) || 0 })),
    byAgent:    byAgent.map((r)    => ({ ...r, calls: Number(r.calls), totalTokens: Number(r.totalTokens), totalCostUsd: Number(r.totalCostUsd) || 0, avgLatencyMs: r.avgLatencyMs != null ? Math.round(Number(r.avgLatencyMs)) : 0 })),
    byOrder:    byOrder.map((r)    => ({ ...r, calls: Number(r.calls), totalTokens: Number(r.totalTokens), totalCostUsd: Number(r.totalCostUsd) || 0 })),
  };
}

export async function listWorkflowCosts(limit = 50, offset = 0) {
  const rows = await db
    .select()
    .from(aiWorkflowCostsTable)
    .orderBy(desc(aiWorkflowCostsTable.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(aiWorkflowCostsTable);
  return { items: rows, total: Number(total) };
}

export async function listProviderPricing() {
  return db.select().from(aiProviderPricingTable).orderBy(asc(aiProviderPricingTable.provider), asc(aiProviderPricingTable.model));
}

export async function upsertProviderPricing(data: {
  provider: string;
  model: string;
  inputPricePer1m: number;
  outputPricePer1m: number;
  cachedInputPrice?: number | null;
  reasoningPrice?: number | null;
  effectiveDate?: string | null;
  active?: boolean;
}) {
  const existing = await db
    .select()
    .from(aiProviderPricingTable)
    .where(and(eq(aiProviderPricingTable.provider, data.provider), eq(aiProviderPricingTable.model, data.model)));

  if (existing.length > 0) {
    const [updated] = await db
      .update(aiProviderPricingTable)
      .set({
        inputPricePer1m:  String(data.inputPricePer1m),
        outputPricePer1m: String(data.outputPricePer1m),
        cachedInputPrice: data.cachedInputPrice != null ? String(data.cachedInputPrice) : null,
        reasoningPrice:   data.reasoningPrice   != null ? String(data.reasoningPrice)   : null,
        effectiveDate:    data.effectiveDate    ?? null,
        active:           data.active           ?? true,
        updatedAt:        new Date(),
      })
      .where(eq(aiProviderPricingTable.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(aiProviderPricingTable)
    .values({
      provider:         data.provider,
      model:            data.model,
      inputPricePer1m:  String(data.inputPricePer1m),
      outputPricePer1m: String(data.outputPricePer1m),
      cachedInputPrice: data.cachedInputPrice != null ? String(data.cachedInputPrice) : null,
      reasoningPrice:   data.reasoningPrice   != null ? String(data.reasoningPrice)   : null,
      effectiveDate:    data.effectiveDate    ?? null,
      active:           data.active           ?? true,
    })
    .returning();
  return created;
}

export async function updateProviderPricing(id: number, data: Partial<{
  inputPricePer1m: number;
  outputPricePer1m: number;
  cachedInputPrice: number | null;
  reasoningPrice: number | null;
  active: boolean;
  effectiveDate: string | null;
}>) {
  const [updated] = await db
    .update(aiProviderPricingTable)
    .set({
      ...(data.inputPricePer1m  !== undefined && { inputPricePer1m:  String(data.inputPricePer1m) }),
      ...(data.outputPricePer1m !== undefined && { outputPricePer1m: String(data.outputPricePer1m) }),
      ...(data.cachedInputPrice !== undefined && { cachedInputPrice: data.cachedInputPrice != null ? String(data.cachedInputPrice) : null }),
      ...(data.reasoningPrice   !== undefined && { reasoningPrice:   data.reasoningPrice   != null ? String(data.reasoningPrice)   : null }),
      ...(data.active           !== undefined && { active: data.active }),
      ...(data.effectiveDate    !== undefined && { effectiveDate: data.effectiveDate }),
      updatedAt: new Date(),
    })
    .where(eq(aiProviderPricingTable.id, id))
    .returning();
  return updated;
}

/** Seed default pricing rows for all well-known models. Idempotent. */
export async function seedDefaultPricing(): Promise<number> {
  const defaults = [
    { provider: "openai",    model: "gpt-4o",                         inputPricePer1m: 2.50,  outputPricePer1m: 10.00, cachedInputPrice: 1.25 },
    { provider: "openai",    model: "gpt-4o-mini",                    inputPricePer1m: 0.15,  outputPricePer1m: 0.60,  cachedInputPrice: 0.075 },
    { provider: "openai",    model: "gpt-4-turbo",                    inputPricePer1m: 10.00, outputPricePer1m: 30.00  },
    { provider: "openai",    model: "gpt-3.5-turbo",                  inputPricePer1m: 0.50,  outputPricePer1m: 1.50   },
    { provider: "openai",    model: "o1",                             inputPricePer1m: 15.00, outputPricePer1m: 60.00, cachedInputPrice: 7.50 },
    { provider: "openai",    model: "o1-mini",                        inputPricePer1m: 3.00,  outputPricePer1m: 12.00, cachedInputPrice: 1.50 },
    { provider: "openai",    model: "o3-mini",                        inputPricePer1m: 1.10,  outputPricePer1m: 4.40,  cachedInputPrice: 0.55 },
    { provider: "anthropic", model: "claude-3-5-sonnet-20241022",     inputPricePer1m: 3.00,  outputPricePer1m: 15.00, cachedInputPrice: 1.50 },
    { provider: "anthropic", model: "claude-3-5-haiku-20241022",      inputPricePer1m: 0.80,  outputPricePer1m: 4.00,  cachedInputPrice: 0.40 },
    { provider: "anthropic", model: "claude-3-opus-20240229",         inputPricePer1m: 15.00, outputPricePer1m: 75.00, cachedInputPrice: 7.50 },
    { provider: "anthropic", model: "claude-3-sonnet-20240229",       inputPricePer1m: 3.00,  outputPricePer1m: 15.00  },
    { provider: "anthropic", model: "claude-3-haiku-20240307",        inputPricePer1m: 0.25,  outputPricePer1m: 1.25   },
    { provider: "google",    model: "gemini-1.5-pro",                 inputPricePer1m: 1.25,  outputPricePer1m: 5.00   },
    { provider: "google",    model: "gemini-1.5-flash",               inputPricePer1m: 0.075, outputPricePer1m: 0.30   },
    { provider: "google",    model: "gemini-2.0-flash",               inputPricePer1m: 0.10,  outputPricePer1m: 0.40   },
    { provider: "mistral",   model: "mistral-large-latest",           inputPricePer1m: 2.00,  outputPricePer1m: 6.00   },
    { provider: "mistral",   model: "mistral-small-latest",           inputPricePer1m: 0.20,  outputPricePer1m: 0.60   },
    { provider: "mistral",   model: "open-mistral-7b",                inputPricePer1m: 0.25,  outputPricePer1m: 0.25   },
    { provider: "replicate", model: "black-forest-labs/flux-1.1-pro", inputPricePer1m: 0.00,  outputPricePer1m: 0.00   },
  ];

  let inserted = 0;
  for (const row of defaults) {
    const existing = await db
      .select({ id: aiProviderPricingTable.id })
      .from(aiProviderPricingTable)
      .where(and(eq(aiProviderPricingTable.provider, row.provider), eq(aiProviderPricingTable.model, row.model)));
    if (existing.length === 0) {
      await db.insert(aiProviderPricingTable).values({
        provider:         row.provider,
        model:            row.model,
        inputPricePer1m:  String(row.inputPricePer1m),
        outputPricePer1m: String(row.outputPricePer1m),
        cachedInputPrice: row.cachedInputPrice != null ? String(row.cachedInputPrice) : null,
      });
      inserted++;
    }
  }
  return inserted;
}
