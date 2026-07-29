/**
 * WP-03A — Placement Engine Core (v2 rebuild)
 *
 * Tables:
 *   layout_sessions   — room design sessions (tenant-scoped)
 *   placements        — furniture placements within a session (tenant-scoped)
 *
 * Tenant invariant:
 *   placements.tenant_id IS NOT DISTINCT FROM layout_sessions.tenant_id
 *   Enforced at service layer and by database trigger.
 *
 * Schema: ai_platform (consistent with all Phase 6 tables).
 * Migrations:
 *   scripts/migrations/wp03a-placement-engine-v2.sql
 *   scripts/migrations/rls-wp03a-placement-engine-v2.sql
 *   scripts/migrations/wp03a-placement-tenant-consistency-v2.sql
 */

import { appSchema } from "./_pg-schema";
import {
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ── layout_sessions ───────────────────────────────────────────────────────────

export const layoutSessionsTable = appSchema.table("layout_sessions", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id"),                          // NULL = platform-wide
  roomTemplateId:   uuid("room_template_id"),                   // soft ref → room_templates (WP-01)
  name:             text("name").notNull(),
  status:           text("status").notNull().default("active"), // active | archived
  coordinateUnit:   text("coordinate_unit").notNull().default("cm"),
  roomWidthCm:      numeric("room_width_cm", { precision: 10, scale: 2 }).notNull(),
  roomLengthCm:     numeric("room_length_cm", { precision: 10, scale: 2 }).notNull(),
  metadata:         jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdBy:        text("created_by").notNull().default("system"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt:       timestamp("archived_at", { withTimezone: true }),
});

export type LayoutSession       = typeof layoutSessionsTable.$inferSelect;
export type InsertLayoutSession = typeof layoutSessionsTable.$inferInsert;

// ── placements ────────────────────────────────────────────────────────────────

export const placementsTable = appSchema.table("placements", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id"),                          // must match session.tenant_id
  sessionId:        uuid("session_id").notNull(),               // FK → layout_sessions (CASCADE)
  furnitureItemId:  uuid("furniture_item_id").notNull(),        // soft ref → furniture_items (WP-02)

  // Position
  xCm:              numeric("x_cm",  { precision: 10, scale: 2 }).notNull().default("0"),
  yCm:              numeric("y_cm",  { precision: 10, scale: 2 }).notNull().default("0"),

  // Dimensions (footprint + height)
  widthCm:          numeric("width_cm",  { precision: 10, scale: 2 }).notNull(),
  depthCm:          numeric("depth_cm",  { precision: 10, scale: 2 }).notNull(),
  heightCm:         numeric("height_cm", { precision: 10, scale: 2 }).notNull(),

  // Orientation — normalized to [0, 360) before storage
  rotationDeg:      numeric("rotation_deg", { precision: 8, scale: 4 }).notNull().default("0"),

  // Anchor
  anchorType:       text("anchor_type").notNull().default("none"), // none | wall | corner | item
  anchorData:       jsonb("anchor_data").$type<Record<string, unknown>>().notNull().default({}),

  // Snap
  snapType:         text("snap_type").notNull().default("none"), // none | grid | wall | corner | item_anchor
  snapData:         jsonb("snap_data").$type<Record<string, unknown>>().notNull().default({}),

  // Versioning
  metadata:         jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  version:          integer("version").notNull().default(1),
  createdBy:        text("created_by").notNull().default("system"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt:       timestamp("archived_at", { withTimezone: true }),
});

export type Placement       = typeof placementsTable.$inferSelect;
export type InsertPlacement = typeof placementsTable.$inferInsert;
