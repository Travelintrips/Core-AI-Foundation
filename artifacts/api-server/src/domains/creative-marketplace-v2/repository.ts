/**
 * repository.ts — Team 21 Creative Marketplace V2
 *
 * All DB queries via raw pool SQL (ai_platform schema).
 * Never uses drizzle-kit push — table definitions live in team-21.sql.
 * Public queries ALWAYS filter: moderation_state = 'approved' AND is_active = true.
 */
import { pool } from "@workspace/db";
import type {
  CM2ListFilter,
  CM2ListingRow,
  CM2CreatorRow,
  CM2RatingRow,
  CM2ModerationLogRow,
  CM2ModerationState,
} from "./types.js";

const SCHEMA = "ai_platform";

// ── Helpers ───────────────────────────────────────────────────────────────────

function listing_join() {
  return `
    LEFT JOIN ${SCHEMA}.cm2_creator_profiles cp ON l.creator_id = cp.id
  `;
}

function listing_select() {
  return `
    l.*,
    cp.creator_code, cp.display_name AS creator_display_name,
    cp.avatar_url AS creator_avatar_url,
    cp.is_verified AS creator_is_verified,
    cp.total_listings AS creator_total_listings,
    cp.avg_rating AS creator_avg_rating
  `;
}

// ── Listing queries ───────────────────────────────────────────────────────────

export async function dbListListingsPublic(filter: CM2ListFilter): Promise<CM2ListingRow[]> {
  const params: unknown[] = [];
  const clauses: string[] = [
    `l.moderation_state = 'approved'`,
    `l.is_active = true`,
  ];
  let i = 1;

  if (filter.itemType) { clauses.push(`l.item_type = $${i++}`); params.push(filter.itemType); }
  if (filter.category) { clauses.push(`l.category = $${i++}`); params.push(filter.category); }
  if (filter.priceType) { clauses.push(`l.price_type = $${i++}`); params.push(filter.priceType); }
  if (filter.licenseType) { clauses.push(`l.license_type = $${i++}`); params.push(filter.licenseType); }
  if (filter.featured === true) { clauses.push(`l.is_featured = true`); }
  if (filter.creatorId) { clauses.push(`l.creator_id = $${i++}`); params.push(filter.creatorId); }
  if (filter.search) {
    clauses.push(`(l.title ILIKE $${i} OR l.description ILIKE $${i} OR l.tags::text ILIKE $${i})`);
    params.push(`%${filter.search}%`);
    i++;
  }
  if (filter.tags && filter.tags.length > 0) {
    clauses.push(`l.tags ?| $${i++}::text[]`);
    params.push(filter.tags);
  }

  const sortMap: Record<string, string> = {
    newest: "l.created_at DESC",
    popular: "l.views_count DESC",
    rating: "l.avg_rating DESC, l.ratings_count DESC",
    downloads: "l.downloads_count DESC",
  };
  const orderBy = sortMap[filter.sortBy ?? "newest"] ?? "l.created_at DESC";
  const limit = Math.min(filter.limit ?? 24, 100);
  const offset = filter.offset ?? 0;

  const sql = `
    SELECT ${listing_select()}
    FROM ${SCHEMA}.cm2_listings l
    ${listing_join()}
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `;
  const { rows } = await pool.query<CM2ListingRow>(sql, params);
  return rows;
}

