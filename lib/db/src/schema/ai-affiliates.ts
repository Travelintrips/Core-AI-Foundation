import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiAffiliatesTable = appSchema.table("ai_affiliates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  affiliateCode: text("affiliate_code").notNull().unique(),
  commissionRate: integer("commission_rate").notNull().default(10),
  status: text("status").notNull().default("active"),
  totalClicks: integer("total_clicks").notNull().default(0),
  totalConversions: integer("total_conversions").notNull().default(0),
  totalRevenue: integer("total_revenue").notNull().default(0),
  totalCommission: integer("total_commission").notNull().default(0),
  pendingCommission: integer("pending_commission").notNull().default(0),
  paidCommission: integer("paid_commission").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const aiAffiliateClicksTable = appSchema.table("ai_affiliate_clicks", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").notNull().references(() => aiAffiliatesTable.id, { onDelete: "cascade" }),
  visitorId: text("visitor_id"),
  sessionId: text("session_id"),
  landingPage: text("landing_page"),
  device: text("device"),
  country: text("country"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiAffiliateConversionsTable = appSchema.table("ai_affiliate_conversions", {
  id: serial("id").primaryKey(),
  affiliateId: integer("affiliate_id").notNull().references(() => aiAffiliatesTable.id, { onDelete: "cascade" }),
  clickId: integer("click_id").references(() => aiAffiliateClicksTable.id),
  serviceRequestId: integer("service_request_id"),
  orderAmount: integer("order_amount").notNull(),
  commissionAmount: integer("commission_amount").notNull(),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiAffiliateSchema = createInsertSchema(aiAffiliatesTable).omit({
  id: true,
  totalClicks: true,
  totalConversions: true,
  totalRevenue: true,
  totalCommission: true,
  pendingCommission: true,
  paidCommission: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiAffiliate = z.infer<typeof insertAiAffiliateSchema>;
export type AiAffiliate = typeof aiAffiliatesTable.$inferSelect;
export type AiAffiliateClick = typeof aiAffiliateClicksTable.$inferSelect;
export type AiAffiliateConversion = typeof aiAffiliateConversionsTable.$inferSelect;
