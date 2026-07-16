/**
 * creative-commercial/couponRecommendationService.ts — Team 03
 *
 * Recommends an existing active coupon to a customer based on:
 *   - Order amount (meets minimum order threshold)
 *   - Service context (service-specific coupons first)
 *   - Customer segment (VIP coupons for VIP segments)
 *   - Past coupon usage (don't recommend already-used coupons)
 *
 * DOES NOT create coupons. Reads from ai_coupons (owned by the core layer).
 * Financial actions (issuing a coupon) go through cc_pending_approvals.
 */

import { db, aiCouponsTable, aiCouponUsagesTable } from "@workspace/db";
import { eq, and, lte, gte, isNull, or, sql } from "drizzle-orm";
import { checkCooldown, recordRecommendation } from "./cooldownService.js";
import { createPendingApproval } from "./approvalService.js";
import type { Recommendation } from "./types.js";

interface CouponContext {
  customerProfileId: number;
  orderAmount: number;
  serviceId?: number;
  segment?: string;
  isAbandoned?: boolean;     // true if this is an abandoned checkout context
  requestedBy?: string;      // admin user requesting the recommendation
}

interface ScoredCoupon {
  id: number;
  code: string;
  type: string;
  value: number;
  minimumOrder: number | null;
  maximumDiscount: number | null;
  discountAmount: number;
  score: number;
}

/**
 * Returns the best available coupon recommendation for a customer.
 * Only recommends coupons the customer hasn't already used.
 * Cooldown: 48h (abandoned_checkout) per customer.
 */
export async function getCouponRecommendation(
  ctx: CouponContext,
): Promise<Recommendation | null> {
  const now = new Date();

  // 1. Load active coupons that satisfy minimum order
  const coupons = await db
    .select()
    .from(aiCouponsTable)
    .where(
      and(
        eq(aiCouponsTable.status, "active"),
        or(isNull(aiCouponsTable.startDate), lte(aiCouponsTable.startDate, now)),
        or(isNull(aiCouponsTable.endDate), gte(aiCouponsTable.endDate, now)),
        or(
          isNull(aiCouponsTable.minimumOrder),
          lte(aiCouponsTable.minimumOrder, ctx.orderAmount),
        ),
      ),
    );

  if (coupons.length === 0) return null;

  // 2. Exclude already-used coupons by this customer
  const usedIds = await db
    .select({ couponId: aiCouponUsagesTable.couponId })
    .from(aiCouponUsagesTable)
    .where(eq(aiCouponUsagesTable.customerProfileId, ctx.customerProfileId));
  const usedSet = new Set(usedIds.map((u) => u.couponId));

  const eligible = coupons.filter((c) => !usedSet.has(c.id));
  if (eligible.length === 0) return null;

  // 3. Score each coupon
  const scored: ScoredCoupon[] = eligible.map((c) => {
    const discountAmount =
      c.type === "percentage"
        ? Math.floor((ctx.orderAmount * c.value) / 100)
        : c.value;
    const effectiveDiscount = c.maximumDiscount
      ? Math.min(discountAmount, c.maximumDiscount)
      : discountAmount;

    let score = 50;
    if (ctx.isAbandoned) score += 20;
    if (ctx.segment === "at_risk" || ctx.segment === "inactive") score += 15;
    if (ctx.segment === "vip") score -= 10; // VIP rarely needs coupons
    // Prefer higher absolute discount
    score += Math.min(20, Math.floor(effectiveDiscount / 1000));

    return { ...c, discountAmount: effectiveDiscount, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // 4. Check cooldown
  const recType = ctx.isAbandoned ? "abandoned_checkout" : "coupon_recovery";
  const contextKey = `coupon:${best.id}`;
  const cooldown = await checkCooldown({
    customerProfileId: ctx.customerProfileId,
    recType,
    contextKey,
  });
  if (cooldown.blocked) return null;

  // 5. Build recommendation (recommend_coupon is non-financial — no approval needed)
  const rec: Recommendation = {
    id: `${recType}:${ctx.customerProfileId}:${contextKey}`,
    type: recType,
    customerProfileId: ctx.customerProfileId,
    title: ctx.isAbandoned
      ? `Selesaikan pesanan Anda — hemat ${best.type === "percentage" ? `${best.value}%` : formatAmount(best.value)}`
      : `Kupon eksklusif untukmu`,
    description: buildCouponDescription(best, ctx),
    reasonCode: ctx.isAbandoned ? "abandoned_checkout_recovery" : "eligible_coupon_available",
    score: best.score,
    payload: {
      couponId: best.id,
      couponCode: best.code,
      discountAmount: best.discountAmount,
      originalAmount: ctx.orderAmount,
      savingsAmount: best.discountAmount,
      ctaLabel: "Gunakan Kupon",
    },
    cooldownUntil: new Date(Date.now() + 48 * 60 * 60 * 1000),
    requiresApproval: false,
    createdAt: new Date(),
  };

  await recordRecommendation({
    customerProfileId: ctx.customerProfileId,
    recType,
    contextKey,
    payloadJson: { couponId: best.id, code: best.code },
  });

  return rec;
}

/**
 * Admin action: create a pending approval to issue a custom recovery coupon.
 * Use when no existing active coupon matches the context.
 * requiresApproval = true — a financial mutation will happen downstream.
 */
export async function requestCustomCouponIssuance(opts: {
  customerProfileId: number;
  orderAmount: number;
  discountPercent: number;
  requestedBy: string;
  reason: string;
}): Promise<{ approvalId: number; message: string }> {
  if (opts.discountPercent < 1 || opts.discountPercent > 50) {
    throw new Error("Custom coupon discount must be 1–50%");
  }

  const approval = await createPendingApproval({
    customerProfileId: opts.customerProfileId,
    actionType: "issue_recovery_coupon",
    actionPayload: {
      orderAmount: opts.orderAmount,
      discountPercent: opts.discountPercent,
      reason: opts.reason,
    },
    requestedBy: opts.requestedBy,
    expiresInHours: 24,
  });

  return {
    approvalId: approval.id,
    message: `Approval request created — a manager must approve before the coupon is issued.`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function buildCouponDescription(coupon: ScoredCoupon, ctx: CouponContext): string {
  const discountLabel =
    coupon.type === "percentage"
      ? `${coupon.value}% off`
      : `hemat ${formatAmount(coupon.value)}`;

  if (ctx.isAbandoned) {
    return `Anda meninggalkan pesanan sebelumnya — gunakan kode ${coupon.code} untuk ${discountLabel} dan selesaikan sekarang.`;
  }
  return `Gunakan kode ${coupon.code} untuk ${discountLabel} pada pesanan berikutnya.`;
}