export async function dbListListingsAdmin(filter: CM2ListFilter): Promise<CM2ListingRow[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  let i = 1;

  if (filter.itemType) { clauses.push(`l.item_type = $${i++}`); params.push(filter.itemType); }
  if (filter.category) { clauses.push(`l.category = $${i++}`); params.push(filter.category); }
  if (filter.priceType) { clauses.push(`l.price_type = $${i++}`); params.push(filter.priceType); }
  if (filter.moderationState) { clauses.push(`l.moderation_state = $${i++}`); params.push(filter.moderationState); }
  if (filter.creatorId) { clauses.push(`l.creator_id = $${i++}`); params.push(filter.creatorId); }
  if (filter.search) {
    clauses.push(`(l.title ILIKE $${i} OR l.description ILIKE $${i})`);
    params.push(`%${filter.search}%`);
    i++;
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sortMap: Record<string, string> = {
    newest: "l.created_at DESC",
    popular: "l.views_count DESC",
    rating: "l.avg_rating DESC",
    downloads: "l.downloads_count DESC",
  };
  const orderBy = sortMap[filter.sortBy ?? "newest"] ?? "l.created_at DESC";
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const sql = `
    SELECT ${listing_select()}
    FROM ${SCHEMA}.cm2_listings l
    ${listing_join()}
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${limit} OFFSET ${offset}
  `;
  const { rows } = await pool.query<CM2ListingRow>(sql, params);
  return rows;
}

export async function dbGetListingPublic(id: number): Promise<CM2ListingRow | null> {
  const { rows } = await pool.query<CM2ListingRow>(
    `SELECT ${listing_select()}
     FROM ${SCHEMA}.cm2_listings l
     ${listing_join()}
     WHERE l.id = $1 AND l.moderation_state = 'approved' AND l.is_active = true`,
    [id],
  );
  return rows[0] ?? null;
}

export async function dbGetListingAdmin(id: number): Promise<CM2ListingRow | null> {
  const { rows } = await pool.query<CM2ListingRow>(
    `SELECT ${listing_select()}
     FROM ${SCHEMA}.cm2_listings l
     ${listing_join()}
     WHERE l.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function dbGetListingByCode(listingCode: string): Promise<CM2ListingRow | null> {
  const { rows } = await pool.query<CM2ListingRow>(
    `SELECT ${listing_select()}
     FROM ${SCHEMA}.cm2_listings l
     ${listing_join()}
     WHERE l.listing_code = $1`,
    [listingCode],
  );
  return rows[0] ?? null;
}

export async function dbCreateListing(data: {
  listingCode: string;
  itemType: string;
  title: string;
  description?: string;
  category: string;
  tags?: string[];
  creatorId?: number;
  priceType?: string;
  priceAmount?: string;
  currency?: string;
  licenseType?: string;
  licenseMetadata?: Record<string, unknown>;
  fileUrl?: string;
  previewUrls?: string[];
  thumbnailUrl?: string;
  fileFormat?: string;
  fileSizeBytes?: number;
  metadata?: Record<string, unknown>;
}): Promise<CM2ListingRow> {
  const { rows } = await pool.query<CM2ListingRow>(
    `INSERT INTO ${SCHEMA}.cm2_listings (
       listing_code, item_type, title, description, category, tags,
       creator_id, price_type, price_amount, currency, license_type, license_metadata,
       file_url, preview_urls, thumbnail_url, file_format, file_size_bytes, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      data.listingCode,
      data.itemType,
      data.title,
      data.description ?? null,
      data.category,
      JSON.stringify(data.tags ?? []),
      data.creatorId ?? null,
      data.priceType ?? "free",
      data.priceAmount ?? "0",
      data.currency ?? "IDR",
      data.licenseType ?? "standard",
      JSON.stringify(data.licenseMetadata ?? {}),
      data.fileUrl ?? null,
      JSON.stringify(data.previewUrls ?? []),
      data.thumbnailUrl ?? null,
      data.fileFormat ?? null,
      data.fileSizeBytes ?? null,
      JSON.stringify(data.metadata ?? {}),
    ],
  );
  // fetch with join
  return (await dbGetListingAdmin(rows[0]!.id))!;
}

export async function dbUpdateListing(
  id: number,
  data: Partial<{
    title: string;
    description: string;
    category: string;
    tags: string[];
    priceType: string;
    priceAmount: string;
    currency: string;
    licenseType: string;
    licenseMetadata: Record<string, unknown>;
    fileUrl: string;
    previewUrls: string[];
    thumbnailUrl: string;
    fileFormat: string;
    fileSizeBytes: number;
    isFeatured: boolean;
    isActive: boolean;
    metadata: Record<string, unknown>;
  }>,
): Promise<CM2ListingRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  const fieldMap: Record<string, string> = {
    title: "title", description: "description", category: "category",
    priceType: "price_type", priceAmount: "price_amount", currency: "currency",
    licenseType: "license_type", fileUrl: "file_url", thumbnailUrl: "thumbnail_url",
    fileFormat: "file_format", fileSizeBytes: "file_size_bytes",
    isFeatured: "is_featured", isActive: "is_active",
  };
  const jsonFields = new Set(["tags", "previewUrls", "licenseMetadata", "metadata"]);
  const jsonColMap: Record<string, string> = {
    tags: "tags", previewUrls: "preview_urls",
    licenseMetadata: "license_metadata", metadata: "metadata",
  };

  for (const [k, v] of Object.entries(data)) {
    if (jsonFields.has(k)) {
      sets.push(`${jsonColMap[k]} = $${i++}`);
      params.push(JSON.stringify(v));
    } else if (fieldMap[k]) {
      sets.push(`${fieldMap[k]} = $${i++}`);
      params.push(v);
    }
  }

  if (sets.length === 0) return dbGetListingAdmin(id);

  params.push(id);
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_listings SET ${sets.join(", ")} WHERE id = $${i}`,
    params,
  );
  return dbGetListingAdmin(id);
}

export async function dbModerateListing(
  id: number,
  toState: CM2ModerationState,
  performedBy: string,
  reason?: string,
  adminNote?: string,
): Promise<CM2ListingRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: current } = await client.query<{ moderation_state: string }>(
      `SELECT moderation_state FROM ${SCHEMA}.cm2_listings WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!current[0]) { await client.query("ROLLBACK"); return null; }
    const fromState = current[0].moderation_state;

    await client.query(
      `UPDATE ${SCHEMA}.cm2_listings SET moderation_state = $1, moderation_note = $2 WHERE id = $3`,
      [toState, adminNote ?? null, id],
    );
    await client.query(
      `INSERT INTO ${SCHEMA}.cm2_moderation_log
         (listing_id, from_state, to_state, reason, admin_note, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, fromState, toState, reason ?? null, adminNote ?? null, performedBy],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return dbGetListingAdmin(id);
}

export async function dbToggleFeatured(id: number): Promise<CM2ListingRow | null> {
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_listings SET is_featured = NOT is_featured WHERE id = $1`,
    [id],
  );
  return dbGetListingAdmin(id);
}

