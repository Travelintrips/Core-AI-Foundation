import { appSchema } from "./_pg-schema";
import { serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ai_customer_impersonation_tokens — Short-lived admin impersonation sessions.
 *
 * Separate from customer_dashboard_tokens so that admin support access
 * never overwrites the customer's real token.
 *
 * token_hash: SHA-256 of the plaintext impersonation token (shown once to admin).
 * readonly: when true the impersonated session must not mutate customer data.
 * ended_at: set when the admin explicitly ends the session.
 */
export const aiCustomerImpersonationTokensTable = appSchema.table("ai_customer_impersonation_tokens", {
  id: serial("id").primaryKey(),
  emailHash: text("email_hash").notNull(), // target customer
  clientEmail: text("client_email").notNull(),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of plaintext impersonation token
  issuedBy: text("issued_by").notNull().default("admin"), // admin identifier
  reason: text("reason").notNull(), // mandatory reason for audit
  readonly: boolean("readonly").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiCustomerImpersonationTokenSchema = createInsertSchema(aiCustomerImpersonationTokensTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiCustomerImpersonationToken = z.infer<typeof insertAiCustomerImpersonationTokenSchema>;
export type AiCustomerImpersonationToken = typeof aiCustomerImpersonationTokensTable.$inferSelect;
