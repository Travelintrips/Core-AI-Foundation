/**
 * materialLibraryService — business logic for the Interior Design Material Library.
 *
 * Wraps the repository. No HTTP concerns here — only domain logic.
 */

import {
  findMaterials,
  findMaterialById,
  listCategories,
  getDistinctBrands,
} from "./materialLibraryRepository.js";
import type {
  MaterialSearchParams,
  MaterialListResult,
  MaterialRecord,
  MaterialCategoryRecord,
  MaterialSortOption,
  MaterialPriceTier,
  MaterialStatus,
} from "./types.js";
import {
  VALID_SORT_OPTIONS,
  VALID_PRICE_TIERS,
  VALID_STATUSES,
} from "./types.js";

export class MaterialNotFoundError extends Error {
  constructor(id: number) {
    super(`Material ${id} not found`);
    this.name = "MaterialNotFoundError";
  }
}

export class MaterialValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "MaterialValidationError";
    this.field = field;
  }
}

/** Parse and validate search params from raw query strings. */
export function parseSearchParams(query: Record<string, unknown>): MaterialSearchParams {
  const page = query["page"] ? Number(query["page"]) : 1;
  const pageSize = query["pageSize"] ? Number(query["pageSize"]) : 24;

  if (!Number.isFinite(page) || page < 1) {
    throw new MaterialValidationError("page", "page must be a positive integer");
  }
  if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new MaterialValidationError("pageSize", "pageSize must be between 1 and 100");
  }

  const sort = (query["sort"] as string | undefined);
  if (sort && !VALID_SORT_OPTIONS.includes(sort as MaterialSortOption)) {
    throw new MaterialValidationError(
      "sort",
      `sort must be one of: ${VALID_SORT_OPTIONS.join(", ")}`,
    );
  }

  const priceTier = (query["priceTier"] as string | undefined);
  if (priceTier && !VALID_PRICE_TIERS.includes(priceTier as MaterialPriceTier)) {
    throw new MaterialValidationError(
      "priceTier",
      `priceTier must be one of: ${VALID_PRICE_TIERS.join(", ")}`,
    );
  }

  const status = (query["status"] as string | undefined);
  if (status && !VALID_STATUSES.includes(status as MaterialStatus)) {
    throw new MaterialValidationError(
      "status",
      `status must be one of: ${VALID_STATUSES.join(", ")}`,
    );
  }

  return {
    search:    typeof query["search"] === "string" ? query["search"].trim() || undefined : undefined,
    category:  typeof query["category"] === "string" ? query["category"].trim() || undefined : undefined,
    brand:     typeof query["brand"] === "string" ? query["brand"].trim() || undefined : undefined,
    priceTier: priceTier as MaterialPriceTier | undefined,
    finish:    typeof query["finish"] === "string" ? query["finish"].trim() || undefined : undefined,
    color:     typeof query["color"] === "string" ? query["color"].trim() || undefined : undefined,
    status:    status as MaterialStatus | undefined,
    page,
    pageSize,
    sort:      (sort as MaterialSortOption | undefined) ?? "name_asc",
  };
}

export async function searchMaterials(params: MaterialSearchParams): Promise<MaterialListResult> {
  return findMaterials(params);
}

export async function getMaterialById(id: number): Promise<MaterialRecord> {
  const material = await findMaterialById(id);
  if (!material) throw new MaterialNotFoundError(id);
  return material;
}

export async function getCategories(): Promise<MaterialCategoryRecord[]> {
  return listCategories();
}

export async function getBrands(): Promise<string[]> {
  return getDistinctBrands();
}
