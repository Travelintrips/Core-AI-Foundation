import {
  findAllActiveMaterials,
  findMaterialById,
  getMaterialCatalogVersion,
} from "../material-library/materialLibraryRepository.js";
import type { MaterialRecord } from "../material-library/types.js";
import { MaterialCache } from "./materialCache.js";
import { getMaterialAnalytics, recordSearch } from "./materialAnalytics.js";
import { rankSimilarMaterials } from "./materialSimilarity.js";
import { rankMaterials } from "./materialSearchEngine.js";
import { buildMaterialSuggestions } from "./materialSuggestions.js";
import type {
  MaterialSearchInput,
  MaterialSearchResponse,
  MaterialSuggestionsResponse,
  SimilarMaterialsResponse,
} from "./types.js";

const CACHE_TTL_MS = 30_000;
const searchCache = new MaterialCache<MaterialSearchResponse>(CACHE_TTL_MS);
const suggestionCache = new MaterialCache<MaterialSuggestionsResponse>(CACHE_TTL_MS);
const similarCache = new MaterialCache<SimilarMaterialsResponse>(CACHE_TTL_MS);

let versionCache: { value: string; expiresAt: number } | undefined;
let catalogSnapshot: {
  version: string;
  materials: MaterialRecord[];
  expiresAt: number;
} | undefined;

export async function getCatalogMaterials(catalogVersion?: string): Promise<MaterialRecord[]> {
  const version = catalogVersion ?? await getCatalogVersion();
  const now = Date.now();
  if (catalogSnapshot && catalogSnapshot.version === version && catalogSnapshot.expiresAt > now) {
    return catalogSnapshot.materials;
  }
  const materials = await findAllActiveMaterials();
  catalogSnapshot = {
    version,
    materials,
    expiresAt: now + CACHE_TTL_MS,
  };
  return materials;
}

export async function getCatalogVersion(): Promise<string> {
  const now = Date.now();
  if (versionCache && versionCache.expiresAt > now) return versionCache.value;
  const version = await getMaterialCatalogVersion();
  versionCache = { value: version, expiresAt: now + 1_000 };
  searchCache.invalidate(version);
  suggestionCache.invalidate(version);
  similarCache.invalidate(version);
  return version;
}

export function resetMaterialIntelligenceCaches(): void {
  searchCache.clear();
  suggestionCache.clear();
  similarCache.clear();
  versionCache = undefined;
  catalogSnapshot = undefined;
}

export async function intelligentSearch(input: MaterialSearchInput): Promise<MaterialSearchResponse> {
  const started = performance.now();
  const catalogVersion = await getCatalogVersion();
  const normalizedInput = {
    query: input.query?.trim() ?? "",
    category: input.category?.trim() || undefined,
    brand: input.brand?.trim() || undefined,
    priceTier: input.priceTier?.trim() || undefined,
    style: input.style?.trim() || undefined,
    component: input.component?.trim() || undefined,
    color: input.color?.trim() || undefined,
    finish: input.finish?.trim() || undefined,
    material: input.material?.trim() || undefined,
    mode: input.mode ?? "hybrid",
    limit: Math.max(1, Math.min(100, input.limit ?? 20)),
  } satisfies MaterialSearchInput;
  const key = JSON.stringify(normalizedInput);
  const cached = searchCache.get(key, catalogVersion);
  if (cached) {
    recordSearch(normalizedInput.query ?? "", cached.items.map((item) => item.material), performance.now() - started, true);
    return { ...cached, cached: true, latencyMs: Number((performance.now() - started).toFixed(2)) };
  }

  const materials = await getCatalogMaterials(catalogVersion);
  const ranked = rankMaterials(materials, normalizedInput).slice(0, normalizedInput.limit);
  const response: MaterialSearchResponse = {
    items: ranked,
    total: ranked.length,
    query: normalizedInput.query ?? "",
    mode: normalizedInput.mode ?? "hybrid",
    catalogVersion,
    cached: false,
    latencyMs: Number((performance.now() - started).toFixed(2)),
  };
  searchCache.set(key, response, catalogVersion);
  recordSearch(normalizedInput.query ?? "", ranked.map((item) => item.material), response.latencyMs, false);
  return response;
}

export async function materialSuggestions(query: string, limit = 10): Promise<MaterialSuggestionsResponse> {
  const catalogVersion = await getCatalogVersion();
  const key = JSON.stringify({ query: query.trim(), limit });
  const cached = suggestionCache.get(key, catalogVersion);
  if (cached) return { ...cached, cached: true };
  const materials = await getCatalogMaterials(catalogVersion);
  const popular = getMaterialAnalytics().topKeywords.map((item) => item.value);
  const response: MaterialSuggestionsResponse = {
    suggestions: buildMaterialSuggestions(materials, query, popular, limit),
    query,
    catalogVersion,
    cached: false,
  };
  suggestionCache.set(key, response, catalogVersion);
  return response;
}

export async function similarMaterials(id: number, limit = 12): Promise<SimilarMaterialsResponse> {
  const catalogVersion = await getCatalogVersion();
  const key = JSON.stringify({ id, limit });
  const cached = similarCache.get(key, catalogVersion);
  if (cached) return { ...cached, cached: true };
  const source = await findMaterialById(id);
  if (!source) throw new Error(`Material ${id} not found`);
  const items = rankSimilarMaterials(source, await getCatalogMaterials(catalogVersion), limit);
  const response: SimilarMaterialsResponse = {
    items,
    materialId: id,
    catalogVersion,
    cached: false,
  };
  similarCache.set(key, response, catalogVersion);
  return response;
}

export { getMaterialAnalytics, rankMaterials, buildMaterialSuggestions, rankSimilarMaterials, MaterialCache };
export type * from "./types.js";