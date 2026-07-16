/**
 * creativeMarketplaceService.ts — V4.7 Creative Marketplace
 *
 * Covers: assets, creators, favorites, ratings, downloads, analytics, search.
 * Never touches: Queue, Runtime, Design Studio, Template Engine, Payment,
 *                Review, Workspace.
 */

import { db, pool } from "@workspace/db";
import {
  marketplaceAssetsTable,
  marketplaceCreatorsTable,
  marketplaceFavoritesTable,
  marketplaceRatingsTable,
  marketplaceDownloadsTable,
  aiTemplatesTable,
  type InsertMarketplaceAsset,
  type InsertMarketplaceCreator,
} from "@workspace/db";
import { eq, and, desc, asc, ilike, inArray, sql, or } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AssetType =
  | "illustration"
  | "icon"
  | "cover"
  | "layout"
  | "background"
  | "photo"
  | "brand_pack";

export interface ListAssetsFilter {
  assetType?: string;
  category?: string;
  priceType?: string; // free | premium
  search?: string;
  featured?: boolean;
  creatorId?: number;
  tags?: string[];
  sortBy?: "newest" | "popular" | "rating" | "downloads";
  limit?: number;
  offset?: number;
}

export interface ListCreatorsFilter {
  search?: string;
  isVerified?: boolean;
  limit?: number;
  offset?: number;
}

