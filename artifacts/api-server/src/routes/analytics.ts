import { Router } from "express";
import { sql, count, avg } from "drizzle-orm";
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
  aiAgentsTable,
  aiFeedbackTable,
  aiCostRecordsTable,
} from "@workspace/db";
import {
  GetAnalyticsOverviewResponse,
  GetAnalyticsUsageQueryParams,
  GetAnalyticsUsageResponse,
  GetProviderBreakdownResponse,
} from "@workspace/api-zod";
import { getDailyCosts, getProviderCostStats, getAgentCostStats } from "../services/costService.js";

const router = Router();

/** Safely parse a `days` query param: integer, clamped 1–365, default 14. */
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

  // Real token counts from cost records
  const [costTotals] = await db
    .select({
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      totalRequests: sql<number>`count(*)::int`,
    })
    .from(aiCostRecordsTable);

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
      totalTokensUsed: costTotals?.totalTokens ?? 0,
      totalExecutions,
      activeWorkflows,
      avgLatencyMs: avgLatencyRow.avg != null ? Number(avgLatencyRow.avg) : null,
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

  // Use real cost records for tokens and request counts by day
  const costRows = await db
    .select({
      date: sql<string>`date_trunc('day', created_at)::date::text`,
      totalRequests: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(total_tokens), 0)::int`,
      avgLatencyMs: avg(aiCostRecordsTable.latencyMs),
    })
    .from(aiCostRecordsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .groupBy(sql`date_trunc('day', created_at)`)
    .orderBy(sql`date_trunc('day', created_at)`);

  // Also query workflow executions for latency data
  const execRows = await db
    .select({
      date: sql<string>`date_trunc('day', created_at)::date::text`,
      executions: sql<number>`count(*)::int`,
      avgLatencyMs: sql<number | null>`avg(duration_ms)`,
    })
    .from(aiWorkflowExecutionsTable)
    .where(sql`created_at >= now() - interval '${sql.raw(String(days))} days'`)
    .groupBy(sql`date_trunc('day', created_at)`)
    .orderBy(sql`date_trunc('day', created_at)`);

  // Merge by date — use cost records for tokens, exec table for latency
  const execByDate = Object.fromEntries(execRows.map((r) => [r.date, r]));
  const costByDate = Object.fromEntries(costRows.map((r) => [r.date, r]));

  // Build union of all dates
  const allDates = [...new Set([...Object.keys(execByDate), ...Object.keys(costByDate)])].sort();

  const result = allDates.map((date) => {
    const cost = costByDate[date];
    const exec = execByDate[date];
    return {
      date,
      executions: exec?.executions ?? cost?.totalRequests ?? 0,
      tokensUsed: cost?.totalTokens ?? 0,
      avgLatencyMs:
        exec?.avgLatencyMs != null
          ? Number(exec.avgLatencyMs)
          : cost?.avgLatencyMs != null
          ? Number(cost.avgLatencyMs)
          : null,
    };
  });

  res.json(GetAnalyticsUsageResponse.parse(result));
});

// ── Provider breakdown ────────────────────────────────────────────────────────

router.get("/ai/analytics/provider-breakdown", async (_req, res): Promise<void> => {
  // Prefer real cost record data over session-based estimates
  const costStats = await getProviderCostStats(90).catch(() => []);

  if (costStats.length > 0) {
    res.json(
      costStats.map((s, i) => ({
        providerId: i + 1,
        providerName: s.provider,
        tokensUsed: s.totalTokens,
        executions: s.totalRequests,
        avgLatencyMs: s.avgLatencyMs,
      })),
    );
    return;
  }

  // Fall back to provider list with zero counts when no cost records exist yet
  const providers = await db.select().from(aiProvidersTable);
  const breakdown = providers.map((p) => ({
    providerId: p.id,
    providerName: p.name,
    tokensUsed: 0,
    executions: 0,
    avgLatencyMs: null,
  }));

  res.json(GetProviderBreakdownResponse.parse(breakdown));
});

// ── Agent stats (Phase 4) ─────────────────────────────────────────────────────

router.get("/ai/analytics/agent-stats", async (req, res): Promise<void> => {
  const days = parseDays(req.query.days);

  const costStats = await getAgentCostStats(days);

  // Join with agent table for display names
  const agents = await db.select().from(aiAgentsTable);
  const agentBySlug = Object.fromEntries(agents.map((a) => [a.slug, a]));

  // Get feedback stats per agent step
  const feedbackRows = await db
    .select({
      action: aiFeedbackTable.action,
      rating: aiFeedbackTable.rating,
      stepName: aiFeedbackTable.stepName,
    })
    .from(aiFeedbackTable);

  const stepToSlug: Record<string, string> = {
    "Brand Strategy":    "brand-strategist",
    "Creative Direction": "creative-director",
    "Copy Production":   "copywriter",
    "Quality Control":   "quality-control",
  };

  const feedbackBySlug: Record<string, { approve: number; reject: number; revision: number; ratings: number[] }> = {};
  for (const fb of feedbackRows) {
    const slug = fb.stepName ? (stepToSlug[fb.stepName] ?? null) : null;
    if (!slug) continue;
    if (!feedbackBySlug[slug]) feedbackBySlug[slug] = { approve: 0, reject: 0, revision: 0, ratings: [] };
    if (fb.action === "approve") feedbackBySlug[slug].approve++;
    if (fb.action === "reject") feedbackBySlug[slug].reject++;
    if (fb.action === "needs_revision" || fb.action === "human_edit") feedbackBySlug[slug].revision++;
    if (fb.rating != null) feedbackBySlug[slug].ratings.push(fb.rating);
  }

  const result = costStats.map((s) => {
    const agent = agentBySlug[s.agentSlug];
    const fb = feedbackBySlug[s.agentSlug] ?? { approve: 0, reject: 0, revision: 0, ratings: [] };
    const totalFb = fb.approve + fb.reject + fb.revision;
    const avgRating =
      fb.ratings.length > 0
        ? fb.ratings.reduce((a, b) => a + b, 0) / fb.ratings.length
        : null;

    return {
      agentSlug: s.agentSlug,
      agentName: agent?.name ?? s.agentSlug,
      totalRequests: s.totalRequests,
      totalTokens: s.totalTokens,
      totalEstimatedCostUsd: s.totalEstimatedCostUsd,
      avgLatencyMs: s.avgLatencyMs,
      successRate: s.successRate,
      approvalRate: totalFb > 0 ? fb.approve / totalFb : null,
      revisionRate: totalFb > 0 ? fb.revision / totalFb : null,
      avgRating,
    };
  });

  res.json(result);
});

// ── Cost trend (Phase 4) ──────────────────────────────────────────────────────

router.get("/ai/analytics/costs", async (req, res): Promise<void> => {
  const days = parseDays(req.query.days);
  const [dailyCosts, providerStats, agentStats] = await Promise.all([
    getDailyCosts(days),
    getProviderCostStats(days),
    getAgentCostStats(days),
  ]);
  res.json({ daily: dailyCosts, byProvider: providerStats, byAgent: agentStats });
});

export default router;
