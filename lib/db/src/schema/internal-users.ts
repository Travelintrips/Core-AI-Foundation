import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * internal_users — company staff accounts for the Internal AI Portal.
 *
 * Distinct from customer_profiles (which is passwordless/token-based).
 * Internal users log in with email + password and are assigned one of the
 * INTERNAL_ROLES below. Role is always re-read from this table on every
 * request — never trusted from a client-supplied token payload alone.
 */
export const internalUsersTable = appSchema.table("internal_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("internal_staff"), // owner | admin | manager | internal_staff
  accountType: text("account_type").notNull().default("internal"), // internal (reserved: customer accounts never live in this table)
  status: text("status").notNull().default("active"), // active | suspended
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInternalUserSchema = createInsertSchema(internalUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInternalUser = z.infer<typeof insertInternalUserSchema>;
export type InternalUser = typeof internalUsersTable.$inferSelect;

/** The only roles allowed to access the Internal AI Portal. */
export const INTERNAL_ROLES = ["owner", "admin", "manager", "internal_staff"] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

/** Fields safe to ever send to a client — never passwordHash. */
export function toSafeInternalUser(u: InternalUser) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    accountType: u.accountType,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}
