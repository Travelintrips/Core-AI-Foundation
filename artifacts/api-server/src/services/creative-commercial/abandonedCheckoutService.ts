/**
 * creative-commercial/abandonedCheckoutService.ts — Team 03
 *
 * Detects abandoned checkouts by scanning sales_funnel_events for
 * "checkout.started" events with no corresponding "checkout.completed"
 * within a configurable window.
 *
 * Returns a recovery recommendation (coupon or reminder) per customer.
 * Default window: 24h. Cooldown: 24h per customer so they're not spammed.
 */

import { db, salesFunnelEventsTable, aiServiceRequestsTable } from "@workspace/db";
import { eq, and, gte, sql, inArray, notInArray } from "drizzle-orm";
import { checkCooldown, recordRecommendation } from "./cooldownService.js";
import type { Recommendation } from "./types.js";

export interface AbandonedCheckout {
  customerId: number | null;
  visitorId: string | null;
  sessionId: string | null;
  serviceId: number | null;
  packageId: number | null;
  abandonedAt: Date;
  hoursSinceAbandonment: number;
}

/**
 * Scans funnel events for abandonments in the given window.
 * Returns raw list — use getAbandonedCheckoutRecommendations for
 * personalized recommendations.
 */
export async function detectAbandonedCheckouts(opts: {
  windowHours?: number;
  limit?: number;
}): Promise<AbandonedCheckout[]> {
  const windowHours = opts.windowHours ?? 24;
  const limit = opts.limit ?? 100;

  // Sessions that started checkout but never completed
  const result = await db.execute<{
    customer_id: number | null;
    visitor_id: string | null;
    session_id: string | null;
    service_id: number | null;
    package_id: number | null;
    abandoned_at: string;
  }>(sql`
    WITH started AS (
      SELECT
        customer_id,
        visitor_id,
        session_id,
        service_id,
        package_id,
        created_at AS abandoned_at
      FROM ai_platform.sales_funnel_events
      WHERE event_type = 'checkout.started'
        AND created_at >= now() - ${windowHours} * interval '1 hour'
    ),
    completed AS (
      SELECT DISTINCT session_id
      FROM ai_platform.sales_funnel_events
      WHERE event_type = 'checkout.completed'
        AND created_at >= now() - ${windowHours} * interval '1 hour'
    )
    SELECT s.*
    FROM started s
    LEFT JOIN completed c ON s.session_id = c.session_id
    WHERE c.session_id IS NULL
      AND s.customer_id IS NOT NULL
    ORDER BY s.abandoned_at DESC
    LIMIT ${limit}
  `);

  const rows = ((result as unknown as { rows: Array<{
    customer_id: number | null;
    visitor_id: string | null;
    session_id: string | null;
    service_id: number | null;
    package_id: number | null;
    abandoned_at: string;
  }> }).rows) ?? [];

  return rows.map((row) => ({
    customerId: row.customer_id,
    visitorId: row.visitor_id,
    sessionId: row.session_id,
    serviceId: row.service_id,
    packageId: row.package_id,
    abandonedAt: new Date(row.abandoned_at),
    hoursSinceAbandonment:
      (Date.now() - new Date(row.abandoned_at).getTime()) / (1000 * 60 * 60),
  }));
}

/**
 * Returns recovery recommendations for customers with abandoned checkouts.
 * Each customer gets at most one recommendation (cooldown enforced).
 */
