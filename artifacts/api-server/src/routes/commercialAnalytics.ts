import { Router } from "express";
import { db, aiInvoicesTable, creativeProjectsTable, customerProfilesTable,
  aiCouponsTable, aiPromotionsTable, aiReferralsTable, aiAffiliatesTable,
  aiAbTestsTable, aiAbVariantsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { generateInsights } from "../services/salesManagerService";

const router = Router();

// GET /ai/commercial-analytics
router.get("/ai/commercial-analytics", async (req, res): Promise<void> => {
  const days = Math.min(parseInt(String(req.query.days ?? 30), 10) || 30, 365);
  const since = sql.raw(`now() - interval '${days} days'`);

  const [revenueRow, projectRow, customerRow, couponRow, promoRow, referralRow, affiliateRow] =
    await Promise.all([
      db.execute<{ total: number; mrr: number; avg_order: number }>(sql`
        SELECT
          coalesce(sum(amount), 0) AS total,
          coalesce(sum(amount) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS mrr,
          coalesce(avg(amount), 0) AS avg_order
        FROM ai_platform.ai_invoices
        WHERE status = 'paid' AND created_at >= now() - interval '30 days'
      `),
      db.execute<{ total: number; completed: number }>(sql`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE status = 'completed') AS completed
        FROM ai_platform.creative_projects
        WHERE created_at >= ${since}
      `),
      db.execute<{ total: number; new_customers: number }>(sql`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE created_at >= ${since}) AS new_customers
        FROM ai_platform.customer_profiles
      `),
      db.execute<{ total_used: number; total_discount: number }>(sql`
        SELECT count(*) AS total_used, coalesce(sum(discount_amount), 0) AS total_discount
        FROM ai_platform.ai_coupon_usages
        WHERE used_at >= ${since}
      `),
      db.execute<{ total: number }>(sql`
        SELECT count(*) AS total FROM ai_platform.ai_promotions WHERE status = 'active'
      `),
      db.execute<{ total: number; converted: number }>(sql`
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE status IN ('converted','rewarded')) AS converted
        FROM ai_platform.ai_referrals
        WHERE created_at >= ${since}
      `),
      db.execute<{ total_revenue: number; total_commission: number }>(sql`
        SELECT
          coalesce(sum(total_revenue), 0) AS total_revenue,
          coalesce(sum(total_commission), 0) AS total_commission
        FROM ai_platform.ai_affiliates
      `),
    ]);

  const revenue = (revenueRow as unknown as { rows: Array<Record<string, string>> }).rows?.[0] ?? {};
  const projects = (projectRow as unknown as { rows: Array<Record<string, string>> }).rows?.[0] ?? {};
  const customers = (customerRow as unknown as { rows: Array<Record<string, string>> }).rows?.[0] ?? {};
  const coupons = (couponRow as unknown as { rows: Array<Record<string, string>> }).rows?.[0] ?? {};
  const promos = (promoRow as unknown as { rows: Array<Record<string, string>> }).rows?.[0] ?? {};
  const referrals = (referralRow as unknown as { rows: Array<Record<string, string>> }).rows?.[0] ?? {};
  const affiliates = (affiliateRow as unknown as { rows: Array<Record<string, string>> }).rows?.[0] ?? {};

  const totalRevenue = parseFloat(revenue.total ?? "0") || 0;
  const mrr = parseFloat(revenue.mrr ?? "0") || 0;
  const arr = mrr * 12;
  const avgOrderValue = parseFloat(revenue.avg_order ?? "0") || 0;
  const totalProjects = parseInt(projects.total ?? "0", 10) || 0;
  const completedProjects = parseInt(projects.completed ?? "0", 10) || 0;
  const conversionRate = totalProjects > 0
    ? Math.round((completedProjects / totalProjects) * 1000) / 10
    : 0;

  res.json({
    days,
    revenue: {
      total: totalRevenue,
      mrr,
      arr,
      avgOrderValue,
    },
    projects: {
      total: totalProjects,
      completed: completedProjects,
      conversionRate,
    },
    customers: {
      total: parseInt(customers.total ?? "0", 10) || 0,
      newInPeriod: parseInt(customers.new_customers ?? "0", 10) || 0,
    },
    coupons: {
      totalUsed: parseInt(coupons.total_used ?? "0", 10) || 0,
      totalDiscount: parseFloat(coupons.total_discount ?? "0") || 0,
    },
    promotions: {
      activeCount: parseInt(promos.total ?? "0", 10) || 0,
    },
    referrals: {
      total: parseInt(referrals.total ?? "0", 10) || 0,
      converted: parseInt(referrals.converted ?? "0", 10) || 0,
    },
    affiliates: {
      totalRevenue: parseFloat(affiliates.total_revenue ?? "0") || 0,
      totalCommission: parseFloat(affiliates.total_commission ?? "0") || 0,
    },
  });
});

// GET /ai/commercial-analytics/insights
router.get("/ai/commercial-analytics/insights", async (_req, res): Promise<void> => {
  const insights = await generateInsights();
  res.json({ items: insights, total: insights.length });
});

// GET /ai/ab-tests
router.get("/ai/ab-tests", async (_req, res): Promise<void> => {
  const tests = await db.select().from(aiAbTestsTable).orderBy(sql`created_at desc`);
  const testsWithVariants = await Promise.all(
    tests.map(async (t) => {
      const variants = await db.select().from(aiAbVariantsTable).where(sql`test_id = ${t.id}`);
      return { ...t, variants };
    }),
  );
  res.json({ items: testsWithVariants, total: testsWithVariants.length });
});

// POST /ai/ab-tests
router.post("/ai/ab-tests", async (req, res): Promise<void> => {
  const { name, description, testType, variants, startDate, endDate } = req.body;
  if (!name || !testType) {
    res.status(400).json({ error: "name and testType are required" });
    return;
  }
  if (!["package","promotion","cta"].includes(testType)) {
    res.status(400).json({ error: "testType must be package, promotion, or cta" });
    return;
  }

  const [test] = await db.insert(aiAbTestsTable).values({
    name, description, testType, status: "active",
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  }).returning();

  const variantList = Array.isArray(variants) ? variants : [
    { name: "Variant A", label: "A" },
    { name: "Variant B", label: "B" },
  ];

  const insertedVariants = await db.insert(aiAbVariantsTable).values(
    variantList.map((v: { name: string; label?: string }) => ({
      testId: test.id,
      name: v.name,
      label: v.label,
    })),
  ).returning();

  res.status(201).json({ ...test, variants: insertedVariants });
});

// POST /ai/ab-tests/:testId/variants/:variantId/record
router.post("/ai/ab-tests/:testId/variants/:variantId/record", async (req, res): Promise<void> => {
  const variantId = parseInt(req.params.variantId, 10);
  const { metric } = req.body; // impressions | clicks | checkouts | conversions
  const VALID_METRICS = ["impressions","clicks","checkouts","conversions"];
  if (!metric || !VALID_METRICS.includes(metric)) {
    res.status(400).json({ error: `metric must be one of: ${VALID_METRICS.join(", ")}` });
    return;
  }

  await db.execute(sql`
    UPDATE ai_platform.ai_ab_variants
    SET ${sql.raw(metric)} = ${sql.raw(metric)} + 1
    WHERE id = ${variantId}
  `);

  res.json({ ok: true });
});

export default router;
