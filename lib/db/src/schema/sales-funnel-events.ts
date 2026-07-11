import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const salesFunnelEventsTable = appSchema.table("sales_funnel_events", {
  id: serial("id").primaryKey(),
  visitorId: text("visitor_id"),
  customerId: integer("customer_id"),
  sessionId: text("session_id"),
  eventType: text("event_type").notNull(),
  serviceId: integer("service_id"),
  portfolioId: integer("portfolio_id"),
  projectId: text("project_id"),
  packageId: integer("package_id"),
  campaignId: text("campaign_id"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  device: text("device"),
  country: text("country"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSalesFunnelEventSchema = createInsertSchema(salesFunnelEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSalesFunnelEvent = z.infer<typeof insertSalesFunnelEventSchema>;
export type SalesFunnelEvent = typeof salesFunnelEventsTable.$inferSelect;