export async function dbIncrementViews(id: number): Promise<void> {
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_listings SET views_count = views_count + 1 WHERE id = $1`,
    [id],
  );
  // upsert daily snapshot
  await pool.query(
    `INSERT INTO ${SCHEMA}.cm2_analytics_snapshots (listing_id, snapshot_date, views_delta)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (listing_id, snapshot_date)
     DO UPDATE SET views_delta = cm2_analytics_snapshots.views_delta + 1`,
    [id],
  );
}

export async function dbIncrementDownloads(id: number): Promise<void> {
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_listings SET downloads_count = downloads_count + 1 WHERE id = $1`,
    [id],
  );
  await pool.query(
    `INSERT INTO ${SCHEMA}.cm2_analytics_snapshots (listing_id, snapshot_date, downloads_delta)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (listing_id, snapshot_date)
     DO UPDATE SET downloads_delta = cm2_analytics_snapshots.downloads_delta + 1`,
    [id],
  );
}

// ── Creator queries ───────────────────────────────────────────────────────────

export async function dbListCreators(opts?: {
  verified?: boolean;
  active?: boolean;
  limit?: number;
  offset?: number;
}): Promise<CM2CreatorRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (opts?.verified !== undefined) { clauses.push(`is_verified = $${i++}`); params.push(opts.verified); }
  if (opts?.active !== undefined) { clauses.push(`is_active = $${i++}`); params.push(opts.active); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;

  const { rows } = await pool.query<CM2CreatorRow>(
    `SELECT * FROM ${SCHEMA}.cm2_creator_profiles ${where}
     ORDER BY total_listings DESC, avg_rating DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows;
}

export async function dbGetCreatorByCode(creatorCode: string): Promise<CM2CreatorRow | null> {
  const { rows } = await pool.query<CM2CreatorRow>(
    `SELECT * FROM ${SCHEMA}.cm2_creator_profiles WHERE creator_code = $1`,
    [creatorCode],
  );
  return rows[0] ?? null;
}

export async function dbGetCreatorById(id: number): Promise<CM2CreatorRow | null> {
  const { rows } = await pool.query<CM2CreatorRow>(
    `SELECT * FROM ${SCHEMA}.cm2_creator_profiles WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function dbCreateCreator(data: {
  creatorCode: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  socialLinks?: Record<string, string>;
  email?: string;
}): Promise<CM2CreatorRow> {
  const { rows } = await pool.query<CM2CreatorRow>(
    `INSERT INTO ${SCHEMA}.cm2_creator_profiles
       (creator_code, display_name, bio, avatar_url, website_url, social_links, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      data.creatorCode, data.displayName,
      data.bio ?? null, data.avatarUrl ?? null,
      data.websiteUrl ?? null,
      JSON.stringify(data.socialLinks ?? {}),
      data.email ?? null,
    ],
  );
  return rows[0]!;
}

export async function dbUpdateCreator(
  id: number,
  data: Partial<{
    displayName: string; bio: string; avatarUrl: string;
    websiteUrl: string; socialLinks: Record<string, string>;
    email: string; isActive: boolean;
  }>,
): Promise<CM2CreatorRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  const fieldMap: Record<string, string> = {
    displayName: "display_name", bio: "bio", avatarUrl: "avatar_url",
    websiteUrl: "website_url", email: "email", isActive: "is_active",
  };

  for (const [k, v] of Object.entries(data)) {
    if (k === "socialLinks") { sets.push(`social_links = $${i++}`); params.push(JSON.stringify(v)); }
    else if (fieldMap[k]) { sets.push(`${fieldMap[k]} = $${i++}`); params.push(v); }
  }

  if (sets.length === 0) return dbGetCreatorById(id);
  params.push(id);
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_creator_profiles SET ${sets.join(", ")} WHERE id = $${i}`,
    params,
  );
  return dbGetCreatorById(id);
}

export async function dbToggleCreatorVerified(id: number): Promise<CM2CreatorRow | null> {
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_creator_profiles SET is_verified = NOT is_verified WHERE id = $1`,
    [id],
  );
  return dbGetCreatorById(id);
}

export async function dbSyncCreatorStats(creatorId: number): Promise<void> {
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_creator_profiles cp
     SET total_listings  = (SELECT COUNT(*) FROM ${SCHEMA}.cm2_listings
                            WHERE creator_id = $1 AND moderation_state = 'approved' AND is_active = true),
         total_downloads = COALESCE((SELECT SUM(downloads_count) FROM ${SCHEMA}.cm2_listings
                                     WHERE creator_id = $1), 0),
         avg_rating      = COALESCE((SELECT AVG(avg_rating) FROM ${SCHEMA}.cm2_listings
                                     WHERE creator_id = $1 AND ratings_count > 0), 0)
     WHERE id = $1`,
    [creatorId],
  );
}

// ── Distinct categories (dedicated query — no full scan) ──────────────────────

export async function dbGetDistinctCategories(itemType?: string): Promise<string[]> {
  const params: unknown[] = [];
  const clauses = [
    `moderation_state = 'approved'`,
    `is_active = true`,
  ];
  if (itemType) { clauses.push(`item_type = $1`); params.push(itemType); }
  const { rows } = await pool.query<{ category: string }>(
    `SELECT DISTINCT category FROM ${SCHEMA}.cm2_listings
     WHERE ${clauses.join(" AND ")}
     ORDER BY category`,
    params,
  );
  return rows.map((r) => r.category);
}

// ── Favorites ─────────────────────────────────────────────────────────────────

/**
 * Single JOIN query — avoids N+1 per-favorite listing fetch.
 * Only returns favorites whose listing is still approved + active.
 */
export async function dbGetFavoritesWithListings(customerEmail: string): Promise<
  { fav_id: number; fav_created_at: Date; listing: CM2ListingRow }[]
> {
  const { rows } = await pool.query(
    `SELECT
       f.id        AS fav_id,
       f.created_at AS fav_created_at,
       l.*,
       cp.creator_code,
       cp.display_name   AS creator_display_name,
       cp.avatar_url     AS creator_avatar_url,
       cp.is_verified    AS creator_is_verified,
       cp.total_listings AS creator_total_listings,
       cp.avg_rating     AS creator_avg_rating
     FROM ${SCHEMA}.cm2_favorites f
     JOIN ${SCHEMA}.cm2_listings l
       ON l.id = f.listing_id
      AND l.moderation_state = 'approved'
      AND l.is_active = true
     LEFT JOIN ${SCHEMA}.cm2_creator_profiles cp ON l.creator_id = cp.id
     WHERE f.customer_email = $1
     ORDER BY f.created_at DESC
     LIMIT 100`,
    [customerEmail],
  );
  return rows.map((r: Record<string, unknown>) => ({
    fav_id: r["fav_id"] as number,
    fav_created_at: r["fav_created_at"] as Date,
    listing: r as unknown as CM2ListingRow,
  }));
}

/** @deprecated Use dbGetFavoritesWithListings for production paths */
export async function dbGetFavorites(customerEmail: string): Promise<
  { id: number; listing_id: number; created_at: Date }[]
> {
  const { rows } = await pool.query(
    `SELECT id, listing_id, created_at FROM ${SCHEMA}.cm2_favorites
     WHERE customer_email = $1 ORDER BY created_at DESC`,
    [customerEmail],
  );
  return rows;
}

export async function dbAddFavorite(
  customerEmail: string, listingId: number,
): Promise<{ id: number; listing_id: number; created_at: Date }> {
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.cm2_favorites (customer_email, listing_id)
     VALUES ($1, $2)
     ON CONFLICT (customer_email, listing_id) DO NOTHING
     RETURNING id, listing_id, created_at`,
    [customerEmail, listingId],
  );
  if (rows[0]) {
    await pool.query(
      `UPDATE ${SCHEMA}.cm2_listings SET favorites_count = favorites_count + 1 WHERE id = $1`,
      [listingId],
    );
    await pool.query(
      `INSERT INTO ${SCHEMA}.cm2_analytics_snapshots (listing_id, snapshot_date, favorites_delta)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (listing_id, snapshot_date)
       DO UPDATE SET favorites_delta = cm2_analytics_snapshots.favorites_delta + 1`,
      [listingId],
    );
  }
  return rows[0] ?? { id: 0, listing_id: listingId, created_at: new Date() };
}

export async function dbRemoveFavorite(
  customerEmail: string, listingId: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM ${SCHEMA}.cm2_favorites WHERE customer_email = $1 AND listing_id = $2`,
    [customerEmail, listingId],
  );
  if ((rowCount ?? 0) > 0) {
    await pool.query(
      `UPDATE ${SCHEMA}.cm2_listings
       SET favorites_count = GREATEST(0, favorites_count - 1) WHERE id = $1`,
      [listingId],
    );
  }
  return (rowCount ?? 0) > 0;
}

