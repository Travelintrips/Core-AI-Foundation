/**
 * assetBrowserService.ts — Universal Asset Browser service (Team 14)
 *
 * Provides admin-accessible, tenant-scoped asset queries over existing tables.
 * No new tables — builds on ai_asset_library + creative_ai_assets.
 * Tenant isolation: emailHash comes from authenticated context only (never raw client input).
 */

import { eq, and, desc, asc, ilike, or, sql } from "drizzle-orm";
import {
  db,
  aiAssetLibraryTable,
  creativeAiAssetsTable,
} from "@workspace/db";
import type { AssetBrowserFilter, AssetBrowserResult, AssetBrowserItem, AssetBrowserSource } from "./assetBrowserTypes.js";

export type { AssetBrowserFilter, AssetBrowserResult, AssetBrowserItem, AssetBrowserSource };

// ── Category / type mapping ───────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  logo: "Logo",
  photo: "Photo",
  illustration: "Illustration",
  icon: "Icon",
  document: "Document",
  brand_guideline: "Brand Guideline",
  reference: "Reference",
  generated_image: "Generated Image",
  uploaded_image: "Uploaded Image",
};

function categoryToAssetType(category: string): string {
  if (["logo", "icon", "illustration"].includes(category)) return "image";
  if (category === "document") return "document";
  if (category === "brand_guideline") return "document";
  if (["generated_image", "uploaded_image", "photo"].includes(category)) return "image";
  if (category === "reference") return "reference";
  return "unknown";
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * List assets from ai_asset_library with full filter/sort/pagination.
 * emailHash is required — enforces tenant isolation (admin resolves it server-side).
 * Pass emailHash=undefined only for platform-level admin with cross-tenant access.
 */
export async function listAssetBrowserItems(
  filter: AssetBrowserFilter,
): Promise<AssetBrowserResult> {
  const {
    emailHash,
    search,
    category,
    assetType,
    sourceId,
    tags,
    showArchived = false,
    favoritedOnly = false,
    projectId,
    sort = "newest",
    page = 1,
    pageSize = 24,
  } = filter;

  const offset = (page - 1) * pageSize;

  // Build conditions
  const conditions = [];

  // Tenant scope
  if (emailHash) {
    conditions.push(eq(aiAssetLibraryTable.emailHash, emailHash));
  }

  // Archived filter — default hide archived
  if (!showArchived) {
    conditions.push(eq(aiAssetLibraryTable.archived, false));
  }

  // Active only (non-replaced versions)
  conditions.push(eq(aiAssetLibraryTable.active, true));

  // Favorited
  if (favoritedOnly) {
    conditions.push(eq(aiAssetLibraryTable.favorited, true));
  }

  // Category
  if (category) {
    conditions.push(eq(aiAssetLibraryTable.category, category));
  }

  // Source filter (sourceId maps to category groups)
  if (sourceId) {
    const sourceCategoryMap: Record<string, string[]> = {
      project_assets: ["logo", "photo", "illustration", "icon", "document", "reference", "uploaded_image"],
      brand_library: ["logo", "brand_guideline", "icon"],
      generated_artifacts: ["generated_image"],
      uploaded_references: ["reference", "uploaded_image"],
      shared_approved: ["logo", "brand_guideline", "illustration"],
    };
    const cats = sourceCategoryMap[sourceId];
    if (cats) {
      conditions.push(
        or(...cats.map((c) => eq(aiAssetLibraryTable.category, c)))!,
      );
    }
  }

  // Project
  if (projectId) {
    conditions.push(eq(aiAssetLibraryTable.projectId, projectId));
  }

  // Search (title + fileName)
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(aiAssetLibraryTable.title, pattern),
        ilike(aiAssetLibraryTable.fileName, pattern),
      )!,
    );
  }

  // Tags (JSONB contains)
  if (tags && tags.length > 0) {
    conditions.push(
      sql`${aiAssetLibraryTable.tags} @> ${JSON.stringify(tags)}::jsonb`,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Sort
  const orderBy =
    sort === "oldest"
      ? asc(aiAssetLibraryTable.createdAt)
      : sort === "name"
        ? asc(aiAssetLibraryTable.title)
        : sort === "size"
          ? desc(aiAssetLibraryTable.fileSizeBytes)
          : desc(aiAssetLibraryTable.createdAt);

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(aiAssetLibraryTable)
      .where(where)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiAssetLibraryTable)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;
  const items: AssetBrowserItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    assetType: categoryToAssetType(row.category),
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] ?? row.category,
    sourceId: deriveSourceId(row.category),
    availability: row.archived ? "archived" : "available",
    previewUrl: row.previewUrl ?? null,
    mimeType: row.mimeType ?? null,
    fileSizeBytes: row.fileSizeBytes ?? null,
    version: row.version,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    uploadedBy: row.uploadedBy ?? null,
    tenantKey: row.emailHash,
    projectId: row.projectId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    previewExpired: false,
  }));

  return { items, total, page, pageSize };
}

/** Get a single asset by id with tenant guard. */
export async function getAssetBrowserItem(
  id: number,
  emailHash?: string,
): Promise<AssetBrowserItem | null> {
  const conditions = [eq(aiAssetLibraryTable.id, id)];
  if (emailHash) conditions.push(eq(aiAssetLibraryTable.emailHash, emailHash));

  const [row] = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(and(...conditions))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    assetType: categoryToAssetType(row.category),
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] ?? row.category,
    sourceId: deriveSourceId(row.category),
    availability: row.archived ? "archived" : "available",
    previewUrl: row.previewUrl ?? null,
    mimeType: row.mimeType ?? null,
    fileSizeBytes: row.fileSizeBytes ?? null,
    version: row.version,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    uploadedBy: row.uploadedBy ?? null,
    tenantKey: row.emailHash,
    projectId: row.projectId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    previewExpired: false,
  };
}

/** Toggle archive state on an asset, with tenant guard. */
export async function toggleAssetArchive(
  id: number,
  archive: boolean,
  emailHash?: string,
): Promise<AssetBrowserItem | null> {
  const conditions = [eq(aiAssetLibraryTable.id, id)];
  if (emailHash) conditions.push(eq(aiAssetLibraryTable.emailHash, emailHash));

  const [updated] = await db
    .update(aiAssetLibraryTable)
    .set({ archived: archive, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  if (!updated) return null;
  return getAssetBrowserItem(id);
}

/** List available source registrations (static, deterministic). */
export function listAssetBrowserSources(adminMode: boolean): AssetBrowserSource[] {
  const sources: AssetBrowserSource[] = [
    { id: "project_assets", label: "Project Assets", requiresAdmin: false },
    { id: "brand_library", label: "Brand Library", requiresAdmin: false },
    { id: "generated_artifacts", label: "Generated Artifacts", requiresAdmin: false },
    { id: "uploaded_references", label: "Uploaded References", requiresAdmin: false },
    { id: "shared_approved", label: "Shared Approved Library", requiresAdmin: true },
  ];
  return sources.filter((s) => !s.requiresAdmin || adminMode);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveSourceId(category: string): string {
  if (category === "generated_image") return "generated_artifacts";
  if (["logo", "brand_guideline", "icon"].includes(category)) return "brand_library";
  if (["reference", "uploaded_image"].includes(category)) return "uploaded_references";
  return "project_assets";
}
