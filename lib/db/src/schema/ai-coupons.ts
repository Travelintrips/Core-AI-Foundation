import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiCouponsTable = appSchema.table("ai_coupons", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  type: text("type").notNull(),
  value: integer("value").notNull(),
  minimumOrder: integer("minimum_order"),
  maximumDiscount: integer("maximum_discount"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  usageLimit: integer("usage_limit"),
  usagePerCustomer: integer("usage_per_customer").notNull().default(1),
  usageCount: integer("usage_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const aiCouponUsagesTable = appSchema.table("ai_coupon_usages", {
  id: serial("id").primaryKey(),
  couponId: integer("coupon_id").notNull().references(() => aiCouponsTable.id, { onDelete: "cascade" }),
  customerProfileId: integer("customer_profile_id"),
  serviceRequestId: integer("service_request_id"),
  discountAmount: integer("discount_amount").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiCouponSchema = createInsertSchema(aiCouponsTable).omit({
  id: true,
  usageCount: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiCoupon = z.infer<typeof insertAiCouponSchema>;
export type AiCoupon = typeof aiCouponsTable.$inferSelect;
export type AiCouponUsage = typeof aiCouponUsagesTable.$inferSelect;
