import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiPromotionsTable = appSchema.table("ai_promotions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  discountType: text("discount_type").notNull(),
  discountValue: integer("discount_value"),
  benefitLabel: text("benefit_label"),
  serviceId: integer("service_id"),
  packageId: integer("package_id"),
  industry: text("industry"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiPromotionSchema = createInsertSchema(aiPromotionsTable).omit({
  id: true,
  usageCount: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPromotion = z.infer<typeof insertAiPromotionSchema>;
export type AiPromotion = typeof aiPromotionsTable.$inferSelect;
