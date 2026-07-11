import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const creativeProjectsTable = appSchema.table("creative_projects", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull().unique(), // UUID string, client-facing ID
  // Legacy compatibility: source_type distinguishes direct (legacy) from service_catalog flow.
  // service_request_id and service_quotation_id are nullable — legacy projects leave them null.
  sourceType: text("source_type").notNull().default("direct"), // direct | service_catalog
  serviceRequestId: integer("service_request_id"), // nullable FK to ai_service_requests.id
  serviceQuotationId: integer("service_quotation_id"), // nullable FK to ai_quotations.id
  brandName: text("brand_name").notNull(),
  businessType: text("business_type").notNull(),
  targetMarket: text("target_market").notNull(),
  productOrService: text("product_or_service").notNull(),
  stylePreference: text("style_preference"),
  colorPreference: text("color_preference"),
  referenceLinks: text("reference_links"),
  goal: text("goal").notNull(),
  notes: text("notes"),
  deadline: text("deadline"),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  result: jsonb("result"), // aggregated final output from all agents
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCreativeProjectSchema = createInsertSchema(creativeProjectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeProject = z.infer<typeof insertCreativeProjectSchema>;
export type CreativeProject = typeof creativeProjectsTable.$inferSelect;
