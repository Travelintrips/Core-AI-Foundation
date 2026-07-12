import { appSchema } from "./_pg-schema";
import { serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeProjectsTable } from "./creative-projects";

/**
 * Payment schedule — one or more installments owed against a creative_project.
 * Supports the Dual Commercial Flow: Standard (fixed_price) projects get a
 * schedule generated at checkout (full_payment or deposit+remaining_balance);
 * Enterprise/custom projects get a schedule generated once a quotation/PO is
 * approved. Purely additive — legacy projects simply have zero schedule rows.
 *
 * payment_type: deposit | remaining_balance | full_payment | custom_installment | subscription_charge
 * status:       pending | paid | partially_paid | failed | refunded | cancelled
 */
export const aiPaymentScheduleTable = appSchema.table("ai_payment_schedule", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => creativeProjectsTable.id, { onDelete: "cascade" }),
  paymentType: text("payment_type").notNull().default("full_payment"),
  percentage: integer("percentage"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("IDR"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  reference: text("reference"), // customer-submitted proof reference (bank transfer id, PO number, etc.)
  proofImageUrl: text("proof_image_url"), // URL to uploaded bank transfer screenshot
  verifiedBy: text("verified_by"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiPaymentScheduleSchema = createInsertSchema(aiPaymentScheduleTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPaymentSchedule = z.infer<typeof insertAiPaymentScheduleSchema>;
export type AiPaymentSchedule = typeof aiPaymentScheduleTable.$inferSelect;

export const AI_PAYMENT_SCHEDULE_TERMINAL_STATES = new Set(["paid", "refunded", "cancelled"]);
