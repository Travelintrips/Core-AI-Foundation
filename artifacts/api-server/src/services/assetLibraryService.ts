/**
 * assetLibraryService.ts — V4.2D Customer Enterprise Asset Library
 *
 * Full CRUD for the customer-facing asset library: search, filter, preview,
 * rename, favorite, archive, replace (new version), download, tag, sort.
 * Versioned: every replace creates a new row; old version kept for history.
 */
import { createHash } from "crypto";
import { eq, and, desc, asc, ilike, sql } from "drizzle-orm";
import {
  db,
  aiAssetLibraryTable,
  creativeAiAssetsTable,
  ASSET_LIBRARY_CATEGORIES,
  type AiAssetLibraryItem,
  type InsertAiAssetLibraryItem,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { logAudit } from "./aiAuditService.js";
import { generateDownloadToken } from "./signedUrlService.js";

// ── View shape ────────────────────────────────────────────────────────────────

export interface AssetLibraryView {
  id: number;
  emailHash: string;
  projectId: string | null;
  category: string;
  categoryLabel: string;
  title: string;
  fileName: string;
  previewUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  checksum: string | null;
  version: number;
  active: boolean;
  archived: boolean;
  favorited: boolean;
  uploadedBy: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  logo:           "Logo",
  photo:          "Photo",
  illustration:   "Illustration",
  icon:           "Icon",
  document:       "Document",
  brand_guideline: "Brand Guideline",
  reference:      "Reference",
  generated_image: "Generated Image",
  uploaded_image: "Uploaded Image",
};

function toView(a: AiAssetLibraryItem): AssetLibraryView {
  return {
    id: a.id,
    emailHash: a.emailHash,
    projectId: a.projectId ?? null,
    category: a.category,
    categoryLabel: CATEGORY_LABELS[a.category] ?? a.category,
    title: a.title,
    fileName: a.fileName,
    previewUrl: a.previewUrl ?? null,
    mimeType: a.mimeType ?? null,
    fileSizeBytes: a.fileSizeBytes ?? null,
    checksum: a.checksum ?? null,
    version: a.version,
    active: a.active,
    archived: a.archived,
    favorited: a.favorited,
    uploadedBy: a.uploadedBy ?? null,
    tags: Array.isArray(a.tags) ? (a.tags as string[]) : [],
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ── Query ─────────────────────────────────────────────────────────────────────

export interface AssetLibraryFilters {
  category?: string;
  search?: string;
  favorited?: boolean;
  archived?: boolean;
  tags?: string[];
  sort?: "newest" | "oldest" | "name" | "size";
  projectId?: string;
  /** Maximum rows to return. Defaults to 500. Hard cap: 1000. */
  limit?: number;
}

export async function listAssetLibrary(
  emailHash: string,
  filters: AssetLibraryFilters = {},
): Promise<AssetLibraryView[]> {
  const showArchived = filters.archived === true;
  const rowLimit = Math.min(filters.limit ?? 500, 1000);

  const conditions = [
    eq(aiAssetLibraryTable.emailHash, emailHash),
    eq(aiAssetLibraryTable.active, true),
    eq(aiAssetLibraryTable.archived, showArchived),
  ];

  if (filters.category) conditions.push(eq(aiAssetLibraryTable.category, filters.category));
  if (filters.projectId) conditions.push(eq(aiAssetLibraryTable.projectId, filters.projectId));
  if (filters.favorited === true) conditions.push(eq(aiAssetLibraryTable.favorited, true));

  // Push text search to DB — avoids fetching all rows into JS memory
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      sql`(${aiAssetLibraryTable.title} ilike ${pattern} or ${aiAssetLibraryTable.fileName} ilike ${pattern})`,
    );
  }

  // Push tag filter to DB via JSONB containment
  if (filters.tags && filters.tags.length > 0) {
    // Match rows whose tags JSONB array contains at least one of the requested tags
    conditions.push(
      sql`${aiAssetLibraryTable.tags} ?| array[${sql.join(
        filters.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]`,
    );
  }

  // Determine ORDER BY in DB rather than sorting in JS
  let orderBy;
  if (filters.sort === "oldest") {
    orderBy = asc(aiAssetLibraryTable.createdAt);
  } else if (filters.sort === "name") {
    orderBy = asc(aiAssetLibraryTable.title);
  } else if (filters.sort === "size") {
    orderBy = desc(aiAssetLibraryTable.fileSizeBytes);
  } else {
    orderBy = desc(aiAssetLibraryTable.createdAt);
  }

  const rows = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(rowLimit);

  return rows.map(toView);
}

export async function getAssetLibraryItem(emailHash: string, id: number): Promise<AssetLibraryView | null> {
  const [row] = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.id, id), eq(aiAssetLibraryTable.emailHash, emailHash)));
  return row ? toView(row) : null;
}

