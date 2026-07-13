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
  tenantId: text("tenant_id"), // null = shared across all tenants; free-text slug once real multi-tenancy lands
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  displayOrder: integer("display_order").notNull().default(0),
  status: text("status").notNull().default("active"), // active | draft | archived
  // Customer/public vs internal-company-only visibility split. Only
  // "public" categories are ever returned to the customer-facing catalog
  // endpoint or shown in the customer portal. Everything else requires an
  // authenticated internal-role session (see middleware/internalAuth.ts).
  visibility: text("visibility").notNull().default("internal"), // public | internal | disabled
  commercialStatus: text("commercial_status").notNull().default("internal_only"), // commercial_ready | internal_only | beta | disabled
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
  tenantId: text("tenant_id"), // null = shared across all tenants
  categoryId: integer("category_id").notNull().references(() => aiServiceCategoriesTable.id, { onDelete: "cascade" }),
  serviceCode: text("service_code").notNull().unique(),
  serviceName: text("service_name").notNull(),
  shortDescription: text("short_description"),
  fullDescription: text("full_description"),
  serviceType: text("service_type").notNull().default("project"), // project | ongoing | consultation
  // Dual Commercial Flow: fixed_price = Standard Service (no quotation, straight to checkout),
  // custom_project / enterprise = goes through Requirement Form -> AI Analysis -> Quotation -> Approval.
  // Defaults to custom_project to preserve the existing (pre-dual-flow) quotation-first behavior.
  serviceFlow: text("service_flow").notNull().default("custom_project"), // fixed_price | custom_project | enterprise
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
  packageLevel: text("package_level").notNull().default("starter"), // starter | professional | business | enterprise
  monthlyPrice: numeric("monthly_price", { precision: 14, scale: 2 }),
  yearlyPrice: numeric("yearly_price", { precision: 14, scale: 2 }),
  oneTimePrice: numeric("one_time_price", { precision: 14, scale: 2 }),
  setupFee: numeric("setup_fee", { precision: 14, scale: 2 }),
  // Commercial terms used when this package is purchased through the Standard
  // (fixed_price) checkout flow — full_payment | deposit | subscription | purchase_order.
  paymentPolicy: text("payment_policy").notNull().default("full_payment"),
  depositPercentage: integer("deposit_percentage").notNull().default(50),
  includedRevisions: integer("included_revisions"),
  deliverablesJson: jsonb("deliverables_json").$type<string[]>(),
  featuresJson: jsonb("features_json").$type<string[]>(),
  limitsJson: jsonb("limits_json").$type<Record<string, unknown>>(),
  slaJson: jsonb("sla_json").$type<Record<string, unknown>>(),
  displayOrder: integer("display_order").notNull().default(0),
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
  tenantId: text("tenant_id"), // null = default tenant
  requestId: text("request_id").notNull().unique(), // UUID, client-facing
  serviceId: integer("service_id").notNull().references(() => aiServicesTable.id, { onDelete: "restrict" }),
  packageId: integer("package_id").references(() => aiServicePackagesTable.id, { onDelete: "set null" }),
  pricingModelSelected: text("pricing_model_selected").notNull().default("one_time"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  companyName: text("company_name"),
  notes: text("notes"),
  briefJson: jsonb("brief_json").$type<Record<string, unknown>>(),
  quantity: integer("quantity").notNull().default(1),
  // Pricing calculator selections
  rushSpeed: text("rush_speed"), // null | "48h" | "24h" | "same_day"
  humanReviewRequested: boolean("human_review_requested").notNull().default(false),
  extraRevisions: integer("extra_revisions").notNull().default(0),
  bilingual: boolean("bilingual").notNull().default(false),
  editableSourceFile: boolean("editable_source_file").notNull().default(false),
  extendedUsageRights: boolean("extended_usage_rights").notNull().default(false),
  // Pricing breakdown (customer-visible)
  currency: text("currency").notNull().default("IDR"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  rushFee: numeric("rush_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  revisionFee: numeric("revision_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  humanReviewFee: numeric("human_review_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  additionalServiceFee: numeric("additional_service_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 14, scale: 2 }).notNull().default("0"),
  tax: numeric("tax", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  pricingSnapshotJson: jsonb("pricing_snapshot_json").$type<Record<string, unknown>>(),
  // Margin & cost control — internal only, never returned to customer-facing responses
  estimatedAiCost: numeric("estimated_ai_cost", { precision: 14, scale: 2 }),
  actualAiCost: numeric("actual_ai_cost", { precision: 14, scale: 2 }),
  humanLaborEstimate: numeric("human_labor_estimate", { precision: 14, scale: 2 }),
  grossMargin: numeric("gross_margin", { precision: 14, scale: 2 }),
  grossMarginPercent: numeric("gross_margin_percent", { precision: 6, scale: 2 }),
  marginApprovalRequired: boolean("margin_approval_required").notNull().default(false),
  marginApprovedBy: text("margin_approved_by"),
  marginApprovedAt: timestamp("margin_approved_at", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | quoted | waiting_customer_approval | approved | pending | orchestrating | in_progress | waiting_review | revision_requested | completed | cancelled
  createdProjectId: text("created_project_id"), // set once handed off to a project/workflow
  completionNotes: text("completion_notes"),   // admin-authored notes shown to customer on completion
  completionLinks: jsonb("completion_links").$type<Array<{ label: string; url: string }>>(), // downloadable/reviewable deliverable links
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServiceRequestSchema = createInsertSchema(aiServiceRequestsTable).omit({
  id: true,
  requestId: true,
  status: true,
  createdProjectId: true,
  subtotal: true,
  rushFee: true,
  revisionFee: true,
  humanReviewFee: true,
  additionalServiceFee: true,
  discount: true,
  tax: true,
  total: true,
  pricingSnapshotJson: true,
  estimatedAiCost: true,
  actualAiCost: true,
  humanLaborEstimate: true,
  grossMargin: true,
  grossMarginPercent: true,
  marginApprovalRequired: true,
  marginApprovedBy: true,
  marginApprovedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiServiceRequest = z.infer<typeof insertAiServiceRequestSchema>;
export type AiServiceRequest = typeof aiServiceRequestsTable.$inferSelect;

/**
 * Global or per-service additive pricing rules (rush delivery, extra
 * revisions, human review, bilingual, buyout, etc). Evaluated by
 * aiPricingService in priority order.
 */
export const aiServicePriceRulesTable = appSchema.table("ai_service_price_rules", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id"), // null = applies to all tenants
  serviceId: integer("service_id").references(() => aiServicesTable.id, { onDelete: "cascade" }), // null = global rule
  ruleCode: text("rule_code").notNull().unique(),
  ruleName: text("rule_name").notNull(),
  conditionType: text("condition_type").notNull(), // rush_speed | extra_revision | human_review | bilingual | quantity | additional_concept | editable_source_file | extended_usage_rights | buyout
  conditionJson: jsonb("condition_json").$type<Record<string, unknown>>(),
  adjustmentType: text("adjustment_type").notNull(), // fixed_amount | percentage | multiplier | per_unit
  adjustmentValue: numeric("adjustment_value", { precision: 14, scale: 4 }).notNull(),
  minimumCharge: numeric("minimum_charge", { precision: 14, scale: 2 }),
  maximumCharge: numeric("maximum_charge", { precision: 14, scale: 2 }),
  priority: integer("priority").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiServicePriceRuleSchema = createInsertSchema(aiServicePriceRulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiServicePriceRule = z.infer<typeof insertAiServicePriceRuleSchema>;
export type AiServicePriceRule = typeof aiServicePriceRulesTable.$inferSelect;