// ── Ratings ───────────────────────────────────────────────────────────────────

export async function dbGetRatings(listingId: number, limit = 20): Promise<CM2RatingRow[]> {
  const { rows } = await pool.query<CM2RatingRow>(
    `SELECT * FROM ${SCHEMA}.cm2_ratings WHERE listing_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [listingId, limit],
  );
  return rows;
}

export async function dbUpsertRating(
  customerEmail: string, listingId: number, rating: number, review?: string,
): Promise<CM2RatingRow> {
  const { rows } = await pool.query<CM2RatingRow>(
    `INSERT INTO ${SCHEMA}.cm2_ratings (customer_email, listing_id, rating, review)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (customer_email, listing_id)
     DO UPDATE SET rating = EXCLUDED.rating, review = EXCLUDED.review, updated_at = NOW()
     RETURNING *`,
    [customerEmail, listingId, rating, review ?? null],
  );
  // recalculate aggregate
  await pool.query(
    `UPDATE ${SCHEMA}.cm2_listings
     SET avg_rating    = (SELECT AVG(rating)::numeric(3,2) FROM ${SCHEMA}.cm2_ratings WHERE listing_id = $1),
         ratings_count = (SELECT COUNT(*) FROM ${SCHEMA}.cm2_ratings WHERE listing_id = $1)
     WHERE id = $1`,
    [listingId],
  );
  return rows[0]!;
}

// ── Downloads ─────────────────────────────────────────────────────────────────

export async function dbRecordDownload(opts: {
  customerEmail?: string;
  listingId: number;
  ipAddress?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ${SCHEMA}.cm2_downloads (customer_email, listing_id, ip_address)
     VALUES ($1,$2,$3)`,
    [opts.customerEmail ?? null, opts.listingId, opts.ipAddress ?? null],
  );
  await dbIncrementDownloads(opts.listingId);
}