export async function getAssetVersionHistory(emailHash: string, id: number): Promise<AssetLibraryView[]> {
  // Traverse the parentAssetId chain to get version history
  const rows = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(eq(aiAssetLibraryTable.emailHash, emailHash))
    .orderBy(desc(aiAssetLibraryTable.version));

  // Find the root item and all its versions
  const [current] = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.id, id), eq(aiAssetLibraryTable.emailHash, emailHash)));
  if (!current) return [];

  // Get all versions with the same fileName (simple grouping)
  return rows.filter((r) => r.fileName === current.fileName).map(toView);
}

// ── Write operations ──────────────────────────────────────────────────────────

export interface CreateAssetInput {
  emailHash: string;
  projectId?: string;
  category: string;
  title: string;
  fileName: string;
  storagePath?: string;
  previewUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  uploadedBy?: string;
  tags?: string[];
  sourceAssetId?: number;
  fileBuffer?: Buffer;
}

export async function createAssetLibraryItem(input: CreateAssetInput): Promise<AssetLibraryView> {
  if (!ASSET_LIBRARY_CATEGORIES.includes(input.category as never)) {
    throw new Error(`Invalid category: ${input.category}`);
  }

  let checksum: string | undefined;
  if (input.fileBuffer) {
    checksum = createHash("sha256").update(input.fileBuffer).digest("hex");
  }

  const row: InsertAiAssetLibraryItem = {
    emailHash: input.emailHash,
    projectId: input.projectId,
    category: input.category,
    title: input.title,
    fileName: input.fileName,
    storagePath: input.storagePath,
    previewUrl: input.previewUrl,
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes,
    checksum,
    version: 1,
    active: true,
    archived: false,
    favorited: false,
    uploadedBy: input.uploadedBy,
    sourceAssetId: input.sourceAssetId,
    tags: input.tags ?? [],
  };

  const [inserted] = await db.insert(aiAssetLibraryTable).values(row).returning();

  await publishSafe("asset_library_upload", {
    emailHash: input.emailHash,
    assetId: inserted.id,
    category: input.category,
    uploadedBy: input.uploadedBy,
  });

  await logAudit("asset-library", "asset_created", String(inserted.id), "ai_asset_library", "success", {
    category: input.category, fileName: input.fileName,
  });

  return toView(inserted);
}

export interface ReplaceAssetInput extends CreateAssetInput {
  parentId: number;
}

export async function replaceAssetLibraryItem(input: ReplaceAssetInput): Promise<AssetLibraryView> {
  const [existing] = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.id, input.parentId), eq(aiAssetLibraryTable.emailHash, input.emailHash)));
  if (!existing) throw new Error("Asset not found");

  // Deactivate existing
  await db
    .update(aiAssetLibraryTable)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(aiAssetLibraryTable.id, input.parentId));

  let checksum: string | undefined;
  if (input.fileBuffer) {
    checksum = createHash("sha256").update(input.fileBuffer).digest("hex");
  }

  const [inserted] = await db.insert(aiAssetLibraryTable).values({
    emailHash: input.emailHash,
    projectId: input.projectId ?? existing.projectId ?? undefined,
    category: input.category ?? existing.category,
    title: input.title ?? existing.title,
    fileName: input.fileName,
    storagePath: input.storagePath,
    previewUrl: input.previewUrl,
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes,
    checksum,
    version: existing.version + 1,
    parentAssetId: input.parentId,
    active: true,
    archived: false,
    favorited: existing.favorited,
    uploadedBy: input.uploadedBy,
    tags: input.tags ?? (Array.isArray(existing.tags) ? (existing.tags as string[]) : []),
  }).returning();

  await publishSafe("asset_library_replaced", {
    emailHash: input.emailHash,
    newAssetId: inserted.id,
    parentId: input.parentId,
    version: inserted.version,
  });

  return toView(inserted);
}

export async function renameAssetLibraryItem(emailHash: string, id: number, newTitle: string): Promise<AssetLibraryView | null> {
  const [updated] = await db
    .update(aiAssetLibraryTable)
    .set({ title: newTitle, updatedAt: new Date() })
    .where(and(eq(aiAssetLibraryTable.id, id), eq(aiAssetLibraryTable.emailHash, emailHash)))
    .returning();
  if (!updated) return null;

  await publishSafe("asset_library_renamed", { emailHash, assetId: id, newTitle });
  return toView(updated);
}

