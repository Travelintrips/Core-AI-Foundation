/**
 * analytics.ts — Analytics API routes (Phase 4.5 version)
 *
 * Routes:
 *   GET /ai/analytics/overview          — platform-wide KPI summary
 *   GET /ai/analytics/usage             — daily token/request trend (from cost records)
 *   GET /ai/analytics/provider-breakdown — per-provider token & cost share
 *   GET /ai/analytics/agent-stats        — per-agent performance table
 *   GET /ai/analytics/export/csv         — CSV export of cost records
 */

import { Router } from "express";
import { sql, avg, count, desc } from "drizzle-orm";
import {
  db,
  aiProvidersTable,
  aiModelsTable,
  aiWorkflowsTable,
  aiPromptsTable,
  aiKnowledgeBasesTable,
  aiMemoryTable,
  aiWorkflowExecutionsTable,
  aiCostRecordsTable,
  aiAgentsTable,
} from "@workspace/db";
import {
  GetAnalyticsOverviewResponse,
  GetAnalyticsUsageQueryParams,
  GetAnalyticsUsageResponse,
  GetProviderBreakdownResponse,
} from "@workspace/api-zod";

const router = Router();

function parseDays(raw: unknown, defaultDays = 14): number {
  const n = parseInt(String(raw ?? defaultDays), 10);
  if (isNaN(n) || n < 1) return defaultDays;
  return Math.min(n, 365);
}

// ── Overview ──────────────────────────────────────────────────────────────────

router.get("/ai/analytics/overview", async (_req, res): Promise<void> => {
  const [
    [{ totalProviders }],
    [{ totalModels }],
    [{ totalWorkflows }],
    [{ totalPrompts }],
    [{ totalKnowledgeBases }],
    [{ totalMemoryEntries }],
    [{ totalExecutions }],
    [{ activeWorkflows }],
    [costTotals],
  ] = await Promise.all([
    db.select({ totalProviders:    sql<number>`count(*)::int` }).from(aiProvidersTable),
    db.select({ totalModels:       sql<number>`count(*)::int` }).from(aiModelsTable),
    db.select({ totalWorkflows:    sql<number>`count(*)::int` }).from(aiWorkflowsTable),
    db.select({ totalPrompts:      sql<number>`count(*)::int` }).from(aiPromptsTable),
    db.select({ totalKnowledgeBases: sql<number>`count(*)::int` }).from(aiKnowledgeBasesTable),
    db.select({ totalMemoryEntries:  sql<number>`count(*)::int` }).from(aiMemoryTable),
    db.select({ totalExecutions:   sql<number>`count(*)::int` }).from(aiWorkflowExecutionsTable),
    db.select({ activeWorkflows:   sql<number>`count(*)::int` }).from(aiWorkflowsTable).where(sql`status = 'active'`),
    db.select({
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalCost:   sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
    }).from(aiCostRecordsTable),
  ]);

  const [{ agentCount }] = await db
    .select({ agentCount: sql<number>`count(*)::int` })
    .from(aiAgentsTable);

  const [avgLatencyRow] = await db
    .select({ avg: avg(aiCostRecordsTable.latencyMs) })
    .from(aiCostRecordsTable)
    .where(sql`status = 'success'`);

  const [successRow] = await db
    .select({ success: sql<number>`count(*)::int` })
    .from(aiWorkflowExecutionsTable)
    .where(sql`status = 'completed'`);

  const successRate = totalExecutions > 0
    ? (successRow.success / totalExecutions) * 100
    : null;

  res.json(
    GetAnalyticsOverviewResponse.parse({
      totalProviders,
      totalModels,
      totalWorkflows,
      totalPrompts,
      totalKnowledgeBases,
      totalMemoryEntries,
      totalTokensUsed: costTotals?.totalTokens ?? 0,
      totalExecutions,
      activeWorkflows,
      avgLatencyMs: avgLatencyRow?.avg != null ? Number(avgLatencyRow.avg) : null,
      successRate,
      // Extra fields (ignored by Zod parse if not in schema, safe)
      totalAgents:   agentCount,
      totalCostUsd:  costTotals?.totalCost != null ? Number(costTotals.totalCost) : 0,
    }),
  );
});

// ── Usage trend ───────────────────────────────────────────────────────────────

