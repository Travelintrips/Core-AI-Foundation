import { appSchema } from "./_pg-schema";
import { serial, text, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiQuotationsTable } from "./ai-quotations";

/**
 * Line items for ai_quotations.
 * Stored as normalised rows (not JSONB) so they can be queried individually.
 * item_type: service | addon | discount | tax
 */
export const aiQuotationItemsTable = appSchema.table("ai_quotation_items", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id")
    .notNull()
    .references(() => aiQuotationsTable.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull().default("service"),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: integer("unit_price").notNull().default(0),
  amount: integer("amount").notNull().default(0),
  metadataJson: jsonb("metadata_json"),
  displayOrder: integer("display_order").notNull().default(0),
});

export const insertAiQuotationItemSchema = createInsertSchema(aiQuotationItemsTable).omit({
  id: true,
});
export type InsertAiQuotationItem = z.infer<typeof insertAiQuotationItemSchema>;
export type AiQuotationItem = typeof aiQuotationItemsTable.$inferSelect;
