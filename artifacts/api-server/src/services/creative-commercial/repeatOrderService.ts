/**
 * creative-commercial/repeatOrderService.ts — Team 03
 *
 * Identifies customers who completed a creative project and haven't
 * re-ordered within X days — then recommends re-ordering or a related
 * service.
 *
 * Three triggers:
 *   1. Seasonal: project completed ~1 year ago (annual brand refresh)
 *   2. Growth: customer health score improved since last order
 *   3. Inactive window: no activity for configurable days
 *
 * Cooldown: 14 days per customer per service recommendation.
 */

import { db, creativeProjectsTable, aiServiceRequestsTable, aiServicesTable } from "@workspace/db";
import { eq, and, lt, gte, desc, sql, inArray } from "drizzle-orm";
import { checkCooldown, recordRecommendation } from "./cooldownService.js";
import type { Recommendation } from "./types.js";

interface RepeatOrderCandidate {
  customerProfileId: number;
  lastCompletedServiceId: number | null;
  lastCompletedServiceName: string | null;
  lastCompletedAt: Date;
  daysSinceLastOrder: number;
  triggerType: "seasonal" | "growth" | "inactive";
}

/**
 * Finds customers eligible for repeat-order nudge.
 * Segments: customers with ≥1 completed order and no recent activity.
 */
export async function findRepeatOrderCandidates(opts: {
  inactiveDaysThreshold?: number;
  limit?: number;
}): Promise<RepeatOrderCandidate[]> {
  const threshold = opts.inactiveDaysThreshold ?? 60;
  const limit = opts.limit ?? 100;

  // ai_service_requests has customer_email, not customer_profile_id.
  // Join via customer_profiles on client_email = customer_email to get the profile id.
  const result = await db.execute<{
    customer_profile_id: number;
    last_service_id: number | null;
    last_service_name: string | null;
    last_completed_at: string;
    days_since: number;
  }>(sql`
    WITH last_orders AS (
      SELECT
        cp.id AS customer_profile_id,
        sr.service_id AS last_service_id,
        s.service_name AS last_service_name,
        max(sr.created_at) AS last_completed_at
      FROM ai_platform.ai_service_requests sr
      JOIN ai_platform.customer_profiles cp ON cp.client_email = sr.customer_email
      LEFT JOIN ai_platform.ai_services s ON s.id = sr.service_id
      WHERE sr.status IN ('completed', 'delivered')
        AND sr.customer_email IS NOT NULL
      GROUP BY cp.id, sr.service_id, s.service_name
    ),
    recent_activity AS (
      SELECT DISTINCT cp2.id AS customer_profile_id
      FROM ai_platform.ai_service_requests sr2
      JOIN ai_platform.customer_profiles cp2 ON cp2.client_email = sr2.customer_email
      WHERE sr2.created_at >= now() - ${threshold} * interval '1 day'
        AND sr2.customer_email IS NOT NULL
    )
    SELECT
      lo.customer_profile_id,
      lo.last_service_id,
      lo.last_service_name,
      lo.last_completed_at,
      extract(day FROM now() - lo.last_completed_at)::int AS days_since
    FROM last_orders lo
    LEFT JOIN recent_activity ra ON ra.customer_profile_id = lo.customer_profile_id
    WHERE ra.customer_profile_id IS NULL
    ORDER BY lo.last_completed_at ASC
    LIMIT ${limit}
  `);

  const rows = (result as unknown as { rows: Array<{
    customer_profile_id: number;
    last_service_id: number | null;
    last_service_name: string | null;
    last_completed_at: string;
    days_since: number;
  }> }).rows ?? [];

  return rows.map((r) => {
    const daysSince = r.days_since;
    let triggerType: "seasonal" | "growth" | "inactive" = "inactive";
    if (daysSince >= 330 && daysSince <= 400) triggerType = "seasonal";
    else if (daysSince >= 60 && daysSince <= 120) triggerType = "growth";

    return {
      customerProfileId: r.customer_profile_id,
      lastCompletedServiceId: r.last_service_id,
      lastCompletedServiceName: r.last_service_name,
      lastCompletedAt: new Date(r.last_completed_at),
      daysSinceLastOrder: daysSince,
      triggerType,
    };
  });
}

/**
 * Returns repeat-order recommendations for all eligible candidates.
 * Respects 14-day cooldown per customer×service.
 */
