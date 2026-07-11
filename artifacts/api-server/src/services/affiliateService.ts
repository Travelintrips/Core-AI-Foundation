import {
  db,
  aiAffiliatesTable,
  aiAffiliateClicksTable,
  aiAffiliateConversionsTable,
  type InsertAiAffiliate,
  type AiAffiliate,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";

function generateAffiliateCode(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${slug}${suffix}`;
}

export async function listAffiliates(): Promise<AiAffiliate[]> {
  return db.select().from(aiAffiliatesTable).orderBy(sql`created_at desc`);
}

export async function createAffiliate(data: InsertAiAffiliate): Promise<AiAffiliate> {
  const code = data.affiliateCode ?? generateAffiliateCode(data.name);
  const [row] = await db
    .insert(aiAffiliatesTable)
    .values({ ...data, affiliateCode: code })
    .returning();
  return row;
}

export async function updateAffiliate(
  id: number,
  data: Partial<InsertAiAffiliate>,
): Promise<AiAffiliate | null> {
  const [row] = await db
    .update(aiAffiliatesTable)
    .set(data)
    .where(eq(aiAffiliatesTable.id, id))
    .returning();
  return row ?? null;
}

export async function recordClick(opts: {
  affiliateId: number;
  visitorId?: string;
  sessionId?: string;
  landingPage?: string;
  device?: string;
  country?: string;
}): Promise<number> {
  const [row] = await db.insert(aiAffiliateClicksTable).values(opts).returning({ id: aiAffiliateClicksTable.id });
  await db
    .update(aiAffiliatesTable)
    .set({ totalClicks: sql`total_clicks + 1` })
    .where(eq(aiAffiliatesTable.id, opts.affiliateId));
  return row.id;
}

export async function recordConversion(opts: {
  affiliateId: number;
  clickId?: number;
  serviceRequestId?: number;
  orderAmount: number;
}): Promise<void> {
  const [affiliate] = await db
    .select()
    .from(aiAffiliatesTable)
    .where(eq(aiAffiliatesTable.id, opts.affiliateId))
    .limit(1);

  if (!affiliate) return;

  const commissionAmount = Math.floor((opts.orderAmount * affiliate.commissionRate) / 100);

  await db.transaction(async (tx) => {
    await tx.insert(aiAffiliateConversionsTable).values({
      affiliateId: opts.affiliateId,
      clickId: opts.clickId,
      serviceRequestId: opts.serviceRequestId,
      orderAmount: opts.orderAmount,
      commissionAmount,
      status: "pending",
    });
    await tx
      .update(aiAffiliatesTable)
      .set({
        totalConversions: sql`total_conversions + 1`,
        totalRevenue: sql`total_revenue + ${opts.orderAmount}`,
        totalCommission: sql`total_commission + ${commissionAmount}`,
        pendingCommission: sql`pending_commission + ${commissionAmount}`,
      })
      .where(eq(aiAffiliatesTable.id, opts.affiliateId));
  });
}

export async function getAffiliateStats(affiliateId: number) {
  const [affiliate] = await db
    .select()
    .from(aiAffiliatesTable)
    .where(eq(aiAffiliatesTable.id, affiliateId))
    .limit(1);

  if (!affiliate) return null;

  const [{ clicks }] = await db
    .select({ clicks: sql<number>`count(*)::int` })
    .from(aiAffiliateClicksTable)
    .where(eq(aiAffiliateClicksTable.affiliateId, affiliateId));

  const [{ conversions }] = await db
    .select({ conversions: sql<number>`count(*)::int` })
    .from(aiAffiliateConversionsTable)
    .where(eq(aiAffiliateConversionsTable.affiliateId, affiliateId));

  return {
    ...affiliate,
    clicksCount: clicks,
    conversionsCount: conversions,
    conversionRate: clicks > 0 ? Math.round((conversions / clicks) * 1000) / 10 : 0,
  };
}
