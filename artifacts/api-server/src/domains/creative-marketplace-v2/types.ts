/**
 * types.ts — Team 21 Creative Marketplace V2
 *
 * All DTOs, enums, and filter types for the domain.
 * Public DTOs never expose: fileUrl, moderationNote, internal metadata fields.
 */

// ── Item type vocabulary ──────────────────────────────────────────────────────

export const CM2_ITEM_TYPES = [
  "blueprint",
  "template",
  "pattern",
  "icon",
  "illustration",
  "layout",
  "typography_pairing",
  "palette",
  "interior_material",
  "furniture_reference",
  "fashion_motif",
  "brand_pack",
] as const;

export type CM2ItemType = (typeof CM2_ITEM_TYPES)[number];

export const CM2_MODERATION_STATES = [
  "pending",
  "approved",
  "rejected",
  "suspended",
] as const;
export type CM2ModerationState = (typeof CM2_MODERATION_STATES)[number];

export const CM2_LICENSE_TYPES = ["standard", "extended", "exclusive"] as const;
export type CM2LicenseType = (typeof CM2_LICENSE_TYPES)[number];

export const CM2_PRICE_TYPES = ["free", "premium"] as const;
export type CM2PriceType = (typeof CM2_PRICE_TYPES)[number];

// ── License metadata ──────────────────────────────────────────────────────────

export interface CM2LicenseMetadata {
  allowedUses: string[];
  requiresAttribution: boolean;
  commercialUse: boolean;
  editorialUse: boolean;
  printUse: boolean;
  digitalUse: boolean;
  resellAllowed: boolean;
  modificationAllowed: boolean;
  numberOfSeats: number | null;
  geographicRestrictions: string[];
  notes: string | null;
}

export function defaultLicenseMeta(type: CM2LicenseType): CM2LicenseMetadata {
  switch (type) {
    case "standard":
      return {
        allowedUses: ["personal", "editorial"],
        requiresAttribution: true,
        commercialUse: false,
        editorialUse: true,
        printUse: true,
        digitalUse: true,
        resellAllowed: false,
        modificationAllowed: true,
        numberOfSeats: 1,
        geographicRestrictions: [],
        notes: null,
      };
    case "extended":
      return {
        allowedUses: ["personal", "editorial", "commercial"],
        requiresAttribution: false,
        commercialUse: true,
        editorialUse: true,
        printUse: true,
        digitalUse: true,
        resellAllowed: false,
        modificationAllowed: true,
        numberOfSeats: null,
        geographicRestrictions: [],
        notes: null,
      };
    case "exclusive":
      return {
        allowedUses: ["personal", "editorial", "commercial", "resell"],
        requiresAttribution: false,
        commercialUse: true,
        editorialUse: true,
        printUse: true,
        digitalUse: true,
        resellAllowed: true,
        modificationAllowed: true,
        numberOfSeats: null,
        geographicRestrictions: [],
        notes: null,
      };
  }
}

export function licenseSummary(type: CM2LicenseType): string {
  switch (type) {
    case "standard":
      return "Personal & editorial use. Attribution required. No commercial use.";
    case "extended":
      return "Commercial use included. No resell. No attribution needed.";
    case "exclusive":
      return "Full commercial rights including resell. No attribution needed.";
  }
}

// ── Public DTOs (safe for unauthenticated response) ───────────────────────────

export interface CM2CreatorSummaryDTO {
  id: number;
  creatorCode: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  totalListings: number;
  avgRating: string;
}

