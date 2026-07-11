import { appSchema } from "./_pg-schema";
import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * customer_support_tickets — Customer Workspace Support Center.
 * status: open | in_progress | resolved | closed
 */
export const customerSupportTicketsTable = appSchema.table("customer_support_tickets", {
  id: serial("id").primaryKey(),
  emailHash: text("email_hash").notNull(),
  clientEmail: text("client_email").notNull(),
  clientName: text("client_name").notNull(),
  projectId: text("project_id"), // optional — creative_projects.project_id (UUID)
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  category: text("category").notNull().default("general"), // general | billing | technical | project | revision
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSupportTicketSchema = createInsertSchema(customerSupportTicketsTable).omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomerSupportTicket = z.infer<typeof insertCustomerSupportTicketSchema>;
export type CustomerSupportTicket = typeof customerSupportTicketsTable.$inferSelect;
