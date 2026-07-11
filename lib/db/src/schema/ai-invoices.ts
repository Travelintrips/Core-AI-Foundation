import { appSchema } from "./_pg-schema";
import { serial, text, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeProjectsTable } from "./creative-projects";
import { aiPaymentScheduleTable } from "./ai-payment-schedule";

/**
 * Invoices generated against a creative_project's payment schedule.
 * invoice_type: deposit | remaining | final | credit_note | receipt
 * status:       draft | issued | paid | void
 */
export const aiInvoicesTable = appSchema.table("ai_invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  projectId: integer("project_id")
    .notNull()
    .references(() => creativeProjectsTable.id, { onDelete: "cascade" }),
  paymentScheduleId: integer("payment_schedule_id").references(() => aiPaymentScheduleTable.id, {
    onDelete: "set null",
  }),
  invoiceType: text("invoice_type").notNull().default("final"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("IDR"),
  status: text("status").notNull().default("issued"),
  lineItemsJson: jsonb("line_items_json").$type<Array<{ label: string; amount: number }>>(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiInvoiceSchema = createInsertSchema(aiInvoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiInvoice = z.infer<typeof insertAiInvoiceSchema>;
export type AiInvoice = typeof aiInvoicesTable.$inferSelect;
