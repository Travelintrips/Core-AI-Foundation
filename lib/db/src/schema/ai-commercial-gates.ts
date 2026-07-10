import { appSchema } from "./_pg-schema";
import { serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeProjectQuotationsTable } from "./creative-project-quotations";
import { aiServiceRequestsTable } from "./ai-service-catalog";

/**
 * Commercial gates: a payment / approval check that must be verified or
 * waived before a quoted service request is converted into an active project.
 *
 * gate_type:  full_payment | deposit | active_subscription | purchase_order | admin_approval | free_trial
 * status:     pending | verified | failed | waived
 */
export const aiCommercialGatesTable = appSchema.table("ai_commercial_gates", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id"), // null = default/shared tenant
  serviceRequestId: integer("service_request_id").references(() => aiServiceRequestsTable.id, { onDelete: "set null" }),
  quotationId: integer("quotation_id").notNull().references(() => creativeProjectQuotationsTable.id, { onDelete: "cascade" }),
  gateType: text("gate_type").notNull().default("admin_approval"),
  // gate_type: full_payment | deposit | active_subscription | purchase_order | admin_approval | free_trial
  status: text("status").notNull().default("pending"),
  // status: pending | verified | failed | waived
  requiredAmount: numeric("required_amount", { precision: 14, scale: 2 }),
  verifiedAmount: numeric("verified_amount", { precision: 14, scale: 2 }),
  referenceNumber: text("reference_number"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiCommercialGateSchema = createInsertSchema(aiCommercialGatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiCommercialGate = z.infer<typeof insertAiCommercialGateSchema>;
export type AiCommercialGate = typeof aiCommercialGatesTable.$inferSelect;
