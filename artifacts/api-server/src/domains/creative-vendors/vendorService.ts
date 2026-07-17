/**
 * vendorService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
 *
 * Architecture: creative vendor = capability/profile extension of marketplace_creators.
 *   - Vendor identity    → marketplace_creators (canonical master)
 *   - Creative extension → creative_vendor_profiles (this domain)
 *   - Ratings            → marketplace_ratings (itemType='creative_vendor') [BLOCKED]
 *   - Portfolio          → ai_service_portfolios [BLOCKED — see vendorPortfolioService]
 *   - Contact requests   → pending canonical mapping [BLOCKED — see vendorContactService]
 *
 * PUBLIC DTO rules:
 *   - Whatsapp masked: first 5 chars + *****
 *   - Email (from marketplace_creators) masked: first 3 chars + *** + @domain
 *   - Only approved (moderationStatus='approved') profiles visible publicly
 *   - No moderation notes in public response
 *
 * SECURITY:
 *   - External URLs validated (SSRF-safe) at storage time
 *   - pageSize capped in service layer
 *   - Rating submission removed — delegated to marketplace_ratings
 */
import { eq, and, ilike, desc, asc, sql, or } from "drizzle-orm";
import {
  vendorDb,
  creativeVendorProfilesTable,
  vendorServiceAreasTable,
  vendorCapabilitiesTable,
  vendorCertificationsTable,
  VENDOR_TYPES,
  type CreativeVendorProfile,
  type VendorType,
} from "./schema.js";
import { marketplaceCreatorsTable } from "@workspace/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorSearchParams {
  q?: string;
  vendorType?: VendorType;
  province?: string;
  city?: string;
  isAvailableNow?: boolean;
  isVerified?: boolean;     // from marketplace_creators.isVerified
  isFeatured?: boolean;     // from creative_vendor_profiles.isFeatured
  maxLeadTimeDays?: number;
  sort?: "rating" | "newest" | "lead_time" | "featured";
  page?: number;
  pageSize?: number;
}

/**
 * Public vendor card — merged view of marketplace_creators + creative_vendor_profiles.
 * Contact info masked per PII rules.
 */
export interface PublicVendorCard {
  // Identity from marketplace_creators (canonical)
  id: number;              // marketplace_creators.id (the canonical vendor ID)
  profileId: number;       // creative_vendor_profiles.id (the extension ID)
  creatorCode: string;     // marketplace_creators.creator_code
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;     // marketplace_creators.is_verified (platform trust signal)
  avgRating: string;       // marketplace_creators.avg_rating

  // Extension from creative_vendor_profiles
  vendorType: string;
  brandName: string | null;  // from marketplace_creators.metadata.brandName if present
  city: string | null;
  province: string | null;
  country: string;

  // Contact — masked (whatsapp from profiles extension)
  contactWhatsapp: string | null;
  websiteUrl: string | null;    // from marketplace_creators
  instagramUrl: string | null;  // from profiles extension

  // Pricing — display only
  minPrice: number | null;
  maxPrice: number | null;
  priceCurrency: string | null;

  // Operations
  leadTimeDays: number;
  isAvailableNow: boolean;
  isFeatured: boolean;
  moderationStatus: string;

  createdAt: Date;
}

