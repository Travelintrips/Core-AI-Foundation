import { appSchema } from "./_pg-schema";
import { serial, integer, text, boolean, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ai_installed_packages — Phase 8 per-tenant installation ledger.
 *
 * tenantId is a free-text slug ("default" until real multi-tenancy lands)
 * so this stays additive without requiring a tenants table migration now.
 */
export const aiInstalledPackagesTable = appSchema.table("ai_installed_packages", {
  id: serial("id").primaryKey(),

  tenantId: text("tenant_id").notNull().default("default"),
  packageId: integer("package_id").notNull(),
  packageType: text("package_type").notNull(), // skill | tool

  installedVersion: text("installed_version").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  configurationJson: jsonb("configuration_json").notNull().default({}),

  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  tenantPackageUnique: unique().on(t.tenantId, t.packageId, t.packageType),
}));

export const insertAiInstalledPackageSchema = createInsertSchema(aiInstalledPackagesTable).omit({ id: true, installedAt: true, updatedAt: true });
export type InsertAiInstalledPackage = z.infer<typeof insertAiInstalledPackageSchema>;
export type AiInstalledPackage = typeof aiInstalledPackagesTable.$inferSelect;
