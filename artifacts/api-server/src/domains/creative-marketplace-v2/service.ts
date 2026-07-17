/**
 * service.ts — Team 21 Creative Marketplace V2
 *
 * Business logic layer. Converts raw DB rows → safe public or admin DTOs.
 * Security contract:
 *   - toPublicDTO() NEVER includes fileUrl, moderationNote, metadata.
 *   - Public endpoints only call dbGetListingPublic (enforces moderation_state='approved').
 *   - Customer email is masked in public rating DTOs.
 */
import type {
  CM2ListingRow,
  CM2CreatorRow,
  CM2RatingRow,
  CM2ModerationLogRow,
  CM2ListingPublicDTO,
  CM2ListingAdminDTO,
  CM2CreatorSummaryDTO,
  CM2CreatorProfileDTO,
  CM2RatingDTO,
  CM2ModerationLogDTO,
  CM2FavoriteDTO,
  CM2ListFilter,
  CM2LicenseType,
  CM2ItemType,
  CM2PriceType,
  CM2ModerationState,
} from "./types.js";
import {
  defaultLicenseMeta,
  licenseSummary,
} from "./types.js";
import * as repo from "./repository.js";

// ── Email masking ─────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const masked = local.length > 2
    ? `${local.slice(0, 2)}${"*".repeat(Math.min(local.length - 2, 4))}`
    : "**";
  return `${masked}@${domain}`;
}

// ── DTO converters ────────────────────────────────────────────────────────────

function creatorSummary(row: CM2ListingRow): CM2CreatorSummaryDTO | null {
  if (!row.creator_code) return null;
  return {
    id: row.creator_id!,
    creatorCode: row.creator_code,
    displayName: row.creator_display_name!,
    avatarUrl: row.creator_avatar_url ?? null,
    isVerified: row.creator_is_verified ?? false,
    totalListings: row.creator_total_listings ?? 0,
    avgRating: row.creator_avg_rating ?? "0",
  };
}

function creatorRowToSummary(row: CM2CreatorRow): CM2CreatorSummaryDTO {
  return {
    id: row.id,
    creatorCode: row.creator_code,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
    isVerified: row.is_verified,
    totalListings: row.total_listings,
    avgRating: row.avg_rating,
  };
}

function buildLicenseMeta(row: CM2ListingRow) {
  const stored = row.license_metadata ?? {};
  const defaults = defaultLicenseMeta(row.license_type as CM2LicenseType);
  return {
    allowedUses: (stored["allowedUses"] as string[]) ?? defaults.allowedUses,
    requiresAttribution: (stored["requiresAttribution"] as boolean) ?? defaults.requiresAttribution,
    commercialUse: (stored["commercialUse"] as boolean) ?? defaults.commercialUse,
    editorialUse: (stored["editorialUse"] as boolean) ?? defaults.editorialUse,
    printUse: (stored["printUse"] as boolean) ?? defaults.printUse,
    digitalUse: (stored["digitalUse"] as boolean) ?? defaults.digitalUse,
    resellAllowed: (stored["resellAllowed"] as boolean) ?? defaults.resellAllowed,
    modificationAllowed: (stored["modificationAllowed"] as boolean) ?? defaults.modificationAllowed,
    numberOfSeats: (stored["numberOfSeats"] as number | null) ?? defaults.numberOfSeats,
    geographicRestrictions: (stored["geographicRestrictions"] as string[]) ?? defaults.geographicRestrictions,
    notes: (stored["notes"] as string | null) ?? defaults.notes,
  };
}

export function toPublicDTO(row: CM2ListingRow): CM2ListingPublicDTO {
  return {
    id: row.id,
    listingCode: row.listing_code,
    itemType: row.item_type as CM2ItemType,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    creator: creatorSummary(row),
    priceType: row.price_type as CM2PriceType,
    priceAmount: row.price_amount,
    currency: row.currency,
    licenseType: row.license_type as CM2LicenseType,
    licenseSummary: licenseSummary(row.license_type as CM2LicenseType),
    licenseMetadata: buildLicenseMeta(row),
    previewUrls: Array.isArray(row.preview_urls) ? row.preview_urls : [],
    thumbnailUrl: row.thumbnail_url ?? null,
    fileFormat: row.file_format ?? null,
    fileSizeBytes: row.file_size_bytes ?? null,
    isFeatured: row.is_featured,
    downloadsCount: Number(row.downloads_count),
    viewsCount: Number(row.views_count),
    favoritesCount: Number(row.favorites_count),
    avgRating: String(row.avg_rating ?? "0"),
    ratingsCount: Number(row.ratings_count),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    // fileUrl intentionally omitted — never in public DTO
  };
}

