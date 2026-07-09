import { Router } from "express";
import { sql } from "drizzle-orm";
import {
  db,
  aiProvidersTable,
  aiModelsTable,
  aiWorkflowsTable,
  aiPromptsTable,
  aiKnowledgeBasesTable,
  aiMemoryTable,
  aiWorkflowExecutionsTable,
  aiOrchestratorSessionsTable,
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
  ] = await Promise.all([
    db.select({ totalProviders: sql<number>`count(*)::int` }).from(aiProvidersTable),
    db.select({ totalModels: sql<number>`count(*)::int` }).from(aiModelsTable),
    db.select({ totalWorkflows: sql<number>`count(*)::int` }).from(aiWorkflowsTable),
    db.select({ totalPrompts: sql<number>`count(*)::int` }).from(aiPromptsTable),
    db.select({ totalKnowledgeBases: sql<number>`count(*)::int` }).from(aiKnowledgeBasesTable),
    db.select({ totalMemoryEntries: sql<number>`count(*)::int` }).from(aiMemoryTable),
    db.select({ totalExecutions: sql<number>`count(*)::int` }).from(aiWorkflowExecutionsTable),
    db.select({ activeWorkflows: sql<number>`count(*)::int` }).from(aiWorkflowsTable).where(sql`status = 'active'`),
  ]);

  const [tokenRow] = await db
    .select({ sum: sql<number>`coalesce(sum(total_tokens), 0)::int` })
    .from(aiOrchestratorSessionsTable);

  const [avgLatencyRow] = await db
    .select({ avg: sql<number>`coalesce(avg(duration_ms), null)` })
    .from(aiWorkflowExecutionsTable)
    .where(sql`status = 'completed'`);

  const [successRow] = await db
    .select({ success: sql<number>`count(*)::int` })
    .from(aiWorkflowExecutionsTable)
    .where(sql`status = 'completed'`);

  const successRate = totalExecutions > 0 ? (successRow.success / totalExecutions) * 100 : null;

  res.json(
    GetAnalyticsOverviewResponse.parse({
      totalProviders,
      totalModels,
      totalWorkflows,
      totalPrompts,
      totalKnowledgeBases,
      totalMemoryEntries,
      totalTokensUsed: tokenRow?.sum ?? 0,
      totalExecutions,
      activeWorkflows,
      avgLatencyMs: avgLatencyRow?.avg != null ? Number(avgLatencyRow.avg) : null,
      successRate,
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

  const execRows = await db
    .select({
      date: sql<string>`date_trunc('day', created_at)::date::text`,
      executions: sql<number>`count(*)::int`,
      tokensUsed: sql<number>`coalesce(sum(tokens_used), 0)::int`,
      avgLatencyMs: sql<number | null>`avg(duration_ms)`,
    })
    .from(aiWorkflowExecutionsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .groupBy(sql`date_trunc('day', created_at)`)
    .orderBy(sql`date_trunc('day', created_at)`);

  const result = execRows.map((r) => ({
    date: r.date,
    executions: r.executions,
    tokensUsed: r.tokensUsed,
    avgLatencyMs: r.avgLatencyMs != null ? Number(r.avgLatencyMs) : null,
  }));

  res.json(GetAnalyticsUsageResponse.parse(result));
});

// ── Provider breakdown ────────────────────────────────────────────────────────

router.get("/ai/analytics/provider-breakdown", async (_req, res): Promise<void> => {
  const providers = await db.select().from(aiProvidersTable);

  const [sessionTotals] = await db
    .select({
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalRequests: sql<number>`coalesce(sum(total_requests), 0)::int`,
    })
    .from(aiOrchestratorSessionsTable);

  const perProvider = Math.max(providers.length, 1);
  const breakdown = providers.map((p) => ({
    providerId: p.id,
    providerName: p.name,
    tokensUsed: Math.floor((sessionTotals?.totalTokens ?? 0) / perProvider),
    executions: Math.floor((sessionTotals?.totalRequests ?? 0) / perProvider),
    avgLatencyMs: null as number | null,
  }));

  res.json(GetProviderBreakdownResponse.parse(breakdown));
});

export default router;
