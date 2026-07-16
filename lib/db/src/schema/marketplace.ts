import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  bigint,
  unique,
} from "drizzle-orm/pg-core";

/**
 * V4.7 — Creative Marketplace
 *
 * marketplace_creators   — creator profiles
 * marketplace_assets     — digital assets (illustration, icon, cover, layout,
 *                          background, photo, brand_pack)
 * marketplace_favorites  — user favourites (assets + templates)
 * marketplace_ratings    — 1-5 star ratings
 * marketplace_downloads  — download event log
 *
 * Constraints honoured:
 *   - Never touches Queue, Runtime, Design Studio, Template Engine,
 *     Payment, Review, or Workspace tables / routes.
 *   - Foreign-key ordering: creators must be created before assets.
 */

// ── Creators ──────────────────────────────────────────────────────────────────

export const marketplaceCreatorsTable = appSchema.table("marketplace_creators", {
  id: serial("id").primaryKey(),
  creatorCode: text("creator_code").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  websiteUrl: text("website_url"),
  email: text("email"),
  isVerified: boolean("is_verified").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  totalAssets: integer("total_assets").notNull().default(0),
  totalDownloads: integer("total_downloads").notNull().default(0),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).notNull().default("0"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type MarketplaceCreator = typeof marketplaceCreatorsTable.$inferSelect;
export type InsertMarketplaceCreator = typeof marketplaceCreatorsTable.$inferInsert;

// ── Assets ────────────────────────────────────────────────────────────────────

export const marketplaceAssetsTable = appSchema.table("marketplace_assets", {
  id: serial("id").primaryKey(),
  assetCode: text("asset_code").notNull().unique(),
  /** illustration | icon | cover | layout | background | photo | brand_pack */
  assetType: text("asset_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  creatorId: integer("creator_id").references(() => marketplaceCreatorsTable.id, {
    onDelete: "set null",
  }),
  /** free | premium */
  priceType: text("price_type").notNull().default("free"),
  priceAmount: numeric("price_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("IDR"),
  fileUrl: text("file_url"),
  previewUrls: jsonb("preview_urls").$type<string[]>().notNull().default([]),
  thumbnailUrl: text("thumbnail_url"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  fileFormat: text("file_format"),
  /** standard | extended | exclusive */
  license: text("license").notNull().default("standard"),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  downloadsCount: integer("downloads_count").notNull().default(0),
  viewsCount: integer("views_count").notNull().default(0),
  favoritesCount: integer("favorites_count").notNull().default(0),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).notNull().default("0"),
  ratingsCount: integer("ratings_count").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type MarketplaceAsset = typeof marketplaceAssetsTable.$inferSelect;
export type InsertMarketplaceAsset = typeof marketplaceAssetsTable.$inferInsert;

// ── Favourites ────────────────────────────────────────────────────────────────

export const marketplaceFavoritesTable = appSchema.table(
  "marketplace_favorites",
  {
    id: serial("id").primaryKey(),
    customerEmail: text("customer_email").notNull(),
    /** asset | template */
    itemType: text("item_type").notNull(),
    itemId: integer("item_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("mp_fav_uniq").on(t.customerEmail, t.itemType, t.itemId)],
);

export type MarketplaceFavorite = typeof marketplaceFavoritesTable.$inferSelect;
export type InsertMarketplaceFavorite = typeof marketplaceFavoritesTable.$inferInsert;

// ── Ratings ───────────────────────────────────────────────────────────────────

export const marketplaceRatingsTable = appSchema.table(
  "marketplace_ratings",
  {
    id: serial("id").primaryKey(),
    customerEmail: text("customer_email").notNull(),
    /** asset | template */
    itemType: text("item_type").notNull(),
    itemId: integer("item_id").notNull(),
    /** 1 – 5 */
    rating: integer("rating").notNull(),
    review: text("review"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("mp_rating_uniq").on(t.customerEmail, t.itemType, t.itemId)],
);

export type MarketplaceRating = typeof marketplaceRatingsTable.$inferSelect;
export type InsertMarketplaceRating = typeof marketplaceRatingsTable.$inferInsert;

// ── Downloads ─────────────────────────────────────────────────────────────────

export const marketplaceDownloadsTable = appSchema.table("marketplace_downloads", {
  id: serial("id").primaryKey(),
  customerEmail: text("customer_email"),
  /** asset | template */
  itemType: text("item_type").notNull(),
  itemId: integer("item_id").notNull(),
  ipAddress: text("ip_address"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MarketplaceDownload = typeof marketplaceDownloadsTable.$inferSelect;
export type InsertMarketplaceDownload = typeof marketplaceDownloadsTable.$inferInsert;
