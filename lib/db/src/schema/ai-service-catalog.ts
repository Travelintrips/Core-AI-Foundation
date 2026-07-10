import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * AI Service Catalog & Pricing Center
 *
 * Customers don't buy "a design" — they buy an AI Department's service.
 * This module is purely additive: categories -> services -> packages,
 * plus a lightweight request record that hands off to the existing
 * AI Orchestrator / Department / Workflow pipeline.
 */

export const aiServiceCategoriesTable = appSchema.table("ai_service_categories", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  displayOrder: integer("display_order").notNull().default(0),
  status: text("status").notNull().default("active"), // active | draft | archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServiceCategorySchema = createInsertSchema(aiServiceCategoriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiServiceCategory = z.infer<typeof insertAiServiceCategorySchema>;
export type AiServiceCategory = typeof aiServiceCategoriesTable.$inferSelect;

export const aiServicesTable = appSchema.table("ai_services", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull().references(() => aiServiceCategoriesTable.id, { onDelete: "cascade" }),
  serviceCode: text("service_code").notNull().unique(),
  serviceName: text("service_name").notNull(),
  shortDescription: text("short_description"),
  fullDescription: text("full_description"),
  serviceType: text("service_type").notNull().default("project"), // project | ongoing | consultation
  pricingModel: text("pricing_model").notNull().default("one_time"), // one_time | monthly_subscription | yearly_subscription | enterprise_custom
  startingPrice: numeric("starting_price", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
  estimatedDelivery: text("estimated_delivery"),
  humanReview: boolean("human_review").notNull().default(false),
  aiOnly: boolean("ai_only").notNull().default(true),
  subscriptionSupported: boolean("subscription_supported").notNull().default(false),
  enterpriseSupported: boolean("enterprise_supported").notNull().default(false),
  department: text("department"),
  workflowSummary: text("workflow_summary"),
  aiEmployeesInvolved: jsonb("ai_employees_involved").$type<string[]>(),
  deliverables: jsonb("deliverables").$type<string[]>(),
  revisionPolicy: text("revision_policy"),
  status: text("status").notNull().default("active"), // active | draft | archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServiceSchema = createInsertSchema(aiServicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiService = z.infer<typeof insertAiServiceSchema>;
export type AiService = typeof aiServicesTable.$inferSelect;

export const aiServicePackagesTable = appSchema.table("ai_service_packages", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "cascade" }),
  packageName: text("package_name").notNull(),
  packageType: text("package_type").notNull().default("standard"), // standard | pro | enterprise
  monthlyPrice: numeric("monthly_price", { precision: 12, scale: 2 }),
  yearlyPrice: numeric("yearly_price", { precision: 12, scale: 2 }),
  oneTimePrice: numeric("one_time_price", { precision: 12, scale: 2 }),
  featuresJson: jsonb("features_json").$type<string[]>(),
  limitsJson: jsonb("limits_json").$type<Record<string, unknown>>(),
  slaJson: jsonb("sla_json").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("active"), // active | draft | archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServicePackageSchema = createInsertSchema(aiServicePackagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiServicePackage = z.infer<typeof insertAiServicePackageSchema>;
export type AiServicePackage = typeof aiServicePackagesTable.$inferSelect;

/**
 * Request Service — customer intent, before it becomes an actual project.
 * Kept separate from creative_projects (which is Creative AI-specific) so
 * every department's services can flow through the same intake shape.
 */
export const aiServiceRequestsTable = appSchema.table("ai_service_requests", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull().unique(), // UUID, client-facing
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "restrict" }),
  packageId: integer("package_id").references(() => aiServicePackagesTable.id, { onDelete: "set null" }),
  pricingModelSelected: text("pricing_model_selected").notNull().default("one_time"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  companyName: text("company_name"),
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending | orchestrating | in_progress | completed | cancelled
  createdProjectId: text("created_project_id"), // set once handed off to a project/workflow
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServiceRequestSchema = createInsertSchema(aiServiceRequestsTable).omit({
  id: true,
  requestId: true,
  status: true,
  createdProjectId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiServiceRequest = z.infer<typeof insertAiServiceRequestSchema>;
export type AiServiceRequest = typeof aiServiceRequestsTable.$inferSelect;
