import { db, salesFunnelEventsTable, type InsertSalesFunnelEvent } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function trackFunnelEvent(data: InsertSalesFunnelEvent): Promise<void> {
  await db.insert(salesFunnelEventsTable).values(data);
}

export interface FunnelStep {
  stage: string;
  count: number;
  conversionRate: number | null;
}

export interface FunnelAnalytics {
  days: number;
  steps: FunnelStep[];
  revenue: number;
  avgOrderValue: number;
  repeatOrders: number;
  referralOrders: number;
  affiliateOrders: number;
}

export async function getFunnelAnalytics(days = 30): Promise<FunnelAnalytics> {
  const since = `now() - interval '${days} days'`;

  const counts = await db
    .select({
      eventType: salesFunnelEventsTable.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(salesFunnelEventsTable)
    .where(sql`created_at >= ${sql.raw(since)}`)
    .groupBy(salesFunnelEventsTable.eventType);

  const countMap = Object.fromEntries(counts.map((r) => [r.eventType, r.count]));

  const STAGES = [
    "portfolio_view",
    "portfolio_open",
    "preview_start",
    "preview_complete",
    "package_select",
    "checkout",
    "payment",
    "project_created",
    "project_completed",
    "repeat_order",
    "referral",
  ];

  const steps: FunnelStep[] = STAGES.map((stage, i) => {
    const count = countMap[stage] ?? 0;
    const prev = i === 0 ? count : (countMap[STAGES[i - 1]] ?? 0);
    const conversionRate = prev > 0 ? Math.round((count / prev) * 1000) / 10 : null;
    return { stage, count, conversionRate };
  });

  return {
    days,
    steps,
    revenue: 0, // sourced from payment tables — placeholder
    avgOrderValue: 0,
    repeatOrders: countMap["repeat_order"] ?? 0,
    referralOrders: countMap["referral"] ?? 0,
    affiliateOrders: countMap["affiliate"] ?? 0,
  };
}
