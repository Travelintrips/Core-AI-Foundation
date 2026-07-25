import type { MaterialRecord } from "../material-library/types.js";

export type MaterialSearchMode =
  | "exact"
  | "keyword"
  | "fuzzy"
  | "semantic-ready"
  | "hybrid";

export interface MaterialScoreBreakdown {
  exact: number;
  keyword: number;
  alias: number;
  category: number;
  brand: number;
  style: number;
  component: number;
  color: number;
  finish: number;
  material: number;
  semantic: number;
  total: number;
}

export interface RankedMaterial {
  material: MaterialRecord;
  score: MaterialScoreBreakdown;
  matchReasons: string[];
}

export interface MaterialSearchInput {
  query?: string;
  category?: string;
  brand?: string;
  priceTier?: string;
  style?: string;
  component?: string;
  color?: string;
  finish?: string;
  material?: string;
  mode?: MaterialSearchMode;
  limit?: number;
}

export interface MaterialSearchResponse {
  items: RankedMaterial[];
  total: number;
  query: string;
  mode: MaterialSearchMode;
  catalogVersion: string;
  cached: boolean;
  latencyMs: number;
}

export type MaterialSuggestionType =
  | "material"
  | "brand"
  | "category"
  | "subcategory"
  | "alias"
  | "popular";

export interface MaterialSuggestion {
  value: string;
  type: MaterialSuggestionType;
  score: number;
}

export interface MaterialSuggestionsResponse {
  suggestions: MaterialSuggestion[];
  query: string;
  catalogVersion: string;
  cached: boolean;
}

export interface SimilarMaterial {
  material: MaterialRecord;
  similarityScore: number;
  matchReasons: string[];
}

export interface SimilarMaterialsResponse {
  items: SimilarMaterial[];
  materialId: number;
  catalogVersion: string;
  cached: boolean;
}

export interface MaterialAnalyticsSnapshot {
  searchCount: number;
  topKeywords: Array<{ value: string; count: number }>;
  topMaterials: Array<{ materialId: number; name: string; count: number }>;
  topCategories: Array<{ value: string; count: number }>;
  averageResponseTimeMs: number;
  cacheHitRatio: number;
}