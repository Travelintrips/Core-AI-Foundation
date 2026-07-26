import type { MaterialAnalyticsSnapshot } from "./types.js";
import type { MaterialRecord } from "../material-library/types.js";

const keywordCounts = new Map<string, number>();
const materialCounts = new Map<number, { name: string; count: number }>();
const categoryCounts = new Map<string, number>();
let searchCount = 0;
let totalResponseTimeMs = 0;
let responseSamples = 0;
let cacheHits = 0;
let cacheMisses = 0;

export function recordSearch(
  query: string,
  results: MaterialRecord[],
  responseTimeMs: number,
  cached: boolean,
): void {
  searchCount++;
  totalResponseTimeMs += responseTimeMs;
  responseSamples++;
  if (cached) cacheHits++;
  else cacheMisses++;

  for (const keyword of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
  }
  for (const material of results.slice(0, 10)) {
    const current = materialCounts.get(material.id) ?? { name: material.name, count: 0 };
    current.count++;
    materialCounts.set(material.id, current);
    categoryCounts.set(material.category, (categoryCounts.get(material.category) ?? 0) + 1);
  }
}

export function getMaterialAnalytics(): MaterialAnalyticsSnapshot {
  const top = <T extends { count: number }>(items: T[]): T[] =>
    items.sort((a, b) => b.count - a.count).slice(0, 10);
  return {
    searchCount,
    topKeywords: top([...keywordCounts].map(([value, count]) => ({ value, count }))),
    topMaterials: top([...materialCounts].map(([materialId, value]) => ({ materialId, ...value }))),
    topCategories: top([...categoryCounts].map(([value, count]) => ({ value, count }))),
    averageResponseTimeMs: responseSamples === 0
      ? 0
      : Number((totalResponseTimeMs / responseSamples).toFixed(2)),
    cacheHitRatio: cacheHits + cacheMisses === 0
      ? 0
      : Number((cacheHits / (cacheHits + cacheMisses)).toFixed(4)),
  };
}

export function resetMaterialAnalytics(): void {
  keywordCounts.clear();
  materialCounts.clear();
  categoryCounts.clear();
  searchCount = 0;
  totalResponseTimeMs = 0;
  responseSamples = 0;
  cacheHits = 0;
  cacheMisses = 0;
}