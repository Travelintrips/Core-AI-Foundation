/**
 * WP-02 — Furniture & Object Library Service
 *
 * Business logic for furniture items, categories, brands, collections, tags.
 * No HTTP concerns — only domain logic.
 *
 * Status transitions:
 *   draft → published  (publish)
 *   published → archived (archive)
 *   archived → draft   (restore)
 *   any non-deleted → deleted_at set (soft delete)
 */

import { eq, and, or, ilike, asc, desc, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  furnitureCategoriesTable,
  furnitureBrandsTable,
  furnitureCollectionsTable,
  furnitureItemsTable,
  furnitureAssetsTable,
  furnitureTagsTable,
  furnitureItemTagsTable,
  type FurnitureCategory,
  type FurnitureBrand,
  type FurnitureCollection,
  type FurnitureItem,
  type FurnitureAsset,
  type FurnitureTag,
  type InsertFurnitureCategory,
  type InsertFurnitureBrand,
  type InsertFurnitureCollection,
  type InsertFurnitureItem,
  type InsertFurnitureTag,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Domain error ──────────────────────────────────────────────────────────────

export class FurnitureLibraryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "FurnitureLibraryError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function makeSlug(name: string): string {
  return `${slugify(name)}-${randomUUID().slice(0, 8)}`;
}

// ── Pagination meta ───────────────────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// FURNITURE ITEMS
// ─────────────────────────────────────────────────────────────────────────────

