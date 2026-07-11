import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiAbTestsTable = appSchema.table("ai_ab_tests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  testType: text("test_type").notNull(),
  status: text("status").notNull().default("active"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  winnerVariantId: integer("winner_variant_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const aiAbVariantsTable = appSchema.table("ai_ab_variants", {
  id: serial("id").primaryKey(),
  testId: integer("test_id").notNull().references(() => aiAbTestsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label"),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  checkouts: integer("checkouts").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  revenue: integer("revenue").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiAbTestSchema = createInsertSchema(aiAbTestsTable).omit({
  id: true,
  winnerVariantId: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAiAbVariantSchema = createInsertSchema(aiAbVariantsTable).omit({
  id: true,
  impressions: true,
  clicks: true,
  checkouts: true,
  conversions: true,
  revenue: true,
  createdAt: true,
});
export type InsertAiAbTest = z.infer<typeof insertAiAbTestSchema>;
export type InsertAiAbVariant = z.infer<typeof insertAiAbVariantSchema>;
export type AiAbTest = typeof aiAbTestsTable.$inferSelect;
export type AiAbVariant = typeof aiAbVariantsTable.$inferSelect;