export function toAdminDTO(row: CM2ListingRow): CM2ListingAdminDTO {
  return {
    ...toPublicDTO(row),
    fileUrl: row.file_url ?? null,
    moderationState: row.moderation_state as CM2ModerationState,
    moderationNote: row.moderation_note ?? null,
    isActive: row.is_active,
    metadata: row.metadata ?? {},
  };
}

function toRatingDTO(row: CM2RatingRow): CM2RatingDTO {
  return {
    id: row.id,
    customerEmailMasked: maskEmail(row.customer_email),
    rating: row.rating,
    review: row.review ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function toModerationLogDTO(row: CM2ModerationLogRow): CM2ModerationLogDTO {
  return {
    id: row.id,
    listingId: row.listing_id,
    fromState: row.from_state as CM2ModerationState,
    toState: row.to_state as CM2ModerationState,
    reason: row.reason ?? null,
    adminNote: row.admin_note ?? null,
    performedBy: row.performed_by ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

// ── Public service methods ─────────────────────────────────────────────────────

export async function browseListings(filter: CM2ListFilter): Promise<CM2ListingPublicDTO[]> {
  const rows = await repo.dbListListingsPublic(filter);
  return rows.map(toPublicDTO);
}

export async function getListingPublic(id: number): Promise<CM2ListingPublicDTO | null> {
  const row = await repo.dbGetListingPublic(id);
  if (!row) return null;
  await repo.dbIncrementViews(id);
  return toPublicDTO(row);
}

export async function getListingPublicByCode(listingCode: string): Promise<CM2ListingPublicDTO | null> {
  const row = await repo.dbGetListingByCode(listingCode);
  if (!row || row.moderation_state !== "approved" || !row.is_active) return null;
  return toPublicDTO(row);
}

export async function recordDownload(opts: {
  listingId: number;
  customerEmail?: string;
  ipAddress?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  // Only allow downloads of approved + active listings
  const row = await repo.dbGetListingPublic(opts.listingId);
  if (!row) return { ok: false, reason: "listing not found or not available" };
  await repo.dbRecordDownload({
    customerEmail: opts.customerEmail,
    listingId: opts.listingId,
    ipAddress: opts.ipAddress,
  });
  return { ok: true };
}

export async function submitRating(opts: {
  customerEmail: string;
  listingId: number;
  rating: number;
  review?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!Number.isFinite(opts.rating) || opts.rating < 1 || opts.rating > 5) {
    return { ok: false, reason: "rating must be between 1 and 5" };
  }
  const row = await repo.dbGetListingPublic(opts.listingId);
  if (!row) return { ok: false, reason: "listing not found or not available" };
  await repo.dbUpsertRating(opts.customerEmail, opts.listingId, opts.rating, opts.review);
  return { ok: true };
}

export async function getListingRatings(listingId: number): Promise<CM2RatingDTO[]> {
  const rows = await repo.dbGetRatings(listingId);
  return rows.map(toRatingDTO);
}

export async function getDistinctCategories(itemType?: string): Promise<string[]> {
  return repo.dbGetDistinctCategories(itemType);
}

export async function listCreatorsPublic(): Promise<CM2CreatorSummaryDTO[]> {
  const rows = await repo.dbListCreators({ active: true });
  return rows.map(creatorRowToSummary);
}

export async function getCreatorProfile(creatorCode: string): Promise<CM2CreatorProfileDTO | null> {
  const creator = await repo.dbGetCreatorByCode(creatorCode);
  if (!creator || !creator.is_active) return null;

  // listings for this creator (approved only, public)
  const listingRows = await repo.dbListListingsPublic({
    creatorId: creator.id,
    sortBy: "newest",
    limit: 20,
  });

  return {
    id: creator.id,
    creatorCode: creator.creator_code,
    displayName: creator.display_name,
    bio: creator.bio ?? null,
    avatarUrl: creator.avatar_url ?? null,
    websiteUrl: creator.website_url ?? null,
    socialLinks: (creator.social_links ?? {}) as Record<string, string>,
    isVerified: creator.is_verified,
    totalListings: creator.total_listings,
    totalDownloads: creator.total_downloads,
    avgRating: creator.avg_rating,
    isActive: creator.is_active,
    listings: listingRows.map(toPublicDTO),
  };
}

// ── Admin service methods ─────────────────────────────────────────────────────

export async function adminListListings(filter: CM2ListFilter): Promise<CM2ListingAdminDTO[]> {
  const rows = await repo.dbListListingsAdmin(filter);
  return rows.map(toAdminDTO);
}

export async function adminGetListing(id: number): Promise<CM2ListingAdminDTO | null> {
  const row = await repo.dbGetListingAdmin(id);
  return row ? toAdminDTO(row) : null;
}

export async function adminCreateListing(data: Parameters<typeof repo.dbCreateListing>[0]): Promise<CM2ListingAdminDTO> {
  // Check duplicate listingCode
  const existing = await repo.dbGetListingByCode(data.listingCode);
  if (existing) throw new Error(`Duplicate listing_code: ${data.listingCode}`);

  const row = await repo.dbCreateListing(data);
  if (data.creatorId) await repo.dbSyncCreatorStats(data.creatorId);
  return toAdminDTO(row);
}

export async function adminUpdateListing(
  id: number,
  data: Parameters<typeof repo.dbUpdateListing>[1],
): Promise<CM2ListingAdminDTO | null> {
  const row = await repo.dbUpdateListing(id, data);
  if (!row) return null;
  if (row.creator_id) await repo.dbSyncCreatorStats(row.creator_id);
  return toAdminDTO(row);
}

export async function adminModerateListing(
  id: number,
  toState: CM2ModerationState,
  performedBy: string,
  reason?: string,
  adminNote?: string,
): Promise<CM2ListingAdminDTO | null> {
  // Guard: cannot transition to same state
  const current = await repo.dbGetListingAdmin(id);
  if (!current) return null;
  if (current.moderation_state === toState) {
    throw new Error(`Listing already in state '${toState}'`);
  }

  const row = await repo.dbModerateListing(id, toState, performedBy, reason, adminNote);
  if (!row) return null;
  // Sync creator stats when a listing is approved/unapproved
  if (row.creator_id) await repo.dbSyncCreatorStats(row.creator_id);
  return toAdminDTO(row);
}

export async function adminToggleFeatured(id: number): Promise<CM2ListingAdminDTO | null> {
  const row = await repo.dbToggleFeatured(id);
  return row ? toAdminDTO(row) : null;
}

export async function adminGetModerationLog(listingId: number): Promise<CM2ModerationLogDTO[]> {
  const rows = await repo.dbGetModerationLog(listingId);
  return rows.map(toModerationLogDTO);
}

export async function adminGetModerationQueue(): Promise<CM2ListingAdminDTO[]> {
  const rows = await repo.dbGetModerationQueue();
  return rows.map(toAdminDTO);
}

export async function adminGetPlatformAnalytics() {
  return repo.dbGetPlatformAnalytics();
}

export async function adminGetListingAnalytics(listingId: number) {
  return repo.dbGetListingAnalytics(listingId);
}

export async function adminGetDownloadLog(opts: { listingId?: number; limit?: number }) {
  return repo.dbGetDownloadLog(opts);
}

export async function adminListCreators(opts?: {
  verified?: boolean;
  limit?: number;
  offset?: number;
}): Promise<CM2CreatorSummaryDTO[]> {
  const rows = await repo.dbListCreators(opts);
  return rows.map(creatorRowToSummary);
}

export async function adminGetCreator(id: number): Promise<CM2CreatorRow | null> {
  return repo.dbGetCreatorById(id);
}

export async function adminCreateCreator(data: Parameters<typeof repo.dbCreateCreator>[0]): Promise<CM2CreatorRow> {
  const existing = await repo.dbGetCreatorByCode(data.creatorCode);
  if (existing) throw new Error(`Duplicate creator_code: ${data.creatorCode}`);
  return repo.dbCreateCreator(data);
}

export async function adminUpdateCreator(
  id: number,
  data: Parameters<typeof repo.dbUpdateCreator>[1],
): Promise<CM2CreatorRow | null> {
  return repo.dbUpdateCreator(id, data);
}

export async function adminToggleCreatorVerified(id: number): Promise<CM2CreatorRow | null> {
  return repo.dbToggleCreatorVerified(id);
}

// ── Workspace service methods (token-authenticated) ────────────────────────────

/** Uses a single JOIN query — no N+1. Only approved+active listings included. */
export async function getFavorites(customerEmail: string): Promise<CM2FavoriteDTO[]> {
  const rows = await repo.dbGetFavoritesWithListings(customerEmail);
  return rows.map((r) => ({
    id: r.fav_id,
    listingId: r.listing.id,
    listing: toPublicDTO(r.listing),
    createdAt: r.fav_created_at instanceof Date ? r.fav_created_at.toISOString() : String(r.fav_created_at),
  }));
}

export async function addFavorite(
  customerEmail: string,
  listingId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const row = await repo.dbGetListingPublic(listingId);
  if (!row) return { ok: false, reason: "listing not found or not available" };
  await repo.dbAddFavorite(customerEmail, listingId);
  return { ok: true };
}

export async function removeFavorite(
  customerEmail: string,
  listingId: number,
): Promise<{ ok: boolean }> {
  const removed = await repo.dbRemoveFavorite(customerEmail, listingId);
  return { ok: removed };
}

export async function getCustomerDownloads(customerEmail: string) {
  return repo.dbGetCustomerDownloads(customerEmail);
}
