/**
 * customerSegmentService — Sprint P2.6
 *
 * Automatically classifies customers into segments based on:
 *   - Order history (count + recency)
 *   - Health score
 *   - Payment behavior
 *
 * Segments: new | returning | vip | enterprise | inactive | lost | high_potential | high_value | at_risk
 */

import { eq, sql } from "drizzle-orm";
import {
  db,
  aiCustomerSegmentsTable,
  aiCustomerHealthScoresTable,
  type AiCustomerSegment,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { logger } from "../lib/logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CustomerSegment =
  | "new"
  | "returning"
  | "vip"
  | "enterprise"
  | "inactive"
  | "lost"
  | "high_potential"
  | "high_value"
  | "at_risk";

const SEGMENT_SCORES: Record<CustomerSegment, number> = {
  vip: 100,
  enterprise: 95,
  high_value: 85,
  returning: 70,
  high_potential: 60,
  new: 50,
  at_risk: 30,
  inactive: 20,
  lost: 5,
};

// ── Calculate segment for one customer ────────────────────────────────────────

export async function calculateCustomerSegment(customerProfileId: number): Promise<AiCustomerSegment> {
  // Load health score
  const [health] = await db
    .select()
    .from(aiCustomerHealthScoresTable)
    .where(eq(aiCustomerHealthScoresTable.customerProfileId, customerProfileId))
    .limit(1);

  // Get customer email from profile (service_requests uses customer_email, not profileId)
  const profileRows = await db.execute(
    sql`SELECT client_email FROM ai_platform.customer_profiles WHERE id = ${customerProfileId} LIMIT 1`,
  );
  const clientEmail = (profileRows as unknown as Array<{ client_email: string }>)[0]?.client_email;

  // Count completed service requests by email
  const reqStatsRows = await db.execute(
    sql`SELECT COUNT(*) as total, MAX(updated_at) as last_order
        FROM ai_platform.ai_service_requests
        WHERE customer_email = ${clientEmail ?? ""}
          AND status = 'completed'`,
  );
  const reqStats = (reqStatsRows as unknown as Array<{ total: string; last_order: string | null }>)[0];

  const completedCount = parseInt(reqStats?.total ?? "0", 10);
  const lastOrderAt = reqStats?.last_order ? new Date(reqStats.last_order) : null;
  const daysSinceOrder = lastOrderAt
    ? Math.floor((Date.now() - lastOrderAt.getTime()) / 86_400_000)
    : 999;
  const overallScore = health?.overallScore ?? 0;
  const healthStatus = health?.healthStatus ?? "potential";

  // Segmentation logic
  let segment: CustomerSegment;

  if (completedCount === 0) {
    segment = "new";
  } else if (completedCount >= 10 || overallScore >= 90) {
    segment = "vip";
  } else if (completedCount >= 5 && overallScore >= 75) {
    segment = "high_value";
  } else if (completedCount >= 3) {
    segment = "returning";
  } else if (healthStatus === "at_risk" || (daysSinceOrder > 90 && completedCount >= 1)) {
    segment = "at_risk";
  } else if (daysSinceOrder > 180) {
    segment = "lost";
  } else if (daysSinceOrder > 60) {
    segment = "inactive";
  } else if (overallScore >= 60 && completedCount === 1) {
    segment = "high_potential";
  } else {
    segment = "returning";
  }

  const score = SEGMENT_SCORES[segment];

  // Upsert
  const [existing] = await db
    .select()
    .from(aiCustomerSegmentsTable)
    .where(eq(aiCustomerSegmentsTable.customerProfileId, customerProfileId))
    .limit(1);

  const previousSegment = existing?.segment ?? null;
  const segmentChanged = previousSegment && previousSegment !== segment;

  let result: AiCustomerSegment;

  if (existing) {
    [result] = await db
      .update(aiCustomerSegmentsTable)
      .set({
        segment,
        previousSegment: existing.segment,
        segmentScore: score,
        segmentReason: `orders=${completedCount}, healthScore=${overallScore}, daysSinceOrder=${daysSinceOrder}`,
        calculatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiCustomerSegmentsTable.customerProfileId, customerProfileId))
      .returning();
  } else {
    [result] = await db
      .insert(aiCustomerSegmentsTable)
      .values({
        customerProfileId,
        segment,
        segmentScore: score,
        segmentReason: `orders=${completedCount}, healthScore=${overallScore}, daysSinceOrder=${daysSinceOrder}`,
      })
      .returning();
  }

  if (segmentChanged) {
    await logAudit("segmentation", "segment_changed", String(customerProfileId), "ai_customer_segment", "success", {
      from: previousSegment, to: segment,
    });
    publishSafe({
      eventType: "customer.segment_changed",
      sourceModule: "segmentation",
      sourceId: String(customerProfileId),
      payload: { customerProfileId, from: previousSegment, to: segment, score },
    });

    // Notify owner of high-value transitions
    if (segment === "vip" || segment === "high_value") {
      publishSafe({
        eventType: "automation.high_value_customer",
        sourceModule: "segmentation",
        sourceId: String(customerProfileId),
        payload: { customerProfileId, segment, previousSegment },
      });
    }
    if (segment === "lost" || segment === "at_risk") {
      publishSafe({
        eventType: "automation.at_risk_customer",
        sourceModule: "segmentation",
        sourceId: String(customerProfileId),
        payload: { customerProfileId, segment, previousSegment },
      });
    }
  }

  logger.info({ customerProfileId, segment, score }, "[segmentation] segment calculated");
  return result;
}

// ── Batch recalculate all customers ──────────────────────────────────────────

export async function recalculateAllSegments(): Promise<{ processed: number; errors: number }> {
  // Iterate over all customer profiles (the canonical source)
  const profileRows = await db.execute(
    sql`SELECT id FROM ai_platform.customer_profiles`,
  );
  const profiles = profileRows as unknown as Array<{ id: number }>;

  let processed = 0;
  let errors = 0;

  for (const { id } of profiles) {
    try {
      await calculateCustomerSegment(id);
      processed++;
    } catch (err) {
      logger.error({ err, profileId: id }, "[segmentation] error calculating segment");
      errors++;
    }
  }

  return { processed, errors };
}

// ── Get segment for customer ──────────────────────────────────────────────────

export async function getCustomerSegment(customerProfileId: number): Promise<AiCustomerSegment | null> {
  const [row] = await db
    .select()
    .from(aiCustomerSegmentsTable)
    .where(eq(aiCustomerSegmentsTable.customerProfileId, customerProfileId))
    .limit(1);
  return row ?? null;
}

// ── List segment distribution ─────────────────────────────────────────────────

export async function getSegmentDistribution(): Promise<Record<CustomerSegment, number>> {
  const rows = await db.select().from(aiCustomerSegmentsTable);
  const dist: Record<string, number> = {};
  for (const row of rows) {
    dist[row.segment] = (dist[row.segment] ?? 0) + 1;
  }
  return dist as Record<CustomerSegment, number>;
}