export async function toggleFavorite(emailHash: string, id: number): Promise<AssetLibraryView | null> {
  const [row] = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.id, id), eq(aiAssetLibraryTable.emailHash, emailHash)));
  if (!row) return null;

  const [updated] = await db
    .update(aiAssetLibraryTable)
    .set({ favorited: !row.favorited, updatedAt: new Date() })
    .where(eq(aiAssetLibraryTable.id, id))
    .returning();

  await publishSafe("asset_library_favorited", { emailHash, assetId: id, favorited: !row.favorited });
  return toView(updated);
}

export async function archiveAssetLibraryItem(emailHash: string, id: number): Promise<AssetLibraryView | null> {
  const [updated] = await db
    .update(aiAssetLibraryTable)
    .set({ archived: true, active: false, updatedAt: new Date() })
    .where(and(eq(aiAssetLibraryTable.id, id), eq(aiAssetLibraryTable.emailHash, emailHash)))
    .returning();
  if (!updated) return null;

  await publishSafe("asset_library_archived", { emailHash, assetId: id });
  return toView(updated);
}

export async function tagAssetLibraryItem(emailHash: string, id: number, tags: string[]): Promise<AssetLibraryView | null> {
  const [updated] = await db
    .update(aiAssetLibraryTable)
    .set({ tags, updatedAt: new Date() })
    .where(and(eq(aiAssetLibraryTable.id, id), eq(aiAssetLibraryTable.emailHash, emailHash)))
    .returning();
  if (!updated) return null;
  return toView(updated);
}

// ── Sign download ─────────────────────────────────────────────────────────────

export type AssetSignResult =
  | { ok: true; token: string; expiresAt: string; accessPath: string }
  | { ok: false; status: 404; error: string };

export async function signAssetLibraryDownload(
  emailHash: string,
  id: number,
  ttlSeconds = 3600,
): Promise<AssetSignResult> {
  const [row] = await db
    .select()
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.id, id), eq(aiAssetLibraryTable.emailHash, emailHash)));
  if (!row || !row.storagePath) return { ok: false, status: 404, error: "Asset not found" };

  // Use projectId as a dummy numeric project id for the token (hash into a stable int)
  const pseudoProjectId = Math.abs(
    row.emailHash.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0),
  );

  const token = generateDownloadToken(pseudoProjectId, row.storagePath, Math.min(ttlSeconds, 86400));
  const expiresAt = new Date(Date.now() + Math.min(ttlSeconds, 86400) * 1000).toISOString();

  await publishSafe("asset_library_download", {
    emailHash,
    assetId: id,
    category: row.category,
  });

  await logAudit("asset-library", "download_signed", String(id), "ai_asset_library", "success", { emailHash });

  return { ok: true, token, expiresAt, accessPath: `/public/files/access/${token}` };
}

// ── Promote AI asset → library ────────────────────────────────────────────────

export async function promoteCreativeAssetToLibrary(
  emailHash: string,
  sourceAssetId: number,
  opts: { category?: string; title?: string; uploadedBy?: string } = {},
): Promise<AssetLibraryView | null> {
  const [asset] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.id, sourceAssetId));
  if (!asset) return null;

  const category = opts.category ?? (asset.assetType === "image" ? "generated_image" : "document");
  const title = opts.title ?? `${asset.assetType} #${asset.id}`;
  const storagePath = asset.storagePath ?? asset.imageUrl ?? "";

  return createAssetLibraryItem({
    emailHash,
    projectId: asset.projectId,
    category,
    title,
    fileName: storagePath.split("/").pop() ?? `asset-${asset.id}`,
    storagePath,
    previewUrl: asset.thumbnailUrl ?? asset.imageUrl ?? undefined,
    mimeType: asset.assetType === "image" ? "image/png" : "application/pdf",
    uploadedBy: opts.uploadedBy ?? "ai",
    sourceAssetId,
  });
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function getAdminAssetLibraryStats() {
  const allActive = await db
    .select({ category: aiAssetLibraryTable.category, emailHash: aiAssetLibraryTable.emailHash, fileSizeBytes: aiAssetLibraryTable.fileSizeBytes })
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.active, true), eq(aiAssetLibraryTable.archived, false)));

  const byCategory: Record<string, number> = {};
  let totalBytes = 0;
  const customers = new Set<string>();
  for (const r of allActive) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    totalBytes += r.fileSizeBytes ?? 0;
    customers.add(r.emailHash);
  }

  return {
    totalAssets: allActive.length,
    totalCustomers: customers.size,
    totalStorageBytes: totalBytes,
    byCategory,
  };
}