export interface ListFurnitureItemsOptions {
  search?: string;
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
  style?: string;
  furnitureType?: string;
  priceTier?: string;
  status?: string;
  tenantId?: string | null;
  includeDeleted?: boolean;
  sortBy?: "name" | "created_at" | "updated_at" | "status" | "price_tier";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface FurnitureItemWithExtras extends FurnitureItem {
  assets: FurnitureAsset[];
  tags: FurnitureTag[];
}

export async function listFurnitureItems(opts: ListFurnitureItemsOptions = {}): Promise<{
  data: FurnitureItem[];
  pagination: PaginationMeta;
}> {
  const page     = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(opts.pageSize ?? 20, 100);
  const offset   = (page - 1) * pageSize;

  const conditions: ReturnType<typeof eq>[] = [];

  // Soft-delete guard — default: exclude deleted
  if (!opts.includeDeleted) {
    conditions.push(isNull(furnitureItemsTable.deletedAt) as ReturnType<typeof eq>);
  }

  if (opts.status)       conditions.push(eq(furnitureItemsTable.status, opts.status));
  if (opts.categoryId)   conditions.push(eq(furnitureItemsTable.categoryId, opts.categoryId));
  if (opts.brandId)      conditions.push(eq(furnitureItemsTable.brandId, opts.brandId));
  if (opts.collectionId) conditions.push(eq(furnitureItemsTable.collectionId, opts.collectionId));
  if (opts.priceTier)    conditions.push(eq(furnitureItemsTable.priceTier, opts.priceTier));

  if (opts.style) {
    conditions.push(ilike(furnitureItemsTable.style, `%${opts.style}%`) as ReturnType<typeof eq>);
  }
  if (opts.furnitureType) {
    conditions.push(ilike(furnitureItemsTable.furnitureType, `%${opts.furnitureType}%`) as ReturnType<typeof eq>);
  }

  if (opts.search) {
    const term = `%${opts.search}%`;
    conditions.push(
      sql`(${furnitureItemsTable.name} ILIKE ${term}
        OR ${furnitureItemsTable.description} ILIKE ${term}
        OR ${furnitureItemsTable.furnitureType} ILIKE ${term}
        OR ${furnitureItemsTable.style} ILIKE ${term})` as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const sortCol = (() => {
    switch (opts.sortBy) {
      case "name":       return furnitureItemsTable.name;
      case "status":     return furnitureItemsTable.status;
      case "price_tier": return furnitureItemsTable.priceTier;
      case "created_at": return furnitureItemsTable.createdAt;
      default:           return furnitureItemsTable.updatedAt;
    }
  })();
  const order = opts.sortDir === "asc" ? asc(sortCol) : desc(sortCol);

  const [rows, countRow] = await Promise.all([
    db.select().from(furnitureItemsTable)
      .where(where)
      .orderBy(order)
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(furnitureItemsTable)
      .where(where),
  ]);

  const total = countRow[0]?.count ?? 0;
  return {
    data: rows,
    pagination: { total, page, pageSize, hasNext: offset + rows.length < total },
  };
}

export async function getFurnitureItem(id: string): Promise<FurnitureItemWithExtras | null> {
  const [row] = await db
    .select()
    .from(furnitureItemsTable)
    .where(eq(furnitureItemsTable.id, id))
    .limit(1);

  if (!row) return null;

  const [assets, tagJoins] = await Promise.all([
    db.select().from(furnitureAssetsTable)
      .where(eq(furnitureAssetsTable.furnitureItemId, id))
      .orderBy(asc(furnitureAssetsTable.sortOrder)),
    db.select({ tagId: furnitureItemTagsTable.tagId })
      .from(furnitureItemTagsTable)
      .where(eq(furnitureItemTagsTable.furnitureItemId, id)),
  ]);

  let tags: FurnitureTag[] = [];
  if (tagJoins.length > 0) {
    tags = await db.select()
      .from(furnitureTagsTable)
      .where(inArray(furnitureTagsTable.id, tagJoins.map(j => j.tagId)));
  }

  return { ...row, assets, tags };
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateFurnitureItemInput {
  code?: string;
  name: string;
  nameId?: string;
  slug?: string;
  description?: string;
  categoryId: string;
  brandId?: string | null;
  collectionId?: string | null;
  style?: string | null;
  furnitureType?: string | null;
  primaryMaterials?: string[];
  finishes?: string[];
  colors?: string[];
  dimensions?: { widthCm: number; depthCm: number; heightCm: number; weightKg?: number | null; seatHeightCm?: number | null };
  priceTier?: string;
  sku?: string | null;
  thumbnailUrl?: string | null;
  previewImages?: string[];
  searchKeywords?: string[];
  tenantId?: string | null;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export async function createFurnitureItem(input: CreateFurnitureItemInput): Promise<FurnitureItem> {
  // Verify category exists
  const [cat] = await db.select({ id: furnitureCategoriesTable.id })
    .from(furnitureCategoriesTable)
    .where(eq(furnitureCategoriesTable.id, input.categoryId))
    .limit(1);
  if (!cat) {
    throw new FurnitureLibraryError("Category not found", "CATEGORY_NOT_FOUND", 400);
  }

  const slug = input.slug ?? makeSlug(input.name);
  const code = input.code ?? `FRN-${randomUUID().slice(0, 8).toUpperCase()}`;

  const [item] = await db
    .insert(furnitureItemsTable)
    .values({
      code,
      name:             input.name,
      nameId:           input.nameId ?? "",
      slug,
      description:      input.description ?? null,
      categoryId:       input.categoryId,
      brandId:          input.brandId ?? null,
      collectionId:     input.collectionId ?? null,
      style:            input.style ?? null,
      furnitureType:    input.furnitureType ?? null,
      primaryMaterials: input.primaryMaterials ?? [],
      finishes:         input.finishes ?? [],
      colors:           input.colors ?? [],
      dimensions:       input.dimensions ?? { widthCm: 0, depthCm: 0, heightCm: 0 },
      priceTier:        input.priceTier ?? "mid",
      sku:              input.sku ?? null,
      thumbnailUrl:     input.thumbnailUrl ?? null,
      previewImages:    input.previewImages ?? [],
      searchKeywords:   input.searchKeywords ?? [],
      tenantId:         input.tenantId ?? null,
      createdBy:        input.createdBy ?? "admin",
      metadata:         input.metadata ?? {},
      status:           "draft",
      version:          1,
    } satisfies InsertFurnitureItem)
    .returning();

  await logAudit({
    module:       "furniture-library",
    action:       "furniture_item_created",
    resourceType: "furniture_item",
    resourceId:   item!.id,
    status:       "success",
    details:      { name: input.name, slug, code },
  });

  return item!;
}

// ── Update ────────────────────────────────────────────────────────────────────

export interface UpdateFurnitureItemInput {
  name?: string;
  nameId?: string;
  description?: string | null;
  categoryId?: string;
  brandId?: string | null;
  collectionId?: string | null;
  style?: string | null;
  furnitureType?: string | null;
  primaryMaterials?: string[];
  finishes?: string[];
  colors?: string[];
  dimensions?: { widthCm: number; depthCm: number; heightCm: number; weightKg?: number | null; seatHeightCm?: number | null };
  priceTier?: string;
  sku?: string | null;
  thumbnailUrl?: string | null;
  previewImages?: string[];
  searchKeywords?: string[];
  metadata?: Record<string, unknown>;
}

export async function updateFurnitureItem(id: string, input: UpdateFurnitureItemInput): Promise<FurnitureItem> {
  const existing = await getFurnitureItem(id);
  if (!existing) {
    throw new FurnitureLibraryError("Furniture item not found", "NOT_FOUND", 404);
  }
  if (existing.deletedAt) {
    throw new FurnitureLibraryError("Cannot edit a deleted item. Restore it first.", "ITEM_DELETED", 409);
  }
  if (existing.status === "archived") {
    throw new FurnitureLibraryError("Cannot edit an archived item. Restore it first.", "ITEM_ARCHIVED", 409);
  }

  const [updated] = await db
    .update(furnitureItemsTable)
    .set({
      ...(input.name             !== undefined && { name: input.name }),
      ...(input.nameId           !== undefined && { nameId: input.nameId }),
      ...(input.description      !== undefined && { description: input.description }),
      ...(input.categoryId       !== undefined && { categoryId: input.categoryId }),
      ...(input.brandId          !== undefined && { brandId: input.brandId }),
      ...(input.collectionId     !== undefined && { collectionId: input.collectionId }),
      ...(input.style            !== undefined && { style: input.style }),
      ...(input.furnitureType    !== undefined && { furnitureType: input.furnitureType }),
      ...(input.primaryMaterials !== undefined && { primaryMaterials: input.primaryMaterials }),
      ...(input.finishes         !== undefined && { finishes: input.finishes }),
      ...(input.colors           !== undefined && { colors: input.colors }),
      ...(input.dimensions       !== undefined && { dimensions: input.dimensions }),
      ...(input.priceTier        !== undefined && { priceTier: input.priceTier }),
      ...(input.sku              !== undefined && { sku: input.sku }),
      ...(input.thumbnailUrl     !== undefined && { thumbnailUrl: input.thumbnailUrl }),
      ...(input.previewImages    !== undefined && { previewImages: input.previewImages }),
      ...(input.searchKeywords   !== undefined && { searchKeywords: input.searchKeywords }),
      ...(input.metadata         !== undefined && { metadata: input.metadata }),
      updatedAt: new Date(),
    })
    .where(eq(furnitureItemsTable.id, id))
    .returning();

  await logAudit({
    module:       "furniture-library",
    action:       "furniture_item_updated",
    resourceType: "furniture_item",
    resourceId:   id,
    status:       "success",
  });

  return updated!;
}

// ── Publish ───────────────────────────────────────────────────────────────────

export async function publishFurnitureItem(id: string): Promise<FurnitureItem> {
  const existing = await getFurnitureItem(id);
  if (!existing) throw new FurnitureLibraryError("Furniture item not found", "NOT_FOUND", 404);
  if (existing.deletedAt) throw new FurnitureLibraryError("Cannot publish a deleted item.", "ITEM_DELETED", 409);
  if (existing.status !== "draft") {
    throw new FurnitureLibraryError(
      `Cannot publish: item is '${existing.status}'. Only draft items can be published.`,
      "INVALID_STATUS_TRANSITION", 409,
    );
  }

  const [updated] = await db
    .update(furnitureItemsTable)
    .set({ status: "published", version: existing.version + 1, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(furnitureItemsTable.id, id))
    .returning();

  await logAudit({
    module: "furniture-library", action: "furniture_item_published",
    resourceType: "furniture_item", resourceId: id, status: "success",
    details: { version: updated!.version },
  });

  return updated!;
}

// ── Archive ───────────────────────────────────────────────────────────────────

export async function archiveFurnitureItem(id: string): Promise<FurnitureItem> {
  const existing = await getFurnitureItem(id);
  if (!existing) throw new FurnitureLibraryError("Furniture item not found", "NOT_FOUND", 404);
  if (existing.deletedAt) throw new FurnitureLibraryError("Cannot archive a deleted item.", "ITEM_DELETED", 409);
  if (existing.status === "archived") throw new FurnitureLibraryError("Item is already archived.", "ALREADY_ARCHIVED", 409);

  const [updated] = await db
    .update(furnitureItemsTable)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(furnitureItemsTable.id, id))
    .returning();

  await logAudit({
    module: "furniture-library", action: "furniture_item_archived",
    resourceType: "furniture_item", resourceId: id, status: "success",
  });

  return updated!;
}

// ── Restore ───────────────────────────────────────────────────────────────────

export async function restoreFurnitureItem(id: string): Promise<FurnitureItem> {
  const existing = await getFurnitureItem(id);
  if (!existing) throw new FurnitureLibraryError("Furniture item not found", "NOT_FOUND", 404);
  if (existing.status !== "archived" && !existing.deletedAt) {
    throw new FurnitureLibraryError("Item is not archived or deleted.", "NOT_ARCHIVED", 409);
  }

  const [updated] = await db
    .update(furnitureItemsTable)
    .set({ status: "draft", archivedAt: null, deletedAt: null, updatedAt: new Date() })
    .where(eq(furnitureItemsTable.id, id))
    .returning();

  await logAudit({
    module: "furniture-library", action: "furniture_item_restored",
    resourceType: "furniture_item", resourceId: id, status: "success",
  });

  return updated!;
}

// ── Soft Delete ───────────────────────────────────────────────────────────────

export async function softDeleteFurnitureItem(id: string): Promise<FurnitureItem> {
  const existing = await getFurnitureItem(id);
  if (!existing) throw new FurnitureLibraryError("Furniture item not found", "NOT_FOUND", 404);
  if (existing.deletedAt) throw new FurnitureLibraryError("Item is already deleted.", "ALREADY_DELETED", 409);

  const [updated] = await db
    .update(furnitureItemsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(furnitureItemsTable.id, id))
    .returning();

  await logAudit({
    module: "furniture-library", action: "furniture_item_deleted",
    resourceType: "furniture_item", resourceId: id, status: "success",
  });

  return updated!;
}

// ── Duplicate ─────────────────────────────────────────────────────────────────

export async function duplicateFurnitureItem(id: string, createdBy = "admin"): Promise<FurnitureItem> {
  const source = await getFurnitureItem(id);
  if (!source) throw new FurnitureLibraryError("Furniture item not found", "NOT_FOUND", 404);

  const [copy] = await db
    .insert(furnitureItemsTable)
    .values({
      code:             `FRN-${randomUUID().slice(0, 8).toUpperCase()}`,
      name:             `${source.name} (Copy)`,
      nameId:           source.nameId,
      slug:             makeSlug(`${source.name}-copy`),
      description:      source.description,
      categoryId:       source.categoryId,
      brandId:          source.brandId,
      collectionId:     source.collectionId,
      style:            source.style,
      furnitureType:    source.furnitureType,
      primaryMaterials: source.primaryMaterials,
      finishes:         source.finishes,
      colors:           source.colors,
      dimensions:       source.dimensions,
      priceTier:        source.priceTier,
      sku:              source.sku ? `${source.sku}-COPY` : null,
      thumbnailUrl:     source.thumbnailUrl,
      previewImages:    source.previewImages,
      searchKeywords:   source.searchKeywords,
      tenantId:         source.tenantId,
      createdBy,
      metadata:         source.metadata,
      status:           "draft",
      version:          1,
    } satisfies InsertFurnitureItem)
    .returning();

  await logAudit({
    module: "furniture-library", action: "furniture_item_duplicated",
    resourceType: "furniture_item", resourceId: copy!.id, status: "success",
    details: { sourceId: id },
  });

  return copy!;
}

// ── Version history (via audit log) ──────────────────────────────────────────

export async function getFurnitureItemHistory(id: string): Promise<Record<string, unknown>[]> {
  // Fetch from audit log — module = furniture-library, resourceId = id
  const rows = await db.execute(
    sql`SELECT action, status, details, created_at
          FROM ai_platform.ai_audit_logs
         WHERE module = 'furniture-library'
           AND resource_id = ${id}
         ORDER BY created_at DESC
         LIMIT 100`
  );
  return rows.rows as Record<string, unknown>[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

export async function listFurnitureCategories(includeInactive = false): Promise<FurnitureCategory[]> {
  const where = includeInactive ? undefined : eq(furnitureCategoriesTable.isActive, true);
  return db.select().from(furnitureCategoriesTable)
    .where(where)
    .orderBy(asc(furnitureCategoriesTable.displayOrder), asc(furnitureCategoriesTable.name));
}

export interface CreateCategoryInput {
  code?: string;
  name: string;
  nameId?: string;
  slug?: string;
  parentId?: string | null;
  icon?: string;
  description?: string | null;
  displayOrder?: number;
  metadata?: Record<string, unknown>;
}

export async function createFurnitureCategory(input: CreateCategoryInput): Promise<FurnitureCategory> {
  const slug = input.slug ?? slugify(input.name);
  const code = input.code ?? slugify(input.name).toUpperCase().replace(/-/g, "_");
  const [row] = await db.insert(furnitureCategoriesTable)
    .values({ ...input, slug, code, nameId: input.nameId ?? "", icon: input.icon ?? "", displayOrder: input.displayOrder ?? 0, metadata: input.metadata ?? {} } satisfies InsertFurnitureCategory)
    .returning();
  return row!;
}

export async function updateFurnitureCategory(id: string, input: Partial<CreateCategoryInput>): Promise<FurnitureCategory> {
  const [updated] = await db.update(furnitureCategoriesTable)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(furnitureCategoriesTable.id, id))
    .returning();
  if (!updated) throw new FurnitureLibraryError("Category not found", "NOT_FOUND", 404);
  return updated;
}

export async function deleteFurnitureCategory(id: string): Promise<void> {
  // Soft via is_active = false (categories may have FKs)
  const [updated] = await db.update(furnitureCategoriesTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(furnitureCategoriesTable.id, id))
    .returning({ id: furnitureCategoriesTable.id });
  if (!updated) throw new FurnitureLibraryError("Category not found", "NOT_FOUND", 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// BRANDS
// ─────────────────────────────────────────────────────────────────────────────

export async function listFurnitureBrands(status?: string): Promise<FurnitureBrand[]> {
  const where = status ? eq(furnitureBrandsTable.status, status) : undefined;
  return db.select().from(furnitureBrandsTable)
    .where(where)
    .orderBy(asc(furnitureBrandsTable.displayOrder), asc(furnitureBrandsTable.name));
}

export interface CreateBrandInput {
  code?: string;
  name: string;
  slug?: string;
  countryOfOrigin?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  status?: string;
  displayOrder?: number;
  metadata?: Record<string, unknown>;
}

export async function createFurnitureBrand(input: CreateBrandInput): Promise<FurnitureBrand> {
  const slug = input.slug ?? slugify(input.name);
  const code = input.code ?? `BRN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(furnitureBrandsTable)
    .values({ ...input, slug, code, status: input.status ?? "active", displayOrder: input.displayOrder ?? 0, metadata: input.metadata ?? {} } satisfies InsertFurnitureBrand)
    .returning();
  return row!;
}

export async function updateFurnitureBrand(id: string, input: Partial<CreateBrandInput>): Promise<FurnitureBrand> {
  const [updated] = await db.update(furnitureBrandsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(furnitureBrandsTable.id, id))
    .returning();
  if (!updated) throw new FurnitureLibraryError("Brand not found", "NOT_FOUND", 404);
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function listFurnitureCollections(brandId?: string): Promise<FurnitureCollection[]> {
  const where = brandId ? eq(furnitureCollectionsTable.brandId, brandId) : undefined;
  return db.select().from(furnitureCollectionsTable)
    .where(where)
    .orderBy(asc(furnitureCollectionsTable.displayOrder), asc(furnitureCollectionsTable.name));
}

export interface CreateCollectionInput {
  code?: string;
  name: string;
  slug?: string;
  brandId?: string | null;
  description?: string | null;
  style?: string | null;
  launchYear?: number | null;
  status?: string;
  displayOrder?: number;
  metadata?: Record<string, unknown>;
}

export async function createFurnitureCollection(input: CreateCollectionInput): Promise<FurnitureCollection> {
  const slug = input.slug ?? slugify(input.name);
  const code = input.code ?? `COL-${randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(furnitureCollectionsTable)
    .values({ ...input, slug, code, status: input.status ?? "active", displayOrder: input.displayOrder ?? 0, metadata: input.metadata ?? {} } satisfies InsertFurnitureCollection)
    .returning();
  return row!;
}

export async function updateFurnitureCollection(id: string, input: Partial<CreateCollectionInput>): Promise<FurnitureCollection> {
  const [updated] = await db.update(furnitureCollectionsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(furnitureCollectionsTable.id, id))
    .returning();
  if (!updated) throw new FurnitureLibraryError("Collection not found", "NOT_FOUND", 404);
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAGS
// ─────────────────────────────────────────────────────────────────────────────

export async function listFurnitureTags(): Promise<FurnitureTag[]> {
  return db.select().from(furnitureTagsTable)
    .orderBy(asc(furnitureTagsTable.displayOrder), asc(furnitureTagsTable.name));
}

export async function createFurnitureTag(input: { name: string; slug?: string; description?: string | null; displayOrder?: number }): Promise<FurnitureTag> {
  const slug = input.slug ?? slugify(input.name);
  const [row] = await db.insert(furnitureTagsTable)
    .values({ name: input.name, slug, description: input.description ?? null, displayOrder: input.displayOrder ?? 0 } satisfies InsertFurnitureTag)
    .returning();
  return row!;
}

export async function updateFurnitureTag(id: string, input: { name?: string; description?: string | null; displayOrder?: number }): Promise<FurnitureTag> {
  const [updated] = await db.update(furnitureTagsTable)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(furnitureTagsTable.id, id))
    .returning();
  if (!updated) throw new FurnitureLibraryError("Tag not found", "NOT_FOUND", 404);
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED
// ─────────────────────────────────────────────────────────────────────────────

export async function seedFurnitureCatalog(): Promise<{
  categories: number;
  brands: number;
  collections: number;
  tags: number;
  items: number;
}> {
  // ── Categories (12) ──────────────────────────────────────────────────────────
  const categorySeeds: InsertFurnitureCategory[] = [
    { code: "seating",           name: "Seating",           nameId: "Kursi & Sofa",        slug: "seating",           icon: "🛋️", displayOrder: 1,  metadata: {}, isActive: true },
    { code: "tables",            name: "Tables",            nameId: "Meja",                 slug: "tables",            icon: "🪑", displayOrder: 2,  metadata: {}, isActive: true },
    { code: "storage",           name: "Storage",           nameId: "Lemari & Rak",         slug: "storage",           icon: "🗄️", displayOrder: 3,  metadata: {}, isActive: true },
    { code: "beds",              name: "Beds & Bedroom",    nameId: "Tempat Tidur",         slug: "beds",              icon: "🛏️", displayOrder: 4,  metadata: {}, isActive: true },
    { code: "outdoor",           name: "Outdoor",           nameId: "Furnitur Luar Ruang",  slug: "outdoor",           icon: "🌿", displayOrder: 5,  metadata: {}, isActive: true },
    { code: "lighting",          name: "Lighting",          nameId: "Pencahayaan",          slug: "lighting",          icon: "💡", displayOrder: 6,  metadata: {}, isActive: true },
    { code: "rugs_textiles",     name: "Rugs & Textiles",   nameId: "Karpet & Tekstil",     slug: "rugs-textiles",     icon: "🧶", displayOrder: 7,  metadata: {}, isActive: true },
    { code: "decor",             name: "Decorative Objects",nameId: "Dekorasi",             slug: "decor",             icon: "🏺", displayOrder: 8,  metadata: {}, isActive: true },
    { code: "office",            name: "Office",            nameId: "Furnitur Kantor",      slug: "office",            icon: "💼", displayOrder: 9,  metadata: {}, isActive: true },
    { code: "bathroom",          name: "Bathroom",          nameId: "Kamar Mandi",          slug: "bathroom",          icon: "🚿", displayOrder: 10, metadata: {}, isActive: true },
    { code: "kitchen_dining",    name: "Kitchen & Dining",  nameId: "Dapur & Makan",        slug: "kitchen-dining",    icon: "🍳", displayOrder: 11, metadata: {}, isActive: true },
    { code: "children",          name: "Children",          nameId: "Furnitur Anak",        slug: "children",          icon: "🧸", displayOrder: 12, metadata: {}, isActive: true },
  ];

  let categoriesCount = 0;
  for (const c of categorySeeds) {
    const r = await db.insert(furnitureCategoriesTable).values(c)
      .onConflictDoNothing({ target: furnitureCategoriesTable.code })
      .returning({ id: furnitureCategoriesTable.id });
    if (r.length > 0) categoriesCount++;
  }

  // ── Brands (8) ───────────────────────────────────────────────────────────────
  const brandSeeds: InsertFurnitureBrand[] = [
    { code: "moroso",   name: "Moroso",    slug: "moroso",    countryOfOrigin: "Italy",  status: "active", displayOrder: 1, metadata: {} },
    { code: "cassina",  name: "Cassina",   slug: "cassina",   countryOfOrigin: "Italy",  status: "active", displayOrder: 2, metadata: {} },
    { code: "muuto",    name: "Muuto",     slug: "muuto",     countryOfOrigin: "Denmark",status: "active", displayOrder: 3, metadata: {} },
    { code: "hay",      name: "HAY",       slug: "hay",       countryOfOrigin: "Denmark",status: "active", displayOrder: 4, metadata: {} },
    { code: "ethnicraft",name: "Ethnicraft",slug: "ethnicraft",countryOfOrigin: "Belgium",status: "active", displayOrder: 5, metadata: {} },
    { code: "vitra",    name: "Vitra",     slug: "vitra",     countryOfOrigin: "Switzerland", status: "active", displayOrder: 6, metadata: {} },
    { code: "jepara_craft", name: "Jepara Craft", slug: "jepara-craft", countryOfOrigin: "Indonesia", status: "active", displayOrder: 7, metadata: {} },
    { code: "dekoruma", name: "Dekoruma",  slug: "dekoruma",  countryOfOrigin: "Indonesia", status: "active", displayOrder: 8, metadata: {} },
  ];

  let brandsCount = 0;
  for (const b of brandSeeds) {
    const r = await db.insert(furnitureBrandsTable).values(b)
      .onConflictDoNothing({ target: furnitureBrandsTable.code })
      .returning({ id: furnitureBrandsTable.id });
    if (r.length > 0) brandsCount++;
  }

  // ── Collections (10) ─────────────────────────────────────────────────────────
  const brands = await db.select({ id: furnitureBrandsTable.id, code: furnitureBrandsTable.code }).from(furnitureBrandsTable);
  const brandMap = Object.fromEntries(brands.map(b => [b.code, b.id]));

  const collectionSeeds: InsertFurnitureCollection[] = [
    { code: "muuto_around",   name: "Around",         slug: "around",        brandId: brandMap["muuto"],        style: "Scandinavian",    status: "active", displayOrder: 1, metadata: {} },
    { code: "hay_about_chair",name: "About A Chair",  slug: "about-a-chair", brandId: brandMap["hay"],          style: "Scandinavian",    status: "active", displayOrder: 2, metadata: {} },
    { code: "vitra_eames",    name: "Eames Collection",slug: "eames-collection", brandId: brandMap["vitra"],    style: "Mid-Century Modern", status: "active", displayOrder: 3, metadata: {} },
    { code: "cassina_lc",     name: "LC Series",      slug: "lc-series",     brandId: brandMap["cassina"],      style: "Bauhaus",         status: "active", displayOrder: 4, metadata: {} },
    { code: "ethnicraft_teak",name: "Teak Originals", slug: "teak-originals",brandId: brandMap["ethnicraft"],   style: "Natural",         status: "active", displayOrder: 5, metadata: {} },
    { code: "jepara_ukir",    name: "Ukir Klasik",    slug: "ukir-klasik",   brandId: brandMap["jepara_craft"], style: "Traditional Javanese", status: "active", displayOrder: 6, metadata: {} },
    { code: "dekoruma_urban", name: "Urban Series",   slug: "urban-series",  brandId: brandMap["dekoruma"],     style: "Modern",          status: "active", displayOrder: 7, metadata: {} },
    { code: "muuto_under",    name: "Under the Bell", slug: "under-the-bell",brandId: brandMap["muuto"],        style: "Scandinavian",    status: "active", displayOrder: 8, metadata: {} },
    { code: "hay_copenhague", name: "Copenhague",     slug: "copenhague",    brandId: brandMap["hay"],          style: "Modern Classic",  status: "active", displayOrder: 9, metadata: {} },
    { code: "vitra_prouve",   name: "Prouvé Collection",slug: "prouve-collection", brandId: brandMap["vitra"], style: "Industrial",      status: "active", displayOrder: 10, metadata: {} },
  ];

  let collectionsCount = 0;
  for (const c of collectionSeeds) {
    const r = await db.insert(furnitureCollectionsTable).values(c)
      .onConflictDoNothing({ target: furnitureCollectionsTable.code })
      .returning({ id: furnitureCollectionsTable.id });
    if (r.length > 0) collectionsCount++;
  }

  // ── Tags (6) ──────────────────────────────────────────────────────────────────
  const tagSeeds: InsertFurnitureTag[] = [
    { name: "Bestseller",    slug: "bestseller",    displayOrder: 1 },
    { name: "New Arrival",   slug: "new-arrival",   displayOrder: 2 },
    { name: "Eco-Friendly",  slug: "eco-friendly",  displayOrder: 3 },
    { name: "Award Winning", slug: "award-winning", displayOrder: 4 },
    { name: "Limited Edition",slug: "limited-edition", displayOrder: 5 },
    { name: "Local Craft",   slug: "local-craft",   displayOrder: 6 },
  ];

  let tagsCount = 0;
  for (const t of tagSeeds) {
    const r = await db.insert(furnitureTagsTable).values(t)
      .onConflictDoNothing({ target: furnitureTagsTable.name })
      .returning({ id: furnitureTagsTable.id });
    if (r.length > 0) tagsCount++;
  }

  // ── Items (20) ────────────────────────────────────────────────────────────────
  const cats  = await db.select({ id: furnitureCategoriesTable.id, code: furnitureCategoriesTable.code }).from(furnitureCategoriesTable);
  const catMap = Object.fromEntries(cats.map(c => [c.code, c.id]));

  const itemSeeds = [
    { code: "FRN-SOFA-001", name: "Oslo 3-Seat Sofa", nameId: "Sofa Oslo 3-Dudukan", slug: "oslo-3-seat-sofa", categoryCode: "seating", style: "Scandinavian", furnitureType: "sofa", priceTier: "premium" as const, primaryMaterials: ["solid_oak", "wool_fabric"], colors: ["light_grey", "charcoal"], dimensions: { widthCm: 220, depthCm: 85, heightCm: 78 } },
    { code: "FRN-SOFA-002", name: "Jepara Teak Sofa Set", nameId: "Set Sofa Jati Jepara", slug: "jepara-teak-sofa-set", categoryCode: "seating", style: "Traditional Javanese", furnitureType: "sofa", priceTier: "mid" as const, primaryMaterials: ["teak"], colors: ["teak_natural", "brown"], dimensions: { widthCm: 180, depthCm: 80, heightCm: 75 } },
    { code: "FRN-CHAIR-001", name: "Shell Lounge Chair", nameId: "Kursi Lounge Shell", slug: "shell-lounge-chair", categoryCode: "seating", style: "Mid-Century Modern", furnitureType: "lounge_chair", priceTier: "premium" as const, primaryMaterials: ["fiberglass", "aluminum"], colors: ["off_white", "black"], dimensions: { widthCm: 65, depthCm: 62, heightCm: 76, seatHeightCm: 42 } },
    { code: "FRN-CHAIR-002", name: "Rattan Accent Chair", nameId: "Kursi Ratan Aksen", slug: "rattan-accent-chair", categoryCode: "seating", style: "Tropical Contemporary", furnitureType: "accent_chair", priceTier: "mid" as const, primaryMaterials: ["rattan", "cotton"], colors: ["natural", "cream"], dimensions: { widthCm: 72, depthCm: 70, heightCm: 80, seatHeightCm: 44 } },
    { code: "FRN-TABLE-001", name: "Oval Travertine Dining Table", nameId: "Meja Makan Oval Travertine", slug: "oval-travertine-dining-table", categoryCode: "kitchen_dining", style: "Modern Classic", furnitureType: "dining_table", priceTier: "luxury" as const, primaryMaterials: ["travertine", "stainless_steel"], colors: ["ivory", "gold"], dimensions: { widthCm: 200, depthCm: 100, heightCm: 75 } },
    { code: "FRN-TABLE-002", name: "Round Solid Oak Coffee Table", nameId: "Meja Kopi Bundar Kayu Oak", slug: "round-oak-coffee-table", categoryCode: "tables", style: "Scandinavian", furnitureType: "coffee_table", priceTier: "mid" as const, primaryMaterials: ["solid_oak"], colors: ["light_oak", "white_oak"], dimensions: { widthCm: 90, depthCm: 90, heightCm: 40 } },
    { code: "FRN-BED-001", name: "Platform Bed Frame — King", nameId: "Rangka Tempat Tidur Platform King", slug: "platform-bed-frame-king", categoryCode: "beds", style: "Minimalist Modern", furnitureType: "bed_frame", priceTier: "premium" as const, primaryMaterials: ["solid_walnut"], colors: ["walnut_dark", "natural_walnut"], dimensions: { widthCm: 200, depthCm: 210, heightCm: 35 } },
    { code: "FRN-BED-002", name: "Balinese Canopy Bed", nameId: "Tempat Tidur Canopy Bali", slug: "balinese-canopy-bed", categoryCode: "beds", style: "Balinese", furnitureType: "canopy_bed", priceTier: "premium" as const, primaryMaterials: ["teak", "cotton_canopy"], colors: ["teak_natural", "white"], dimensions: { widthCm: 180, depthCm: 200, heightCm: 220 } },
    { code: "FRN-STOR-001", name: "Modular Bookcase System", nameId: "Sistem Rak Buku Modular", slug: "modular-bookcase-system", categoryCode: "storage", style: "Scandinavian", furnitureType: "bookcase", priceTier: "mid" as const, primaryMaterials: ["MDF", "lacquer"], colors: ["white", "black", "dusty_pink"], dimensions: { widthCm: 160, depthCm: 30, heightCm: 200 } },
    { code: "FRN-STOR-002", name: "Teak Sideboard 3-Door", nameId: "Kabinet Samping Jati 3-Pintu", slug: "teak-sideboard-3-door", categoryCode: "storage", style: "Natural", furnitureType: "sideboard", priceTier: "mid" as const, primaryMaterials: ["teak"], colors: ["teak_natural"], dimensions: { widthCm: 180, depthCm: 45, heightCm: 80 } },
    { code: "FRN-LIGHT-001", name: "Wabi-Sabi Woven Pendant Light", nameId: "Lampu Gantung Anyam Wabi-Sabi", slug: "wabi-sabi-pendant-light", categoryCode: "lighting", style: "Wabi-Sabi", furnitureType: "pendant_light", priceTier: "mid" as const, primaryMaterials: ["bamboo", "natural_fiber"], colors: ["natural", "cream"], dimensions: { widthCm: 50, depthCm: 50, heightCm: 60 } },
    { code: "FRN-LIGHT-002", name: "Arch Floor Lamp Marble Base", nameId: "Lampu Lantai Arch Alas Marmer", slug: "arch-floor-lamp-marble-base", categoryCode: "lighting", style: "Modern Classic", furnitureType: "floor_lamp", priceTier: "premium" as const, primaryMaterials: ["marble", "brass", "linen"], colors: ["white_marble", "brass", "cream"], dimensions: { widthCm: 35, depthCm: 35, heightCm: 180 } },
    { code: "FRN-RUG-001", name: "Moroccan Wool Area Rug 200×300", nameId: "Karpet Wol Maroko 200×300", slug: "moroccan-wool-rug-200x300", categoryCode: "rugs_textiles", style: "Bohemian", furnitureType: "area_rug", priceTier: "premium" as const, primaryMaterials: ["wool"], colors: ["terracotta", "cream", "teal"], dimensions: { widthCm: 200, depthCm: 300, heightCm: 1 } },
    { code: "FRN-DECOR-001", name: "Travertine Vase Set", nameId: "Set Vas Travertine", slug: "travertine-vase-set", categoryCode: "decor", style: "Modern Classic", furnitureType: "vase", priceTier: "mid" as const, primaryMaterials: ["travertine"], colors: ["ivory", "beige"], dimensions: { widthCm: 15, depthCm: 15, heightCm: 35 } },
    { code: "FRN-DECOR-002", name: "Brass Geometric Mirror", nameId: "Cermin Geometri Kuningan", slug: "brass-geometric-mirror", categoryCode: "decor", style: "Art Deco", furnitureType: "mirror", priceTier: "mid" as const, primaryMaterials: ["brass", "glass"], colors: ["brass_antique"], dimensions: { widthCm: 80, depthCm: 5, heightCm: 100 } },
    { code: "FRN-OUT-001", name: "Teak Outdoor Dining Set 6", nameId: "Set Meja Makan Luar Jati 6 Kursi", slug: "teak-outdoor-dining-set-6", categoryCode: "outdoor", style: "Natural", furnitureType: "outdoor_dining_set", priceTier: "premium" as const, primaryMaterials: ["teak"], colors: ["teak_natural"], dimensions: { widthCm: 200, depthCm: 100, heightCm: 75 } },
    { code: "FRN-OFF-001", name: "Ergonomic Task Chair", nameId: "Kursi Ergonomis Kantor", slug: "ergonomic-task-chair", categoryCode: "office", style: "Modern", furnitureType: "task_chair", priceTier: "mid" as const, primaryMaterials: ["mesh", "aluminum"], colors: ["black", "dark_grey"], dimensions: { widthCm: 65, depthCm: 65, heightCm: 110, seatHeightCm: 50 } },
    { code: "FRN-OFF-002", name: "Walnut Standing Desk", nameId: "Meja Berdiri Walnut", slug: "walnut-standing-desk", categoryCode: "office", style: "Minimalist Modern", furnitureType: "standing_desk", priceTier: "premium" as const, primaryMaterials: ["solid_walnut", "steel"], colors: ["walnut_dark", "matte_black"], dimensions: { widthCm: 160, depthCm: 75, heightCm: 120 } },
    { code: "FRN-KIDS-001", name: "Children's Montessori Shelf", nameId: "Rak Montessori Anak", slug: "childrens-montessori-shelf", categoryCode: "children", style: "Minimalist Modern", furnitureType: "childrens_shelf", priceTier: "mid" as const, primaryMaterials: ["solid_pine", "non_toxic_paint"], colors: ["white", "natural_pine"], dimensions: { widthCm: 100, depthCm: 30, heightCm: 70 } },
    { code: "FRN-BATH-001", name: "Freestanding Teak Bath Caddy", nameId: "Baki Mandi Jati Berdiri", slug: "freestanding-teak-bath-caddy", categoryCode: "bathroom", style: "Natural", furnitureType: "bath_accessory", priceTier: "mid" as const, primaryMaterials: ["teak"], colors: ["teak_natural"], dimensions: { widthCm: 80, depthCm: 20, heightCm: 10 } },
  ];

  let itemsCount = 0;
  for (const i of itemSeeds) {
    const categoryId = catMap[i.categoryCode];
    if (!categoryId) continue;

    const r = await db.insert(furnitureItemsTable).values({
      code:             i.code,
      name:             i.name,
      nameId:           i.nameId,
      slug:             i.slug,
      categoryId,
      style:            i.style,
      furnitureType:    i.furnitureType,
      priceTier:        i.priceTier,
      primaryMaterials: i.primaryMaterials,
      colors:           i.colors,
      dimensions:       i.dimensions,
      status:           "published",
      publishedAt:      new Date(),
      createdBy:        "seed",
      metadata:         {},
      version:          1,
      finishes:         [],
      previewImages:    [],
      searchKeywords:   [i.name.toLowerCase(), i.furnitureType ?? "", i.style ?? ""].filter(Boolean),
    } satisfies InsertFurnitureItem)
      .onConflictDoNothing({ target: furnitureItemsTable.code })
      .returning({ id: furnitureItemsTable.id });
    if (r.length > 0) itemsCount++;
  }

  return { categories: categoriesCount, brands: brandsCount, collections: collectionsCount, tags: tagsCount, items: itemsCount };
}
