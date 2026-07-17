/**
 * creative-commercial/funnelProjectionService.ts — Team 03
 *
 * Builds funnel stage metrics from historical sales_funnel_events and
 * projects next-period performance using trailing conversion rates.
 *
 * Stages (in order):
 *   visitor → page_view → service_view → checkout_started →
 *   submitted → quoted → payment_verified → completed
 *
 * Projections are stored in cc_funnel_snapshots for trend analysis.
 * All reads — no financial mutations.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { FunnelProjection, FunnelStageData, FunnelStage } from "./types.js";

const STAGE_EVENT_TYPES: Record<FunnelStage, string[]> = {
  visitor:          ["page.visited", "session.started"],
  page_view:        ["page.viewed", "portfolio.viewed", "service_catalog.viewed"],
  service_view:     ["service.viewed", "package.viewed"],
  checkout_started: ["checkout.started"],
  submitted:        ["service_request.created", "form.submitted"],
  quoted:           ["quotation.issued", "quotation.approved"],
  payment_verified: ["payment.verified", "gate.verified"],
  completed:        ["project.completed", "service_request.converted"],
};

const STAGE_ORDER: FunnelStage[] = [
  "visitor",
  "page_view",
  "service_view",
  "checkout_started",
  "submitted",
  "quoted",
  "payment_verified",
  "completed",
];

type StageCountRow = { stage: string; cnt: number } & Record<string, unknown>;
type SourceRow = { source: string; visitors: number; conversions: number; revenue: number } & Record<string, unknown>;

/**
 * Builds historical funnel metrics over the given period.
 *
 * RBAC / Tenant scope:
 *   - tenantId: when provided, restricts funnel events to customers belonging
 *     to that tenant (via customer_profiles). Pass null/undefined for platform-wide
 *     view — only super-admin callers should omit.
 */
