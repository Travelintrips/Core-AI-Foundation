/**
 * vendorPortfolioService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Vendor portfolio CRUD + moderation.
 * Public view: only approved items.
 * Admin view: all items (pending, approved, rejected).
 */
import { eq, and, desc, asc, sql } from "drizzle-orm";
import {
  vendorDb,
  vendorPortfolioItemsTable,
  vendorsTable,
  type VendorPortfolioItem,
} from "./schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicPortfolioItem {
  id: number;
  vendorId: number;
  title: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  galleryJson: Array<{ url: string; caption?: string }> | null;
  clientIndustry: string | null;
  projectDurationDays: number | null;
  tagsJson: string[] | null;
  isFeatured: boolean;
  displayOrder: number;
  createdAt: Date;
}

function toPublicItem(item: VendorPortfolioItem): PublicPortfolioItem {
  return {
    id: item.id,
    vendorId: item.vendorId,
    title: item.title,
    description: item.description ?? null,
    category: item.category ?? null,
    coverImageUrl: item.coverImageUrl ?? null,
    galleryJson:
      (item.galleryJson as Array<{ url: string; caption?: string }>) ?? null,
    clientIndustry: item.clientIndustry ?? null,
    projectDurationDays: item.projectDurationDays ?? null,
    tagsJson: (item.tagsJson as string[]) ?? null,
    isFeatured: item.isFeatured,
    displayOrder: item.displayOrder,
    createdAt: item.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: list approved portfolio items for a vendor
// ─────────────────────────────────────────────────────────────────────────────

export async function listVendorPortfolioPublic(
  vendorId: number,
): Promise<PublicPortfolioItem[]> {
  const rows = await vendorDb
    .select()
    .from(vendorPortfolioItemsTable)
    .where(
      and(
        eq(vendorPortfolioItemsTable.vendorId, vendorId),
        eq(vendorPortfolioItemsTable.moderationStatus, "approved"),
      ),
    )
    .orderBy(desc(vendorPortfolioItemsTable.isFeatured), asc(vendorPortfolioItemsTable.displayOrder));

  return rows.map(toPublicItem);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: list all portfolio items (all moderation states)
// ─────────────────────────────────────────────────────────────────────────────

export async function listVendorPortfolioAdmin(
  vendorId: number,
  moderationStatus?: string,
) {
  const conditions = [
    eq(vendorPortfolioItemsTable.vendorId, vendorId),
    moderationStatus
      ? eq(vendorPortfolioItemsTable.moderationStatus, moderationStatus)
      : undefined,
  ].filter(Boolean);

  return vendorDb
    .select()
    .from(vendorPortfolioItemsTable)
    .where(and(...conditions))
    .orderBy(desc(vendorPortfolioItemsTable.createdAt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor: add portfolio item (starts as pending moderation)
// ─────────────────────────────────────────────────────────────────────────────

export async function addPortfolioItem(
  vendorId: number,
  data: {
    title: string;
    description?: string;
    category?: string;
    coverImageUrl?: string;
    galleryJson?: Array<{ url: string; caption?: string }>;
    clientIndustry?: string;
    projectDurationDays?: number;
    tagsJson?: string[];
  },
) {
  const [row] = await vendorDb
    .insert(vendorPortfolioItemsTable)
    .values({
      vendorId,
      title: data.title,
      description: data.description,
      category: data.category,
      coverImageUrl: data.coverImageUrl,
      galleryJson: data.galleryJson ?? [],
      clientIndustry: data.clientIndustry,
      projectDurationDays: data.projectDurationDays,
      tagsJson: data.tagsJson ?? [],
      moderationStatus: "pending",
    })
    .returning();
  return row!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: approve portfolio item
// ─────────────────────────────────────────────────────────────────────────────

export async function approvePortfolioItem(
  vendorId: number,
  itemId: number,
): Promise<VendorPortfolioItem | null> {
  const [row] = await vendorDb
    .update(vendorPortfolioItemsTable)
    .set({
      moderationStatus: "approved",
      moderationNote: null,
      moderatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vendorPortfolioItemsTable.id, itemId),
        eq(vendorPortfolioItemsTable.vendorId, vendorId),
      ),
    )
    .returning();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: reject portfolio item
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectPortfolioItem(
  vendorId: number,
  itemId: number,
  reason: string,
): Promise<VendorPortfolioItem | null> {
  const [row] = await vendorDb
    .update(vendorPortfolioItemsTable)
    .set({
      moderationStatus: "rejected",
      moderationNote: reason,
      moderatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vendorPortfolioItemsTable.id, itemId),
        eq(vendorPortfolioItemsTable.vendorId, vendorId),
      ),
    )
    .returning();
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: pending moderation count (for dashboard badge)
// ─────────────────────────────────────────────────────────────────────────────

export async function countPendingPortfolioItems(): Promise<number> {
  const [row] = await vendorDb
    .select({ count: sql<number>`count(*)::int` })
    .from(vendorPortfolioItemsTable)
    .where(eq(vendorPortfolioItemsTable.moderationStatus, "pending"));
  return row?.count ?? 0;
}