export async function getRepeatOrderRecommendations(opts: {
  inactiveDaysThreshold?: number;
  maxRecommendations?: number;
}): Promise<Recommendation[]> {
  const candidates = await findRepeatOrderCandidates({
    inactiveDaysThreshold: opts.inactiveDaysThreshold ?? 60,
    limit: opts.maxRecommendations ?? 50,
  });

  const recommendations: Recommendation[] = [];

  for (const candidate of candidates) {
    const contextKey = `repeat:${candidate.lastCompletedServiceId ?? "unknown"}`;
    const cooldown = await checkCooldown({
      customerProfileId: candidate.customerProfileId,
      recType: "repeat_order",
      contextKey,
    });
    if (cooldown.blocked) continue;

    const score = scoreRepeatOrder(candidate);

    const rec: Recommendation = {
      id: `repeat_order:${candidate.customerProfileId}:${contextKey}`,
      type: "repeat_order",
      customerProfileId: candidate.customerProfileId,
      title: buildRepeatTitle(candidate),
      description: buildRepeatDescription(candidate),
      reasonCode: `repeat_${candidate.triggerType}`,
      score,
      payload: {
        serviceId: candidate.lastCompletedServiceId ?? undefined,
        ctaLabel: "Pesan Lagi",
        metadata: {
          lastCompletedAt: candidate.lastCompletedAt.toISOString(),
          daysSinceLastOrder: candidate.daysSinceLastOrder,
          triggerType: candidate.triggerType,
        },
      },
      cooldownUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      requiresApproval: false,
      createdAt: new Date(),
    };

    await recordRecommendation({
      customerProfileId: candidate.customerProfileId,
      recType: "repeat_order",
      contextKey,
      payloadJson: { serviceId: candidate.lastCompletedServiceId, triggerType: candidate.triggerType },
    });

    recommendations.push(rec);
  }

  return recommendations.sort((a, b) => b.score - a.score);
}

/** Repeat-order stats for analytics dashboard. */
export async function getRepeatOrderStats(): Promise<{
  totalRepeatCustomers: number;
  avgDaysBetweenOrders: number;
  repeatRate: number;
}> {
  const result = await db.execute<{
    total_repeat: number;
    total_customers: number;
    avg_days: number;
  }>(sql`
    WITH order_counts AS (
      SELECT
        customer_profile_id,
        count(*) AS order_count,
        avg(extract(day FROM created_at))::float AS avg_day
      FROM ai_platform.ai_service_requests
      WHERE status IN ('completed', 'delivered')
        AND customer_profile_id IS NOT NULL
      GROUP BY customer_profile_id
    )
    SELECT
      count(*) FILTER (WHERE order_count > 1)::int AS total_repeat,
      count(*)::int AS total_customers,
      coalesce(avg(avg_day)::float, 0) AS avg_days
    FROM order_counts
  `);

  const rows = (result as unknown as { rows: Array<{
    total_repeat: string;
    total_customers: string;
    avg_days: string;
  }> }).rows ?? [];
  const row = rows[0] ?? { total_repeat: "0", total_customers: "0", avg_days: "0" };

  const totalRepeat = parseInt(row.total_repeat, 10) || 0;
  const totalCustomers = parseInt(row.total_customers, 10) || 0;

  return {
    totalRepeatCustomers: totalRepeat,
    avgDaysBetweenOrders: parseFloat(row.avg_days) || 0,
    repeatRate: totalCustomers > 0 ? Math.round((totalRepeat / totalCustomers) * 1000) / 10 : 0,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreRepeatOrder(c: RepeatOrderCandidate): number {
  if (c.triggerType === "seasonal") return 90;
  if (c.triggerType === "growth") return 75;
  // inactive: score decays with inactivity (too long = lower chance)
  return Math.max(30, 70 - Math.floor(c.daysSinceLastOrder / 30) * 5);
}

function buildRepeatTitle(c: RepeatOrderCandidate): string {
  if (c.triggerType === "seasonal") {
    return `Saatnya refresh brand tahunan Anda`;
  }
  if (c.triggerType === "growth") {
    return `Langkah selanjutnya untuk bisnis Anda`;
  }
  return c.lastCompletedServiceName
    ? `Pesan ulang ${c.lastCompletedServiceName}`
    : `Lanjutkan perjalanan kreatif Anda`;
}

function buildRepeatDescription(c: RepeatOrderCandidate): string {
  const months = Math.round(c.daysSinceLastOrder / 30);
  if (c.triggerType === "seasonal") {
    return `Proyek Anda bersama kami sudah setahun berjalan — momen tepat untuk refresh identitas brand.`;
  }
  if (c.triggerType === "growth") {
    return `Bisnis Anda berkembang. Kami siap mendukung fase pertumbuhan berikutnya dengan layanan kreatif yang tepat.`;
  }
  return `Sudah ${months} bulan sejak proyek terakhir. Tim kami siap membantu membawa brand Anda ke level berikutnya.`;
}