export async function dbGetCustomerDownloads(customerEmail: string): Promise<
  { id: number; listing_id: number; created_at: Date }[]
> {
  const { rows } = await pool.query(
    `SELECT id, listing_id, created_at FROM ${SCHEMA}.cm2_downloads
     WHERE customer_email = $1 ORDER BY created_at DESC LIMIT 100`,
    [customerEmail],
  );
  return rows;
}

// ── Moderation log ────────────────────────────────────────────────────────────

export async function dbGetModerationLog(listingId: number): Promise<CM2ModerationLogRow[]> {
  const { rows } = await pool.query<CM2ModerationLogRow>(
    `SELECT * FROM ${SCHEMA}.cm2_moderation_log WHERE listing_id = $1 ORDER BY created_at DESC`,
    [listingId],
  );
  return rows;
}

export async function dbGetModerationQueue(): Promise<CM2ListingRow[]> {
  return dbListListingsAdmin({ moderationState: "pending", sortBy: "newest", limit: 100 });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function dbGetPlatformAnalytics(): Promise<Record<string, unknown>> {
  const { rows: [row] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE moderation_state = 'approved' AND is_active = true) AS total_approved,
      COUNT(*) AS total_all,
      COUNT(*) FILTER (WHERE moderation_state = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE moderation_state = 'rejected') AS rejected_count,
      COUNT(*) FILTER (WHERE moderation_state = 'suspended') AS suspended_count,
      COUNT(*) FILTER (WHERE price_type = 'free') AS free_count,
      COUNT(*) FILTER (WHERE price_type = 'premium') AS premium_count,
      SUM(downloads_count)::bigint AS total_downloads,
      SUM(views_count)::bigint AS total_views,
      SUM(favorites_count)::bigint AS total_favorites,
      COALESCE(AVG(NULLIF(avg_rating, 0))::numeric(3,2), 0) AS platform_avg_rating
    FROM ${SCHEMA}.cm2_listings
  `);

  const { rows: byType } = await pool.query(`
    SELECT item_type, COUNT(*) AS cnt
    FROM ${SCHEMA}.cm2_listings WHERE moderation_state = 'approved' AND is_active = true
    GROUP BY item_type ORDER BY cnt DESC
  `);

  const { rows: creatorStats } = await pool.query(`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_verified = true) AS verified
    FROM ${SCHEMA}.cm2_creator_profiles WHERE is_active = true
  `);

  return {
    totalListings: Number(row.total_approved),
    totalAll: Number(row.total_all),
    byModerationState: {
      approved: Number(row.total_approved),
      pending: Number(row.pending_count),
      rejected: Number(row.rejected_count),
      suspended: Number(row.suspended_count),
    },
    byItemType: Object.fromEntries(byType.map((r: { item_type: string; cnt: string }) => [r.item_type, Number(r.cnt)])),
    freeListings: Number(row.free_count),
    premiumListings: Number(row.premium_count),
    totalDownloads: Number(row.total_downloads ?? 0),
    totalViews: Number(row.total_views ?? 0),
    totalFavorites: Number(row.total_favorites ?? 0),
    avgRating: String(row.platform_avg_rating ?? "0"),
    totalCreators: Number(creatorStats[0]?.total ?? 0),
    verifiedCreators: Number(creatorStats[0]?.verified ?? 0),
  };
}

export async function dbGetListingAnalytics(listingId: number): Promise<{
  listing: CM2ListingRow | null;
  snapshots: { date: string; viewsDelta: number; downloadsDelta: number; favoritesDelta: number }[];
}> {
  const listing = await dbGetListingAdmin(listingId);
  const { rows } = await pool.query(
    `SELECT snapshot_date::text AS date, views_delta, downloads_delta, favorites_delta
     FROM ${SCHEMA}.cm2_analytics_snapshots WHERE listing_id = $1
     ORDER BY snapshot_date DESC LIMIT 30`,
    [listingId],
  );
  return {
    listing,
    snapshots: rows.map((r: {
      date: string; views_delta: number;
      downloads_delta: number; favorites_delta: number
    }) => ({
      date: r.date,
      viewsDelta: Number(r.views_delta),
      downloadsDelta: Number(r.downloads_delta),
      favoritesDelta: Number(r.favorites_delta),
    })),
  };
}

// ── Admin downloads log ────────────────────────────────────────────────────────

export async function dbGetDownloadLog(opts: { listingId?: number; limit?: number }): Promise<{
  id: number; customer_email: string | null; listing_id: number;
  ip_address: string | null; created_at: Date
}[]> {
  const params: unknown[] = [];
  let where = "";
  if (opts.listingId) { where = "WHERE listing_id = $1"; params.push(opts.listingId); }
  const limit = Math.min(opts.limit ?? 100, 500);
  const { rows } = await pool.query(
    `SELECT id, customer_email, listing_id, ip_address, created_at
     FROM ${SCHEMA}.cm2_downloads ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  return rows;
}
