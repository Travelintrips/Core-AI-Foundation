import { db, aiPromotionsTable, type InsertAiPromotion, type AiPromotion } from "@workspace/db";
import { eq, and, lte, gte, isNull, or, sql } from "drizzle-orm";

export async function listPromotions(includeExpired = false): Promise<AiPromotion[]> {
  const q = db.select().from(aiPromotionsTable).orderBy(sql`created_at desc`);
  if (!includeExpired) {
    return q.where(eq(aiPromotionsTable.status, "active"));
  }
  return q;
}

export async function createPromotion(data: InsertAiPromotion): Promise<AiPromotion> {
  const [row] = await db.insert(aiPromotionsTable).values(data).returning();
  return row;
}

export async function updatePromotion(
  id: number,
  data: Partial<InsertAiPromotion>,
): Promise<AiPromotion | null> {
  const [row] = await db
    .update(aiPromotionsTable)
    .set(data)
    .where(eq(aiPromotionsTable.id, id))
    .returning();
  return row ?? null;
}

export async function deletePromotion(id: number): Promise<boolean> {
  const result = await db
    .delete(aiPromotionsTable)
    .where(eq(aiPromotionsTable.id, id))
    .returning({ id: aiPromotionsTable.id });
  return result.length > 0;
}

/** Find active promotions applicable to a given service+package+industry combo */
export async function getApplicablePromotions(opts: {
  serviceId?: number;
  packageId?: number;
  industry?: string;
}): Promise<AiPromotion[]> {
  const now = new Date();
  return db
    .select()
    .from(aiPromotionsTable)
    .where(
      and(
        eq(aiPromotionsTable.status, "active"),
        or(isNull(aiPromotionsTable.startDate), lte(aiPromotionsTable.startDate, now)),
        or(isNull(aiPromotionsTable.endDate), gte(aiPromotionsTable.endDate, now)),
        or(
          isNull(aiPromotionsTable.usageLimit),
          sql`${aiPromotionsTable.usageCount} < ${aiPromotionsTable.usageLimit}`,
        ),
      ),
    );
}