export async function buildFunnelMetrics(
  periodDays = 30,
  tenantId?: string | null,
): Promise<FunnelProjection> {
  const historicalFrom = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const historicalTo = new Date();

  // Count events per stage
  const stageCountsResult = await db.execute<StageCountRow>(sql`
    SELECT
      CASE
        WHEN event_type = ANY(ARRAY['page.visited', 'session.started']) THEN 'visitor'
        WHEN event_type = ANY(ARRAY['page.viewed', 'portfolio.viewed', 'service_catalog.viewed']) THEN 'page_view'
        WHEN event_type = ANY(ARRAY['service.viewed', 'package.viewed']) THEN 'service_view'
        WHEN event_type = 'checkout.started' THEN 'checkout_started'
        WHEN event_type = ANY(ARRAY['service_request.created', 'form.submitted']) THEN 'submitted'
        WHEN event_type = ANY(ARRAY['quotation.issued', 'quotation.approved']) THEN 'quoted'
        WHEN event_type = ANY(ARRAY['payment.verified', 'gate.verified']) THEN 'payment_verified'
        WHEN event_type = ANY(ARRAY['project.completed', 'service_request.converted']) THEN 'completed'
        ELSE NULL
      END AS stage,
      count(*) AS cnt
    FROM ai_platform.sales_funnel_events
    WHERE created_at BETWEEN ${historicalFrom.toISOString()} AND ${historicalTo.toISOString()}
      ${tenantId != null ? sql`AND customer_id IN (
        SELECT id FROM ai_platform.customer_profiles WHERE tenant_id = ${tenantId}
      )` : sql``}
    GROUP BY stage
    HAVING CASE
      WHEN event_type = ANY(ARRAY['page.visited', 'session.started']) THEN 'visitor'
      WHEN event_type = ANY(ARRAY['page.viewed', 'portfolio.viewed', 'service_catalog.viewed']) THEN 'page_view'
      WHEN event_type = ANY(ARRAY['service.viewed', 'package.viewed']) THEN 'service_view'
      WHEN event_type = 'checkout.started' THEN 'checkout_started'
      WHEN event_type = ANY(ARRAY['service_request.created', 'form.submitted']) THEN 'submitted'
      WHEN event_type = ANY(ARRAY['quotation.issued', 'quotation.approved']) THEN 'quoted'
      WHEN event_type = ANY(ARRAY['payment.verified', 'gate.verified']) THEN 'payment_verified'
      WHEN event_type = ANY(ARRAY['project.completed', 'service_request.converted']) THEN 'completed'
      ELSE NULL
    END IS NOT NULL
  `);

  const stageCounts = (stageCountsResult as unknown as { rows: StageCountRow[] }).rows ?? [];
  const countMap: Record<string, number> = {};
  for (const row of stageCounts) {
    countMap[row.stage] = Number(row.cnt);
  }

  // Build stage data with conversion rates
  const stages: FunnelStageData[] = STAGE_ORDER.map((stage, idx) => {
    const count = countMap[stage] ?? 0;
    const nextStage = STAGE_ORDER[idx + 1];
    const nextCount = nextStage ? (countMap[nextStage] ?? 0) : 0;
    const conversionRate = count > 0 && nextStage ? Math.min(1, nextCount / count) : 0;

    return {
      stage,
      count,
      conversionRate: Math.round(conversionRate * 1000) / 1000,
      dropOffRate: Math.round((1 - conversionRate) * 1000) / 1000,
    };
  });

  // Project forward using trailing rates
  const projectedFrom = new Date();
  const projectedTo = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);

  const visitorStage = stages[0];
  const projectedVisitors = Math.round((visitorStage?.count ?? 0) * 1.05); // +5% growth assumption

  // Project completions: visitors × product of all conversion rates
  const overallConversionRate = stages.reduce(
    (product, s) => (s.stage !== "completed" ? product * s.conversionRate : product),
    1,
  );
  const projectedOrders = Math.round(projectedVisitors * overallConversionRate);

  // Estimate revenue from completed count × average order value from invoices
  const avgOrderResult = await db.execute<{ avg_amount: number }>(sql`
    SELECT coalesce(avg(amount), 0)::float AS avg_amount
    FROM ai_platform.ai_invoices
    WHERE status = 'paid'
      AND created_at >= ${historicalFrom.toISOString()}
  `);
  const avgOrderRows = (avgOrderResult as unknown as { rows: Array<{ avg_amount: string }> }).rows ?? [];
  const avgOrderValue = parseFloat(avgOrderRows[0]?.avg_amount ?? "0") || 0;
  const projectedRevenue = Math.round(projectedOrders * avgOrderValue);

  // By-source breakdown
  const sourceResult = await db.execute<SourceRow>(sql`
    SELECT
      coalesce(utm_source, 'direct') AS source,
      count(*) FILTER (WHERE event_type IN ('page.visited', 'session.started'))::int AS visitors,
      count(*) FILTER (WHERE event_type IN ('project.completed', 'service_request.converted'))::int AS conversions,
      0::int AS revenue
    FROM ai_platform.sales_funnel_events
    WHERE created_at BETWEEN ${historicalFrom.toISOString()} AND ${historicalTo.toISOString()}
    GROUP BY coalesce(utm_source, 'direct')
    ORDER BY visitors DESC
    LIMIT 10
  `);

  const bySource: Record<string, { visitors: number; conversions: number; revenue: number }> = {};
  for (const row of (sourceResult as unknown as { rows: SourceRow[] }).rows ?? []) {
    bySource[row.source] = {
      visitors: Number(row.visitors),
      conversions: Number(row.conversions),
      revenue: Number(row.revenue),
    };
  }

  // Persist snapshot (fire-and-forget)
  persistFunnelSnapshot(stages, projectedRevenue, projectedOrders).catch(() => {});

  return {
    periodDays,
    historicalFrom,
    historicalTo,
    projectedFrom,
    projectedTo,
    stages,
    projectedRevenue,
    projectedOrders,
    bySource,
  };
}

/** Returns stored funnel snapshots for trend view (last N snapshots). */
export async function getFunnelSnapshots(limit = 30): Promise<Array<{
  snapshotDate: Date;
  stage: string;
  count: number;
  conversionRate: number;
}>> {
  const result = await db.execute<{
    snapshot_date: string;
    stage: string;
    cnt: number;
    conversion_rate: number;
  }>(sql`
    SELECT snapshot_date, stage, cnt, conversion_rate
    FROM ai_platform.cc_funnel_snapshots
    ORDER BY snapshot_date DESC
    LIMIT ${limit}
  `);

  return ((result as unknown as { rows: Array<{
    snapshot_date: string;
    stage: string;
    cnt: number;
    conversion_rate: number;
  }> }).rows ?? []).map((r) => ({
    snapshotDate: new Date(r.snapshot_date),
    stage: r.stage,
    count: Number(r.cnt),
    conversionRate: Number(r.conversion_rate),
  }));
}

async function persistFunnelSnapshot(stages: FunnelStageData[], projectedRevenue: number, projectedOrders: number): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  for (const stage of stages) {
    await db.execute(sql`
      INSERT INTO ai_platform.cc_funnel_snapshots
        (snapshot_date, stage, cnt, conversion_rate, projected_revenue, projected_orders)
      VALUES (
        ${today}::date,
        ${stage.stage},
        ${stage.count},
        ${stage.conversionRate},
        ${projectedRevenue},
        ${projectedOrders}
      )
      ON CONFLICT (snapshot_date, stage) DO UPDATE
        SET cnt = EXCLUDED.cnt,
            conversion_rate = EXCLUDED.conversion_rate,
            projected_revenue = EXCLUDED.projected_revenue,
            projected_orders = EXCLUDED.projected_orders
    `);
  }
}