export async function getAbandonedCheckoutRecommendations(opts: {
  windowHours?: number;
  maxRecommendations?: number;
}): Promise<Recommendation[]> {
  const abandonments = await detectAbandonedCheckouts({
    windowHours: opts.windowHours ?? 24,
    limit: opts.maxRecommendations ?? 50,
  });

  const recommendations: Recommendation[] = [];

  for (const ab of abandonments) {
    if (!ab.customerId) continue;

    const contextKey = `abandoned:${ab.sessionId ?? ab.serviceId ?? "unknown"}`;
    const cooldown = await checkCooldown({
      customerProfileId: ab.customerId,
      recType: "abandoned_checkout",
      contextKey,
    });
    if (cooldown.blocked) continue;

    const urgencyScore = Math.min(100, 60 + (24 - ab.hoursSinceAbandonment) * 1.5);

    const rec: Recommendation = {
      id: `abandoned_checkout:${ab.customerId}:${contextKey}`,
      type: "abandoned_checkout",
      customerProfileId: ab.customerId,
      title: "Selesaikan pesanan Anda",
      description: buildAbandonmentDescription(ab),
      reasonCode: "checkout_abandoned",
      score: urgencyScore,
      payload: {
        serviceId: ab.serviceId ?? undefined,
        packageId: ab.packageId ?? undefined,
        ctaLabel: "Lanjutkan Pesanan",
        metadata: {
          sessionId: ab.sessionId,
          abandonedAt: ab.abandonedAt.toISOString(),
          hoursSince: ab.hoursSinceAbandonment,
        },
      },
      cooldownUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      requiresApproval: false,
      createdAt: new Date(),
    };

    await recordRecommendation({
      customerProfileId: ab.customerId,
      recType: "abandoned_checkout",
      contextKey,
      payloadJson: { sessionId: ab.sessionId, serviceId: ab.serviceId },
    });

    recommendations.push(rec);
  }

  return recommendations.sort((a, b) => b.score - a.score);
}

/** Returns abandonment stats for the funnel projection dashboard. */
export async function getAbandonmentStats(windowHours = 168): Promise<{
  totalAbandoned: number;
  recoveredCount: number;
  recoveryRate: number;
  avgHoursBeforeAbandonment: number;
}> {
  const result = await db.execute<{
    total_abandoned: number;
    recovered_count: number;
    avg_hours: number;
  }>(sql`
    WITH started AS (
      SELECT session_id, created_at,
             lead(event_type) OVER (PARTITION BY session_id ORDER BY created_at) AS next_event
      FROM ai_platform.sales_funnel_events
      WHERE event_type IN ('checkout.started', 'checkout.completed')
        AND created_at >= now() - ${windowHours} * interval '1 hour'
    )
    SELECT
      count(*) FILTER (WHERE next_event IS DISTINCT FROM 'checkout.completed') AS total_abandoned,
      count(*) FILTER (WHERE next_event = 'checkout.completed') AS recovered_count,
      coalesce(avg(extract(epoch FROM created_at) / 3600)::float, 0) AS avg_hours
    FROM started
    WHERE next_event IS NOT NULL OR next_event IS NULL
  `);

  const rows = (result as unknown as { rows: Array<{
    total_abandoned: string;
    recovered_count: string;
    avg_hours: string;
  }> }).rows ?? [];
  const row = rows[0] ?? { total_abandoned: "0", recovered_count: "0", avg_hours: "0" };

  const total = parseInt(row.total_abandoned, 10) || 0;
  const recovered = parseInt(row.recovered_count, 10) || 0;

  return {
    totalAbandoned: total,
    recoveredCount: recovered,
    recoveryRate: total > 0 ? Math.round((recovered / (total + recovered)) * 1000) / 10 : 0,
    avgHoursBeforeAbandonment: parseFloat(row.avg_hours) || 0,
  };
}

function buildAbandonmentDescription(ab: AbandonedCheckout): string {
  const hours = Math.round(ab.hoursSinceAbandonment);
  if (hours < 2) return `Anda meninggalkan pesanan beberapa menit yang lalu. Selesaikan sekarang sebelum slot habis.`;
  if (hours < 12) return `Pesanan Anda terbengkalai ${hours} jam yang lalu. Kami siap membantu Anda menyelesaikannya.`;
  return `Anda memulai pesanan kemarin — masih ada waktu untuk melanjutkan dan mendapatkan layanan terbaik dari kami.`;
}
