/**
 * vendorService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Core CRUD + search + public DTO for creative vendors.
 * Covers: profile, service areas, capabilities, certifications, ratings.
 *
 * PUBLIC DTO rules:
 *   - Whatsapp masked: first 5 chars + *****
 *   - Email masked: first 3 chars + *** + @domain
 *   - Only approved portfolio items
 *   - Only approved ratings
 *   - No moderation notes or internal fields
 */
import { eq, and, ilike, desc, asc, sql, inArray, or } from "drizzle-orm";
import {
  vendorDb,
  vendorsTable,
  vendorServiceAreasTable,
  vendorCapabilitiesTable,
  vendorCertificationsTable,
  vendorRatingsTable,
  VENDOR_TYPES,
  type Vendor,
  type VendorType,
} from "./schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorSearchParams {
  q?: string;
  vendorType?: VendorType;
  province?: string;
  city?: string;
  isAvailableNow?: boolean;
  isVerified?: boolean;
  isFeatured?: boolean;
  maxLeadTimeDays?: number;
  sort?: "rating" | "newest" | "lead_time" | "featured";
  page?: number;
  pageSize?: number;
}

export interface PublicVendorCard {
  id: number;
  vendorCode: string;
  displayName: string;
  brandName: string | null;
  vendorType: string;
  shortBio: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string | null;
  province: string | null;
  country: string;
  // Contact — masked
  contactWhatsapp: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  // Pricing — display only, optional
  minPrice: number | null;
  maxPrice: number | null;
  priceCurrency: string | null;
  // Operations
  leadTimeDays: number;
  isAvailableNow: boolean;
  isVerified: boolean;
  isFeatured: boolean;
  avgRating: string;
  totalRatings: number;
  createdAt: Date;
}

export interface VendorDetailPublic extends PublicVendorCard {
  description: string | null;
  galleryJson: Array<{ url: string; caption?: string }> | null;
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
  recentRatings: Array<{
    rating: number;
    review: string | null;
    projectContext: string | null;
    createdAt: Date;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Mask whatsapp number: "+628121234567" → "+62812*****" */
function maskWhatsapp(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, "");
  return cleaned.length > 5 ? `${cleaned.slice(0, 5)}*****` : "***";
}

/** Mask email: "vendor@example.com" → "ven***@example.com" */
function maskEmail(raw: string | null): string | null {
  if (!raw) return null;
  const atIdx = raw.indexOf("@");
  if (atIdx < 0) return "***";
  const local = raw.slice(0, atIdx);
  const domain = raw.slice(atIdx);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

function toPublicCard(v: Vendor): PublicVendorCard {
  return {
    id: v.id,
    vendorCode: v.vendorCode,
    displayName: v.displayName,
    brandName: v.brandName ?? null,
    vendorType: v.vendorType,
    shortBio: v.shortBio ?? null,
    logoUrl: v.logoUrl ?? null,
    coverUrl: v.coverUrl ?? null,
    city: v.city ?? null,
    province: v.province ?? null,
    country: v.country,
    contactWhatsapp: maskWhatsapp(v.whatsapp ?? null),
    contactEmail: maskEmail(v.email ?? null),
    websiteUrl: v.websiteUrl ?? null,
    instagramUrl: v.instagramUrl ?? null,
    minPrice: v.minPrice ?? null,
    maxPrice: v.maxPrice ?? null,
    priceCurrency: v.priceCurrency ?? null,
    leadTimeDays: v.leadTimeDays,
    isAvailableNow: v.isAvailableNow,
    isVerified: v.isVerified,
    isFeatured: v.isFeatured,
    avgRating: String(v.avgRating ?? "0"),
    totalRatings: v.totalRatings,
    createdAt: v.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Search / Browse
// ─────────────────────────────────────────────────────────────────────────────

export async function searchVendors(params: VendorSearchParams = {}) {
  const {
    q,
    vendorType,
    province,
    city,
    isAvailableNow,
    isVerified,
    isFeatured,
    maxLeadTimeDays,
    sort = "rating",
    page = 1,
    pageSize = 24,
  } = params;

  const conditions = [
    eq(vendorsTable.moderationStatus, "approved"),
    eq(vendorsTable.status, "active"),
    vendorType ? eq(vendorsTable.vendorType, vendorType) : undefined,
    province ? ilike(vendorsTable.province, `%${province}%`) : undefined,
    city ? ilike(vendorsTable.city, `%${city}%`) : undefined,
    isAvailableNow !== undefined
      ? eq(vendorsTable.isAvailableNow, isAvailableNow)
      : undefined,
    isVerified !== undefined ? eq(vendorsTable.isVerified, isVerified) : undefined,
    isFeatured !== undefined ? eq(vendorsTable.isFeatured, isFeatured) : undefined,
    maxLeadTimeDays !== undefined
      ? sql`${vendorsTable.leadTimeDays} <= ${maxLeadTimeDays}`
      : undefined,
    q
      ? or(
          ilike(vendorsTable.displayName, `%${q}%`),
          ilike(vendorsTable.brandName, `%${q}%`),
          ilike(vendorsTable.shortBio, `%${q}%`),
        )
      : undefined,
  ].filter(Boolean);

  const orderBy =
    sort === "rating"
      ? desc(vendorsTable.avgRating)
      : sort === "newest"
        ? desc(vendorsTable.createdAt)
        : sort === "lead_time"
          ? asc(vendorsTable.leadTimeDays)
          : [desc(vendorsTable.isFeatured), desc(vendorsTable.avgRating)];

  const offset = (page - 1) * pageSize;

  const [rows, countRow] = await Promise.all([
    vendorDb
      .select()
      .from(vendorsTable)
      .where(and(...conditions))
      .orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]))
      .limit(pageSize)
      .offset(offset),
    vendorDb
      .select({ count: sql<number>`count(*)::int` })
      .from(vendorsTable)
      .where(and(...conditions)),
  ]);

  const total = countRow[0]?.count ?? 0;
  return {
    items: rows.map(toPublicCard),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get vendor detail (public)
// ─────────────────────────────────────────────────────────────────────────────

export async function getVendorDetailPublic(
  id: number,
): Promise<VendorDetailPublic | null> {
  const [vendor] = await vendorDb
    .select()
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.id, id),
        eq(vendorsTable.moderationStatus, "approved"),
        eq(vendorsTable.status, "active"),
      ),
    );