export interface VendorDetailPublic extends PublicVendorCard {
  bio: string | null;           // from marketplace_creators.bio
  serviceAreas: Array<{ province: string; city: string | null; isRemote: boolean }>;
  capabilities: Array<{
    capabilityName: string;
    proficiencyLevel: string;
    yearsExperience: number | null;
    toolsJson: string[] | null;
  }>;
  certifications: Array<{
    certificationName: string;
    issuer: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// URL validation (SSRF-safe at storage time)
// ─────────────────────────────────────────────────────────────────────────────

const PRIVATE_IP_RE =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|127\.\d+\.\d+\.\d+|::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;

export function validateExternalUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL must use http or https: "${url}"`);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || PRIVATE_IP_RE.test(host)) {
    throw new Error(`URL targets a private/internal address: "${url}"`);
  }
  // Block raw IP literals (catch-all)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) {
    throw new Error(`URL must use a domain name, not a raw IP: "${url}"`);
  }
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Masking helpers
// ─────────────────────────────────────────────────────────────────────────────

export function maskWhatsapp(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.slice(0, 5) + "*****";
}

export function maskEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const [local, domain] = v.split("@");
  if (!domain) return null;
  return local!.slice(0, 3) + "***@" + domain;
}

// ─────────────────────────────────────────────────────────────────────────────
// DTO builder — merged creator + profile row
// ─────────────────────────────────────────────────────────────────────────────

type CreatorRow = typeof marketplaceCreatorsTable.$inferSelect;
type ProfileRow = CreativeVendorProfile;

export function toPublicCard(creator: CreatorRow, profile: ProfileRow): PublicVendorCard {
  return {
    id: creator.id,
    profileId: profile.id,
    creatorCode: creator.creatorCode,
    displayName: creator.displayName,
    avatarUrl: creator.avatarUrl ?? null,
    isVerified: creator.isVerified,
    avgRating: String(creator.avgRating ?? "0"),

    vendorType: profile.vendorType,
    brandName: null, // extension: can be populated from metadata if needed
    city: profile.city ?? null,
    province: profile.province ?? null,
    country: profile.country,

    contactWhatsapp: maskWhatsapp(profile.whatsapp),
    websiteUrl: creator.websiteUrl ?? null,
    instagramUrl: profile.instagramUrl ?? null,

    minPrice: profile.minPrice ?? null,
    maxPrice: profile.maxPrice ?? null,
    priceCurrency: profile.priceCurrency ?? null,

    leadTimeDays: profile.leadTimeDays,
    isAvailableNow: profile.isAvailableNow,
    isFeatured: profile.isFeatured,
    moderationStatus: profile.moderationStatus,

    createdAt: profile.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — JOIN marketplace_creators + creative_vendor_profiles
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PAGE_SIZE = 50;

export async function searchVendors(params: VendorSearchParams): Promise<{
  items: PublicVendorCard[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(Math.max(1, params.pageSize ?? 20), MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  // Build WHERE conditions on profiles (always filter approved only for public)
  const profileConditions = [
    eq(creativeVendorProfilesTable.moderationStatus, "approved"),
    params.vendorType
      ? eq(creativeVendorProfilesTable.vendorType, params.vendorType)
      : undefined,
    params.province
      ? eq(creativeVendorProfilesTable.province, params.province)
      : undefined,
    params.city
      ? eq(creativeVendorProfilesTable.city, params.city)
      : undefined,
    params.isAvailableNow !== undefined
      ? eq(creativeVendorProfilesTable.isAvailableNow, params.isAvailableNow)
      : undefined,
    params.isFeatured !== undefined
      ? eq(creativeVendorProfilesTable.isFeatured, params.isFeatured)
      : undefined,
    params.maxLeadTimeDays !== undefined
      ? sql`${creativeVendorProfilesTable.leadTimeDays} <= ${params.maxLeadTimeDays}`
      : undefined,
  ].filter(Boolean) as ReturnType<typeof eq>[];

  const creatorConditions = [
    eq(marketplaceCreatorsTable.isActive, true),
    params.isVerified !== undefined
      ? eq(marketplaceCreatorsTable.isVerified, params.isVerified)
      : undefined,
    params.q
      ? or(
          ilike(marketplaceCreatorsTable.displayName, `%${params.q}%`),
          ilike(marketplaceCreatorsTable.bio, `%${params.q}%`),
        )
      : undefined,
  ].filter(Boolean) as ReturnType<typeof eq>[];

  // ORDER BY
  let orderBy: Parameters<typeof vendorDb.select>[0] extends never ? never : ReturnType<typeof asc>[];
  switch (params.sort) {
    case "rating":
      orderBy = [desc(marketplaceCreatorsTable.avgRating)];
      break;
    case "featured":
      orderBy = [desc(creativeVendorProfilesTable.isFeatured), desc(marketplaceCreatorsTable.avgRating)];
      break;
    case "lead_time":
      orderBy = [asc(creativeVendorProfilesTable.leadTimeDays)];
      break;
    default: // newest
      orderBy = [desc(creativeVendorProfilesTable.createdAt)];
  }

  const baseQuery = vendorDb
    .select({
      creator: marketplaceCreatorsTable,
      profile: creativeVendorProfilesTable,
    })
    .from(creativeVendorProfilesTable)
    .innerJoin(
      marketplaceCreatorsTable,
      eq(creativeVendorProfilesTable.creatorId, marketplaceCreatorsTable.id),
    )
    .where(and(...profileConditions, ...creatorConditions));

  const [rows, countRows] = await Promise.all([
    baseQuery.orderBy(...orderBy).limit(pageSize).offset(offset),
    vendorDb
      .select({ count: sql<number>`count(*)::int` })
      .from(creativeVendorProfilesTable)
      .innerJoin(
        marketplaceCreatorsTable,
        eq(creativeVendorProfilesTable.creatorId, marketplaceCreatorsTable.id),
      )
      .where(and(...profileConditions, ...creatorConditions)),
  ]);

  const total = countRows[0]?.count ?? 0;
  return {
    items: rows.map((r) => toPublicCard(r.creator, r.profile)),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get public vendor detail (JOIN + child tables)
// ─────────────────────────────────────────────────────────────────────────────

export async function getVendorDetailPublic(id: number): Promise<VendorDetailPublic | null> {
  const [row] = await vendorDb
    .select({ creator: marketplaceCreatorsTable, profile: creativeVendorProfilesTable })
    .from(creativeVendorProfilesTable)
    .innerJoin(
      marketplaceCreatorsTable,
      eq(creativeVendorProfilesTable.creatorId, marketplaceCreatorsTable.id),
    )
    .where(
      and(
        eq(marketplaceCreatorsTable.id, id),
        eq(creativeVendorProfilesTable.moderationStatus, "approved"),
        eq(marketplaceCreatorsTable.isActive, true),
      ),
    );

  if (!row) return null;

  const [serviceAreas, capabilities, certifications] = await Promise.all([
    vendorDb
      .select()
      .from(vendorServiceAreasTable)
      .where(eq(vendorServiceAreasTable.profileId, row.profile.id)),
    vendorDb
      .select()
      .from(vendorCapabilitiesTable)
      .where(eq(vendorCapabilitiesTable.profileId, row.profile.id)),
    vendorDb
      .select()
      .from(vendorCertificationsTable)
      .where(eq(vendorCertificationsTable.profileId, row.profile.id)),
  ]);

  return {
    ...toPublicCard(row.creator, row.profile),
    bio: row.creator.bio ?? null,
    serviceAreas: serviceAreas.map((a) => ({
      province: a.province,
      city: a.city ?? null,
      isRemote: a.isRemote,
    })),
    capabilities: capabilities.map((c) => ({
      capabilityName: c.capabilityName,
      proficiencyLevel: c.proficiencyLevel,
      yearsExperience: c.yearsExperience ?? null,
      toolsJson: (c.toolsJson as string[]) ?? null,
    })),
    certifications: certifications.map((c) => ({
      certificationName: c.certificationName,
      issuer: c.issuer ?? null,
      issuedAt: c.issuedAt ?? null,
      expiresAt: c.expiresAt ?? null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: get full vendor (unmasked)
// ─────────────────────────────────────────────────────────────────────────────

export async function getVendorAdmin(id: number) {
  const [row] = await vendorDb
    .select({ creator: marketplaceCreatorsTable, profile: creativeVendorProfilesTable })
    .from(creativeVendorProfilesTable)
    .innerJoin(
      marketplaceCreatorsTable,
      eq(creativeVendorProfilesTable.creatorId, marketplaceCreatorsTable.id),
    )
    .where(eq(marketplaceCreatorsTable.id, id));

  if (!row) return null;
  return { creator: row.creator, profile: row.profile };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: list all vendors (paginated)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ADMIN_PAGE_SIZE = 100;

export async function listVendorsAdmin(
  moderationStatus?: string,
  vendorType?: string,
  page = 1,
  pageSize = 30,
) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(Math.max(1, pageSize), MAX_ADMIN_PAGE_SIZE);
  const offset = (safePage - 1) * safePageSize;

  const conditions = [
    moderationStatus
      ? eq(creativeVendorProfilesTable.moderationStatus, moderationStatus)
      : undefined,
    vendorType
      ? eq(creativeVendorProfilesTable.vendorType, vendorType)
      : undefined,
  ].filter(Boolean) as ReturnType<typeof eq>[];

  const [rows, countRows] = await Promise.all([
    vendorDb
      .select({ creator: marketplaceCreatorsTable, profile: creativeVendorProfilesTable })
      .from(creativeVendorProfilesTable)
      .innerJoin(
        marketplaceCreatorsTable,
        eq(creativeVendorProfilesTable.creatorId, marketplaceCreatorsTable.id),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(creativeVendorProfilesTable.createdAt))
      .limit(safePageSize)
      .offset(offset),
    vendorDb
      .select({ count: sql<number>`count(*)::int` })
      .from(creativeVendorProfilesTable)
      .where(conditions.length ? and(...conditions) : undefined),
  ]);

  return {
    items: rows.map((r) => ({ creator: r.creator, profile: r.profile })),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total: countRows[0]?.count ?? 0,
      totalPages: Math.ceil((countRows[0]?.count ?? 0) / safePageSize),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: create vendor profile (extension over existing marketplace_creators entry)
//
// NOTE: Does NOT create a marketplace_creators row — the creator must already
// exist in marketplace_creators. This domain only manages the extension.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateVendorProfileInput {
  creatorId: number;      // must exist in marketplace_creators
  vendorType: VendorType;
  whatsapp?: string;
  instagramUrl?: string;
  city?: string;
  province?: string;
  country?: string;
  minPrice?: number;
  maxPrice?: number;
  priceCurrency?: string;
  leadTimeDays?: number;
  isAvailableNow?: boolean;
}

export async function createVendorProfile(
  input: CreateVendorProfileInput,
): Promise<CreativeVendorProfile> {
  const instagramUrl = validateExternalUrl(input.instagramUrl);

  const [profile] = await vendorDb
    .insert(creativeVendorProfilesTable)
    .values({
      creatorId: input.creatorId,
      vendorType: input.vendorType,
      whatsapp: input.whatsapp,
      instagramUrl,
      city: input.city,
      province: input.province,
      country: input.country ?? "ID",
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      priceCurrency: input.priceCurrency ?? "IDR",
      leadTimeDays: input.leadTimeDays ?? 7,
      isAvailableNow: input.isAvailableNow ?? true,
    })
    .returning();

  return profile!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: update vendor profile (extension fields only)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateVendorProfileInput {
  vendorType?: VendorType;
  whatsapp?: string;
  instagramUrl?: string;
  city?: string;
  province?: string;
  country?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  priceCurrency?: string;
  leadTimeDays?: number;
  isAvailableNow?: boolean;
  isFeatured?: boolean;
}

export async function updateVendorProfile(
  profileId: number,
  input: UpdateVendorProfileInput,
): Promise<CreativeVendorProfile | null> {
  const instagramUrl = input.instagramUrl !== undefined
    ? validateExternalUrl(input.instagramUrl)
    : undefined;

  const updateData: Partial<typeof creativeVendorProfilesTable.$inferInsert> = {
    ...(input.vendorType !== undefined && { vendorType: input.vendorType }),
    ...(input.whatsapp !== undefined && { whatsapp: input.whatsapp }),
    ...(instagramUrl !== undefined && { instagramUrl }),
    ...(input.city !== undefined && { city: input.city }),
    ...(input.province !== undefined && { province: input.province }),
    ...(input.country !== undefined && { country: input.country }),
    ...(input.minPrice !== undefined && { minPrice: input.minPrice }),
    ...(input.maxPrice !== undefined && { maxPrice: input.maxPrice }),
    ...(input.priceCurrency !== undefined && { priceCurrency: input.priceCurrency }),
    ...(input.leadTimeDays !== undefined && { leadTimeDays: input.leadTimeDays }),
    ...(input.isAvailableNow !== undefined && { isAvailableNow: input.isAvailableNow }),
    ...(input.isFeatured !== undefined && { isFeatured: input.isFeatured }),
    updatedAt: new Date(),
  };

  const [profile] = await vendorDb
    .update(creativeVendorProfilesTable)
    .set(updateData)
    .where(eq(creativeVendorProfilesTable.id, profileId))
    .returning();

  return profile ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: approve / reject
// ─────────────────────────────────────────────────────────────────────────────

export async function approveVendorProfile(profileId: number): Promise<CreativeVendorProfile | null> {
  const [profile] = await vendorDb
    .update(creativeVendorProfilesTable)
    .set({
      moderationStatus: "approved",
      moderationNote: null,
      moderatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(creativeVendorProfilesTable.id, profileId))
    .returning();
  return profile ?? null;
}

export async function rejectVendorProfile(
  profileId: number,
  reason: string,
): Promise<CreativeVendorProfile | null> {
  const [profile] = await vendorDb
    .update(creativeVendorProfilesTable)
    .set({
      moderationStatus: "rejected",
      moderationNote: reason,
      moderatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(creativeVendorProfilesTable.id, profileId))
    .returning();
  return profile ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category counts (for filter UI)
// ─────────────────────────────────────────────────────────────────────────────

export async function getVendorCategories() {
  const rows = await vendorDb
    .select({
      vendorType: creativeVendorProfilesTable.vendorType,
      count: sql<number>`count(*)::int`,
    })
    .from(creativeVendorProfilesTable)
    .innerJoin(
      marketplaceCreatorsTable,
      eq(creativeVendorProfilesTable.creatorId, marketplaceCreatorsTable.id),
    )
    .where(
      and(
        eq(creativeVendorProfilesTable.moderationStatus, "approved"),
        eq(marketplaceCreatorsTable.isActive, true),
      ),
    )
    .groupBy(creativeVendorProfilesTable.vendorType)
    .orderBy(desc(sql`count(*)`));
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics for admin
// ─────────────────────────────────────────────────────────────────────────────

export async function getVendorAnalytics() {
  const [summary] = await vendorDb
    .select({
      total: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) filter (where ${creativeVendorProfilesTable.moderationStatus} = 'approved')::int`,
      pending: sql<number>`count(*) filter (where ${creativeVendorProfilesTable.moderationStatus} = 'pending')::int`,
      rejected: sql<number>`count(*) filter (where ${creativeVendorProfilesTable.moderationStatus} = 'rejected')::int`,
      featured: sql<number>`count(*) filter (where ${creativeVendorProfilesTable.isFeatured} = true)::int`,
      available: sql<number>`count(*) filter (where ${creativeVendorProfilesTable.isAvailableNow} = true)::int`,
    })
    .from(creativeVendorProfilesTable);

  const byType = await vendorDb
    .select({
      vendorType: creativeVendorProfilesTable.vendorType,
      count: sql<number>`count(*)::int`,
    })
    .from(creativeVendorProfilesTable)
    .where(eq(creativeVendorProfilesTable.moderationStatus, "approved"))
    .groupBy(creativeVendorProfilesTable.vendorType)
    .orderBy(desc(sql`count(*)`));

  return { summary, byType };
}

export { VENDOR_TYPES };
