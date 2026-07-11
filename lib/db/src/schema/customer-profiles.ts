import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * customer_profiles — Customer Workspace company/billing profile.
 *
 * Purely additive: keyed by the same emailHash used by
 * customer_dashboard_tokens, so it works with the existing token-based
 * customer identity model without touching auth/session logic.
 */
export const customerProfilesTable = appSchema.table("customer_profiles", {
  id: serial("id").primaryKey(),
  emailHash: text("email_hash").notNull().unique(),
  clientEmail: text("client_email").notNull(),
  companyName: text("company_name"),
  address: text("address"),
  picName: text("pic_name"),
  picPhone: text("pic_phone"),
  billingEmail: text("billing_email"),
  taxId: text("tax_id"),
  paymentMethodNotes: text("payment_method_notes"),
  brandPreferences: jsonb("brand_preferences").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerProfileSchema = createInsertSchema(customerProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomerProfile = z.infer<typeof insertCustomerProfileSchema>;
export type CustomerProfile = typeof customerProfilesTable.$inferSelect;
