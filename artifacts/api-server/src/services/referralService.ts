import { db, aiReferralsTable, type InsertAiReferral, type AiReferral } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import crypto from "node:crypto";

function generateReferralCode(profileId: number): string {
  const base = crypto.createHash("sha256").update(`referral-${profileId}-${Date.now()}`).digest("hex");
  return base.slice(0, 8).toUpperCase();
}

export async function getOrCreateReferral(customerProfileId: number, baseUrl: string): Promise<AiReferral> {
  const [existing] = await db
    .select()
    .from(aiReferralsTable)
    .where(eq(aiReferralsTable.referrerProfileId, customerProfileId))
    .limit(1);

  if (existing) return existing;

  const code = generateReferralCode(customerProfileId);
  const [row] = await db
    .insert(aiReferralsTable)
    .values({
      referrerProfileId: customerProfileId,
      referralCode: code,
      referralLink: `${baseUrl}/?ref=${code}`,
      status: "pending",
    })
    .returning();
  return row;
}

export async function listReferrals(opts?: { referrerProfileId?: number }): Promise<AiReferral[]> {
  const q = db.select().from(aiReferralsTable).orderBy(sql`created_at desc`);
  if (opts?.referrerProfileId) {
    return q.where(eq(aiReferralsTable.referrerProfileId, opts.referrerProfileId));
  }
  return q;
}

export async function convertReferral(code: string, refereeProfileId: number): Promise<AiReferral | null> {
  const [referral] = await db
    .select()
    .from(aiReferralsTable)
    .where(eq(aiReferralsTable.referralCode, code))
    .limit(1);

  if (!referral || referral.status !== "pending") return null;

  // Abuse protection: referee cannot be the same as referrer
  if (referral.referrerProfileId === refereeProfileId) return null;

  const [updated] = await db
    .update(aiReferralsTable)
    .set({
      refereeProfileId,
      status: "converted",
      convertedAt: new Date(),
    })
    .where(eq(aiReferralsTable.id, referral.id))
    .returning();

  return updated ?? null;
}

export async function getReferralStats(customerProfileId: number) {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(aiReferralsTable)
    .where(eq(aiReferralsTable.referrerProfileId, customerProfileId));

  const [{ converted }] = await db
    .select({ converted: sql<number>`count(*)::int` })
    .from(aiReferralsTable)
    .where(and(
      eq(aiReferralsTable.referrerProfileId, customerProfileId),
      sql`status = 'converted'`,
    ));

  return { total, converted };
}
