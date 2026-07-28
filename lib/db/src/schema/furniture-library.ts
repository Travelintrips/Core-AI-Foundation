/**
 * WP-02 — Furniture & Object Library (Phase 6)
 *
 * Tables:
 *   furniture_categories      — hierarchical category tree
 *   furniture_brands          — brand catalog
 *   furniture_collections     — brand collections / product series
 *   furniture_items           — primary furniture objects (versioned, soft-deletable)
 *   furniture_assets          — per-item media (images, renders, spec sheets)
 *   furniture_tags            — reusable tag vocabulary
 *   furniture_item_tags       — M:N join between items and tags
 *
 * Schema: ai_platform (consistent with all other Phase 6 tables).
 * No placement, collision, or layout engine — WP-03 scope.
 */

import { appSchema } from "./_pg-schema";
import {
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ── furniture_categories ──────────────────────────────────────────────────────

export const furnitureCategoriesTable = appSchema.table("furniture_categories", {
  id:           uuid("id").primaryKey().defaultRandom(),
  code:         text("code").notNull().unique(),
  name:         text("name").notNull(),
  nameId:       text("name_id").notNull().default(""),
  slug:         text("slug").notNull().unique(),
  parentId:     uuid("parent_id"),                         // self-referential for subcategories
  icon:         text("icon").notNull().default(""),
  description:  text("description"),
  isActive:     boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  metadata:     jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FurnitureCategory       = typeof furnitureCategoriesTable.$inferSelect;
export type InsertFurnitureCategory = typeof furnitureCategoriesTable.$inferInsert;

// ── furniture_brands ──────────────────────────────────────────────────────────

export const furnitureBrandsTable = appSchema.table("furniture_brands", {
  id:               uuid("id").primaryKey().defaultRandom(),
  code:             text("code").notNull().unique(),
  name:             text("name").notNull(),
  slug:             text("slug").notNull().unique(),
  countryOfOrigin:  text("country_of_origin"),
  websiteUrl:       text("website_url"),
  logoUrl:          text("logo_url"),
  description:      text("description"),
  status:           text("status").notNull().default("active"),   // active | inactive
  displayOrder:     integer("display_order").notNull().default(0),
  metadata:         jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FurnitureBrand       = typeof furnitureBrandsTable.$inferSelect;
export type InsertFurnitureBrand = typeof furnitureBrandsTable.$inferInsert;

// ── furniture_collections ─────────────────────────────────────────────────────

export const furnitureCollectionsTable = appSchema.table("furniture_collections", {
  id:          uuid("id").primaryKey().defaultRandom(),
  code:        text("code").notNull().unique(),
  name:        text("name").notNull(),
  slug:        text("slug").notNull().unique(),
  brandId:     uuid("brand_id"),                           // nullable FK → furniture_brands
  description: text("description"),
  style:       text("style"),                              // design style keyword
  launchYear:  integer("launch_year"),
  status:      text("status").notNull().default("active"), // active | inactive | archived
  displayOrder: integer("display_order").notNull().default(0),
  metadata:    jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FurnitureCollection       = typeof furnitureCollectionsTable.$inferSelect;
export type InsertFurnitureCollection = typeof furnitureCollectionsTable.$inferInsert;

// ── furniture_items ───────────────────────────────────────────────────────────
// Core entity. Soft-deletable, versioned, optionally tenant-scoped.

export const furnitureItemsTable = appSchema.table("furniture_items", {
  id:             uuid("id").primaryKey().defaultRandom(),
  code:           text("code").notNull().unique(),         // stable SKU / catalog code
  name:           text("name").notNull(),
  nameId:         text("name_id").notNull().default(""),   // Indonesian name
  slug:           text("slug").notNull().unique(),
  description:    text("description"),
  categoryId:     uuid("category_id").notNull(),           // FK → furniture_categories
  brandId:        uuid("brand_id"),                        // FK → furniture_brands (nullable)
  collectionId:   uuid("collection_id"),                   // FK → furniture_collections (nullable)

  // Classification
  style:          text("style"),                           // e.g. Scandinavian, Industrial
  furnitureType:  text("furniture_type"),                  // e.g. sofa, chair, table
  primaryMaterials: text("primary_materials").array().notNull().default([]),
  finishes:       text("finishes").array().notNull().default([]),
  colors:         text("colors").array().notNull().default([]),

  // Dimensions (all in centimetres)
  dimensions:     jsonb("dimensions").$type<{
    widthCm:  number;
    depthCm:  number;
    heightCm: number;
    weightKg?: number | null;
    seatHeightCm?: number | null;
  }>().notNull().default({ widthCm: 0, depthCm: 0, heightCm: 0 }),

  // Commercial
  priceTier:      text("price_tier").notNull().default("mid"),   // budget | mid | premium | luxury
  sku:            text("sku"),

  // Media
  thumbnailUrl:   text("thumbnail_url"),
  previewImages:  text("preview_images").array().notNull().default([]),

  // Search
  searchKeywords: text("search_keywords").array().notNull().default([]),

  // Lifecycle
  status:        text("status").notNull().default("draft"),   // draft | published | archived
  version:       integer("version").notNull().default(1),
  tenantId:      uuid("tenant_id"),                           // null = platform-wide
  createdBy:     text("created_by").notNull().default("system"),
  publishedAt:   timestamp("published_at", { withTimezone: true }),
  archivedAt:    timestamp("archived_at", { withTimezone: true }),
  deletedAt:     timestamp("deleted_at", { withTimezone: true }), // soft delete

  metadata:      jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FurnitureItem       = typeof furnitureItemsTable.$inferSelect;
export type InsertFurnitureItem = typeof furnitureItemsTable.$inferInsert;

// ── furniture_assets ──────────────────────────────────────────────────────────

export const furnitureAssetsTable = appSchema.table("furniture_assets", {
  id:              uuid("id").primaryKey().defaultRandom(),
  furnitureItemId: uuid("furniture_item_id").notNull(),    // FK → furniture_items
  assetType:       text("asset_type").notNull().default("preview"), // thumbnail | preview | render | spec_sheet | model
  url:             text("url").notNull(),
  fileName:        text("file_name"),
  mimeType:        text("mime_type"),
  fileSizeBytes:   integer("file_size_bytes"),
  sortOrder:       integer("sort_order").notNull().default(0),
  isPublic:        boolean("is_public").notNull().default(true),
  metadata:        jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FurnitureAsset       = typeof furnitureAssetsTable.$inferSelect;
export type InsertFurnitureAsset = typeof furnitureAssetsTable.$inferInsert;

// ── furniture_tags ────────────────────────────────────────────────────────────

export const furnitureTagsTable = appSchema.table("furniture_tags", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull().unique(),
  slug:         text("slug").notNull().unique(),
  description:  text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FurnitureTag       = typeof furnitureTagsTable.$inferSelect;
export type InsertFurnitureTag = typeof furnitureTagsTable.$inferInsert;

// ── furniture_item_tags ───────────────────────────────────────────────────────

export const furnitureItemTagsTable = appSchema.table("furniture_item_tags", {
  furnitureItemId: uuid("furniture_item_id").notNull(),    // FK → furniture_items
  tagId:           uuid("tag_id").notNull(),               // FK → furniture_tags
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FurnitureItemTag       = typeof furnitureItemTagsTable.$inferSelect;
export type InsertFurnitureItemTag = typeof furnitureItemTagsTable.$inferInsert;
