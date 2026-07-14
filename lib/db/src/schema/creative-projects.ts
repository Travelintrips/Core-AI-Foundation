import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, boolean } from "drizzle-orm/pg-core";
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
  // Legacy values: pending | running | completed | failed.
  // Dual Commercial Flow adds (both Standard & Enterprise reuse these where applicable):
  // waiting_payment | deposit_paid | waiting_payment_verification | payment_verified |
  // waiting_remaining_payment | remaining_paid | ready_to_build | building | internal_review |
  // waiting_client_review | revision | approved | completed
  // Document Engine (Phase 3): generating_document — held until the PDF has rendered.
  // Presentation Engine (Phase 4): generating_presentation — held until the PPTX has rendered.
  status: text("status").notNull().default("pending"),
  // Commercial terms — full_payment | deposit | subscription | purchase_order
  paymentPolicy: text("payment_policy").notNull().default("full_payment"),
  depositPercentage: integer("deposit_percentage").notNull().default(50),
  // pending | paid | partially_paid | failed | refunded | cancelled
  paymentStatus: text("payment_status").notNull().default("pending"),
  // True once payment has cleared enough to release full-resolution / source deliverables.
  filesUnlocked: boolean("files_unlocked").notNull().default(false),
  result: jsonb("result"), // aggregated final output from all agents
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // WP-04: soft delete — NULL = active, non-NULL = soft-deleted
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // WP-05: archive — NULL = not archived, non-NULL = archived (orthogonal to deletedAt)
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const insertCreativeProjectSchema = createInsertSchema(creativeProjectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeProject = z.infer<typeof insertCreativeProjectSchema>;
export type CreativeProject = typeof creativeProjectsTable.$inferSelect;
