import { appSchema } from "./_pg-schema";
import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * customer_dashboard_tokens
 *
 * Each row represents a magic-link dashboard session for a customer email.
 * The plaintext token is shown once after creation and never stored.
 * The token_hash (SHA-256) is stored and used for lookup.
 */
export const customerDashboardTokensTable = appSchema.table("customer_dashboard_tokens", {
  id: serial("id").primaryKey(),
  emailHash: text("email_hash").notNull(),        // SHA-256 of lower-cased email — for fast lookup
  clientEmail: text("client_email").notNull(),
  clientName: text("client_name").notNull(),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of plaintext dashboard token
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCustomerDashboardTokenSchema = createInsertSchema(customerDashboardTokensTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCustomerDashboardToken = z.infer<typeof insertCustomerDashboardTokenSchema>;
export type CustomerDashboardToken = typeof customerDashboardTokensTable.$inferSelect;
