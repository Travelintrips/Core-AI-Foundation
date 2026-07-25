/**
 * materialLibraryRepository — DB queries for the Interior Design Material Library.
 *
 * Single-responsibility: all SQL via Drizzle ORM. No business logic here.
 */

import { eq, ilike, and, or, asc, desc, count, max, SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { materialsTable, materialCategoriesTable } from "@workspace/db/schema";
import type {
  MaterialRecord,
  MaterialCategoryRecord,
  MaterialSearchParams,
  MaterialListResult,
  MaterialSortOption,
} from "./types.js";

const PAGE_SIZE_DEFAULT = 24;
const PAGE_SIZE_MAX = 100;

function buildSearchConditions(params: MaterialSearchParams): SQL[] {
  const conditions: SQL[] = [];

  // Status filter — default to active only
  const statusVal = params.status ?? "active";
  conditions.push(eq(materialsTable.status, statusVal));

  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(
      or(
        ilike(materialsTable.name, term),
        ilike(materialsTable.description, term),
        ilike(materialsTable.brand, term),
        ilike(materialsTable.materialType, term),
        ilike(materialsTable.subcategory, term),
      ) as SQL,
    );
  }

  if (params.category) {
    conditions.push(ilike(materialsTable.category, params.category));
  }

  if (params.brand) {
    conditions.push(ilike(materialsTable.brand, `%${params.brand}%`));
  }

  if (params.priceTier) {
    conditions.push(eq(materialsTable.priceTier, params.priceTier));
  }

  if (params.finish) {
    conditions.push(ilike(materialsTable.finish, `%${params.finish}%`));
  }

  if (params.color) {
    conditions.push(ilike(materialsTable.color, `%${params.color}%`));
  }

  return conditions;
}

function buildOrderBy(sort: MaterialSortOption = "name_asc") {
  switch (sort) {
    case "name_asc":     return [asc(materialsTable.name)];
    case "name_desc":    return [desc(materialsTable.name)];
    case "created_desc": return [desc(materialsTable.createdAt)];
    case "created_asc":  return [asc(materialsTable.createdAt)];
    case "category_asc": return [asc(materialsTable.category), asc(materialsTable.name)];
    // price_asc / price_desc: sort by CASE WHEN on priceTier text.
    // Drizzle doesn't support CASE expressions inline; fall back to name ordering.
    case "price_asc":    return [asc(materialsTable.priceTier), asc(materialsTable.name)];
    case "price_desc":   return [desc(materialsTable.priceTier), asc(materialsTable.name)];
    default:             return [asc(materialsTable.name)];
  }
}

export async function findMaterials(params: MaterialSearchParams): Promise<MaterialListResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PAGE_SIZE_DEFAULT));
  const offset = (page - 1) * pageSize;

  const conditions = buildSearchConditions(params);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = buildOrderBy(params.sort);

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(materialsTable)
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(materialsTable)
      .where(where),
  ]);

  const total = Number(totalRows[0]?.count ?? 0);
  const totalPages = Math.ceil(total / pageSize);

  return {
    items: rows as MaterialRecord[],
    total,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  };
}

export async function findMaterialById(id: number): Promise<MaterialRecord | undefined> {
  const rows = await db
    .select()
    .from(materialsTable)
    .where(eq(materialsTable.id, id))
    .limit(1);
  return rows[0] as MaterialRecord | undefined;
}

/**
 * Additive read helper for Material Intelligence. It reads the canonical
 * active catalog in one query; the Phase 1 paginated contract is unchanged.
 */
export async function findAllActiveMaterials(): Promise<MaterialRecord[]> {
  const rows = await db
    .select()
    .from(materialsTable)
    .where(eq(materialsTable.status, "active"))
    .orderBy(asc(materialsTable.name), asc(materialsTable.id));
  return rows as MaterialRecord[];
}

export async function findMaterialByCode(code: string): Promise<MaterialRecord | undefined> {
  const rows = await db
    .select()
    .from(materialsTable)
    .where(eq(materialsTable.materialCode, code))
    .limit(1);
  return rows[0] as MaterialRecord | undefined;
}

export async function listCategories(): Promise<MaterialCategoryRecord[]> {
  const rows = await db
    .select()
    .from(materialCategoriesTable)
    .orderBy(asc(materialCategoriesTable.displayOrder));
  return rows as MaterialCategoryRecord[];
}

export async function upsertCategory(data: {
  name: string;
  icon: string;
  displayOrder: number;
}): Promise<void> {
  await db
    .insert(materialCategoriesTable)
    .values(data)
    .onConflictDoUpdate({
      target: materialCategoriesTable.name,
      set: { icon: data.icon, displayOrder: data.displayOrder },
    });
}

export async function upsertMaterial(data: {
  materialCode: string;
  name: string;
  slug: string;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  materialType?: string | null;
  color?: string | null;
  finish?: string | null;
  texture?: string | null;
  pattern?: string | null;
  description?: string | null;
  priceTier: string;
  thumbnailUrl?: string | null;
  previewImages?: string[] | null;
  technicalData?: Record<string, string> | null;
  searchKeywords?: string[] | null;
  status?: string;
}): Promise<void> {
  await db
    .insert(materialsTable)
    .values(data)
    .onConflictDoUpdate({
      target: materialsTable.materialCode,
      set: {
        name: data.name,
        slug: data.slug,
        category: data.category,
        subcategory: data.subcategory,
        brand: data.brand,
        materialType: data.materialType,
        color: data.color,
        finish: data.finish,
        texture: data.texture,
        pattern: data.pattern,
        description: data.description,
        priceTier: data.priceTier,
        thumbnailUrl: data.thumbnailUrl,
        previewImages: data.previewImages,
        technicalData: data.technicalData,
        searchKeywords: data.searchKeywords,
        status: data.status ?? "active",
        updatedAt: new Date(),
      },
    });
}

export async function countMaterials(): Promise<number> {
  const rows = await db.select({ count: count() }).from(materialsTable);
  return Number(rows[0]?.count ?? 0);
}

/**
 * A cheap catalog fingerprint for additive consumers such as Material
 * Intelligence. It deliberately uses the canonical table rather than a
 * duplicated in-memory catalog, and changes when a material is inserted or
 * updated.
 */
export async function getMaterialCatalogVersion(): Promise<string> {
  const [row] = await db
    .select({ count: count(), latestUpdatedAt: max(materialsTable.updatedAt) })
    .from(materialsTable);
  return `${Number(row?.count ?? 0)}:${row?.latestUpdatedAt?.toISOString() ?? "empty"}`;
}

export async function getDistinctBrands(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ brand: materialsTable.brand })
    .from(materialsTable)
    .where(eq(materialsTable.status, "active"))
    .orderBy(asc(materialsTable.brand));
  return rows.map((r) => r.brand).filter(Boolean) as string[];
}