export interface CM2ListingPublicDTO {
  id: number;
  listingCode: string;
  itemType: CM2ItemType;
  title: string;
  description: string | null;
  category: string;
  tags: string[];
  creator: CM2CreatorSummaryDTO | null;
  priceType: CM2PriceType;
  priceAmount: string;
  currency: string;
  licenseType: CM2LicenseType;
  licenseSummary: string;
  licenseMetadata: CM2LicenseMetadata;
  previewUrls: string[];
  thumbnailUrl: string | null;
  fileFormat: string | null;
  fileSizeBytes: number | null;
  isFeatured: boolean;
  downloadsCount: number;
  viewsCount: number;
  favoritesCount: number;
  avgRating: string;
  ratingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CM2CreatorProfileDTO extends CM2CreatorSummaryDTO {
  bio: string | null;
  websiteUrl: string | null;
  socialLinks: Record<string, string>;
  totalDownloads: number;
  isActive: boolean;
  listings: CM2ListingPublicDTO[];
}

export interface CM2RatingDTO {
  id: number;
  customerEmailMasked: string; // e.g. "jo***@example.com"
  rating: number;
  review: string | null;
  createdAt: string;
}

export interface CM2FavoriteDTO {
  id: number;
  listingId: number;
  listing: CM2ListingPublicDTO;
  createdAt: string;
}

// ── Admin DTOs (includes internal fields) ────────────────────────────────────

export interface CM2ListingAdminDTO extends CM2ListingPublicDTO {
  fileUrl: string | null;
  moderationState: CM2ModerationState;
  moderationNote: string | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
}

export interface CM2ModerationLogDTO {
  id: number;
  listingId: number;
  fromState: CM2ModerationState;
  toState: CM2ModerationState;
  reason: string | null;
  adminNote: string | null;
  performedBy: string | null;
  createdAt: string;
}

export interface CM2AnalyticsDTO {
  totalListings: number;
  byItemType: Record<string, number>;
  byModerationState: Record<string, number>;
  totalCreators: number;
  verifiedCreators: number;
  totalDownloads: number;
  totalViews: number;
  totalFavorites: number;
  avgRating: string;
  freeListings: number;
  premiumListings: number;
}

export interface CM2ListingAnalyticsDTO {
  listingId: number;
  totalViews: number;
  totalDownloads: number;
  totalFavorites: number;
  avgRating: string;
  ratingsCount: number;
  snapshots: {
    date: string;
    viewsDelta: number;
    downloadsDelta: number;
    favoritesDelta: number;
  }[];
}

// ── Query filters ─────────────────────────────────────────────────────────────

export interface CM2ListFilter {
  itemType?: string;
  category?: string;
  priceType?: string;
  licenseType?: string;
  tags?: string[];
  search?: string;
  featured?: boolean;
  creatorId?: number;
  moderationState?: CM2ModerationState; // admin only
  sortBy?: "newest" | "popular" | "rating" | "downloads";
  limit?: number;
  offset?: number;
}

// ── DB row shapes (raw from pool.query) ───────────────────────────────────────

export interface CM2ListingRow {
  id: number;
  listing_code: string;
  item_type: string;
  title: string;
  description: string | null;
  category: string;
  tags: string[];
  creator_id: number | null;
  price_type: string;
  price_amount: string;
  currency: string;
  license_type: string;
  license_metadata: Record<string, unknown>;
  file_url: string | null;
  preview_urls: string[];
  thumbnail_url: string | null;
  file_size_bytes: number | null;
  file_format: string | null;
  moderation_state: string;
  moderation_note: string | null;
  is_featured: boolean;
  is_active: boolean;
  downloads_count: number;
  views_count: number;
  favorites_count: number;
  avg_rating: string;
  ratings_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  // joined fields
  creator_code: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
  creator_is_verified: boolean | null;
  creator_total_listings: number | null;
  creator_avg_rating: string | null;
}

export interface CM2CreatorRow {
  id: number;
  creator_code: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  website_url: string | null;
  social_links: Record<string, string>;
  email: string | null;
  is_verified: boolean;
  is_active: boolean;
  total_listings: number;
  total_downloads: number;
  avg_rating: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CM2RatingRow {
  id: number;
  customer_email: string;
  listing_id: number;
  rating: number;
  review: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CM2ModerationLogRow {
  id: number;
  listing_id: number;
  from_state: string;
  to_state: string;
  reason: string | null;
  admin_note: string | null;
  performed_by: string | null;
  created_at: Date;
}
