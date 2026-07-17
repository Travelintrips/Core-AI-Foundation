/**
 * vendorPortfolioService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Vendor portfolio CRUD + moderation.
 * Public view: only approved items, capped at 100.
 * Admin view: paginated (max 100 per page).
 *
 * SECURITY:
 *   - coverImageUrl validated (SSRF-safe) at storage time
 *   - All list queries bounded by limit/offset
 */
import { eq, and, desc, asc, sql } from "drizzle-orm";
import {
  vendorDb,
  vendorPortfolioItemsTable,
  vendorsTable,
  type VendorPortfolioItem,
} from "./schema.js";
import { validateExternalUrl } from "./vendorService.js";

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
// Public: list approved portfolio items for a vendor (bounded)
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_PORTFOLIO_LIMIT = 100; // cap — prevents loading unbounded rows

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
    .orderBy(
      desc(vendorPortfolioItemsTable.isFeatured),
      asc(vendorPortfolioItemsTable.displayOrder),
    )
    .limit(PUBLIC_PORTFOLIO_LIMIT);

  return rows.map(toPublicItem);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: list all portfolio items (paginated)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ADMIN_PAGE_SIZE = 100;

export async function listVendorPortfolioAdmin(
  vendorId: number,
  moderationStatus?: string,
  page = 1,
  pageSize = 30,
) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(Math.max(1, pageSize), MAX_ADMIN_PAGE_SIZE);
  const offset = (safePage - 1) * safePageSize;

  const conditions = [
    eq(vendorPortfolioItemsTable.vendorId, vendorId),
    moderationStatus
      ? eq(vendorPortfolioItemsTable.moderationStatus, moderationStatus)
      : undefined,
  ].filter(Boolean);

  const [rows, countRow] = await Promise.all([
    vendorDb
      .select()
      .from(vendorPortfolioItemsTable)
      .where(and(...conditions))
      .orderBy(desc(vendorPortfolioItemsTable.createdAt))
      .limit(safePageSize)
      .offset(offset),
    vendorDb
      .select({ count: sql<number>`count(*)::int` })
      .from(vendorPortfolioItemsTable)
      .where(and(...conditions)),
  ]);

  return {
    items: rows,
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total: countRow[0]?.count ?? 0,
    },
  };
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
  // Validate external URL at storage time
  const coverImageUrl = validateExternalUrl(data.coverImageUrl);

  const [row] = await vendorDb
    .insert(vendorPortfolioItemsTable)
    .values({
      vendorId,
      title: data.title,
      description: data.description,
      category: data.category,
      coverImageUrl,
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
