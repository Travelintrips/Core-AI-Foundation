import {
  db,
  aiCouponsTable,
  aiCouponUsagesTable,
  type InsertAiCoupon,
  type AiCoupon,
} from "@workspace/db";
import { eq, and, lte, gte, isNull, or, sql } from "drizzle-orm";

export interface CouponValidationResult {
  valid: boolean;
  reason?: string;
  coupon?: AiCoupon;
  discountAmount?: number;
}

export async function listCoupons(): Promise<AiCoupon[]> {
  return db.select().from(aiCouponsTable).orderBy(sql`created_at desc`);
}

export class DuplicateCouponError extends Error {
  constructor(code: string) {
    super(`Coupon code '${code}' already exists`);
    this.name = "DuplicateCouponError";
  }
}

/** Drizzle may wrap the pg error in a "Failed query" wrapper; walk the cause chain. */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("code" in err && (err as { code?: string }).code === "23505") return true;
  if ("cause" in err) return isUniqueViolation((err as { cause?: unknown }).cause);
  return false;
}

export async function createCoupon(data: InsertAiCoupon): Promise<AiCoupon> {
  try {
    const [row] = await db.insert(aiCouponsTable).values(data).returning();
    return row;
  } catch (err: unknown) {
    // Postgres unique_violation (23505) → domain error; route maps to 409
    if (isUniqueViolation(err)) {
      throw new DuplicateCouponError(data.code);
    }
    throw err;
  }
}

export async function updateCoupon(
  id: number,
  data: Partial<InsertAiCoupon>,
): Promise<AiCoupon | null> {
  const [row] = await db
    .update(aiCouponsTable)
    .set(data)
    .where(eq(aiCouponsTable.id, id))
    .returning();
  return row ?? null;
}

export async function validateCoupon(opts: {
  code: string;
  orderAmount: number;
  customerProfileId?: number;
}): Promise<CouponValidationResult> {
  const now = new Date();
  const [coupon] = await db
    .select()
    .from(aiCouponsTable)
    .where(eq(aiCouponsTable.code, opts.code.toUpperCase()))
    .limit(1);

  if (!coupon) return { valid: false, reason: "Coupon not found" };
  if (coupon.status !== "active") return { valid: false, reason: "Coupon is not active" };
  if (coupon.startDate && coupon.startDate > now) return { valid: false, reason: "Coupon not yet valid" };
  if (coupon.endDate && coupon.endDate < now) return { valid: false, reason: "Coupon has expired" };
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, reason: "Coupon usage limit reached" };
  }
  if (coupon.minimumOrder && opts.orderAmount < coupon.minimumOrder) {
    return { valid: false, reason: `Minimum order is ${coupon.minimumOrder}` };
  }

  // Per-customer abuse protection
  if (opts.customerProfileId && coupon.usagePerCustomer) {
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(aiCouponUsagesTable)
      .where(
        and(
          eq(aiCouponUsagesTable.couponId, coupon.id),
          eq(aiCouponUsagesTable.customerProfileId, opts.customerProfileId),
        ),
      );
    if (cnt >= coupon.usagePerCustomer) {
      return { valid: false, reason: "You have already used this coupon" };
    }
  }

  let discountAmount =
    coupon.type === "percentage"
      ? Math.floor((opts.orderAmount * coupon.value) / 100)
      : coupon.value;

  if (coupon.maximumDiscount) {
    discountAmount = Math.min(discountAmount, coupon.maximumDiscount);
  }

  return { valid: true, coupon, discountAmount };
}

export async function redeemCoupon(opts: {
  couponId: number;
  customerProfileId?: number;
  serviceRequestId?: number;
  discountAmount: number;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(aiCouponUsagesTable).values({
      couponId: opts.couponId,
      customerProfileId: opts.customerProfileId,
      serviceRequestId: opts.serviceRequestId,
      discountAmount: opts.discountAmount,
    });
    await tx
      .update(aiCouponsTable)
      .set({ usageCount: sql`usage_count + 1` })
      .where(eq(aiCouponsTable.id, opts.couponId));
  });
}