router.get("/ai/analytics/usage", async (req, res): Promise<void> => {
  const queryParse = GetAnalyticsUsageQueryParams.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: queryParse.error.message });
    return;
  }
  const days = parseDays(queryParse.data.days);

  // Use cost records for token and request counts by day
  const costRows = await db
    .select({
      date:         sql<string>`date_trunc('day', created_at)::date::text`,
      executions:   sql<number>`count(*)::int`,
      tokensUsed:   sql<number>`coalesce(sum(total_tokens), 0)::int`,
      avgLatencyMs: avg(aiCostRecordsTable.latencyMs),
    })
    .from(aiCostRecordsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .groupBy(sql`date_trunc('day', created_at)`)
    .orderBy(sql`date_trunc('day', created_at)`);

  const result = costRows.map((r) => ({
    date:         r.date,
    executions:   r.executions,
    tokensUsed:   r.tokensUsed,
    avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
  }));

  res.json(GetAnalyticsUsageResponse.parse(result));
});

// ── Provider breakdown ────────────────────────────────────────────────────────

router.get("/ai/analytics/provider-breakdown", async (_req, res): Promise<void> => {
  // Real data from cost records
  const costRows = await db
    .select({
      provider:     aiCostRecordsTable.provider,
      totalTokens:  sql<number>`coalesce(sum(total_tokens), 0)::int`,
      executions:   sql<number>`count(*)::int`,
      avgLatencyMs: avg(aiCostRecordsTable.latencyMs),
      totalCost:    sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
    })
    .from(aiCostRecordsTable)
    .groupBy(aiCostRecordsTable.provider)
    .orderBy(desc(sql`sum(total_tokens)`));

  if (costRows.length > 0) {
    res.json(
      costRows.map((r, i) => ({
        providerId:   i + 1,
        providerName: r.provider,
        tokensUsed:   r.totalTokens,
        executions:   r.executions,
        avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
      })),
    );
    return;
  }

  // Fallback to provider list with zeros
  const providers = await db.select().from(aiProvidersTable);
  res.json(
    GetProviderBreakdownResponse.parse(
      providers.map((p) => ({
        providerId:   p.id,
        providerName: p.name,
        tokensUsed:   0,
        executions:   0,
        avgLatencyMs: null,
      })),
    ),
  );
});

// ── Agent performance stats ───────────────────────────────────────────────────

router.get("/ai/analytics/agent-stats", async (req, res): Promise<void> => {
  const days = parseDays(req.query.days);
  const providerFilter = req.query.provider as string | undefined;
  const agentFilter    = req.query.agent as string | undefined;

  let query = db
    .select({
      agentSlug:    aiCostRecordsTable.agentSlug,
      totalRequests: count(),
      totalTokens:  sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalCost:    sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
      avgLatency:   avg(aiCostRecordsTable.latencyMs),
      successCount: sql<number>`count(*) filter (where status = 'success')::int`,
    })
    .from(aiCostRecordsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .$dynamic();

  const rows = await query
    .groupBy(aiCostRecordsTable.agentSlug)
    .orderBy(desc(sql`sum(estimated_cost_usd::numeric)`));

  const filtered = rows
    .filter((r) => r.agentSlug != null)
    .filter((r) => !providerFilter || providerFilter === "all" ? true : true) // provider filter applies at row level if needed
    .filter((r) => !agentFilter    || agentFilter    === "all" ? true : r.agentSlug === agentFilter);

  res.json(
    filtered.map((r) => ({
      agentSlug:              r.agentSlug!,
      agentName:              r.agentSlug!,
      totalRequests:          r.totalRequests,
      totalTokens:            r.totalTokens,
      totalEstimatedCostUsd:  r.totalCost != null ? Number(r.totalCost) : 0,
      avgLatencyMs:           r.avgLatency != null ? Number(r.avgLatency) : null,
      successRate:            r.totalRequests > 0 ? (r.successCount ?? 0) / r.totalRequests : 0,
      approvalRate:           null,
      revisionRate:           null,
      avgRating:              null,
    })),
  );
});

// ── CSV export ────────────────────────────────────────────────────────────────

router.get("/ai/analytics/export/csv", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiCostRecordsTable)
    .orderBy(desc(aiCostRecordsTable.createdAt));

  const headers = [
    "id", "project_id", "client_id", "agent_slug", "provider", "model",
    "input_tokens", "output_tokens", "total_tokens", "estimated_cost_usd",
    "latency_ms", "retry_count", "fallback_count", "status", "created_at",
  ];

  const escape = (v: unknown) =>
    v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;

  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.id, r.projectId, r.clientId, r.agentSlug, r.provider, r.model,
        r.inputTokens, r.outputTokens, r.totalTokens, r.estimatedCostUsd,
        r.latencyMs, r.retryCount, r.fallbackCount, r.status, r.createdAt,
      ].map(escape).join(","),
    ),
  ];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="ai-cost-analytics-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join("\n"));
});

export default router;