  if (!vendor) return null;

  const [serviceAreas, capabilities, certifications, ratings] = await Promise.all([
    vendorDb
      .select()
      .from(vendorServiceAreasTable)
      .where(eq(vendorServiceAreasTable.vendorId, id)),
    vendorDb
      .select()
      .from(vendorCapabilitiesTable)
      .where(eq(vendorCapabilitiesTable.vendorId, id)),
    vendorDb
      .select()
      .from(vendorCertificationsTable)
      .where(eq(vendorCertificationsTable.vendorId, id)),
    vendorDb
      .select()
      .from(vendorRatingsTable)
      .where(
        and(
          eq(vendorRatingsTable.vendorId, id),
          eq(vendorRatingsTable.moderationStatus, "approved"),
        ),
      )
      .orderBy(desc(vendorRatingsTable.createdAt))
      .limit(10),
  ]);

  const base = toPublicCard(vendor);
  return {
    ...base,
    description: vendor.description ?? null,
    galleryJson: (vendor.galleryJson as Array<{ url: string; caption?: string }>) ?? null,
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
    recentRatings: ratings.map((r) => ({
      rating: r.rating,
      review: r.review ?? null,
      projectContext: r.projectContext ?? null,
      createdAt: r.createdAt,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: full detail (no redaction)
// ─────────────────────────────────────────────────────────────────────────────

export async function getVendorAdmin(id: number) {
  const [vendor] = await vendorDb
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, id));
  if (!vendor) return null;

  const [serviceAreas, capabilities, certifications] = await Promise.all([
    vendorDb
      .select()
      .from(vendorServiceAreasTable)
      .where(eq(vendorServiceAreasTable.vendorId, id)),
    vendorDb
      .select()
      .from(vendorCapabilitiesTable)
      .where(eq(vendorCapabilitiesTable.vendorId, id)),
    vendorDb
      .select()
      .from(vendorCertificationsTable)
      .where(eq(vendorCertificationsTable.vendorId, id)),
  ]);

  return { ...vendor, serviceAreas, capabilities, certifications };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: list with moderation filter
// ─────────────────────────────────────────────────────────────────────────────

export async function listVendorsAdmin(params: {
  moderationStatus?: string;
  vendorType?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const { moderationStatus, vendorType, status, page = 1, pageSize = 30 } = params;
  const conditions = [
    moderationStatus ? eq(vendorsTable.moderationStatus, moderationStatus) : undefined,
    vendorType ? eq(vendorsTable.vendorType, vendorType) : undefined,
    status ? eq(vendorsTable.status, status) : undefined,
  ].filter(Boolean);

  const offset = (page - 1) * pageSize;
  const rows = await vendorDb
    .select()
    .from(vendorsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(vendorsTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  const [countRow] = await vendorDb
    .select({ count: sql<number>`count(*)::int` })
    .from(vendorsTable)
    .where(conditions.length ? and(...conditions) : undefined);

  return {
    items: rows,
    pagination: { page, pageSize, total: countRow?.count ?? 0 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Create vendor
// ─────────────────────────────────────────────────────────────────────────────

export async function createVendor(data: {
  displayName: string;
  vendorType: VendorType;
  brandName?: string;
  description?: string;
  shortBio?: string;
  city?: string;
  province?: string;
  whatsapp?: string;
  email?: string;
  websiteUrl?: string;
  instagramUrl?: string;
  leadTimeDays?: number;
}) {
  const vendorCode = `VND-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const [row] = await vendorDb
    .insert(vendorsTable)
    .values({
      vendorCode,
      displayName: data.displayName,
      vendorType: data.vendorType,
      brandName: data.brandName,
      description: data.description,
      shortBio: data.shortBio,
      city: data.city,
      province: data.province,
      whatsapp: data.whatsapp,
      email: data.email,
      websiteUrl: data.websiteUrl,
      instagramUrl: data.instagramUrl,
      leadTimeDays: data.leadTimeDays ?? 7,
    })
    .returning();
  return row!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Update vendor
// ─────────────────────────────────────────────────────────────────────────────

export async function updateVendor(
  id: number,
  data: Partial<Omit<typeof vendorsTable.$inferInsert, "id" | "vendorCode" | "createdAt">>,
) {
  const [row] = await vendorDb
    .update(vendorsTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(vendorsTable.id, id))
    .returning();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Approve / Reject
// ─────────────────────────────────────────────────────────────────────────────

export async function approveVendor(id: number) {
  return updateVendor(id, {
    moderationStatus: "approved",
    moderationNote: null,
    moderatedAt: new Date(),
    status: "active",
  });
}

export async function rejectVendor(id: number, reason: string) {
  return updateVendor(id, {
    moderationStatus: "rejected",
    moderationNote: reason,
    moderatedAt: new Date(),
    status: "inactive",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ratings
// ─────────────────────────────────────────────────────────────────────────────

export async function submitRating(
  vendorId: number,
  clientEmailHash: string,
  rating: number,
  review?: string,
  projectContext?: string,
) {
  if (rating < 1 || rating > 5) throw new Error("Rating must be 1–5");

  const [row] = await vendorDb
    .insert(vendorRatingsTable)
    .values({
      vendorId,
      clientEmailHash,
      rating,
      review,
      projectContext,
      moderationStatus: "pending",
    })
    .returning();

  // Recalculate avg rating (approved ratings only)
  await recalcAvgRating(vendorId);
  return row!;
}

async function recalcAvgRating(vendorId: number) {
  const [stats] = await vendorDb
    .select({
      avg: sql<string>`COALESCE(AVG(rating)::numeric(3,2), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(vendorRatingsTable)
    .where(
      and(
        eq(vendorRatingsTable.vendorId, vendorId),
        eq(vendorRatingsTable.moderationStatus, "approved"),
      ),
    );

  await vendorDb
    .update(vendorsTable)
    .set({
      avgRating: stats?.avg ?? "0",
      totalRatings: stats?.count ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(vendorsTable.id, vendorId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories listing (for filter UI)
// ─────────────────────────────────────────────────────────────────────────────

export async function getVendorCategories() {
  const rows = await vendorDb
    .select({
      vendorType: vendorsTable.vendorType,
      count: sql<number>`count(*)::int`,
    })
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.moderationStatus, "approved"),
        eq(vendorsTable.status, "active"),
      ),
    )
    .groupBy(vendorsTable.vendorType)
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
      approved: sql<number>`count(*) filter (where moderation_status = 'approved')::int`,
      pending: sql<number>`count(*) filter (where moderation_status = 'pending')::int`,
      rejected: sql<number>`count(*) filter (where moderation_status = 'rejected')::int`,
      verified: sql<number>`count(*) filter (where is_verified = true)::int`,
      featured: sql<number>`count(*) filter (where is_featured = true)::int`,
      avgRating: sql<string>`COALESCE(AVG(avg_rating)::numeric(3,2), 0)`,
    })
    .from(vendorsTable);

  const byType = await vendorDb
    .select({
      vendorType: vendorsTable.vendorType,
      count: sql<number>`count(*)::int`,
      avgRating: sql<string>`COALESCE(AVG(avg_rating)::numeric(3,2), 0)`,
    })
    .from(vendorsTable)
    .where(eq(vendorsTable.moderationStatus, "approved"))
    .groupBy(vendorsTable.vendorType)
    .orderBy(desc(sql`count(*)`));

  return { summary, byType };
}

export { toPublicCard, maskWhatsapp, maskEmail, VENDOR_TYPES };
