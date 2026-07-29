/**
 * WP-03A — Placement Engine (Phase 6)
 *
 * Tables:
 *   layout_sessions  — tenant-owned design canvas with room geometry
 *   placements       — furniture items placed on a session canvas
 *
 * Coordinate system: 2D top-down, unit = centimetres.
 * Rotation: degrees, normalised to [0, 360) before persistence.
 * Anchor point: top-left corner of the placement bounding box.
 *
 * Schema: ai_platform (consistent with all other Phase 6 tables).
 * Collision detection is WP-03B scope.
 */

import { appSchema } from "./_pg-schema";
import {
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ── layout_sessions ───────────────────────────────────────────────────────────

export const layoutSessionsTable = appSchema.table("layout_sessions", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),               // required — no platform-wide sessions
  roomTemplateId:  uuid("room_template_id"),                  // optional FK → room_templates
  name:            text("name").notNull(),
  status:          text("status").notNull().default("draft"), // draft | active | archived

  // Room geometry — may differ from the source template (custom rooms)
  widthCm:         numeric("width_cm", { precision: 10, scale: 2 }).notNull().default("400"),
  depthCm:         numeric("depth_cm", { precision: 10, scale: 2 }).notNull().default("500"),
  heightCm:        numeric("height_cm", { precision: 10, scale: 2 }).notNull().default("270"),

  createdBy:       text("created_by").notNull().default("system"),
  archivedAt:      timestamp("archived_at", { withTimezone: true }),
  deletedAt:       timestamp("deleted_at", { withTimezone: true }),  // soft delete
  metadata:        jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LayoutSession       = typeof layoutSessionsTable.$inferSelect;
export type InsertLayoutSession = typeof layoutSessionsTable.$inferInsert;

// ── placements ────────────────────────────────────────────────────────────────

export const placementsTable = appSchema.table("placements", {
  id:              uuid("id").primaryKey().defaultRandom(),
  sessionId:       uuid("session_id").notNull(),              // FK → layout_sessions
  tenantId:        uuid("tenant_id").notNull(),               // denormalised for RLS — must match session
  furnitureItemId: uuid("furniture_item_id"),                 // optional FK → furniture_items

  // Display name — overrides furniture item name for the canvas label
  label:           text("label").notNull().default(""),

  // 2D position: top-left anchor corner of the bounding box (centimetres)
  xCm:             numeric("x_cm", { precision: 10, scale: 2 }).notNull().default("0"),
  yCm:             numeric("y_cm", { precision: 10, scale: 2 }).notNull().default("0"),

  // Bounding box dimensions (centimetres, must be > 0)
  widthCm:         numeric("width_cm", { precision: 10, scale: 2 }).notNull().default("0"),
  depthCm:         numeric("depth_cm", { precision: 10, scale: 2 }).notNull().default("0"),

  // Rotation in degrees, normalised to [0, 360) before write
  rotationDeg:     numeric("rotation_deg", { precision: 8, scale: 4 }).notNull().default("0"),

  // Anchor point within the bounding box (0 = left/top, 1 = right/bottom)
  // Default (0, 0) = top-left corner is the anchor
  anchorX:         numeric("anchor_x", { precision: 5, scale: 4 }).notNull().default("0"),
  anchorY:         numeric("anchor_y", { precision: 5, scale: 4 }).notNull().default("0"),

  // Clearance zones (centimetres) — used by WP-03B collision warnings
  clearanceFrontCm: numeric("clearance_front_cm", { precision: 8, scale: 2 }).notNull().default("0"),
  clearanceSideCm:  numeric("clearance_side_cm",  { precision: 8, scale: 2 }).notNull().default("0"),
  clearanceBackCm:  numeric("clearance_back_cm",  { precision: 8, scale: 2 }).notNull().default("0"),

  // Soft-archive within session (archived placements excluded from collision checks)
  isArchived:      boolean("is_archived").notNull().default(false),

  version:         integer("version").notNull().default(1),
  metadata:        jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Placement       = typeof placementsTable.$inferSelect;
export type InsertPlacement = typeof placementsTable.$inferInsert;
