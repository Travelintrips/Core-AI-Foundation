/**
 * WP-01 — Room Template Library (Phase 6)
 *
 * Catalog tables for room types, styles, themes, layout constraint sets,
 * and room templates. These are the foundation for all subsequent Phase 6
 * work packages.
 *
 * Namespace: room-design-catalog (distinct from design-template and design-blueprint).
 * Schema: ai_platform (all tables share the existing schema).
 */

import { appSchema } from "./_pg-schema";
import {
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// ── room_types ────────────────────────────────────────────────────────────────

export const roomTypesTable = appSchema.table("room_types", {
  id:              uuid("id").primaryKey().defaultRandom(),
  code:            text("code").notNull().unique(),
  label:           text("label").notNull(),
  labelId:         text("label_id").notNull().default(""),
  icon:            text("icon").notNull().default(""),
  constraintSetId: uuid("constraint_set_id"),
  metadata:        jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  displayOrder:    integer("display_order").notNull().default(0),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoomType         = typeof roomTypesTable.$inferSelect;
export type InsertRoomType   = typeof roomTypesTable.$inferInsert;

// ── room_styles ───────────────────────────────────────────────────────────────

export const roomStylesTable = appSchema.table("room_styles", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  name:               text("name").notNull(),
  nameId:             text("name_id").notNull().default(""),
  slug:               text("slug").notNull().unique(),
  palette:            jsonb("palette").$type<Record<string, unknown>>().notNull().default({}),
  materialFinishPrefs: text("material_finish_prefs").array().notNull().default([]),
  furnitureEra:       text("furniture_era").notNull().default("contemporary"),
  textureRules:       jsonb("texture_rules").$type<unknown[]>().notNull().default([]),
  description:        text("description"),
  previewImageUrl:    text("preview_image_url"),
  status:             text("status").notNull().default("draft"),
  displayOrder:       integer("display_order").notNull().default(0),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoomStyle        = typeof roomStylesTable.$inferSelect;
export type InsertRoomStyle  = typeof roomStylesTable.$inferInsert;

// ── room_themes ───────────────────────────────────────────────────────────────

export const roomThemesTable = appSchema.table("room_themes", {
  id:                uuid("id").primaryKey().defaultRandom(),
  name:              text("name").notNull(),
  nameId:            text("name_id").notNull().default(""),
  slug:              text("slug").notNull().unique(),
  description:       text("description"),
  styleIds:          uuid("style_ids").array().notNull().default([]),
  decorationSetIds:  uuid("decoration_set_ids").array().notNull().default([]),
  lightingPresetIds: uuid("lighting_preset_ids").array().notNull().default([]),
  previewImageUrl:   text("preview_image_url"),
  status:            text("status").notNull().default("draft"),
  displayOrder:      integer("display_order").notNull().default(0),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoomTheme        = typeof roomThemesTable.$inferSelect;
export type InsertRoomTheme  = typeof roomThemesTable.$inferInsert;

// ── layout_constraint_sets ────────────────────────────────────────────────────

export const layoutConstraintSetsTable = appSchema.table("layout_constraint_sets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull(),
  roomTypeId:  uuid("room_type_id").notNull(),
  rules:       jsonb("rules").$type<unknown[]>().notNull().default([]),
  version:     integer("version").notNull().default(1),
  description: text("description"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LayoutConstraintSet       = typeof layoutConstraintSetsTable.$inferSelect;
export type InsertLayoutConstraintSet = typeof layoutConstraintSetsTable.$inferInsert;

// ── room_templates ────────────────────────────────────────────────────────────

export const roomTemplatesTable = appSchema.table("room_templates", {
  id:              uuid("id").primaryKey().defaultRandom(),
  name:            text("name").notNull(),
  slug:            text("slug").notNull().unique(),
  description:     text("description"),
  roomTypeId:      uuid("room_type_id").notNull(),
  styleId:         uuid("style_id"),
  dimensions:      jsonb("dimensions").$type<{ widthCm: number; depthCm: number; heightCm: number }>().notNull().default({ widthCm: 400, depthCm: 500, heightCm: 270 }),
  fixedElements:   jsonb("fixed_elements").$type<unknown[]>().notNull().default([]),
  previewImageUrl: text("preview_image_url"),
  thumbnailUrl:    text("thumbnail_url"),
  tags:            text("tags").array().notNull().default([]),
  status:          text("status").notNull().default("draft"),
  version:         integer("version").notNull().default(1),
  tenantId:        uuid("tenant_id"),
  createdBy:       text("created_by").notNull().default("system"),
  publishedAt:     timestamp("published_at", { withTimezone: true }),
  archivedAt:      timestamp("archived_at", { withTimezone: true }),
  metadata:        jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoomTemplate       = typeof roomTemplatesTable.$inferSelect;
export type InsertRoomTemplate = typeof roomTemplatesTable.$inferInsert;
