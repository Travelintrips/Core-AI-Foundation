import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiCustomerHealthScoresTable = appSchema.table("ai_customer_health_scores", {
  id: serial("id").primaryKey(),
  customerProfileId: integer("customer_profile_id").notNull().unique(),
  paymentScore: integer("payment_score").notNull().default(0),
  activityScore: integer("activity_score").notNull().default(0),
  repeatOrderScore: integer("repeat_order_score").notNull().default(0),
  reviewScore: integer("review_score").notNull().default(0),
  responseTimeScore: integer("response_time_score").notNull().default(0),
  overallScore: integer("overall_score").notNull().default(0),
  healthStatus: text("health_status").notNull().default("potential"),
  lastCalculatedAt: timestamp("last_calculated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiCustomerHealthScoreSchema = createInsertSchema(aiCustomerHealthScoresTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiCustomerHealthScore = z.infer<typeof insertAiCustomerHealthScoreSchema>;
export type AiCustomerHealthScore = typeof aiCustomerHealthScoresTable.$inferSelect;
