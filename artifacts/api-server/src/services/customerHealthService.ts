/**
 * Customer Health Score Service — Sprint P2.5
 * Rule-based scoring from existing platform data.
 * Uses raw SQL via db.execute; results arrive as { rows: [...] }.
 */
import {
  db,
  aiCustomerHealthScoresTable,
  type AiCustomerHealthScore,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export type HealthStatus = "healthy" | "potential" | "at_risk" | "lost";

function scoreToStatus(score: number): HealthStatus {
  if (score >= 75) return "healthy";
  if (score >= 50) return "potential";
  if (score >= 25) return "at_risk";
  return "lost";
}

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export async function calculateHealthScore(customerProfileId: number): Promise<AiCustomerHealthScore> {
  // Payment on-time rate
  const paymentResult = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'paid')::int AS on_time,
      count(*)::int AS total
    FROM ai_platform.ai_payment_schedule
    WHERE project_id IN (
      SELECT id::text FROM ai_platform.creative_projects
      WHERE client_email = (
        SELECT client_email FROM ai_platform.customer_profiles WHERE id = ${customerProfileId}
      )
    )
  `);

  const reviewResult = await db.execute(sql`
    SELECT coalesce(avg(rating), 0)::float AS avg_rating
    FROM ai_platform.creative_ai_client_reviews
    WHERE client_email = (
      SELECT client_email FROM ai_platform.customer_profiles WHERE id = ${customerProfileId}
    )
  `);

  const projectResult = await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'completed')::int AS completed
    FROM ai_platform.creative_projects
    WHERE client_email = (
      SELECT client_email FROM ai_platform.customer_profiles WHERE id = ${customerProfileId}
    )
  `);

  type PaymentRow = { on_time: string; total: string };
  type ReviewRow  = { avg_rating: string };
  type ProjectRow = { total: string; completed: string };

  const pr = rows<PaymentRow>(paymentResult)[0] ?? { on_time: "0", total: "0" };
  const rr = rows<ReviewRow>(reviewResult)[0]   ?? { avg_rating: "0" };
  const pj = rows<ProjectRow>(projectResult)[0] ?? { total: "0", completed: "0" };

  const totalPayments   = parseInt(pr.total, 10)     || 0;
  const onTimePayments  = parseInt(pr.on_time, 10)   || 0;
  const totalProjects   = parseInt(pj.total, 10)     || 0;
  const avgRating       = parseFloat(rr.avg_rating)  || 0;

  const paymentScore      = totalPayments > 0 ? Math.round((onTimePayments / totalPayments) * 100) : 50;
  const activityScore     = Math.min(totalProjects * 20, 100);
  const repeatOrderScore  = totalProjects > 1 ? Math.min((totalProjects - 1) * 25, 100) : 0;
  const reviewScore       = avgRating > 0 ? Math.round((avgRating / 5) * 100) : 50;
  const responseTimeScore = 70; // placeholder
  const overallScore      = Math.round(
    paymentScore * 0.3 + activityScore * 0.2 + repeatOrderScore * 0.25 +
    reviewScore * 0.15 + responseTimeScore * 0.1,
  );

  const healthStatus = scoreToStatus(overallScore);

  const [row] = await db
    .insert(aiCustomerHealthScoresTable)
    .values({
      customerProfileId,
      paymentScore,
      activityScore,
      repeatOrderScore,
      reviewScore,
      responseTimeScore,
      overallScore,
      healthStatus,
      lastCalculatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiCustomerHealthScoresTable.customerProfileId,
      set: {
        paymentScore,
        activityScore,
        repeatOrderScore,
        reviewScore,
        responseTimeScore,
        overallScore,
        healthStatus,
        lastCalculatedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

export async function listHealthScores(): Promise<AiCustomerHealthScore[]> {
  return db.select().from(aiCustomerHealthScoresTable).orderBy(sql`overall_score desc`);
}

export async function getHealthScore(customerProfileId: number): Promise<AiCustomerHealthScore | null> {
  const [row] = await db
    .select()
    .from(aiCustomerHealthScoresTable)
    .where(eq(aiCustomerHealthScoresTable.customerProfileId, customerProfileId))
    .limit(1);
  return row ?? null;
}
