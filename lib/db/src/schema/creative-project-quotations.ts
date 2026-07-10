import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One quotation (price offer) per creative project. Staff draft the line
 * items and totals, send it to the client, and the client approves or
 * rejects it from the customer portal before AI generation starts.
 */
export const creativeProjectQuotationsTable = pgTable("creative_project_quotations", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull().unique(), // UUID — matches creative_projects.project_id
  currency: text("currency").notNull().default("IDR"),
  lineItems: jsonb("line_items").notNull(), // [{ description, quantity, unitPrice }]
  discount: integer("discount").notNull().default(0), // flat amount, same currency unit
  taxPercent: integer("tax_percent").notNull().default(0), // e.g. 11 for PPN 11%
  subtotal: integer("subtotal").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  total: integer("total").notNull().default(0),
  notes: text("notes"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | sent | approved | rejected | expired
  sentAt: timestamp("sent_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  responseNotes: text("response_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCreativeProjectQuotationSchema = createInsertSchema(creativeProjectQuotationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeProjectQuotation = z.infer<typeof insertCreativeProjectQuotationSchema>;
export type CreativeProjectQuotation = typeof creativeProjectQuotationsTable.$inferSelect;

export interface QuotationLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}
