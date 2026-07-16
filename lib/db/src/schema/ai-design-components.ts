/**
 * Design Components — DB Schema (Team 8)
 *
 * Stores saved component instances created by admin users.
 * The component type definitions themselves live in the static registry
 * (componentRegistry.ts) — this table only persists user-configured instances.
 *
 * NOTE: Migration draft at integration/migrations/team-08.sql
 * This file must NOT be added to the lib/db barrel (index.ts) until
 * Team 24 performs the integration wiring.  Import directly from this file.
 */

import { text, integer, jsonb, timestamp, serial } from "drizzle-orm/pg-core";
import { appSchema } from "./_pg-schema.js";

export const designComponentsTable = appSchema.table("ai_design_components", {
  id: serial("id").primaryKey(),

  /** Admin tenant that owns this instance */
  tenantId: text("tenant_id").notNull(),

  /** Human-readable label for this instance */
  name: text("name").notNull(),

  /** URL-safe slug derived from name */
  slug: text("slug").notNull(),

  /**
   * Component type from the static registry.
   * e.g. "text", "logo", "sofa", "body_panel", "front"
   */
  type: text("type").notNull(),

  /**
   * Primary domain: "graphic" | "interior" | "fashion" | "packaging"
   */
  domain: text("domain").notNull(),

  /**
   * User-supplied field values keyed by property name.
   * Schema is validated against the component definition at write time.
   */
  fieldValues: jsonb("field_values").$type<Record<string, unknown>>().notNull().default({}),

  /**
   * Optional reference to a blueprint or template this instance is scoped to.
   */
  blueprintId: text("blueprint_id"),

  /** active | archived */
  status: text("status").notNull().default("active"),

  /** Actor who created this instance */
  createdBy: text("created_by"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type DesignComponent = typeof designComponentsTable.$inferSelect;
export type NewDesignComponent = typeof designComponentsTable.$inferInsert;