export interface MarketplaceAnalytics {
  totalAssets: number;
  freeAssets: number;
  premiumAssets: number;
  totalCreators: number;
  verifiedCreators: number;
  totalDownloads: number;
  totalFavorites: number;
  totalRatings: number;
  avgRating: number;
  byType: Array<{ assetType: string; count: number; downloads: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Creators
// ─────────────────────────────────────────────────────────────────────────────

export async function listCreators(filter: ListCreatorsFilter = {}) {
  const { search, isVerified, limit = 24, offset = 0 } = filter;
  let rows = await db.select().from(marketplaceCreatorsTable)
    .where(
      and(
        eq(marketplaceCreatorsTable.isActive, true),
        isVerified !== undefined ? eq(marketplaceCreatorsTable.isVerified, isVerified) : undefined,
        search ? ilike(marketplaceCreatorsTable.displayName, `%${search}%`) : undefined,
      ),
    )
    .orderBy(desc(marketplaceCreatorsTable.totalDownloads))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getCreator(id: number) {
  const [creator] = await db
    .select()
    .from(marketplaceCreatorsTable)
    .where(eq(marketplaceCreatorsTable.id, id));
  if (!creator) return null;

  const assets = await db
    .select()
    .from(marketplaceAssetsTable)
    .where(
      and(
        eq(marketplaceAssetsTable.creatorId, id),
        eq(marketplaceAssetsTable.isActive, true),
      ),
    )
    .orderBy(desc(marketplaceAssetsTable.downloadsCount))
    .limit(20);

  return { ...creator, assets };
}

export async function createCreator(data: InsertMarketplaceCreator) {
  const [row] = await db.insert(marketplaceCreatorsTable).values(data).returning();
  return row!;
}

export async function updateCreator(id: number, data: Partial<InsertMarketplaceCreator>) {
  const [row] = await db
    .update(marketplaceCreatorsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(marketplaceCreatorsTable.id, id))
    .returning();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assets
// ─────────────────────────────────────────────────────────────────────────────

export async function listAssets(filter: ListAssetsFilter = {}) {
  const {
    assetType,
    category,
    priceType,
    search,
    featured,
    creatorId,
    sortBy = "newest",
    limit = 24,
    offset = 0,
  } = filter;

  const orderMap = {
    newest: desc(marketplaceAssetsTable.createdAt),
    popular: desc(marketplaceAssetsTable.viewsCount),
    rating: desc(marketplaceAssetsTable.avgRating),
    downloads: desc(marketplaceAssetsTable.downloadsCount),
  };

  const rows = await db
    .select({
      asset: marketplaceAssetsTable,
      creatorName: marketplaceCreatorsTable.displayName,
      creatorCode: marketplaceCreatorsTable.creatorCode,
      creatorVerified: marketplaceCreatorsTable.isVerified,
    })
    .from(marketplaceAssetsTable)
    .leftJoin(
      marketplaceCreatorsTable,
      eq(marketplaceAssetsTable.creatorId, marketplaceCreatorsTable.id),
    )
    .where(
      and(
        eq(marketplaceAssetsTable.isActive, true),
        assetType ? eq(marketplaceAssetsTable.assetType, assetType) : undefined,
        category ? eq(marketplaceAssetsTable.category, category) : undefined,
        priceType ? eq(marketplaceAssetsTable.priceType, priceType) : undefined,
        featured !== undefined ? eq(marketplaceAssetsTable.isFeatured, featured) : undefined,
        creatorId ? eq(marketplaceAssetsTable.creatorId, creatorId) : undefined,
        search
          ? or(
              ilike(marketplaceAssetsTable.title, `%${search}%`),
              ilike(marketplaceAssetsTable.description, `%${search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(orderMap[sortBy] ?? desc(marketplaceAssetsTable.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r.asset,
    creator: r.creatorName
      ? {
          name: r.creatorName,
          code: r.creatorCode,
          verified: r.creatorVerified,
        }
      : null,
  }));
}

export async function getAsset(id: number) {
  const [row] = await db
    .select({
      asset: marketplaceAssetsTable,
      creatorName: marketplaceCreatorsTable.displayName,
      creatorCode: marketplaceCreatorsTable.creatorCode,
      creatorVerified: marketplaceCreatorsTable.isVerified,
      creatorAvatarUrl: marketplaceCreatorsTable.avatarUrl,
    })
    .from(marketplaceAssetsTable)
    .leftJoin(
      marketplaceCreatorsTable,
      eq(marketplaceAssetsTable.creatorId, marketplaceCreatorsTable.id),
    )
    .where(eq(marketplaceAssetsTable.id, id));

  if (!row) return null;
  return {
    ...row.asset,
    creator: row.creatorName
      ? {
          name: row.creatorName,
          code: row.creatorCode,
          verified: row.creatorVerified,
          avatarUrl: row.creatorAvatarUrl,
        }
      : null,
  };
}

export async function createAsset(data: InsertMarketplaceAsset) {
  const [row] = await db.insert(marketplaceAssetsTable).values(data).returning();
  // bump creator's total_assets counter
  if (data.creatorId) {
    await db
      .update(marketplaceCreatorsTable)
      .set({ totalAssets: sql`${marketplaceCreatorsTable.totalAssets} + 1` })
      .where(eq(marketplaceCreatorsTable.id, data.creatorId));
  }
  return row!;
}

export async function updateAsset(id: number, data: Partial<InsertMarketplaceAsset>) {
  const [row] = await db
    .update(marketplaceAssetsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(marketplaceAssetsTable.id, id))
    .returning();
  return row ?? null;
}

export async function featureAsset(id: number, featured: boolean) {
  return updateAsset(id, { isFeatured: featured });
}

export async function activateAsset(id: number, active: boolean) {
  return updateAsset(id, { isActive: active });
}

export async function listFeatured(limit = 12) {
  return listAssets({ featured: true, sortBy: "downloads", limit });
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

export const ASSET_TYPES: AssetType[] = [
  "illustration",
  "icon",
  "cover",
  "layout",
  "background",
  "photo",
  "brand_pack",
];

export async function listCategories() {
  const rows = await db
    .selectDistinct({ category: marketplaceAssetsTable.category })
    .from(marketplaceAssetsTable)
    .where(eq(marketplaceAssetsTable.isActive, true))
    .orderBy(asc(marketplaceAssetsTable.category));

  return rows.map((r) => r.category);
}

// ─────────────────────────────────────────────────────────────────────────────
// Search (templates + assets)
// ─────────────────────────────────────────────────────────────────────────────

export async function searchMarketplace(
  query: string,
  opts: { limit?: number; assetType?: string } = {},
) {
  const { limit = 20, assetType } = opts;
  const half = Math.ceil(limit / 2);

  const [assets, templates] = await Promise.all([
    db
      .select()
      .from(marketplaceAssetsTable)
      .where(
        and(
          eq(marketplaceAssetsTable.isActive, true),
          assetType ? eq(marketplaceAssetsTable.assetType, assetType) : undefined,
          or(
            ilike(marketplaceAssetsTable.title, `%${query}%`),
            ilike(marketplaceAssetsTable.description, `%${query}%`),
            ilike(marketplaceAssetsTable.category, `%${query}%`),
          ),
        ),
      )
      .orderBy(desc(marketplaceAssetsTable.downloadsCount))
      .limit(half),

    db
      .select()
      .from(aiTemplatesTable)
      .where(
        and(
          eq(aiTemplatesTable.status, "published"),
          or(
            ilike(aiTemplatesTable.name, `%${query}%`),
            ilike(aiTemplatesTable.description, `%${query}%`),
            ilike(aiTemplatesTable.category, `%${query}%`),
          ),
        ),
      )
      .orderBy(desc(aiTemplatesTable.conversions))
      .limit(half),
  ]);

  return {
    assets: assets.map((a) => ({ ...a, _kind: "asset" as const })),
    templates: templates.map((t) => ({ ...t, _kind: "template" as const })),
    total: assets.length + templates.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Views & Downloads
// ─────────────────────────────────────────────────────────────────────────────

export async function recordAssetView(assetId: number) {
  await db
    .update(marketplaceAssetsTable)
    .set({ viewsCount: sql`${marketplaceAssetsTable.viewsCount} + 1` })
    .where(eq(marketplaceAssetsTable.id, assetId));
}

export async function downloadAsset(
  assetId: number,
  customerEmail?: string,
  ipAddress?: string,
) {
  const asset = await getAsset(assetId);
  if (!asset || !asset.isActive) throw new Error("Asset not found or inactive");

  // record event
  await db.insert(marketplaceDownloadsTable).values({
    customerEmail: customerEmail ?? null,
    itemType: "asset",
    itemId: assetId,
    ipAddress: ipAddress ?? null,
  });

  // bump counter
  await db
    .update(marketplaceAssetsTable)
    .set({ downloadsCount: sql`${marketplaceAssetsTable.downloadsCount} + 1` })
    .where(eq(marketplaceAssetsTable.id, assetId));

  // bump creator counter
  if (asset.creatorId) {
    await db
      .update(marketplaceCreatorsTable)
      .set({ totalDownloads: sql`${marketplaceCreatorsTable.totalDownloads} + 1` })
      .where(eq(marketplaceCreatorsTable.id, asset.creatorId));
  }

  return { downloadUrl: asset.fileUrl, asset };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ratings
// ─────────────────────────────────────────────────────────────────────────────

export async function rateItem(
  customerEmail: string,
  itemType: "asset" | "template",
  itemId: number,
  rating: number,
  review?: string,
) {
  if (rating < 1 || rating > 5) throw new Error("Rating must be 1-5");

  await db
    .insert(marketplaceRatingsTable)
    .values({ customerEmail, itemType, itemId, rating, review })
    .onConflictDoUpdate({
      target: [
        marketplaceRatingsTable.customerEmail,
        marketplaceRatingsTable.itemType,
        marketplaceRatingsTable.itemId,
      ],
      set: { rating, review, updatedAt: new Date() },
    });

  // recompute avg for assets
  if (itemType === "asset") {
    const [stats] = await db
      .select({
        avg: sql<string>`AVG(rating)::numeric(3,2)`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(marketplaceRatingsTable)
      .where(
        and(
          eq(marketplaceRatingsTable.itemType, "asset"),
          eq(marketplaceRatingsTable.itemId, itemId),
        ),
      );

    if (stats) {
      await db
        .update(marketplaceAssetsTable)
        .set({
          avgRating: stats.avg,
          ratingsCount: stats.cnt,
          updatedAt: new Date(),
        })
        .where(eq(marketplaceAssetsTable.id, itemId));
    }
  }

  return { ok: true };
}

export async function getItemRatings(itemType: "asset" | "template", itemId: number) {
  return db
    .select()
    .from(marketplaceRatingsTable)
    .where(
      and(
        eq(marketplaceRatingsTable.itemType, itemType),
        eq(marketplaceRatingsTable.itemId, itemId),
      ),
    )
    .orderBy(desc(marketplaceRatingsTable.createdAt))
    .limit(50);
}

// ─────────────────────────────────────────────────────────────────────────────
// Favourites
// ─────────────────────────────────────────────────────────────────────────────

export async function addFavorite(
  customerEmail: string,
  itemType: "asset" | "template",
  itemId: number,
) {
  await db
    .insert(marketplaceFavoritesTable)
    .values({ customerEmail, itemType, itemId })
    .onConflictDoNothing();

  if (itemType === "asset") {
    await db
      .update(marketplaceAssetsTable)
      .set({ favoritesCount: sql`${marketplaceAssetsTable.favoritesCount} + 1` })
      .where(eq(marketplaceAssetsTable.id, itemId));
  }

  return { ok: true };
}

export async function removeFavorite(
  customerEmail: string,
  itemType: string,
  itemId: number,
) {
  await db
    .delete(marketplaceFavoritesTable)
    .where(
      and(
        eq(marketplaceFavoritesTable.customerEmail, customerEmail),
        eq(marketplaceFavoritesTable.itemType, itemType),
        eq(marketplaceFavoritesTable.itemId, itemId),
      ),
    );

  if (itemType === "asset") {
    await db
      .update(marketplaceAssetsTable)
      .set({
        favoritesCount: sql`GREATEST(${marketplaceAssetsTable.favoritesCount} - 1, 0)`,
      })
      .where(eq(marketplaceAssetsTable.id, itemId));
  }

  return { ok: true };
}

export async function getFavorites(customerEmail: string) {
  const favs = await db
    .select()
    .from(marketplaceFavoritesTable)
    .where(eq(marketplaceFavoritesTable.customerEmail, customerEmail))
    .orderBy(desc(marketplaceFavoritesTable.createdAt));

  const assetIds = favs
    .filter((f) => f.itemType === "asset")
    .map((f) => f.itemId);
  const templateIds = favs
    .filter((f) => f.itemType === "template")
    .map((f) => f.itemId);

  const [assets, templates] = await Promise.all([
    assetIds.length > 0
      ? db
          .select()
          .from(marketplaceAssetsTable)
          .where(inArray(marketplaceAssetsTable.id, assetIds))
      : Promise.resolve([]),
    templateIds.length > 0
      ? db
          .select()
          .from(aiTemplatesTable)
          .where(inArray(aiTemplatesTable.id, templateIds))
      : Promise.resolve([]),
  ]);

  return {
    favorites: favs,
    assets,
    templates,
  };
}

export async function getCustomerDownloads(customerEmail: string, limit = 50) {
  return db
    .select()
    .from(marketplaceDownloadsTable)
    .where(eq(marketplaceDownloadsTable.customerEmail, customerEmail))
    .orderBy(desc(marketplaceDownloadsTable.createdAt))
    .limit(limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export async function getMarketplaceAnalytics(): Promise<MarketplaceAnalytics> {
  const [totals, byType] = await Promise.all([
    pool
      .query<{
        total_assets: string;
        free_assets: string;
        premium_assets: string;
        total_creators: string;
        verified_creators: string;
        total_downloads: string;
        total_favorites: string;
        total_ratings: string;
        avg_rating: string;
      }>(
        `SELECT
           COUNT(*)                                   AS total_assets,
           COUNT(*) FILTER (WHERE price_type='free')  AS free_assets,
           COUNT(*) FILTER (WHERE price_type='premium') AS premium_assets,
           (SELECT COUNT(*) FROM ai_platform.marketplace_creators)     AS total_creators,
           (SELECT COUNT(*) FROM ai_platform.marketplace_creators WHERE is_verified) AS verified_creators,
           COALESCE(SUM(downloads_count),0)           AS total_downloads,
           COALESCE(SUM(favorites_count),0)           AS total_favorites,
           COALESCE(SUM(ratings_count),0)             AS total_ratings,
           COALESCE(ROUND(AVG(NULLIF(avg_rating,0)),2),0) AS avg_rating
         FROM ai_platform.marketplace_assets
         WHERE is_active = true`,
      )
      .then((r) => r.rows[0]!),

    pool
      .query<{ asset_type: string; count: string; downloads: string }>(
        `SELECT asset_type,
                COUNT(*)                    AS count,
                COALESCE(SUM(downloads_count),0) AS downloads
         FROM ai_platform.marketplace_assets
         WHERE is_active = true
         GROUP BY asset_type
         ORDER BY downloads DESC`,
      )
      .then((r) => r.rows),
  ]);

  return {
    totalAssets: parseInt(totals.total_assets, 10),
    freeAssets: parseInt(totals.free_assets, 10),
    premiumAssets: parseInt(totals.premium_assets, 10),
    totalCreators: parseInt(totals.total_creators, 10),
    verifiedCreators: parseInt(totals.verified_creators, 10),
    totalDownloads: parseInt(totals.total_downloads, 10),
    totalFavorites: parseInt(totals.total_favorites, 10),
    totalRatings: parseInt(totals.total_ratings, 10),
    avgRating: parseFloat(totals.avg_rating),
    byType: byType.map((r) => ({
      assetType: r.asset_type,
      count: parseInt(r.count, 10),
      downloads: parseInt(r.downloads, 10),
    })),
  };
}

export async function getAdminDownloads(limit = 100, offset = 0) {
  return pool
    .query(
      `SELECT d.*, a.title AS asset_title, a.asset_type
       FROM ai_platform.marketplace_downloads d
       LEFT JOIN ai_platform.marketplace_assets a ON a.id = d.item_id AND d.item_type='asset'
       ORDER BY d.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    .then((r) => r.rows);
}
