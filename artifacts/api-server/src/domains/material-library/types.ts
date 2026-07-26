/**
 * Shared types for the Material Library Catalog domain.
 * No Zod imports — validation is done manually per api-server convention.
 */

export type MaterialPriceTier = "Budget" | "Standard" | "Premium" | "Luxury";
export type MaterialStatus = "active" | "inactive";

export interface MaterialRecord {
  id: number;
  materialCode: string;
  name: string;
  slug: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  materialType: string | null;
  color: string | null;
  finish: string | null;
  texture: string | null;
  pattern: string | null;
  description: string | null;
  priceTier: MaterialPriceTier;
  thumbnailUrl: string | null;
  previewImages: string[] | null;
  technicalData: Record<string, string> | null;
  searchKeywords: string[] | null;
  status: MaterialStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaterialCategoryRecord {
  id: number;
  name: string;
  icon: string;
  displayOrder: number;
  createdAt: Date;
}

export interface MaterialSearchParams {
  search?: string;
  category?: string;
  brand?: string;
  priceTier?: MaterialPriceTier;
  finish?: string;
  color?: string;
  status?: MaterialStatus;
  page?: number;
  pageSize?: number;
  sort?: MaterialSortOption;
}

export type MaterialSortOption =
  | "name_asc"
  | "name_desc"
  | "created_desc"
  | "created_asc"
  | "price_asc"
  | "price_desc"
  | "category_asc";

export interface MaterialListResult {
  items: MaterialRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

export const VALID_SORT_OPTIONS: MaterialSortOption[] = [
  "name_asc", "name_desc", "created_desc", "created_asc",
  "price_asc", "price_desc", "category_asc",
];

export const PRICE_TIER_ORDER: Record<MaterialPriceTier, number> = {
  Budget: 1, Standard: 2, Premium: 3, Luxury: 4,
};

export const VALID_PRICE_TIERS: MaterialPriceTier[] = ["Budget", "Standard", "Premium", "Luxury"];
export const VALID_STATUSES: MaterialStatus[] = ["active", "inactive"];
